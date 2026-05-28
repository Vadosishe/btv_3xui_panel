import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// 1. Получить список администраторов
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const admins = await prisma.admin.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return NextResponse.json({ success: true, admins });
  } catch (error: any) {
    console.error('Error fetching admins:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении списка администраторов' }, { status: 500 });
  }
}

// 2. Создать нового администратора
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { email, password, name } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json({ success: false, error: 'Все поля (email, пароль, имя) обязательны' }, { status: 400 });
    }

    // Проверяем, существует ли администратор с таким email
    const existingAdmin = await prisma.admin.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingAdmin) {
      return NextResponse.json({ success: false, error: 'Администратор с таким email уже существует' }, { status: 400 });
    }

    // Хэшируем пароль с помощью bcryptjs
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newAdmin = await prisma.admin.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name.trim(),
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    // Фиксируем в аудит-логе
    await prisma.auditLog.create({
      data: {
        action: 'CREATE_ADMIN',
        details: `Администратор ${session.email} создал учетную запись администратора: ${newAdmin.email} (${newAdmin.name})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, admin: newAdmin });
  } catch (error: any) {
    console.error('Error creating admin:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при создании администратора' }, { status: 500 });
  }
}
