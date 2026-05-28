import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { handleTelegramMessage } from '@/lib/telegram';

/**
 * Входная точка для Telegram Webhook в продакшене.
 * Telegram будет слать сюда POST запросы при поступлении новых сообщений.
 */
export async function POST(req: Request) {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: 'tg_bot_token' },
    });

    const token = setting?.value || '';
    if (!token) {
      return NextResponse.json({ success: false, error: 'Telegram Bot Token not configured' }, { status: 400 });
    }

    const body = await req.json();

    if (body && body.message) {
      // Асинхронно обрабатываем сообщение
      try {
        await handleTelegramMessage(token, body.message);
      } catch (err: any) {
        console.error('Error handling telegram message inside webhook:', err.message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Telegram Webhook Route Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
