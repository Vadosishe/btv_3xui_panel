import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { xuiGetInbounds, generateConfigLink, xuiGetNodeDomains, xuiGetClientTraffic } from '@/lib/xui';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    // Фоновая On-Demand автосинхронизация трафика этого клиента из 3XUI
    if (client) {
      try {
        const traffic = await xuiGetClientTraffic(client.email);
        if (traffic) {
          const totalUsed = BigInt(traffic.up || 0) + BigInt(traffic.down || 0);
          if (totalUsed !== client.usedTrafficBytes) {
            client.usedTrafficBytes = totalUsed; // Обновляем в памяти для рендеринга страницы и заголовков
            
            // Асинхронно сохраняем в БД в фоне, не блокируя ответ клиенту
            prisma.client.update({
              where: { id: client.id },
              data: { usedTrafficBytes: totalUsed, lastSyncedAt: new Date() }
            }).catch(dbErr => console.error('Failed to update synced traffic for client on sub request:', dbErr));
          }
        }
      } catch (err) {
        console.warn('Failed to sync traffic from XUI on sub request:', err);
      }
    }

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

    // --- СЦЕНАРИЙ 3: Запрос конфигурации AmneziaVPN (Реальный AWG / Резервный плейсхолдер) ---
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

      const serverId = searchParams.get('server') || undefined;

      // Пробуем получить реальный конфиг Amnezia WireGuard (AWG 1.0) через интеграционный модуль
      try {
        const { amneziaGetPeerConfig, getAwgServers } = await import('@/lib/amnezia');
        const realAwgConfig = await amneziaGetPeerConfig(client.email, serverId);
        
        if (realAwgConfig) {
          let filename = `btv-awg-${client.vpnUuid.substring(0, 8)}.conf`;
          try {
            const servers = await getAwgServers();
            const srv = servers.find(s => s.id === serverId);
            if (srv) {
              const cleanSrvName = encodeURIComponent(srv.name.replace(/\s+/g, '_'));
              filename = `btv-awg-${cleanSrvName}-${client.vpnUuid.substring(0, 8)}.conf`;
            }
          } catch (e) {}

          return new NextResponse(realAwgConfig, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Cache-Control': 'no-store',
            },
          });
        }
      } catch (err) {
        console.warn('Failed to fetch real AWG config, falling back to mock container:', err);
      }

      // Откат к плейсхолдеру (стандартный mock-профиль), если API выключено или недоступно
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
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
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
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
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

      // Получаем назначенные Amnezia-серверы для шаблона клиента
      let clientAwgServers: any[] = [];
      try {
        const { getAwgServers, getTemplateAwgServers } = await import('@/lib/amnezia');
        const allAwgServers = await getAwgServers();
        const templateMap = await getTemplateAwgServers();
        const assignedServerIds = templateMap[client.templateId] || [];
        clientAwgServers = allAwgServers.filter(s => s.enabled && assignedServerIds.includes(s.id));
      } catch (e) {
        console.error('Failed to fetch assigned AWG servers for browser sub:', e);
      }

      return new NextResponse(renderSubscriptionPortal(client, usedGBText, limitGBText, progressPercent, configLinks, supportLink, tgBotUsername, qrCodeDataUrl, clientAwgServers), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
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
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
      <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
      <meta http-equiv="Pragma" content="no-cache">
      <meta http-equiv="Expires" content="0">
      <style>
        :root {
          --bg-gradient: radial-gradient(circle at 50% 0%, #151922 0%, #07090d 100%);
          --card-bg: rgba(22, 28, 41, 0.45);
          --card-border: rgba(239, 68, 68, 0.2);
          --text-primary: #f3f4f6;
          --text-secondary: #9ca3af;
          --danger-glow: rgba(239, 68, 68, 0.15);
        }
        body {
          background: #07090d;
          background-image: var(--bg-gradient);
          color: var(--text-primary);
          font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
        }
        .card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--card-border);
          border-radius: 24px;
          padding: 40px 30px;
          max-width: 450px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 40px rgba(0,0,0,0.5), 0 0 40px var(--danger-glow);
        }
        .icon {
          font-size: 56px;
          margin-bottom: 20px;
          filter: drop-shadow(0 0 10px rgba(239, 68, 68, 0.4));
        }
        h1 {
          font-size: 24px;
          margin: 0 0 12px 0;
          font-weight: 700;
          letter-spacing: -0.5px;
          background: linear-gradient(135deg, #ff6b6b, #ef4444);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        p {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.6;
          margin: 0 0 30px 0;
        }
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #a855f7, #7c3aed);
          color: white;
          padding: 14px 28px;
          border-radius: 12px;
          text-decoration: none;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 4px 15px rgba(124, 58, 237, 0.3);
          transition: all 0.3s ease;
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(124, 58, 237, 0.5);
        }
        .btn:active {
          transform: translateY(0);
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
  qrCodeDataUrl: string,
  clientAwgServers: any[] = []
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
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
      <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
      <meta http-equiv="Pragma" content="no-cache">
      <meta http-equiv="Expires" content="0">
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <style>
        :root {
          --bg-gradient: radial-gradient(circle at 50% 0%, #111520 0%, #06080c 100%);
          --card-bg: rgba(18, 24, 38, 0.55);
          --card-border: rgba(255, 255, 255, 0.05);
          --text-primary: #f3f4f6;
          --text-secondary: #9ca3af;
          --text-muted: #6b7280;
          --cyan-neon: #00f0ff;
          --purple-neon: #a855f7;
          --gradient-primary: linear-gradient(135deg, #00f0ff 0%, #a855f7 100%);
          --gradient-hover: linear-gradient(135deg, #02b6d4 0%, #8b5cf6 100%);
          --success: #10b981;
          --danger: #ef4444;
        }
        body {
          background: #06080c;
          background-image: var(--bg-gradient);
          color: var(--text-primary);
          font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          min-height: 100vh;
          margin: 0;
          padding: 24px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          box-sizing: border-box;
        }
        .container {
          max-width: 480px;
          width: 100%;
        }
        .header {
          text-align: center;
          margin-bottom: 24px;
          position: relative;
        }
        .logo {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.5px;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 0 30px rgba(0, 240, 255, 0.2);
        }
        .company-badge {
          display: inline-block;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 6px 16px;
          border-radius: 30px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-secondary);
          margin-top: 8px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .welcome-card {
          background: rgba(18, 24, 38, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.03);
          border-radius: 20px;
          padding: 16px 24px;
          text-align: center;
          margin-bottom: 20px;
          font-size: 14px;
          color: var(--text-secondary);
        }
        .welcome-card strong {
          color: #fff;
          font-size: 16px;
        }
        .card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--card-border);
          border-radius: 24px;
          padding: 24px;
          box-shadow: 0 15px 35px rgba(0,0,0,0.4);
          margin-bottom: 20px;
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .card:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 45px rgba(0,0,0,0.5);
          border-color: rgba(255, 255, 255, 0.08);
        }
        h2 {
          font-size: 14px;
          margin: 0 0 16px 0;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #fff;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .actions {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .btn-sub {
          background: var(--gradient-primary);
          color: white;
          border: none;
          padding: 14px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(0, 240, 255, 0.25);
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .btn-sub:hover {
          background: var(--gradient-hover);
          box-shadow: 0 6px 20px rgba(0, 240, 255, 0.4);
          transform: translateY(-1px);
        }
        .btn-sub:active {
          transform: translateY(1px);
        }
        .btn-secondary {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
          padding: 14px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.15);
        }
        .qr-wrapper {
          text-align: center;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .qr-container {
          background: #ffffff;
          padding: 16px;
          border-radius: 20px;
          display: inline-block;
          box-shadow: 0 0 25px rgba(0, 240, 255, 0.15);
          margin-bottom: 12px;
          transition: all 0.3s ease;
        }
        .qr-container:hover {
          box-shadow: 0 0 35px rgba(168, 85, 247, 0.3);
          transform: scale(1.02);
        }
        .qr-container img {
          width: 150px;
          height: 150px;
          display: block;
        }
        .qr-desc {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.5;
          max-width: 280px;
          margin: 0 auto;
        }
        .instructions-box {
          background: rgba(168, 85, 247, 0.06);
          border: 1px solid rgba(168, 85, 247, 0.15);
          padding: 16px;
          border-radius: 16px;
          font-size: 12px;
          color: #e9d5ff;
          line-height: 1.6;
          margin-bottom: 16px;
        }
        .instructions-title {
          color: #fff;
          font-size: 13px;
          display: block;
          margin-bottom: 8px;
          font-weight: 700;
        }
        .instructions-cyan {
          background: rgba(0, 240, 255, 0.04);
          border: 1px solid rgba(0, 240, 255, 0.15);
          color: #e0f7fa;
        }
        .btn-download {
          background: rgba(168, 85, 247, 0.12);
          border: 1px solid rgba(168, 85, 247, 0.3);
          color: #e9d5ff;
          padding: 14px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
        }
        .btn-download:hover {
          background: rgba(168, 85, 247, 0.2);
          border-color: rgba(168, 85, 247, 0.6);
          box-shadow: 0 0 15px rgba(168, 85, 247, 0.2);
          transform: translateY(-1px);
        }
        .config-item {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.04);
          padding: 12px 18px;
          border-radius: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          font-size: 13px;
          transition: all 0.2s;
        }
        .config-item:hover {
          border-color: rgba(255, 255, 255, 0.08);
          background: rgba(0, 0, 0, 0.25);
        }
        .config-name {
          font-weight: 600;
          color: #fff;
        }
        .copy-action {
          color: var(--cyan-neon);
          cursor: pointer;
          font-weight: 700;
          transition: color 0.2s;
        }
        .copy-action:hover {
          color: #fff;
          text-shadow: 0 0 8px var(--cyan-neon);
        }
        .happ-links {
          display: flex;
          gap: 12px;
          margin-top: 12px;
        }
        .btn-market {
          flex: 1;
          text-align: center;
          padding: 10px;
          font-size: 11px;
          font-weight: 600;
          text-decoration: none;
          border-radius: 10px;
          border: 1px solid rgba(0, 240, 255, 0.25);
          background: rgba(0, 240, 255, 0.08);
          color: var(--cyan-neon);
          transition: all 0.2s;
        }
        .btn-market:hover {
          background: rgba(0, 240, 255, 0.15);
          border-color: var(--cyan-neon);
          box-shadow: 0 0 10px rgba(0, 240, 255, 0.15);
        }
        .progress-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 16px 0 24px 0;
        }
        .progress-circle {
          position: relative;
          width: 140px;
          height: 140px;
          margin-bottom: 16px;
        }
        .progress-circle svg {
          width: 140px;
          height: 140px;
          transform: rotate(-90deg);
        }
        .progress-circle circle {
          fill: none;
          stroke-width: 10;
        }
        .progress-circle .bg {
          stroke: rgba(255, 255, 255, 0.04);
        }
        .progress-circle .bar {
          stroke: url(#cyan-purple-grad);
          stroke-dasharray: 377;
          stroke-dashoffset: var(--dashoffset);
          stroke-linecap: round;
          transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1);
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
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -0.5px;
        }
        .progress-label {
          font-size: 10px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 2px;
        }
        .usage-text {
          font-size: 14px;
          color: var(--text-secondary);
          text-align: center;
        }
        .usage-text strong {
          color: #fff;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          padding-top: 20px;
          margin-top: 20px;
        }
        .stat-box {
          text-align: center;
          background: rgba(0, 0, 0, 0.15);
          border-radius: 16px;
          padding: 12px;
          border: 1px solid rgba(255, 255, 255, 0.02);
        }
        .stat-val {
          font-size: 15px;
          font-weight: 700;
        }
        .stat-val.active {
          color: var(--success);
          text-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
        }
        .stat-lbl {
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 4px;
        }
        .tg-status-box {
          background: rgba(16, 185, 129, 0.04);
          border: 1px solid rgba(16, 185, 129, 0.15);
          padding: 16px;
          border-radius: 16px;
          font-size: 12px;
          color: #d1fae5;
          line-height: 1.6;
          margin-bottom: 16px;
        }
        .tg-status-box strong {
          color: #fff;
          font-size: 13px;
          display: block;
          margin-bottom: 4px;
        }
        .tg-unbind-btn {
          display: block;
          width: 100%;
          text-decoration: none;
          text-align: center;
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #fca5a5;
          padding: 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.2s;
          cursor: pointer;
        }
        .tg-unbind-btn:hover {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.4);
        }
        .btn-tg-bind {
          display: block;
          width: 100%;
          text-decoration: none;
          text-align: center;
          background: linear-gradient(135deg, #0284c7, #0369a1);
          color: white;
          padding: 14px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 600;
          box-shadow: 0 4px 15px rgba(2, 132, 199, 0.2);
          transition: all 0.3s;
        }
        .btn-tg-bind:hover {
          background: linear-gradient(135deg, #0ea5e9, #0284c7);
          box-shadow: 0 6px 20px rgba(2, 132, 199, 0.35);
          transform: translateY(-1px);
        }
        .btn-support {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-decoration: none;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #fff;
          padding: 14px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 600;
          transition: all 0.2s;
        }
        .btn-support:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.15);
          box-shadow: 0 4px 15px rgba(255, 255, 255, 0.05);
        }
        .toast {
          position: fixed;
          bottom: 24px;
          background: var(--success);
          color: white;
          padding: 12px 24px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
          display: none;
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 1000;
        }
        @keyframes slideUp {
          from { transform: translateY(100px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Шапка панели -->
        <div class="header">
          <div class="logo">BTV VPN SERVICE</div>
          <div class="company-badge">${client.company.name}</div>
        </div>

        <div class="welcome-card">
          Приветствуем, <strong>${client.name}</strong>! Параметры вашего подключения и статистика использования приведены ниже.
        </div>

        <!-- 1. ПОДКЛЮЧЕНИЕ: ССЫЛКИ И QR-КОД (Сверху) -->
        <div class="card">
          <h2>🛜 Подключение подписки</h2>
          <div class="actions">
            <button class="btn-sub" onclick="copySubscription()">
              <span>📋</span> Скопировать ссылку подписки
            </button>
          </div>

          <!-- Секция QR-кода -->
          ${qrCodeDataUrl ? `
            <div class="qr-wrapper">
              <div class="qr-container">
                <img src="${qrCodeDataUrl}" alt="Subscription QR Code" />
              </div>
              <div class="qr-desc">
                Используйте кнопку копирования или отсканируйте QR-код в приложении (v2rayNG, Sing-box, Shadowrocket) для импорта подписки.
              </div>
            </div>
          ` : `
            <div class="qr-wrapper">
              <div class="qr-desc" style="color: var(--text-muted);">QR-код подписки временно недоступен</div>
            </div>
          `}
        </div>

        <!-- 2. СЕКЦИЯ AMNEZIA WG (Сверху, если привязано) -->
        ${clientAwgServers.length > 0 ? `
          <div class="card">
            <h2>🛡️ Подключение Amnezia WireGuard</h2>
            <div class="instructions-box">
              <div class="instructions-title">Порядок настройки:</div>
              1. Установите приложение <strong>AmneziaVPN</strong> на ваше устройство.<br/>
              2. Скачайте файл конфигурации (.conf) для нужного сервера ниже.<br/>
              3. Импортируйте скачанный файл в приложении AmneziaVPN.
              <div style="margin-top: 8px; color: #a78bfa; font-size: 11px; font-weight: 500;">💡 Также подходит приложение <strong>Amnezia WG</strong>.</div>
            </div>
            <div class="actions" style="gap: 10px;">
              ${clientAwgServers.map(server => `
                <button class="btn-download" onclick="downloadAmneziaConfig('${server.id}')">
                  <span>📥</span>
                  <span>Скачать файл: <b>${server.name}</b> (.conf)</span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="card">
            <h2>🛡️ Резервный канал Amnezia WireGuard</h2>
            <div class="instructions-box">
              <div class="instructions-title">Порядок настройки:</div>
              1. Скачайте файл конфигурации по кнопке ниже.<br/>
              2. Установите приложение <strong>AmneziaVPN</strong>.<br/>
              3. Импортируйте скачанный файл в приложении AmneziaVPN.
              <div style="margin-top: 8px; color: #a78bfa; font-size: 11px; font-weight: 500;">💡 Также подходит приложение <strong>Amnezia WG</strong>.</div>
            </div>
            <button class="btn-download" onclick="downloadAmneziaConfig()">
              <span>📥</span> Скачать конфиг Amnezia (.vpn)
            </button>
          </div>
        `}

        <!-- 3. VLESS КЛЮЧИ ДЛЯ РУЧНОГО ИМПОРТА (Сверху) -->
        ${configLinks.length > 0 ? `
          <div class="card">
            <h2>🔑 Конфигурации VLESS</h2>
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.4;">
              Для ручной настройки скопируйте нужный ключ и импортируйте его в клиент (v2rayNG, Nekobox, Shadowrocket).
            </div>
            <div class="actions" style="gap: 8px;">
              ${configLinks.map((link, idx) => {
                const proto = link.split('://')[0].toUpperCase();
                const nodeName = link.includes('#') ? decodeURIComponent(link.split('#')[1]).split('_')[0] : `Локация ${idx + 1}`;
                return `
                  <div class="config-item">
                    <span class="config-name">${nodeName} (${proto})</span>
                    <span class="copy-action" onclick="copyConfig(${idx})">Копировать</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 4. БЫСТРАЯ НАСТРОЙКА HAPP (Сверху) -->
        <div class="card">
          <h2>⚡ Настройка через Happ</h2>
          <div class="instructions-box instructions-cyan">
            <div class="instructions-title" style="color: #22d3ee;">Рекомендуемый способ подключения:</div>
            <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; line-height: 1.6;">
              <li>Скопируйте ссылку подписки с помощью кнопки выше.</li>
              <li>
                Скачайте приложение <strong>Happ - Proxy Utility</strong>:
                <div class="happ-links" style="margin-top: 8px; margin-bottom: 4px;">
                  <a href="https://apps.apple.com/app/happ-proxy-utility/id6475730248" target="_blank" class="btn-market">🍏 Скачать для iOS</a>
                  <a href="https://play.google.com/store/apps/details?id=com.happ.proxy" target="_blank" class="btn-market">🤖 Скачать для Android</a>
                </div>
              </li>
              <li>Откройте приложение <strong>Happ</strong>, подтвердите автоматический импорт ссылки из буфера обмена и нажмите кнопку подключения в центре.</li>
            </ol>
          </div>
        </div>

        <!-- 5. ТЕКУЩАЯ ИНФОРМАЦИЯ И СТАТИСТИКА (Снизу) -->
        <div class="card">
          <h2>📊 Состояние подключения</h2>
          
          <div class="progress-section">
            <div class="progress-circle" style="--dashoffset: ${377 - (377 * progress) / 100}">
              <svg viewBox="0 0 140 140">
                <defs>
                  <linearGradient id="cyan-purple-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#00f0ff" />
                    <stop offset="100%" stop-color="#a855f7" />
                  </linearGradient>
                </defs>
                <circle class="bg" cx="70" cy="70" r="60" />
                <circle class="bar" cx="70" cy="70" r="60" />
              </svg>
              <div class="progress-text">
                <div class="progress-val">${progress}%</div>
                <div class="progress-label">Трафик</div>
              </div>
            </div>
            
            <div class="usage-text">
              Использовано <strong>${usedGB} GB</strong> из <strong>${limitGB}</strong>
            </div>
          </div>

          <div class="stats-grid">
            <div class="stat-box">
              <div class="stat-val active">Активна</div>
              <div class="stat-lbl">Статус VPN</div>
            </div>
            <div class="stat-box">
              <div class="stat-val" style="color: #fff;">${expirationText}</div>
              <div class="stat-lbl">Действует до</div>
            </div>
          </div>
        </div>

        <!-- 6. TELEGRAM БОТ И УВЕДОМЛЕНИЯ (Снизу) -->
        ${cleanTgBotUsername ? `
          <div class="card">
            <h2>🤖 Telegram-уведомления</h2>
            ${client.tgId ? `
              <div class="tg-status-box">
                <strong>✅ Telegram привязан:</strong>
                Аккаунт: <b>${client.telegramUsername ? `@${client.telegramUsername}` : `имя: ${client.telegramFirstName || 'Пользователь'}`}</b> (ID: ${client.tgId})<br/>
                Система присылает уведомления об окончании трафика и статусе подписки.
              </div>
              <a href="?action=unbind" class="tg-unbind-btn">
                ❌ Отключить уведомления в Telegram
              </a>
            ` : `
              <div class="instructions-box instructions-cyan" style="margin-bottom: 16px;">
                Подключите Telegram-бота для получения автоматических уведомлений об остатке трафика, дате окончания подписки и проверки статуса.
              </div>
              <a href="javascript:void(0)" onclick="openTgBot('https://t.me/${cleanTgBotUsername}?start=${client.subscriptionToken}')" class="btn-tg-bind">
                🔗 Подключить Telegram-бота
              </a>
            `}
          </div>
        ` : ''}

        <!-- 7. ТЕХПОДДЕРЖКА (Снизу) -->
        <a href="${supportLink}" class="btn-support" target="_blank">
          💬 Связаться с техподдержкой
        </a>

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

        function downloadAmneziaConfig(serverId) {
          const url = window.location.pathname + '?format=amnezia' + (serverId ? '&server=' + encodeURIComponent(serverId) : '');
          window.location.href = url;
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
