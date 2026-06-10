import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// 1. Получить список всех компаний
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: { clients: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, companies });
  } catch (error: any) {
    console.error('Error fetching companies:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении списка компаний' }, { status: 500 });
  }
}

// 2. Создать новую компанию
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { name, description } = await req.json();

    if (!name || name.trim() === '') {
      return NextResponse.json({ success: false, error: 'Название компании обязательно' }, { status: 400 });
    }

    // Проверяем уникальность названия
    const existing = await prisma.company.findUnique({
      where: { name: name.trim() },
    });

    if (existing) {
      return NextResponse.json({ success: false, error: 'Компания с таким названием уже существует' }, { status: 400 });
    }

    const company = await prisma.company.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
      },
    });

    // Создаем группу на сервере 3XUI
    try {
      const { xuiCreateGroup } = await import('@/lib/xui');
      await xuiCreateGroup(company.name);
    } catch (e) {
      console.warn('Failed to sync company creation as group on 3XUI:', e);
    }

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'CREATE_COMPANY',
        details: `Создана компания: ${company.name}`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, company });
  } catch (error: any) {
    console.error('Error creating company:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при создании компании' }, { status: 500 });
  }
}
