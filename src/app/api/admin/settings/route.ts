import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiClearCache } from '@/lib/xui';

// 1. Получить все настройки приложения
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const settings = await prisma.appSetting.findMany();
    const settingsMap: Record<string, string> = {};
    settings.forEach(s => {
      settingsMap[s.key] = s.value;
    });

    // Добавим дефолтные значения для фронтенда, если их нет в БД
    const responseSettings = {
      xui_scheme: settingsMap.xui_scheme || 'http',
      xui_address: settingsMap.xui_address || 'localhost',
      xui_port: settingsMap.xui_port || '2053',
      xui_base_path: settingsMap.xui_base_path || '/',
      xui_api_token: settingsMap.xui_api_token || '',
      btw_support_link: settingsMap.btw_support_link || 'https://t.me/btw_support_bot',
      app_panel_url: settingsMap.app_panel_url || process.env.NEXTAUTH_URL || 'http://localhost:3000',
      tg_bot_token: settingsMap.tg_bot_token || '',
      tg_admin_chat_ids: settingsMap.tg_admin_chat_ids || '',
      sync_interval_minutes: settingsMap.sync_interval_minutes || '15',
      xui_node_costs: settingsMap.xui_node_costs || '{}',
      btw_subscription_price: settingsMap.btw_subscription_price || '100',
      xui_telegram_bot_token: settingsMap.xui_telegram_bot_token || '',
      xui_telegram_bot_username: settingsMap.xui_telegram_bot_username || '',
    };

    return NextResponse.json({ success: true, settings: responseSettings });
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении настроек' }, { status: 500 });
  }
}

// 2. Сохранить / Обновить настройки приложения
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const newSettings = await req.json();

    if (!newSettings || typeof newSettings !== 'object') {
      return NextResponse.json({ success: false, error: 'Некорректный формат данных' }, { status: 400 });
    }

    // Сохраняем каждую настройку транзакцией
    const operations = Object.entries(newSettings).map(([key, value]) => {
      return prisma.appSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    });

    await prisma.$transaction(operations);

    // Очищаем кэш XUI при обновлении системных настроек
    try {
      xuiClearCache();
    } catch (e) {
      console.warn('Failed to clear XUI cache during settings update:', e);
    }

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_SETTINGS',
        details: `Обновлены системные настройки панели (кол-во параметров: ${Object.keys(newSettings).length})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, message: 'Настройки успешно сохранены' });
  } catch (error: any) {
    console.error('Error saving settings:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при сохранении настроек' }, { status: 500 });
  }
}
