import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiGetClientTraffic } from '@/lib/xui';

// Принудительная ручная или автоматическая синхронизация трафика клиентов
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    console.log('Starting client traffic synchronization from 3XUI...');
    
    // Получаем всех клиентов из БД
    const clients = await prisma.client.findMany({
      include: {
        template: true,
      },
    });

    let syncCount = 0;
    let failedCount = 0;

    for (const client of clients) {
      try {
        const trafficData = await xuiGetClientTraffic(client.email);

        if (trafficData) {
          // Вычисляем суммарный трафик (up + down)
          const up = BigInt(trafficData.up || 0);
          const down = BigInt(trafficData.down || 0);
          const totalUsedBytes = up + down;

          // Обновляем данные трафика в Postgres
          await prisma.client.update({
            where: { id: client.id },
            data: {
              usedTrafficBytes: totalUsedBytes,
              lastSyncedAt: new Date(),
            },
          });
          syncCount++;
        } else {
          // Если 3XUI не нашел статистику для этого email
          failedCount++;
        }
      } catch (err: any) {
        console.error(`Failed to sync traffic for client ${client.email}:`, err.message);
        failedCount++;
      }
    }

    // Логируем аудит синхронизации
    await prisma.auditLog.create({
      data: {
        action: 'SYNC_TRAFFIC',
        details: `Синхронизация трафика успешно завершена. Обновлено клиентов: ${syncCount}, сбоев: ${failedCount}`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Синхронизация трафика завершена',
      syncCount,
      failedCount,
    });
  } catch (error: any) {
    console.error('Error during traffic sync:', error);
    return NextResponse.json({ success: false, error: 'Внутренняя ошибка сервера при синхронизации' }, { status: 500 });
  }
}
