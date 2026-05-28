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
