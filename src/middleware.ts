import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET_KEY = process.env.JWT_SECRET || 'btw_default_super_secret_key_change_me_in_prod';
const encoder = new TextEncoder();
const key = encoder.encode(SECRET_KEY);

// Вспомогательная функция для генерации ожидаемого API ключа (совместимо с Next.js Edge Runtime)
async function getExpectedApiKey(secret: string): Promise<string> {
  const customApiKey = process.env.DIAGNOSTIC_API_KEY;
  if (customApiKey) return customApiKey;

  const msgUint8 = new TextEncoder().encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 32);
}

// Список публичных путей
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/favicon.ico',
  '/request',       // Публичная форма запроса VPN
  '/api/request',   // API для отправки заявки
  '/api/telegram',  // Telegram Webhook API
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Пропускаем статические файлы Next.js и медиа
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // 2. Пропускаем публичную ссылку Smart Subscription и Telegram Webhook
  if (pathname.startsWith('/api/sub/') || pathname.startsWith('/api/telegram/')) {
    return NextResponse.next();
  }

  // 3. Проверяем, является ли путь публичным
  const isPublicPath = PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'));

  // Получаем сессионный токен из кук
  const token = req.cookies.get('admin_session')?.value;

  let isValid = false;
  if (token) {
    try {
      await jwtVerify(token, key, { algorithms: ['HS256'] });
      isValid = true;
    } catch (e) {
      isValid = false;
    }
  }

  // 3.5. Защита API-эндпоинтов (с поддержкой сессии и API-ключа)
  if (pathname.startsWith('/api/')) {
    if (isValid || isPublicPath) {
      return NextResponse.next();
    }

    // Если нет валидной сессии и это не публичный API — проверяем API Key
    const authHeader = req.headers.get('authorization') || '';
    const apiKeyHeader = req.headers.get('x-api-key') || '';
    const apiKeyParam = req.nextUrl.searchParams.get('key') || '';

    let clientKey = apiKeyHeader || apiKeyParam;
    if (!clientKey && authHeader.startsWith('Bearer ')) {
      clientKey = authHeader.substring(7);
    }

    const expectedKey = await getExpectedApiKey(SECRET_KEY);

    if (clientKey && clientKey === expectedKey) {
      return NextResponse.next();
    }

    return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
  }

  // 4. Если пользователь авторизован и идет на /login — перенаправляем на /dashboard
  if (isValid && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // 5. Если путь приватный и пользователь НЕ авторизован — перенаправляем на /login
  if (!isValid && !isPublicPath && pathname !== '/') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // 6. Если заходят на корень "/" — перенаправляем на /dashboard (или на /login если не авторизован)
  if (pathname === '/') {
    if (isValid) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    } else {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  return NextResponse.next();
}

// Конфигурация Middleware (какие пути перехватывать)
export const config = {
  matcher: [
    /*
     * Перехватываем все пути, кроме тех, что содержат точку (файлы) или начинаются с:
     * - api/sub (публичная подписка)
     * - _next (внутренние ресурсы Next)
     */
    '/((?!api/sub|_next/static|_next/image|favicon.ico).*)',
  ],
};
