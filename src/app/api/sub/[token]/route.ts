import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { xuiGetInbounds, generateConfigLink, xuiGetNodeDomains } from '@/lib/xui';
import QRCode from 'qrcode';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const startTime = Date.now();
  try {
    const { token } = await params;
    const { searchParams } = new URL(req.url);
    const format = searchParams.get('format');
    const acceptHeader = req.headers.get('accept') || '';
    const isBrowser = acceptHeader.includes('text/html') && !format;

    // 1. Ищем клиента по токену подписки
    const t0 = Date.now();
    const client = await prisma.client.findUnique({
      where: { subscriptionToken: token },
      include: {
        company: true,
        template: true,
      },
    });
    const t1 = Date.now();
    console.log(`[SUB API BENCHMARK] Fetch client by token: ${t1 - t0}ms`);

    // 2. Получаем ссылку поддержки и домен из настроек
    const t2 = Date.now();
    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const t3 = Date.now();
    console.log(`[SUB API BENCHMARK] Fetch settings: ${t3 - t2}ms`);

    // Обработка веб-отвязки Telegram со страницы подписки
    const action = searchParams.get('action');
    if (action === 'unbind' && client) {
      await prisma.client.update({
        where: { id: client.id },
        data: {
          tgId: '',
          telegramUsername: '',
          telegramFirstName: '',
        },
      });

      // Записываем лог в БД
      await prisma.auditLog.create({
        data: {
          action: 'UNLINK_TELEGRAM',
          details: `Клиент ${client.name} (${client.email}) отвязал свой Telegram через веб-кабинет подписки`,
        },
      });

      const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      return NextResponse.redirect(`${appPanelUrl}/api/sub/${client.subscriptionToken}`);
    }

    const supportLink = settingsMap.get('btw_support_link') || 'https://t.me/btw_support_bot';
    const tgBotUsername = settingsMap.get('xui_telegram_bot_username') || '';

    // Проверяем активность подписки
    const now = new Date();
    const isExpired = client?.expiresAt ? new Date(client.expiresAt) < now : false;
    const isCompanyActive = client?.company?.isActive ?? false;
    const isClientActive = client?.isActive ?? false;

    const isActive = client && isClientActive && isCompanyActive && !isExpired;

    // --- СЦЕНАРИЙ 3: Запрос конфигурации AmneziaVPN (Архитектурный плейсхолдер) ---
    if (format === 'amnezia') {
      if (!client) {
        return new NextResponse(JSON.stringify({ error: 'Подписка не найдена' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      if (!isActive) {
        return new NextResponse(JSON.stringify({ error: 'Подписка недействительна или заблокирована' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }

      const nodeDomains = await xuiGetNodeDomains();
      const defaultDomain = settingsMap.get('xui_address') || 'vpn.btw.com';
      const nodeDomain = nodeDomains['0'] || defaultDomain;

      const amneziaConfig = generateAmneziaMockConfig(client, nodeDomain);

      return new NextResponse(amneziaConfig, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="btv-vpn-${client.vpnUuid.substring(0, 8)}.vpn"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // --- СЦЕНАРИЙ 1: Запрос из БРАУЗЕРА (показываем красивый веб-портал) ---
    if (isBrowser) {
      if (!client) {
        return new NextResponse(renderErrorPage('Подписка не найдена', 'Убедитесь в корректности ссылки или обратитесь в поддержку.'), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 404,
        });
      }

      if (!isActive) {
        let reason = 'Подписка приостановлена администратором.';
        if (isExpired) {
          reason = `Срок действия подписки истек ${new Date(client.expiresAt!).toLocaleDateString('ru-RU')}.`;
        } else if (!isCompanyActive) {
          reason = `Обслуживание вашей компании (${client.company.name}) временно приостановлено.`;
        }
        return new NextResponse(renderErrorPage('Доступ к VPN ограничен', reason, supportLink), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // Если активен — вычисляем лимиты и генерируем ссылки для ручного копирования
      const limitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : client.template.trafficLimitGB;
      const limitBytes = limitGB > 0 ? BigInt(limitGB) * BigInt(1024 * 1024 * 1024) : BigInt(0);
      const usedBytes = client.usedTrafficBytes;
      
      const usedGBText = (Number(usedBytes) / (1024 * 1024 * 1024)).toFixed(2);
      const limitGBText = limitGB > 0 ? `${limitGB} GB` : 'Безлимит';
      const progressPercent = limitGB > 0 
        ? Math.min(100, Math.round((Number(usedBytes) / Number(limitBytes)) * 100)) 
        : 0;

      // Динамически получаем доменные имена нод из API 3XUI
      const t4 = Date.now();
      const nodeDomains = await xuiGetNodeDomains();
      const t5 = Date.now();
      console.log(`[SUB API BENCHMARK] Get node domains: ${t5 - t4}ms`);

      let configLinks: string[] = [];
      const t6 = Date.now();
      try {
        const inbounds = await xuiGetInbounds();
        const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');

        const clientFlow = client.flow !== null ? client.flow : (client.template.flow || '');
        for (const inboundId of templateInboundIds) {
          const inbound = inbounds.find(i => i.id === inboundId);
          if (inbound) {
            const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
            const nodeDomain = nodeDomains[inboundNodeId] || nodeDomains['0'] || 'vpn.btw.com';
            const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain, clientFlow, client.name);
            if (link) configLinks.push(link);
          }
        }
      } catch (e) {}
      const t7 = Date.now();
      console.log(`[SUB API BENCHMARK] Fetch inbounds and gen config links: ${t7 - t6}ms`);

      // Отдаем красивую HTML страницу
      const t8 = Date.now();
      let qrCodeDataUrl = '';
      try {
        const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
        const personalSubUrl = `${appPanelUrl}/api/sub/${client.subscriptionToken}`;
        qrCodeDataUrl = await QRCode.toDataURL(personalSubUrl);
      } catch (qrErr) {}
      const t9 = Date.now();
      console.log(`[SUB API BENCHMARK] Generate QR code: ${t9 - t8}ms`);
      console.log(`[SUB API BENCHMARK] TOTAL TIME BROWSER SUB API: ${Date.now() - startTime}ms`);

      return new NextResponse(renderSubscriptionPortal(client, usedGBText, limitGBText, progressPercent, configLinks, supportLink, tgBotUsername, qrCodeDataUrl), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // --- СЦЕНАРИЙ 2: Запрос из VPN КЛИЕНТА (возвращаем Base64 список конфигов) ---
    if (!isActive) {
      // Для неактивных клиентов отдаем пустую подписку с заголовками лимитов
      const limitGB = client?.trafficLimitGB !== null && client?.trafficLimitGB !== undefined ? client.trafficLimitGB : (client?.template?.trafficLimitGB || 0);
      const limitBytes = limitGB > 0 ? BigInt(limitGB) * BigInt(1024 * 1024 * 1024) : BigInt(0);
      const usedBytes = client?.usedTrafficBytes || BigInt(0);
      const expiryTimestamp = client?.expiresAt ? Math.floor(new Date(client.expiresAt).getTime() / 1000) : 0;

      return new NextResponse('', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Subscription-Userinfo': `upload=0; download=${usedBytes.toString()}; total=${limitBytes.toString()}; expire=${expiryTimestamp}`,
          'profile-update-interval': '12',
        }
      });
    }

    // Получаем инбаунды и генерируем конфиги
    // Динамически получаем доменные имена нод из API 3XUI
    const t4 = Date.now();
    const nodeDomains = await xuiGetNodeDomains();
    const t5 = Date.now();
    console.log(`[SUB API BENCHMARK] (Client) Get node domains: ${t5 - t4}ms`);

    const t6 = Date.now();
    const inbounds = await xuiGetInbounds();
    const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');
    let configs: string[] = [];

    const clientFlow = client.flow !== null ? client.flow : (client.template.flow || '');
    for (const inboundId of templateInboundIds) {
      const inbound = inbounds.find(i => i.id === inboundId);
      if (inbound) {
        const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
        const nodeDomain = nodeDomains[inboundNodeId] || nodeDomains['0'] || 'vpn.btw.com';
        const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain, clientFlow, client.name);
        if (link) configs.push(link);
      }
    }
    const t7 = Date.now();
    console.log(`[SUB API BENCHMARK] (Client) Fetch inbounds and gen config links: ${t7 - t6}ms`);
    console.log(`[SUB API BENCHMARK] TOTAL TIME CLIENT SUB API: ${Date.now() - startTime}ms`);

    // Соединяем конфиги переносом строки и кодируем в Base64
    const subscriptionContent = configs.join('\n');
    const base64Content = Buffer.from(subscriptionContent).toString('base64');

    const limitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : client.template.trafficLimitGB;
    const limitBytes = limitGB > 0 ? BigInt(limitGB) * BigInt(1024 * 1024 * 1024) : BigInt(0);
    const usedBytes = client.usedTrafficBytes;
    const expiryTimestamp = client.expiresAt ? Math.floor(new Date(client.expiresAt).getTime() / 1000) : 0;

    return new NextResponse(base64Content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Subscription-Userinfo': `upload=0; download=${usedBytes.toString()}; total=${limitBytes.toString()}; expire=${expiryTimestamp}`,
        'profile-update-interval': '12',
      },
    });
  } catch (error: any) {
    console.error('Subscription Endpoint Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

/**
 * Рендер красивой HTML-страницы с ошибкой доступа
 */
function renderErrorPage(title: string, message: string, supportLink?: string): string {
  return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} | BTV VPN</title>
      <style>
        body {
          background: #08090c;
          color: #f3f4f6;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
        }
        .card {
          background: rgba(20, 26, 38, 0.65);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(239, 68, 68, 0.25);
          border-radius: 16px;
          padding: 30px;
          max-width: 450px;
          width: 100%;
          text-align: center;
          box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        }
        .icon {
          color: #ef4444;
          font-size: 48px;
          margin-bottom: 15px;
        }
        h1 {
          font-size: 22px;
          margin: 0 0 10px 0;
          font-weight: 600;
        }
        p {
          color: #9ca3af;
          font-size: 14px;
          line-height: 1.5;
          margin: 0 0 25px 0;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #a855f7, #7c3aed);
          color: white;
          padding: 12px 24px;
          border-radius: 10px;
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: transform 0.2s;
        }
        .btn:hover {
          transform: translateY(-2px);
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">⚠️</div>
        <h1>${title}</h1>
        <p>${message}</p>
        ${supportLink ? `<a href="${supportLink}" class="btn" target="_blank">Связаться с поддержкой</a>` : ''}
      </div>
    </body>
    </html>
  `;
}

/**
 * Рендер премиального портала подписки
 */
function renderSubscriptionPortal(
  client: any,
  usedGB: string,
  limitGB: string,
  progress: number,
  configLinks: string[],
  supportLink: string,
  tgBotUsername: string,
  qrCodeDataUrl: string
): string {
  const configsJson = JSON.stringify(configLinks);
  const expirationText = client.expiresAt 
    ? new Date(client.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Безлимитная';

  // Очищаем имя бота от возможного символа @ на входе
  const cleanTgBotUsername = tgBotUsername.replace(/^@/, '').trim();

  return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Личный кабинет VPN | BTV</title>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <style>
        body {
          background: #0a0c10;
          color: #f3f4f6;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }
        .container {
          max-width: 500px;
          width: 100%;
        }
        .header {
          text-align: center;
          margin-bottom: 20px;
        }
        .logo {
          font-size: 26px;
          font-weight: 800;
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .company-badge {
          display: inline-block;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 11px;
          color: #9ca3af;
          margin-top: 5px;
        }
        .card {
          background: rgba(20, 26, 38, 0.65);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 25px;
          box-shadow: 0 15px 35px rgba(0,0,0,0.6);
          margin-bottom: 20px;
        }
        h2 {
          font-size: 18px;
          margin: 0 0 20px 0;
          font-weight: 600;
          text-align: center;
        }
        .progress-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 25px;
        }
        .progress-circle {
          position: relative;
          width: 120px;
          height: 120px;
          margin-bottom: 15px;
        }
        .progress-circle svg {
          width: 120px;
          height: 120px;
          transform: rotate(-90deg);
        }
        .progress-circle circle {
          fill: none;
          stroke-width: 8;
        }
        .progress-circle .bg {
          stroke: rgba(255,255,255,0.05);
        }
        .progress-circle .bar {
          stroke: url(#gradient);
          stroke-dasharray: 351.8;
          stroke-dashoffset: ${351.8 - (351.8 * progress) / 100};
          stroke-linecap: round;
          transition: stroke-dashoffset 1s ease-in-out;
        }
        .progress-text {
          position: absolute;
          top: 0; left: 0; width: 100%; height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .progress-val {
          font-size: 22px;
          font-weight: 700;
        }
        .progress-label {
          font-size: 10px;
          color: #9ca3af;
          margin-top: 2px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin-bottom: 20px;
          border-top: 1px solid rgba(255,255,255,0.06);
          padding-top: 20px;
        }
        .stat-box {
          text-align: center;
        }
        .stat-val {
          font-size: 15px;
          font-weight: 600;
        }
        .stat-lbl {
          font-size: 10px;
          color: #6b7280;
          margin-top: 3px;
        }
        .actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .btn-sub {
          background: linear-gradient(135deg, #06b6d4, #0891b2);
          color: white;
          border: none;
          padding: 12px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, opacity 0.2s;
        }
        .btn-sub:hover {
          transform: translateY(-1px);
          opacity: 0.95;
        }
        .btn-tg {
          background: rgba(168, 85, 247, 0.1);
          border: 1px solid rgba(168, 85, 247, 0.3);
          color: #c084fc;
          padding: 12px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          text-align: center;
          cursor: pointer;
          transition: background 0.2s;
        }
        .btn-tg:hover {
          background: rgba(168, 85, 247, 0.15);
        }
        .configs-section {
          margin-top: 15px;
          border-top: 1px solid rgba(255,255,255,0.06);
          padding-top: 20px;
        }
        .config-item {
          background: rgba(0,0,0,0.25);
          border: 1px solid rgba(255,255,255,0.04);
          padding: 10px 15px;
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 12px;
        }
        .config-name {
          font-weight: 500;
          color: #e5e7eb;
        }
        .copy-link {
          color: #06b6d4;
          cursor: pointer;
          font-weight: 600;
        }
        .copy-link:hover {
          text-decoration: underline;
        }
        .toast {
          position: fixed;
          bottom: 20px;
          background: #10b981;
          color: white;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          display: none;
          animation: slideUp 0.3s;
        }
        @keyframes slideUp {
          from { transform: translateY(100px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">BTV VPN SERVICE</div>
          <div class="company-badge">${client.company.name}</div>
        </div>

        <div class="card">
          <h2>Привет, ${client.name}!</h2>
          
          <div class="progress-section">
            <div class="progress-circle">
              <svg>
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#06b6d4" />
                    <stop offset="100%" stop-color="#a855f7" />
                  </linearGradient>
                </defs>
                <circle class="bg" cx="60" cy="60" r="56" />
                <circle class="bar" cx="60" cy="60" r="56" />
              </svg>
              <div class="progress-text">
                <div class="progress-val">${progress}%</div>
                <div class="progress-label">использовано</div>
              </div>
            </div>
            <div style="font-size: 13px; color: #9ca3af;">
              Потрачено <strong>${usedGB} GB</strong> из <strong>${limitGB}</strong>
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-box">
              <div class="stat-val" style="color: #10b981;">Активна</div>
              <div class="stat-lbl">Статус VPN</div>
            </div>
            <div class="stat-box">
              <div class="stat-val">${expirationText}</div>
              <div class="stat-lbl">Действует до</div>
            </div>
          </div>

          <div class="actions">
            <button class="btn-sub" onclick="copySubscription()">Скопировать ссылку для приложений</button>
            <a href="${supportLink}" class="btn-tg" target="_blank">Связаться с техподдержкой</a>
          </div>

          <!-- Секция Быстрой настройки HAPP (Однокнопочный клиент) -->
          <div class="configs-section" style="border-top: 1px solid rgba(255,255,255,0.06); margin-top: 20px; padding-top: 20px;">
            <div style="font-size: 11px; color: #9ca3af; margin-bottom: 12px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>⚡ Быстрое подключение в 1 клик (Рекомендуется)</span>
            </div>
            <div style="background: rgba(6, 182, 212, 0.05); border: 1px solid rgba(6, 182, 212, 0.15); padding: 15px; border-radius: 12px; text-align: left; font-size: 12px; color: #9be9f8; line-height: 1.5; margin-bottom: 12px;">
              <strong style="color: #fff; display: block; margin-bottom: 6px;">Самый простой способ настройки:</strong>
              1. Скопируйте ссылку подписки кнопкой выше.<br/>
              2. Установите однокнопочное приложение <strong>Happ - Proxy Utility</strong>:<br/>
              <div style="display: flex; gap: 10px; margin: 10px 0;">
                <a href="https://apps.apple.com/app/happ-proxy-utility/id6475730248" target="_blank" class="btn-tg" style="flex: 1; text-align: center; padding: 8px; font-size: 11px; text-decoration: none; display: block; border-color: rgba(6, 182, 212, 0.3); color: #22d3ee;">🍏 Скачать для iOS</a>
                <a href="https://play.google.com/store/apps/details?id=com.happ.proxy" target="_blank" class="btn-tg" style="flex: 1; text-align: center; padding: 8px; font-size: 11px; text-decoration: none; display: block; border-color: rgba(6, 182, 212, 0.3); color: #22d3ee;">🤖 Скачать для Android</a>
              </div>
              3. Откройте приложение <strong>Happ</strong>, подтвердите автоматический импорт ссылки из буфера обмена и нажмите круглую кнопку подключения в центре. VPN готов к работе! 🎉
            </div>
          </div>

          <!-- Секция Telegram бота (Уведомления и контроль) -->
          ${cleanTgBotUsername ? `
            <div class="configs-section" style="border-top: 1px solid rgba(255,255,255,0.06); margin-top: 20px; padding-top: 20px;">
              <div style="font-size: 11px; color: #9ca3af; margin-bottom: 12px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <span>🤖 Уведомления и Бот в Telegram</span>
              </div>
              ${client.tgId ? `
                <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); padding: 15px; border-radius: 12px; text-align: left; font-size: 12px; color: #34d399; line-height: 1.5; margin-bottom: 12px;">
                  <strong style="color: #fff; display: block; margin-bottom: 4px;">✅ Telegram привязан:</strong>
                  Аккаунт: <b>${client.telegramUsername ? `@${client.telegramUsername}` : `имя: ${client.telegramFirstName || 'Пользователь'}`}</b> (ID: ${client.tgId})<br/>
                  Вы получаете автоматические оповещения о VPN-подключении в мессенджере.
                </div>
                <a href="?action=unbind" class="btn-sub" style="display: block; text-decoration: none; text-align: center; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.25); color: #f87171;">
                  ❌ Отвязать аккаунт Telegram
                </a>
              ` : `
                <div style="background: rgba(6, 182, 212, 0.05); border: 1px solid rgba(6, 182, 212, 0.15); padding: 15px; border-radius: 12px; text-align: left; font-size: 12px; color: #9be9f8; line-height: 1.5; margin-bottom: 12px;">
                  Привяжите нашего Telegram-бота, чтобы получать автоматические уведомления об окончании трафика или подписки и проверять баланс командой <b>/status</b>!
                </div>
                <a href="javascript:void(0)" onclick="openTgBot('https://t.me/${cleanTgBotUsername}?start=${client.subscriptionToken}')" class="btn-sub" style="display: block; text-decoration: none; text-align: center; background: linear-gradient(135deg, #0284c7, #0369a1);">
                  🔗 Привязать Telegram-бота
                </a>
              `}
            </div>
          ` : ''}

          <!-- Секция QR-кода подписки -->
          <div class="configs-section" style="border-top: 1px solid rgba(255,255,255,0.06); margin-top: 20px; padding-top: 20px; text-align: center;">
            <div style="font-size: 11px; color: #9ca3af; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>📱 QR-код подписки</span>
            </div>
            ${qrCodeDataUrl ? `
              <div style="background: #fff; padding: 15px; border-radius: 12px; display: inline-block; box-shadow: 0 5px 25px rgba(0,0,0,0.5); margin-bottom: 10px;">
                <img src="${qrCodeDataUrl}" alt="Subscription QR Code" style="width: 160px; height: 160px; display: block;" />
              </div>
              <div style="font-size: 11px; color: #6b7280; line-height: 1.4; max-width: 250px; margin: 0 auto;">
                Сканируйте в v2rayNG / Sing-box / Shadowrocket для быстрого импорта
              </div>
            ` : `
              <div style="font-size: 11px; color: var(--text-muted);">QR-код временно недоступен</div>
            `}
          </div>

          <!-- Секция AmneziaVPN (Архитектурный плейсхолдер) -->
          <div class="configs-section" style="border-top: 1px solid rgba(255,255,255,0.06); margin-top: 20px; padding-top: 20px;">
            <div style="font-size: 11px; color: #9ca3af; margin-bottom: 12px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <span>🛡️ Резервный канал AmneziaVPN</span>
            </div>
            <div style="background: rgba(168, 85, 247, 0.05); border: 1px solid rgba(168, 85, 247, 0.15); padding: 15px; border-radius: 12px; text-align: left; font-size: 12px; color: #d8b4fe; line-height: 1.5; margin-bottom: 12px;">
              <strong style="color: #fff; display: block; margin-bottom: 4px;">Как подключиться:</strong>
              1. Скачайте файл конфигурации по кнопке ниже.<br/>
              2. Установите официальный клиент <strong>AmneziaVPN</strong>.<br/>
              3. Выберите «Импортировать резервную копию или файл настройки» и откройте скачанный <strong>.vpn</strong> файл.
            </div>
            <button class="btn-tg" style="width: 100%; display: block; border-color: rgba(168, 85, 247, 0.4); color: #e9d5ff; background: rgba(168, 85, 247, 0.12); cursor: pointer;" onclick="downloadAmneziaConfig()">
              📥 Скачать конфиг AmneziaVPN (.vpn)
            </button>
          </div>

          ${configLinks.length > 0 ? `
            <div class="configs-section">
              <div style="font-size: 11px; color: #6b7280; margin-bottom: 10px; text-align: center;">
                Ключи для ручного импорта VLESS:
              </div>
              ${configLinks.map((link, idx) => {
                const proto = link.split('://')[0].toUpperCase();
                const nodeName = link.includes('#') ? decodeURIComponent(link.split('#')[1]).split('_')[0] : `Сервер ${idx + 1}`;
                return `
                  <div class="config-item">
                    <span class="config-name">${nodeName} (${proto})</span>
                    <span class="copy-link" onclick="copyConfig(${idx})">Копировать</span>
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      </div>

      <div class="toast" id="toast">Ссылка успешно скопирована!</div>

      <script>
        const configLinks = ${configsJson};
        const subUrl = window.location.href;

        function openTgBot(url) {
          if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
            window.Telegram.WebApp.openTelegramLink(url);
          } else {
            window.open(url, '_blank');
          }
        }

        function showToast(message) {
          const toast = document.getElementById('toast');
          toast.innerText = message;
          toast.style.display = 'block';
          setTimeout(() => {
            toast.style.display = 'none';
          }, 2000);
        }

        function copyToClipboard(text, successMsg) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
              .then(() => showToast(successMsg))
              .catch(() => fallbackCopy(text, successMsg));
          } else {
            fallbackCopy(text, successMsg);
          }
        }

        function fallbackCopy(text, successMsg) {
          const textArea = document.createElement("textarea");
          textArea.value = text;
          textArea.style.top = "0";
          textArea.style.left = "0";
          textArea.style.position = "fixed";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try {
            const successful = document.execCommand('copy');
            if (successful) {
              showToast(successMsg);
            } else {
              showToast('Не удалось скопировать. Скопируйте вручную.');
            }
          } catch (err) {
            showToast('Ошибка при копировании. Скопируйте вручную.');
          }
          document.body.removeChild(textArea);
        }

        function copySubscription() {
          copyToClipboard(subUrl, 'Ссылка подписки скопирована!');
        }

        function copyConfig(idx) {
          copyToClipboard(configLinks[idx], 'VPN ключ скопирован!');
        }

        function downloadAmneziaConfig() {
          window.location.href = window.location.pathname + '?format=amnezia';
        }
      </script>
    </body>
    </html>
  `;
}

/**
 * ARCHITECTURE PLACEHOLDER: Future integration with AmnesiaVPN.
 * Generates a mock Amnesia connection profile (.vpn JSON format) for the client.
 * Replace this mock implementation with active server API calls to the Amnesia management service.
 */
function generateAmneziaMockConfig(client: any, nodeDomain: string): string {
  const amneziaProfile = {
    description: `BTV VPN (Amnezia) - ${client.name}`,
    hostName: nodeDomain,
    userName: "admin",
    port: 22,
    sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----\\n...\\n-----END OPENSSH PRIVATE KEY-----",
    containers: [
      {
        container: "amnezia-wg",
        enable: true,
        port: 51820,
        settings: {
          privateKey: "MOCK_PRIVATE_KEY_WILL_BE_GENERATED_BY_AMNEZIA_SERVER",
          publicKey: "MOCK_PUBLIC_KEY_WILL_BE_GENERATED_BY_AMNEZIA_SERVER",
          ip: "10.0.8.2",
          serverPublicKey: "MOCK_SERVER_PUBLIC_KEY_FROM_AMNEZIA_INSTALLED_CONTAINER",
          presharedKey: "",
          mtu: 1360,
          dns: "1.1.1.1"
        }
      },
      {
        container: "amnezia-shadowsocks",
        enable: true,
        port: 8388,
        settings: {
          password: "MOCK_SHADOWSOCKS_PASSWORD",
          cipher: "aes-256-gcm"
        }
      }
    ]
  };

  return JSON.stringify(amneziaProfile, null, 2);
}
