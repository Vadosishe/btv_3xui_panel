import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SECRET_KEY = process.env.JWT_SECRET || 'btw_default_super_secret_key_change_me_in_prod';
const encoder = new TextEncoder();
const key = encoder.encode(SECRET_KEY);

export interface SessionPayload {
  userId: string;
  email: string;
}

/**
 * Создать JWT-токен сессии
 */
export async function signToken(payload: SessionPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d') // Сессия на 7 дней
    .sign(key);
}

/**
 * Проверить JWT-токен сессии
 */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    return payload as unknown as SessionPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Получить сессию из кук (для серверных компонентов и API-роутов)
 */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin_session')?.value;
    if (!token) return null;
    return await verifyToken(token);
  } catch (error) {
    return null;
  }
}

/**
 * Удалить сессию (разлогиниться)
 */
export async function deleteSession() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('admin_session');
  } catch (error) {
    // Игнорируем в случае вызова вне контекста запроса
  }
}
