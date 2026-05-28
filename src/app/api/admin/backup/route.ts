import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// Экспорт полного бэкапа данных в формате JSON
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    console.log(`Admin ${session.email} requested a database backup...`);

    // Собираем все данные из таблиц
    const admins = await prisma.admin.findMany({
      select: { id: true, email: true, name: true, passwordHash: true, createdAt: true },
    });
    const companies = await prisma.company.findMany();
    const templates = await prisma.template.findMany();
    const clients = await prisma.client.findMany();
    const settings = await prisma.appSetting.findMany();
    const logs = await prisma.auditLog.findMany({ take: 100, orderBy: { createdAt: 'desc' } }); // Последние 100 логов

    // Сериализуем BigInt в строки для клиентов
    const serializedClients = clients.map(c => ({
      ...c,
      usedTrafficBytes: c.usedTrafficBytes.toString(),
    }));

    const backupData = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      exportedBy: session.email,
      data: {
        admins,
        companies,
        templates,
        clients: serializedClients,
        settings,
        logs,
      },
    };

    // Создаем имя файла для экспорта
    const filename = `btw_vpn_backup_${new Date().toISOString().slice(0, 10)}.json`;

    // Логируем аудит экспорта
    await prisma.auditLog.create({
      data: {
        action: 'EXPORT_BACKUP',
        details: `Создана резервная копия данных: ${filename}`,
        adminId: session.userId,
      },
    });

    return new NextResponse(JSON.stringify(backupData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Error exporting backup:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при экспорте резервной копии' }, { status: 500 });
  }
}
