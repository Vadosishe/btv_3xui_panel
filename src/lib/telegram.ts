import prisma from './prisma';
import { xuiGetInbounds, xuiGetNodeDomains, generateConfigLink } from './xui';

/**
 * Отправить текстовое сообщение в Telegram
 */
export async function sendTelegramMessage(token: string, chatId: string | number, text: string, replyMarkup?: any): Promise<boolean> {
  if (!token) return false;
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    });
    return res.ok;
  } catch (err: any) {
    console.error('Failed to send Telegram message:', err.message);
    return false;
  }
}

/**
 * Обработать входящее сообщение от Telegram пользователя
 */
export async function handleTelegramMessage(token: string, message: any) {
  if (!message || !message.chat || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const fromName = message.from?.first_name || 'Пользователь';

  // 1. Команда /start [token]
  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    if (parts.length > 1) {
      const subToken = parts[1].trim();

      // Ищем клиента с таким токеном
      const client = await prisma.client.findUnique({
        where: { subscriptionToken: subToken },
        include: { company: true },
      });

      if (client) {
        // Привязываем Telegram Chat ID
        await prisma.client.update({
          where: { id: client.id },
          data: { tgId: String(chatId) },
        });

        // Записываем в лог аудита
        await prisma.auditLog.create({
          data: {
            action: 'LINK_TELEGRAM',
            details: `Клиент ${client.name} (${client.email}) успешно привязал свой Telegram ID: ${chatId}`,
          },
        });

        const welcomeText = `🎉 <b>Успешно привязано!</b>\n\nПривет, ${client.name}! Ваша подписка <b>BTV VPN</b> успешно привязана к этому Telegram-аккаунту.\n\n<b>Компания:</b> ${client.company.name}\n\n👉 Напишите /status в любой момент, чтобы проверить баланс трафика и срок действия VPN-подключения!`;
        
        // Получаем URL личного кабинета
        const settings = await prisma.appSetting.findMany();
        const settingsMap = new Map(settings.map(s => [s.key, s.value]));
        const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
        const personalSubUrl = `${appPanelUrl}/api/sub/${client.subscriptionToken}`;

        await sendTelegramMessage(token, chatId, welcomeText, {
          inline_keyboard: [
            [{ text: '📱 Открыть Кабинет VPN', web_app: { url: personalSubUrl } }]
          ]
        });
      } else {
        await sendTelegramMessage(token, chatId, '⚠️ <b>Ошибка привязки</b>\n\nНе удалось найти VPN-подписку по указанному коду. Убедитесь в корректности ссылки из личного кабинета.');
      }
    } else {
      // Обычный /start без токена
      const helpText = `👋 <b>Добро пожаловать в BTV VPN!</b>\n\nПривет, ${fromName}!\nЭтот бот предназначен для контроля лимитов и быстрого доступа к вашему VPN.\n\n💡 <b>Как привязать подписку:</b>\nПерейдите по вашей персональной ссылке подписки в браузере, найдите раздел Telegram-интеграции и нажмите кнопку привязки аккаунта!`;
      await sendTelegramMessage(token, chatId, helpText);
    }
    return;
  }

  // 2. Команда /status
  if (text === '/status') {
    // Ищем клиента по привязанному Telegram Chat ID
    const client = await prisma.client.findFirst({
      where: { tgId: String(chatId) },
      include: { company: true, template: true },
    });

    if (client) {
      const now = new Date();
      const isExpired = client.expiresAt ? new Date(client.expiresAt) < now : false;
      const isCompanyActive = client.company.isActive;
      const isActive = client.isActive && isCompanyActive && !isExpired;

      const usedGB = (Number(client.usedTrafficBytes) / (1024 * 1024 * 1024)).toFixed(2);
      
      const limitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : client.template.trafficLimitGB;
      const limitGBText = limitGB > 0 ? `${limitGB} GB` : 'Безлимит';

      const expirationText = client.expiresAt 
        ? new Date(client.expiresAt).toLocaleDateString('ru-RU')
        : 'Безлимитная';

      let statusEmoji = isActive ? '🟢 Активна' : '🔴 Отключена';
      if (isExpired) {
        statusEmoji = '⚠️ Истекла подписка';
      } else if (!isCompanyActive) {
        statusEmoji = '🔴 Компания заблокирована';
      }

      const statusText = `📊 <b>Статус VPN BTV:</b>\n\n` +
        `👤 <b>Имя:</b> ${client.name}\n` +
        `🏢 <b>Компания:</b> ${client.company.name}\n` +
        `🌐 <b>Статус:</b> ${statusEmoji}\n\n` +
        `💾 <b>Потрачено:</b> ${usedGB} GB из ${limitGBText}\n` +
        `📅 <b>Действует до:</b> ${expirationText}`;

      const settings = await prisma.appSetting.findMany();
      const settingsMap = new Map(settings.map(s => [s.key, s.value]));
      const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const personalSubUrl = `${appPanelUrl}/api/sub/${client.subscriptionToken}`;

      await sendTelegramMessage(token, chatId, statusText, {
        inline_keyboard: [
          [{ text: '📱 Открыть Кабинет VPN', web_app: { url: personalSubUrl } }]
        ]
      });
    } else {
      await sendTelegramMessage(token, chatId, '⚠️ <b>Вы еще не привязали VPN-подписку!</b>\n\nПожалуйста, перейдите в личный кабинет VPN в браузере и нажмите кнопку привязки аккаунта Telegram.');
    }
    return;
  }

  // 3. Команда /help
  if (text === '/help') {
    const helpMsg = `🤖 <b>Доступные команды бота BTV VPN:</b>\n\n` +
      `📊 /status — Проверить баланс трафика, статус и срок действия подписки.\n` +
      `🔑 /config — Получить персональные ключи (VLESS/Trojan) и QR-код для ручного импорта.\n` +
      `📱 /instructions — Пошаговая инструкция по настройке VPN на iOS, Android, Windows, macOS.\n` +
      `🆘 /support — Связаться с нашей службой технической поддержки.`;
    await sendTelegramMessage(token, chatId, helpMsg);
    return;
  }

  // 4. Команда /support
  if (text === '/support') {
    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const supportLink = settingsMap.get('btw_support_link') || 'https://t.me/btw_support_bot';
    
    const supportMsg = `🆘 <b>Служба техподдержки BTV VPN:</b>\n\n` +
      `Если у вас возникли вопросы по настройке, сбои при оплате или проблемы с подключением, пожалуйста, напишите нашему специалисту:\n` +
      `👉 <a href="${supportLink}">Написать в поддержку</a>`;
    await sendTelegramMessage(token, chatId, supportMsg);
    return;
  }

  // 5. Команда /instructions
  if (text === '/instructions') {
    const instructionsMsg = `📱 <b>Инструкции по настройке BTV VPN:</b>\n\n` +
      `🍏 <b>iOS (iPhone, iPad):</b>\n` +
      `1. Скачайте приложение <a href="https://apps.apple.com/app/sing-box-tool/id6475221237">Sing-box</a> или <a href="https://apps.apple.com/app/shadowrocket/id932747118">Shadowrocket</a> ($2.99).\n` +
      `2. Скопируйте умную ссылку подписки из кабинета или по команде /config.\n` +
      `3. В приложении добавьте новый профиль типа <code>HTTP/Subscription</code> и укажите ссылку.\n\n` +
      `🤖 <b>Android:</b>\n` +
      `1. Скачайте <a href="https://play.google.com/store/apps/details?id=com.v2ray.ang">v2rayNG</a> или <a href="https://play.google.com/store/apps/details?id=io.nekohasekai.sfa">Sing-box</a>.\n` +
      `2. Импортируйте ключ или ссылку подписки через кнопку "+".\n\n` +
      `💻 <b>Windows:</b>\n` +
      `1. Скачайте программу <a href="https://github.com/MatsuriDayo/nekoray/releases">Nekoray</a>.\n` +
      `2. Добавьте ссылку подписки (Группы -> Настройки группы -> Добавить).\n\n` +
      `🍏 <b>macOS:</b>\n` +
      `1. Используйте <a href="https://apps.apple.com/app/foxtun/id6475221237">FoXray</a> или <a href="https://apps.apple.com/app/sing-box-tool/id6475221237">Sing-box</a>.\n` +
      `2. Импортируйте умную подписку.`;
    await sendTelegramMessage(token, chatId, instructionsMsg);
    return;
  }

  // 6. Команда /config
  if (text === '/config') {
    // Ищем клиента по привязанному Telegram Chat ID
    const client = await prisma.client.findFirst({
      where: { tgId: String(chatId) },
      include: { company: true, template: true },
    });

    if (client) {
      const now = new Date();
      const isExpired = client.expiresAt ? new Date(client.expiresAt) < now : false;
      const isCompanyActive = client.company.isActive;
      const isActive = client.isActive && isCompanyActive && !isExpired;

      if (!isActive) {
        let reason = 'Ваша подписка временно неактивна.';
        if (isExpired) {
          reason = 'Срок действия вашей подписки истек.';
        } else if (!isCompanyActive) {
          reason = 'Обслуживание вашей компании временно приостановлено.';
        }
        await sendTelegramMessage(token, chatId, `⚠️ <b>Доступ ограничен</b>\n\n${reason}\nПожалуйста, свяжитесь с поддержкой.`);
        return;
      }

      // Генерируем конфиги
      let configLinks: string[] = [];
      try {
        const inbounds = await xuiGetInbounds();
        const nodeDomains = await xuiGetNodeDomains();
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
      } catch (e) {
        console.error('Failed to generate configs for telegram bot:', e);
      }

      const settings = await prisma.appSetting.findMany();
      const settingsMap = new Map(settings.map(s => [s.key, s.value]));
      const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const personalSubUrl = `${appPanelUrl}/api/sub/${client.subscriptionToken}`;

      let keysMsg = `🔑 <b>Ваши персональные доступы VPN BTV:</b>\n\n` +
        `🌐 <b>Умная ссылка подписки:</b>\n` +
        `🔗 <a href="${personalSubUrl}">Открыть в браузере (для перехода)</a>\n\n` +
        `📋 <b>Нажмите для копирования (в буфер):</b>\n` +
        `<code>${personalSubUrl}</code>\n\n`;

      if (configLinks.length > 0) {
        keysMsg += `<b>Ключи для ручного импорта (нажмите для копирования):</b>\n\n`;
        configLinks.forEach((link, idx) => {
          const proto = link.split('://')[0].toUpperCase();
          const nodeName = link.includes('#') ? decodeURIComponent(link.split('#')[1]).split('_')[0] : `Сервер ${idx + 1}`;
          keysMsg += `🇳🇱 <b>${nodeName} (${proto}):</b>\n<code>${link}</code>\n\n`;
        });
      } else {
        keysMsg += `<i>Доступные серверные ключи не найдены. Воспользуйтесь ссылкой подписки выше или личным кабинетом.</i>`;
      }

      await sendTelegramMessage(token, chatId, keysMsg, {
        inline_keyboard: [
          [{ text: '📱 Открыть Личный Кабинет', web_app: { url: personalSubUrl } }]
        ]
      });
    } else {
      await sendTelegramMessage(token, chatId, '⚠️ <b>Вы еще не привязали VPN-подписку!</b>\n\nПожалуйста, перейдите в личный кабинет VPN в браузере и нажмите кнопку привязки аккаунта Telegram.');
    }
    return;
  }

  // 7. Неподдерживаемые сообщения
  const unknownText = `🤔 <b>Неизвестная команда</b>\n\nДоступные команды:\n👉 /status — проверить остаток трафика и состояние VPN.\n👉 /config — получить VPN ключи и ссылку подписки.\n👉 /instructions — инструкции по настройке.\n👉 /support — написать в техподдержку.`;
  await sendTelegramMessage(token, chatId, unknownText);
}
