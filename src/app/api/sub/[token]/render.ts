/**
 * Рендер красивой HTML-страницы с ошибкой доступа
 */
export function renderErrorPage(title: string, message: string, supportLink?: string): string {
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
export function renderSubscriptionPortal(
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
              1. Установите приложение <strong>AmneziaVPN</strong> (<a href="https://amnezia.org/ru" target="_blank" style="color: var(--cyan-neon); text-decoration: underline;">Официальный сайт</a> или <a href="https://storage.googleapis.com/amnezia/amnezia.org" target="_blank" style="color: var(--cyan-neon); text-decoration: underline;">Зеркало для РФ</a>).<br/>
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
              1. Установите приложение <strong>AmneziaVPN</strong> (<a href="https://amnezia.org/ru" target="_blank" style="color: var(--cyan-neon); text-decoration: underline;">Официальный сайт</a> или <a href="https://storage.googleapis.com/amnezia/amnezia.org" target="_blank" style="color: var(--cyan-neon); text-decoration: underline;">Зеркало для РФ</a>).<br/>
              2. Скачайте файл конфигурации по кнопке ниже.<br/>
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
            <div style="margin-top: 12px; font-size: 11px; color: var(--text-muted); border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 10px; line-height: 1.4;">
              💡 <strong>Альтернативные клиенты:</strong> Вы также можете использовать официальные приложения <strong>Sing-box</strong>, <strong>v2rayNG</strong> (Android) или <strong>V2Box / Shadowrocket</strong> (iOS).
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
                Установите приложение <strong>Happ - Proxy Utility</strong>:
                <div class="happ-links" style="margin-top: 8px; margin-bottom: 4px;">
                  <a href="https://www.happ.su/main" target="_blank" class="btn-sub" style="padding: 10px 16px; font-size: 12px; display: inline-flex; width: auto; box-shadow: none;">🍏🤖 Скачать Happ (iOS / Android)</a>
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