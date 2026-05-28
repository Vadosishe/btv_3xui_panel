import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// Удалить администратора
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    // Запрещаем удалять себя
    if (id === session.userId) {
      return NextResponse.json({ success: false, error: 'Вы не можете удалить собственную учетную запись' }, { status: 400 });
    }

    // Ищем целевого администратора перед удалением для лога
    const targetAdmin = await prisma.admin.findUnique({
      where: { id },
    });

    if (!targetAdmin) {
      return NextResponse.json({ success: false, error: 'Администратор не найден' }, { status: 404 });
    }

    await prisma.admin.delete({
      where: { id },
    });

    // Логируем в аудит-лог
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_ADMIN',
        details: `Администратор ${session.email} удалил учетную запись администратора: ${targetAdmin.email} (${targetAdmin.name})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, message: 'Администратор успешно удален' });
  } catch (error: any) {
    console.error('Error deleting admin:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при удалении администратора' }, { status: 500 });
  }
}
