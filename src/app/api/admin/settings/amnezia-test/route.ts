import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { apiUrl, apiPassword } = await req.json();

    if (!apiUrl) {
      return NextResponse.json({ success: false, error: 'Укажите URL API сервера Amnezia' }, { status: 400 });
    }

    const cleanUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

    // 1. Попытка авторизации
    let sessionCookie = '';
    try {
      const loginRes = await fetch(`${cleanUrl}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: apiPassword || '' }),
        cache: 'no-store',
      });

      if (!loginRes.ok) {
        const text = await loginRes.text();
        return NextResponse.json({
          success: false,
          error: `Ошибка авторизации на сервере. Статус: ${loginRes.status}. Ответ: ${text || 'нет ответа'}`
        });
      }

      const setCookie = loginRes.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/connect\.sid=[^;]+/);
        if (match) {
          sessionCookie = match[0];
        }
      }
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        error: `Не удалось подключиться к серверу по адресу ${cleanUrl}. Проверьте адрес и доступность сети. Ошибка: ${err.message}`
      });
    }

    // 2. Проверка работоспособности API (запрос списка пиров)
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (sessionCookie) {
        headers['Cookie'] = sessionCookie;
      }

      const peersRes = await fetch(`${cleanUrl}/api/peers`, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });

      if (!peersRes.ok) {
        const text = await peersRes.text();
        return NextResponse.json({
          success: false,
          error: `Успешно авторизовались, но API списков пиров вернуло ошибку. Статус: ${peersRes.status}. Ответ: ${text || 'нет ответа'}`
        });
      }

      const peers = await peersRes.json();
      return NextResponse.json({
        success: true,
        message: `Соединение успешно установлено! Обнаружено пиров на сервере: ${Array.isArray(peers) ? peers.length : 0}`,
      });
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        error: `Авторизовались успешно, но произошел сбой при получении списка пиров. Ошибка: ${err.message}`
      });
    }

  } catch (error: any) {
    console.error('Error testing Amnezia connection:', error);
    return NextResponse.json({ success: false, error: 'Внутренняя ошибка при тестировании соединения' }, { status: 500 });
  }
}
