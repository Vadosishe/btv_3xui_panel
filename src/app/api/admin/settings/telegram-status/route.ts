import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

/**
 * GET /api/admin/settings/telegram-status
 * Выполняет диагностику токена бота, статуса вебхука и локального Long Polling.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const tokenSetting = await prisma.appSetting.findUnique({
      where: { key: 'tg_bot_token' }
    });
    const token = tokenSetting?.value || '';

    const appUrlSetting = await prisma.appSetting.findUnique({
      where: { key: 'app_panel_url' }
    });
    const appPanelUrl = appUrlSetting?.value || '';

    if (!token) {
      return NextResponse.json({
        success: true,
        configured: false,
        status: 'NOT_CONFIGURED',
        message: 'Токен Telegram бота не настроен.'
      });
    }

    // 1. Проверяем токен через getMe
    let botInfo: any = null;
    let getMeSuccess = false;
    let getMeError = '';

    try {
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(4000) });
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.ok) {
          botInfo = meData.result;
          getMeSuccess = true;
        } else {
          getMeError = meData.description || 'Неизвестная ошибка getMe';
        }
      } else {
        if (meRes.status === 401 || meRes.status === 404) {
          getMeError = 'Неверный токен бота (401 Unauthorized)';
        } else {
          getMeError = `Ошибка Telegram API: HTTP ${meRes.status}`;
        }
      }
    } catch (e: any) {
      getMeError = `Ошибка сети при запросе к Telegram: ${e.message}`;
    }

    if (!getMeSuccess) {
      return NextResponse.json({
        success: true,
        configured: true,
        status: 'INVALID_TOKEN',
        error: getMeError,
        message: 'Не удалось авторизоваться в Telegram. Проверьте правильность токена.'
      });
    }

    // 2. Получаем инфо о вебхуке через getWebhookInfo
    let webhookInfo: any = null;
    let webhookSuccess = false;
    let webhookError = '';

    try {
      const whRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(4000) });
      if (whRes.ok) {
        const whData = await whRes.json();
        if (whData.ok) {
          webhookInfo = whData.result;
          webhookSuccess = true;
        } else {
          webhookError = whData.description || 'Неизвестная ошибка getWebhookInfo';
        }
      } else {
        webhookError = `Ошибка Telegram API: HTTP ${whRes.status}`;
      }
    } catch (e: any) {
      webhookError = `Ошибка сети при запросе статуса вебхука: ${e.message}`;
    }

    const expectedWebhookUrl = appPanelUrl && appPanelUrl.startsWith('https://')
      ? `${appPanelUrl}/api/telegram/webhook`
      : '';

    const isWebhookActive = !!(webhookInfo?.url && webhookInfo.url !== '');
    const hasWebhookUrlMismatch = isWebhookActive && expectedWebhookUrl && webhookInfo.url !== expectedWebhookUrl;

    // Режим работы бота по факту
    let activeMode = 'UNKNOWN';
    if (isWebhookActive) {
      activeMode = 'WEBHOOK';
    } else if (globalThis.telegramPollingActive) {
      activeMode = 'POLLING';
    }

    return NextResponse.json({
      success: true,
      configured: true,
      status: 'OK',
      botInfo: {
        id: botInfo.id,
        firstName: botInfo.first_name,
        username: botInfo.username,
      },
      webhookInfo: webhookSuccess ? {
        url: webhookInfo.url || '',
        pendingUpdateCount: webhookInfo.pending_update_count || 0,
        lastErrorDate: webhookInfo.last_error_date || null,
        lastErrorMessage: webhookInfo.last_error_message || '',
        hasCustomCertificate: webhookInfo.has_custom_certificate || false,
      } : null,
      serverState: {
        pollingActive: !!globalThis.telegramPollingActive,
        appPanelUrl,
        expectedWebhookUrl,
        isHttps: appPanelUrl.startsWith('https://'),
      },
      diagnostics: {
        activeMode,
        isWebhookActive,
        hasWebhookUrlMismatch,
        webhookError,
      }
    });

  } catch (error: any) {
    console.error('Error in telegram bot status GET:', error);
    return NextResponse.json({ success: false, error: 'Внутренняя ошибка сервера при диагностике' }, { status: 500 });
  }
}

/**
 * POST /api/admin/settings/telegram-status
 * Принудительное переподключение/исправление вебхука или перезапуск Long Polling.
 */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { action } = await req.json();
    if (action !== 'repair') {
      return NextResponse.json({ success: false, error: 'Неподдерживаемое действие' }, { status: 400 });
    }

    const tokenSetting = await prisma.appSetting.findUnique({
      where: { key: 'tg_bot_token' }
    });
    const token = tokenSetting?.value || '';

    const appUrlSetting = await prisma.appSetting.findUnique({
      where: { key: 'app_panel_url' }
    });
    const appPanelUrl = appUrlSetting?.value || '';

    if (!token) {
      return NextResponse.json({ success: false, error: 'Токен бота не настроен' }, { status: 400 });
    }

    // 1. Всегда сначала сбрасываем вебхук в Telegram, чтобы убрать конфликты
    console.log('🤖 Manual bot repair initiated. Deleting active webhook first...');
    const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    const delData = await delRes.json();
    const deleteWebhookSuccess = delRes.ok && delData.ok;

    let modeApplied = '';
    let details = '';

    if (appPanelUrl && appPanelUrl.startsWith('https://')) {
      // Регистрируем вебхук заново
      const webhookUrl = `${appPanelUrl}/api/telegram/webhook`;
      console.log(`🤖 Repair: Panel URL is HTTPS, registering webhook to ${webhookUrl}`);
      
      const setWebhookRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const setWebhookData = await setWebhookRes.json();
      
      if (setWebhookRes.ok && setWebhookData.ok) {
        modeApplied = 'WEBHOOK';
        details = `Успешно зарегистрирован вебхук: ${webhookUrl}`;
        // Останавливаем Long Polling
        const { stopTelegramPolling } = await import('@/lib/telegram-polling');
        stopTelegramPolling();
      } else {
        modeApplied = 'ERROR';
        details = `Сброс вебхука выполнен, но повторная регистрация не удалась: ${setWebhookData.description || 'Неизвестная ошибка'}`;
      }
    } else {
      // Панель работает без HTTPS — используем фоновый Long Polling
      console.log('🤖 Repair: Panel URL is HTTP or empty, starting background Long Polling...');
      
      // Остановим старый опрос если был
      const { stopTelegramPolling, startTelegramPolling } = await import('@/lib/telegram-polling');
      stopTelegramPolling();
      
      // Даем время потоку завершиться
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Запускаем Long Polling заново
      startTelegramPolling();
      
      modeApplied = 'POLLING';
      details = 'Успешно сброшен вебхук и принудительно перезапущен фоновый опрос Long Polling на сервере.';
    }

    // Записываем лог в БД
    await prisma.auditLog.create({
      data: {
        action: 'REPAIR_TELEGRAM_BOT',
        details: `Выполнено принудительное восстановление бота Telegram. Режим: ${modeApplied}. Детали: ${details}`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      modeApplied,
      details,
      message: 'Бот успешно переподключен и настроен!'
    });

  } catch (error: any) {
    console.error('Error in telegram bot status POST:', error);
    return NextResponse.json({ success: false, error: `Внутренняя ошибка сервера: ${error.message}` }, { status: 500 });
  }
}
