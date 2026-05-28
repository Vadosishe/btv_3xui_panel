import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// Получить конкретный шаблон
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    const template = await prisma.template.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ success: false, error: 'Шаблон не найден' }, { status: 404 });
    }

    return NextResponse.json({ success: true, template });
  } catch (error: any) {
    console.error('Error fetching template details:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении данных шаблона' }, { status: 500 });
  }
}

// Обновить шаблон
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const { name, description, inboundIds, trafficLimitGB, limitIp, durationDays, flow } = await req.json();

    if (!name || name.trim() === '') {
      return NextResponse.json({ success: false, error: 'Название шаблона обязательно' }, { status: 400 });
    }

    if (!inboundIds || !Array.isArray(inboundIds) || inboundIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Необходимо привязать хотя бы одно входящее подключение (Inbound)' }, { status: 400 });
    }

    const existing = await prisma.template.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Шаблон не найден' }, { status: 404 });
    }

    // Проверяем уникальность названия при изменении
    if (name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const nameDuplicate = await prisma.template.findUnique({
        where: { name: name.trim() },
      });
      if (nameDuplicate) {
        return NextResponse.json({ success: false, error: 'Шаблон с таким названием уже существует' }, { status: 400 });
      }
    }

    const updatedTemplate = await prisma.template.update({
      where: { id },
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        inboundIdsJson: JSON.stringify(inboundIds),
        trafficLimitGB: Number(trafficLimitGB) || 0,
        limitIp: Number(limitIp) || 0,
        durationDays: Number(durationDays) || 30,
        flow: flow?.trim() || "",
      },
    });

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_TEMPLATE',
        details: `Обновлен шаблон VPN: ${updatedTemplate.name} (Лимит ГБ: ${updatedTemplate.trafficLimitGB}, Срок: ${updatedTemplate.durationDays} дн.)`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, template: updatedTemplate });
  } catch (error: any) {
    console.error('Error updating template:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при обновлении данных шаблона' }, { status: 500 });
  }
}

// Безопасное удаление шаблона (с проверкой зависимости клиентов)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    const template = await prisma.template.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ success: false, error: 'Шаблон не найден' }, { status: 404 });
    }

    // 1. Проверяем, есть ли клиенты, привязанные к этому шаблону
    const clientsCount = await prisma.client.count({
      where: { templateId: id },
    });

    if (clientsCount > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Невозможно удалить шаблон, так как он назначен ${clientsCount} клиентам. Сначала переназначьте их на другой шаблон.`,
        },
        { status: 400 }
      );
    }

    // 2. Удаляем шаблон из БД
    await prisma.template.delete({
      where: { id },
    });

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_TEMPLATE',
        details: `Удален шаблон VPN: ${template.name}`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, message: 'Шаблон успешно удален' });
  } catch (error: any) {
    console.error('Error deleting template:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при удалении шаблона' }, { status: 500 });
  }
}
