import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get('limit');
    const take = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 200) : 200;

    // Выгружаем последние логи аудита
    const logs = await prisma.auditLog.findMany({
      include: {
        admin: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take,
    });

    return NextResponse.json({ success: true, logs });
  } catch (error: any) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении логов аудита' }, { status: 500 });
  }
}

// 2. Очистить логи (все или старше X дней)
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const daysParam = searchParams.get('days');
    
    let details = 'Очищены все логи аудита';
    
    if (daysParam) {
      const days = parseInt(daysParam, 10) || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      await prisma.auditLog.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
      });
      details = `Очищены логи аудита старше ${days} дней`;
    } else {
      await prisma.auditLog.deleteMany({});
    }

    // Записываем факт очистки в лог
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_SETTINGS',
        details,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error clearing audit logs:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при очистке логов аудита' }, { status: 500 });
  }
}
