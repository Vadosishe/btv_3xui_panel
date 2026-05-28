import prisma from './prisma';

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

  // 3. Неподдерживаемые сообщения
  const unknownText = `🤔 <b>Неизвестная команда</b>\n\nДоступные команды:\n👉 /status — проверить остаток трафика и состояние VPN.\n\nЕсли вы хотите привязать VPN-ключ, воспользуйтесь специальной ссылкой из личного кабинета.`;
  await sendTelegramMessage(token, chatId, unknownText);
}
