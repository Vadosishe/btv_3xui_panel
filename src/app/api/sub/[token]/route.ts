import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { xuiGetInbounds, generateConfigLink, xuiGetNodeDomains } from '@/lib/xui';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const acceptHeader = req.headers.get('accept') || '';
    const isBrowser = acceptHeader.includes('text/html');

    // 1. Ищем клиента по токену подписки
    const client = await prisma.client.findUnique({
      where: { subscriptionToken: token },
      include: {
        company: true,
        template: true,
      },
    });

    // 2. Получаем ссылку поддержки и домен из настроек
    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const supportLink = settingsMap.get('btw_support_link') || 'https://t.me/btw_support_bot';

    // Проверяем активность подписки
    const now = new Date();
    const isExpired = client?.expiresAt ? new Date(client.expiresAt) < now : false;
    const isCompanyActive = client?.company?.isActive ?? false;
    const isClientActive = client?.isActive ?? false;

    const isActive = client && isClientActive && isCompanyActive && !isExpired;

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
      const nodeDomains = await xuiGetNodeDomains();

      let configLinks: string[] = [];
      try {
        const inbounds = await xuiGetInbounds();
        const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');

        for (const inboundId of templateInboundIds) {
          const inbound = inbounds.find(i => i.id === inboundId);
          if (inbound) {
            const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
            const nodeDomain = nodeDomains[inboundNodeId] || defaultDomain;
            const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain);
            if (link) configLinks.push(link);
          }
        }
      } catch (e) {}

      // Отдаем красивую HTML страницу
      return new NextResponse(renderSubscriptionPortal(client, usedGBText, limitGBText, progressPercent, configLinks, supportLink), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // --- СЦЕНАРИЙ 2: Запрос из VPN КЛИЕНТА (возвращаем Base64 список конфигов) ---
    if (!isActive) {
      // Для неактивных клиентов отдаем пустую подписку (VPN клиент не сможет подключиться)
      return new NextResponse('', { status: 200 });
    }

    // Получаем инбаунды и генерируем конфиги
    // Динамически получаем доменные имена нод из API 3XUI
    const nodeDomains = await xuiGetNodeDomains();

    const inbounds = await xuiGetInbounds();
    const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');
    let configs: string[] = [];

    for (const inboundId of templateInboundIds) {
      const inbound = inbounds.find(i => i.id === inboundId);
      if (inbound) {
        const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
        const nodeDomain = nodeDomains[inboundNodeId] || defaultDomain;
        const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain);
        if (link) configs.push(link);
      }
    }

    // Соединяем конфиги переносом строки и кодируем в Base64
    const subscriptionContent = configs.join('\n');
    const base64Content = Buffer.from(subscriptionContent).toString('base64');

    return new NextResponse(base64Content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
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
      <title>${title} | BTW VPN</title>
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
  supportLink: string
): string {
  const configsJson = JSON.stringify(configLinks);
  const expirationText = client.expiresAt 
    ? new Date(client.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Безлимитная';

  return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Личный кабинет VPN | BTW</title>
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
          <div class="logo">BTW VPN SERVICE</div>
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

          ${configLinks.length > 0 ? `
            <div class="configs-section">
              <div style="font-size: 11px; color: #6b7280; margin-bottom: 10px; text-align: center;">
                Ключи для ручного импорта:
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

        function showToast(message) {
          const toast = document.getElementById('toast');
          toast.innerText = message;
          toast.style.display = 'block';
          setTimeout(() => {
            toast.style.display = 'none';
          }, 2000);
        }

        function copySubscription() {
          navigator.clipboard.writeText(subUrl);
          showToast('Ссылка подписки скопирована!');
        }

        function copyConfig(idx) {
          navigator.clipboard.writeText(configLinks[idx]);
          showToast('VPN ключ скопирован!');
        }
      </script>
    </body>
    </html>
  `;
}
