import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// 1. Получить список всех шаблонов
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const templates = await prisma.template.findMany({
      include: {
        _count: {
          select: { clients: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, templates });
  } catch (error: any) {
    console.error('Error fetching templates:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении списка шаблонов' }, { status: 500 });
  }
}

// 2. Создать новый шаблон
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { name, description, inboundIds, trafficLimitGB, limitIp, durationDays } = await req.json();

    if (!name || name.trim() === '') {
      return NextResponse.json({ success: false, error: 'Название шаблона обязательно' }, { status: 400 });
    }

    if (!inboundIds || !Array.isArray(inboundIds) || inboundIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Необходимо привязать хотя бы одно входящее подключение (Inbound)' }, { status: 400 });
    }

    // Проверяем уникальность названия
    const existing = await prisma.template.findUnique({
      where: { name: name.trim() },
    });

    if (existing) {
      return NextResponse.json({ success: false, error: 'Шаблон с таким названием уже существует' }, { status: 400 });
    }

    const template = await prisma.template.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        inboundIdsJson: JSON.stringify(inboundIds),
        trafficLimitGB: Number(trafficLimitGB) || 0,
        limitIp: Number(limitIp) || 0,
        durationDays: Number(durationDays) || 30,
      },
    });

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'CREATE_TEMPLATE',
        details: `Создан шаблон VPN: ${template.name} (Лимит ГБ: ${template.trafficLimitGB}, Срок дней: ${template.durationDays})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, template });
  } catch (error: any) {
    console.error('Error creating template:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при создании шаблона' }, { status: 500 });
  }
}
