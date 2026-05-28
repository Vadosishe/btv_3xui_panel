import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { signToken } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email и пароль обязательны' },
        { status: 400 }
      );
    }

    // 1. Проверяем, есть ли администраторы в БД вообще
    const adminCount = await prisma.admin.count();
    let admin = null;

    if (adminCount === 0) {
      // Авто-сидинг первого администратора для удобства запуска
      console.log('No admins found in database. Auto-creating default admin...');
      const defaultEmail = 'admin@btw.vpn';
      const defaultPassword = 'admin';
      
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(defaultPassword, salt);

      admin = await prisma.admin.create({
        data: {
          email: defaultEmail,
          name: 'Главный Администратор',
          passwordHash,
        },
      });

      // Логируем автосоздание в AuditLog
      await prisma.auditLog.create({
        data: {
          action: 'AUTO_SEED_ADMIN',
          details: 'Автоматически создан стандартный аккаунт администратора: admin@btw.vpn',
        },
      });
    }

    // 2. Ищем администратора по email
    if (!admin) {
      admin = await prisma.admin.findUnique({
        where: { email },
      });
    }

    // 3. Если админ не найден или пароль не совпадает
    if (!admin) {
      return NextResponse.json(
        { success: false, error: 'Неверный email или пароль' },
        { status: 401 }
      );
    }

    // В случае автосидинга, если пользователь пытается войти с другими данными
    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return NextResponse.json(
        { success: false, error: 'Неверный email или пароль' },
        { status: 401 }
      );
    }

    // 4. Генерируем токен сессии
    const token = await signToken({
      userId: admin.id,
      email: admin.email,
    });

    // 5. Формируем ответ с установкой httpOnly куки
    const response = NextResponse.json({
      success: true,
      message: 'Успешная авторизация',
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      },
    });

    // Устанавливаем куку
    response.cookies.set({
      name: 'admin_session',
      value: token,
      httpOnly: true,
      secure: false, // Отключаем жесткий Secure флаг, чтобы сессия работала при прямом доступе по HTTP (через IP:3002)
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 дней
      path: '/',
    });

    // Записываем лог входа
    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_LOGIN',
        details: `Успешный вход администратора: ${admin.email}`,
        adminId: admin.id,
      },
    });

    return response;
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, error: 'Внутренняя ошибка сервера при входе' },
      { status: 500 }
    );
  }
}
