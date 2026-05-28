import prisma from './prisma';
import { handleTelegramMessage } from './telegram';

declare global {
  var telegramPollingActive: boolean | undefined;
  var telegramPollingOffset: number | undefined;
}

/**
 * Запустить Long Polling цикл для локального тестирования Telegram бота без Webhook
 */
export function startTelegramPolling() {
  // Защита от дублирования процессов при hot-reload в Next.js
  if (globalThis.telegramPollingActive) {
    return;
  }

  globalThis.telegramPollingActive = true;
  globalThis.telegramPollingOffset = globalThis.telegramPollingOffset ?? 0;

  console.log('🤖 Background Telegram Bot Polling successfully initialized.');

  // Запуск асинхронного неблокирующего цикла опроса
  const pollLoop = async () => {
    while (globalThis.telegramPollingActive) {
      try {
        // Подгружаем токен из базы настроек
        const setting = await prisma.appSetting.findUnique({
          where: { key: 'tg_bot_token' },
        });

        const token = setting?.value || '';
        if (!token) {
          // Если токен еще не задан, спим 15 секунд и проверяем снова
          await new Promise((resolve) => setTimeout(resolve, 15000));
          continue;
        }

        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${globalThis.telegramPollingOffset}&timeout=10`;
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
            for (const update of data.result) {
              // Обновляем offset, чтобы Telegram знал, что мы приняли эти сообщения
              globalThis.telegramPollingOffset = update.update_id + 1;

              if (update.message) {
                // Обрабатываем сообщение асинхронно
                try {
                  await handleTelegramMessage(token, update.message);
                } catch (msgErr: any) {
                  console.error('Error handling telegram message inside polling:', msgErr.message);
                }
              }
            }
          }
        } else {
          // Если пришел ошибочный статус от Telegram (например, неверный токен)
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      } catch (err: any) {
        // Ошибка сети или таймаут. Спим пару секунд перед ретраем
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  };

  pollLoop();
}

/**
 * Остановить опрос Telegram бота (при необходимости)
 */
export function stopTelegramPolling() {
  globalThis.telegramPollingActive = false;
  console.log('🤖 Background Telegram Bot Polling stopped.');
}
