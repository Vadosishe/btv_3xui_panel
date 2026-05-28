import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { scheme, address, port, basePath, apiToken } = await req.json();

    if (!address || !port || !apiToken) {
      return NextResponse.json({ success: false, error: 'Адрес, порт и API токен обязательны' }, { status: 400 });
    }

    // Нормализуем путь
    let normalizedPath = basePath || '/';
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
    if (normalizedPath.endsWith('/') && normalizedPath.length > 1) {
      normalizedPath = normalizedPath.slice(0, -1);
    }

    const apiUrl = `${scheme || 'http'}://${address}:${port}${normalizedPath === '/' ? '' : normalizedPath}`;
    const testUrl = `${apiUrl}/panel/api/inbounds/list`;

    console.log(`Testing XUI connection to: ${testUrl}`);

    const res = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000), // Таймаут 5 секунд
    });

    if (!res.ok) {
      return NextResponse.json({ 
        success: false, 
        error: `Ошибка HTTP: статус ${res.status}. Убедитесь, что схема, адрес и порт указаны верно.` 
      });
    }

    const data = await res.json();
    if (data.success) {
      const inboundsCount = Array.isArray(data.obj) ? data.obj.length : 0;
      return NextResponse.json({ 
        success: true, 
        message: `Соединение успешно установлено! Найдено входящих подключений (inbounds): ${inboundsCount}` 
      });
    } else {
      return NextResponse.json({ 
        success: false, 
        error: `Панель 3XUI вернула ошибку: ${data.msg || 'Неизвестная ошибка'}` 
      });
    }
  } catch (err: any) {
    console.error('XUI Test connection failed:', err);
    let errorMessage = err.message || 'Ошибка подключения';
    if (err.name === 'TimeoutError') {
      errorMessage = 'Превышено время ожидания ответа (таймаут 5 сек). Проверьте доступность IP/порта сервера.';
    }
    return NextResponse.json({ success: false, error: `Не удалось подключиться: ${errorMessage}` });
  }
}
