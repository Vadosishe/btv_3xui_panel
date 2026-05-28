import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiDeleteClient } from '@/lib/xui';

// Получить конкретную компанию с её клиентами
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        clients: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!company) {
      return NextResponse.json({ success: false, error: 'Компания не найдена' }, { status: 404 });
    }

    return NextResponse.json({ success: true, company });
  } catch (error: any) {
    console.error('Error fetching company details:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении данных компании' }, { status: 500 });
  }
}

// Обновить компанию
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const { name, description, isActive } = await req.json();

    if (!name || name.trim() === '') {
      return NextResponse.json({ success: false, error: 'Название компании обязательно' }, { status: 400 });
    }

    const existing = await prisma.company.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Компания не найдена' }, { status: 404 });
    }

    // Проверяем уникальность названия, если оно изменилось
    if (name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const nameDuplicate = await prisma.company.findUnique({
        where: { name: name.trim() },
      });
      if (nameDuplicate) {
        return NextResponse.json({ success: false, error: 'Компания с таким названием уже существует' }, { status: 400 });
      }
    }

    const updatedCompany = await prisma.company.update({
      where: { id },
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        isActive: isActive ?? existing.isActive,
      },
    });

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_COMPANY',
        details: `Обновлена компания: ${updatedCompany.name} (Активна: ${updatedCompany.isActive})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, company: updatedCompany });
  } catch (error: any) {
    console.error('Error updating company:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при обновлении данных компании' }, { status: 500 });
  }
}

// Удалить компанию (с каскадным удалением её клиентов в 3XUI!)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        clients: {
          include: {
            template: true,
          },
        },
      },
    });

    if (!company) {
      return NextResponse.json({ success: false, error: 'Компания не найдена' }, { status: 404 });
    }

    console.log(`Deleting company ${company.name} and cleaning up ${company.clients.length} clients in 3XUI...`);

    // 1. Сначала удаляем каждого клиента этой компании из XUI на всех инбаундах по их шаблонам
    for (const client of company.clients) {
      try {
        const inboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');
        for (const inboundId of inboundIds) {
          await xuiDeleteClient(inboundId, client.vpnUuid);
        }
      } catch (xuiErr: any) {
        console.error(`Failed to delete client ${client.email} from 3XUI during company deletion:`, xuiErr.message);
        // Продолжаем удаление остальных клиентов, даже если возникли сбои на API
      }
    }

    // 2. Удаляем компанию из БД (база каскадно удалит и записи клиентов из таблицы Client)
    await prisma.company.delete({
      where: { id },
    });

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_COMPANY',
        details: `Удалена компания: ${company.name} и все её сотрудники (${company.clients.length} пользователей)`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, message: 'Компания и все её пользователи успешно удалены' });
  } catch (error: any) {
    console.error('Error deleting company:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при удалении компании' }, { status: 500 });
  }
}
