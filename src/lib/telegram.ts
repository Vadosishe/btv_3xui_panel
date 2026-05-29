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
  try {
    if (!message || !message.chat || !message.text) return;

    const chatId = message.chat.id;
    let text = message.text.trim();
    const fromName = message.from?.first_name || 'Пользователь';

  // Маппинг кнопок клавиатуры в стандартные команды
  if (text === '📋 Подать заявку на VPN') text = '/request';
  if (text === 'ℹ️ Инструкции') text = '/instructions';
  if (text === '🆘 Техподдержка') text = '/support';

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
        // Получаем информацию о Telegram профиле
        const username = message.from?.username || '';
        const firstName = message.from?.first_name || '';

        // Привязываем Telegram Chat ID и метаданные профиля
        await prisma.client.update({
          where: { id: client.id },
          data: { 
            tgId: String(chatId),
            telegramUsername: username,
            telegramFirstName: firstName
          },
        });

        // Записываем в лог аудита
        await prisma.auditLog.create({
          data: {
            action: 'LINK_TELEGRAM',
            details: `Клиент ${client.name} (${client.email}) привязал Telegram: @${username} (имя: ${firstName}, ID: ${chatId})`,
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
      // Обычный /start без токена: проверяем, привязан ли этот пользователь
      const boundClient = await prisma.client.findFirst({
        where: { tgId: String(chatId) },
        include: { company: true }
      });

      if (boundClient) {
        const welcomeText = `👋 <b>Вы уже привязаны к VPN BTV!</b>\n\nПривет, ${boundClient.name}!\nВаш Telegram-аккаунт успешно связан с подпиской BTV.\n\n<b>Компания:</b> ${boundClient.company.name}\n\n💡 <b>Доступные команды:</b>\n👉 /status — проверить остаток лимита трафика.\n👉 /unbind — отвязать этот Telegram от вашей VPN-подписки.`;
        
        const settings = await prisma.appSetting.findMany();
        const settingsMap = new Map(settings.map(s => [s.key, s.value]));
        const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
        const personalSubUrl = `${appPanelUrl}/api/sub/${boundClient.subscriptionToken}`;

        await sendTelegramMessage(token, chatId, welcomeText, {
          inline_keyboard: [
            [{ text: '📱 Открыть Кабинет VPN', web_app: { url: personalSubUrl } }]
          ]
        });
      } else {
        const helpText = `👋 <b>Добро пожаловать в BTV VPN!</b>\n\n` +
          `Привет, ${fromName}!\n` +
          `Этот бот предназначен для получения доступа и удобного контроля вашей подписки BTV.\n\n` +
          `📋 <b>У вас ещё нет VPN-подписки?</b>\n` +
          `Вы можете подать заявку на получение VPN прямо сейчас! Нажмите на кнопку меню внизу или используйте команду /request.\n\n` +
          `🔗 <b>Уже есть подписка?</b>\n` +
          `Перейдите по вашей персональной ссылке подписки в браузере, найдите раздел привязки Telegram и нажмите кнопку привязки аккаунта!`;

        await sendTelegramMessage(token, chatId, helpText, {
          keyboard: [
            [{ text: '📋 Подать заявку на VPN' }],
            [{ text: 'ℹ️ Инструкции' }, { text: '🆘 Техподдержка' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        });
      }
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
      // Синхронизируем трафик перед показом статуса
      let usedTrafficBytes = client.usedTrafficBytes;
      try {
        const { xuiGetClientTraffic } = await import('./xui');
        const traffic = await xuiGetClientTraffic(client.email);
        if (traffic) {
          const totalUsed = BigInt(traffic.up || 0) + BigInt(traffic.down || 0);
          usedTrafficBytes = totalUsed;
          
          // Фоновое сохранение в БД без ожидания ответа
          prisma.client.update({
            where: { id: client.id },
            data: { usedTrafficBytes: totalUsed, lastSyncedAt: new Date() }
          }).catch(dbErr => console.error('Failed to update synced traffic for client inside telegram status:', dbErr));
        }
      } catch (err) {
        console.warn('Failed to sync traffic on telegram status request:', err);
      }

      const now = new Date();
      const isExpired = client.expiresAt ? new Date(client.expiresAt) < now : false;
      const isCompanyActive = client.company.isActive;
      const isActive = client.isActive && isCompanyActive && !isExpired;

      const usedGB = (Number(usedTrafficBytes) / (1024 * 1024 * 1024)).toFixed(2);
      
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

  // Команда /unbind
  if (text === '/unbind') {
    const boundClient = await prisma.client.findFirst({
      where: { tgId: String(chatId) },
    });

    if (boundClient) {
      await prisma.client.update({
        where: { id: boundClient.id },
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
          details: `Клиент ${boundClient.name} (${boundClient.email}) отвязал Telegram (Chat ID: ${chatId}) через команду в боте`,
        },
      });

      const successText = `❌ <b>Связь с Telegram удалена!</b>\n\nВаш аккаунт Telegram больше не привязан к VPN-подписке BTV сотрудника <b>${boundClient.name}</b>.\n\nЕсли вы хотите привязать другой аккаунт, откройте персональный кабинет в браузере и выполните привязку повторно.`;
      await sendTelegramMessage(token, chatId, successText);
    } else {
      await sendTelegramMessage(token, chatId, '⚠️ <b>Вы еще не привязали VPN-подписку!</b>\n\nЭтот Telegram-аккаунт не связан ни с одной активной VPN-подпиской BTV.');
    }
    return;
  }

  // 3. Команда /help
  if (text === '/help') {
    const helpMsg = `🤖 <b>Доступные команды бота BTV VPN:</b>\n\n` +
      `📊 /status — Проверить баланс трафика, статус и срок действия подписки.\n` +
      `🔑 /config — Получить персональные ключи (VLESS/Trojan) и QR-код для ручного импорта.\n` +
      `📱 /instructions — Пошаговая инструкция по настройке VPN на iOS, Android, Windows, macOS.\n` +
      `📋 /request — Подать заявку на VPN конфигурацию.\n` +
      `❌ /unbind — Отвязать этот аккаунт Telegram от VPN-подписки.\n` +
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
      `⚡ <b>САМЫЙ ПРОСТОЙ СПОСОБ (Рекомендуется):</b>\n` +
      `Используйте однокнопочное приложение <b>Happ - Proxy Utility</b> (работает в 1 клик):\n` +
      `🍏 <a href="https://apps.apple.com/app/happ-proxy-utility/id6475730248">Скачать Happ для iPhone / iOS</a>\n` +
      `🤖 <a href="https://play.google.com/store/apps/details?id=com.happ.proxy">Скачать Happ для Android</a>\n\n` +
      `<b>Как настроить Happ:</b>\n` +
      `1️⃣ Скопируйте вашу ссылку подписки (через команду /config).\n` +
      `2️⃣ Откройте Happ. Приложение само автоматически предложит импортировать ссылку (нажмите OK / Import).\n` +
      `3️⃣ Нажмите большую круглую кнопку подключения по центру. Всё готово! 🎉\n\n` +
      `──────────────────\n\n` +
      `⚙️ <b>Альтернативные приложения (для опытных пользователей):</b>\n\n` +
      `🍏 <b>iOS (iPhone, iPad):</b>\n` +
      `• <a href="https://apps.apple.com/app/sing-box-tool/id6475221237">Sing-box</a> (бесплатный, стабильный клиент).\n` +
      `• <a href="https://apps.apple.com/app/shadowrocket/id932747118">Shadowrocket</a> ($2.99, продвинутый).\n` +
      `<i>Импорт: добавить профиль → тип HTTP / Subscription → вставить ссылку подписки.</i>\n\n` +
      `🤖 <b>Android:</b>\n` +
      `• <a href="https://play.google.com/store/apps/details?id=com.v2ray.ang">v2rayNG</a> (классика для Android).\n` +
      `• <a href="https://play.google.com/store/apps/details?id=io.nekohasekai.sfa">Sing-box</a> (быстрый и энергоэффективный).\n` +
      `<i>Импорт: нажать "+" → добавить подписку/профиль → вставить ссылку подписки.</i>\n\n` +
      `💻 <b>Windows:</b>\n` +
      `• <a href="https://github.com/MatsuriDayo/nekoray/releases">Nekoray</a> (мощный клиент для ПК).\n` +
      `• <a href="https://github.com/hiddify/hiddify-next/releases">Hiddify</a> (простой однокнопочный клиент для ПК).\n` +
      `<i>Импорт: добавить ссылку подписки (Группы → Настройки группы) или скопировать в Hiddify.</i>\n\n` +
      `🍏 <b>macOS:</b>\n` +
      `• <a href="https://apps.apple.com/app/foxtun/id6475221237">FoXray</a> или <a href="https://apps.apple.com/app/sing-box-tool/id6475221237">Sing-box</a>.\n` +
      `<i>Импорт: добавить подписку.</i>`;
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

  // Команда /request — Подача заявки на VPN конфигурацию
  if (text === '/request' || text.startsWith('/request ')) {
    const args = text.replace('/request', '').trim();
    
    if (!args) {
      // Без аргументов — показываем красивую инструкцию
      const requestHelp = `📋 <b>Запрос доступа к VPN BTV</b>\n\n` +
        `Чтобы подать заявку на подключение к VPN, вам нужно отправить боту сообщение с вашим <b>Email адресом</b>.\n\n` +
        `✍️ <b>Инструкция как это сделать:</b>\n\n` +
        `1️⃣ Нажмите на команду ниже, чтобы скопировать её в буфер обмена:\n` +
        `<code>/request </code>\n\n` +
        `2️⃣ Вставьте её в поле ввода сообщения.\n\n` +
        `3️⃣ <b>Допишите через пробел</b> ваш email (и, по желанию, примечание) и отправьте сообщение.\n\n` +
        `👉 <b>Пример готового сообщения:</b>\n` +
        `<code>/request ivan@example.com Для работы</code>\n\n` +
        `<i>После отправки заявка поступит к администраторам, и бот сразу уведомит вас о решении прямо в этом чате!</i>`;

      await sendTelegramMessage(token, chatId, requestHelp);
      return;
    }

    // Парсим email и описание
    const parts = args.split(/\s+/);
    const email = parts[0];
    const description = parts.slice(1).join(' ');

    // Простая валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await sendTelegramMessage(token, chatId,
        `❌ <b>Некорректный email</b>\n\n` +
        `Пожалуйста, укажите корректный email адрес.\n` +
        `Пример: <code>/request user@example.com</code>`
      );
      return;
    }

    // Проверяем дубликат
    const existingRequest = await prisma.vpnRequest.findFirst({
      where: { email: email.toLowerCase().trim(), status: 'PENDING' },
    });

    if (existingRequest) {
      await sendTelegramMessage(token, chatId,
        `⚠️ <b>Заявка уже существует</b>\n\n` +
        `На email <b>${email}</b> уже подана заявка, которая находится на рассмотрении.`
      );
      return;
    }

    // Создаём заявку
    try {
      await prisma.vpnRequest.create({
        data: {
          email: email.toLowerCase().trim(),
          telegram: message.from?.username ? `@${message.from.username}` : '',
          telegramChatId: String(chatId),
          name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || '',
          description: description || '',
          source: 'TELEGRAM',
        },
      });

      await sendTelegramMessage(token, chatId,
        `✅ <b>Заявка отправлена!</b>\n\n` +
        `Email: <b>${email}</b>\n` +
        (description ? `Описание: ${description}\n` : '') +
        `\nАдминистратор рассмотрит вашу заявку и вы получите уведомление в этот чат.`
      );
    } catch (err: any) {
      console.error('Error creating VPN request from Telegram:', err);
      await sendTelegramMessage(token, chatId,
        `❌ Произошла ошибка при отправке заявки. Попробуйте позже.`
      );
    }
    return;
  }

    // 7. Неподдерживаемые сообщения
    const unknownText = `🤔 <b>Неизвестная команда</b>\n\nДоступные команды:\n👉 /status — проверить остаток трафика и состояние VPN.\n👉 /config — получить VPN ключи и ссылку подписки.\n👉 /instructions — инструкции по настройке.\n👉 /request — подать заявку на VPN конфигурацию.\n👉 /support — написать в техподдержку.`;
    await sendTelegramMessage(token, chatId, unknownText);
  } catch (err: any) {
    console.error('Error in handleTelegramMessage:', err);
    try {
      const chatId = message?.chat?.id;
      if (chatId) {
        await sendTelegramMessage(
          token,
          chatId,
          `⚠️ <b>Внутренняя ошибка сервера</b>\n\nПроизошел сбой при обработке вашего запроса. Пожалуйста, убедитесь, что база данных обновлена, или обратитесь к администратору.`
        );
      }
    } catch (sendErr) {
      console.error('Failed to send error notification to user:', sendErr);
    }
  }
}
