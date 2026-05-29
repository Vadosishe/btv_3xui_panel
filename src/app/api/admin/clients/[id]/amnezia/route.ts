import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getAwgServers, getTemplateAwgServers, amneziaGetPeerDetailsOnServer, amneziaSyncClient } from '@/lib/amnezia';

// GET: Проверить статус пира на всех привязанных серверах Amnezia WG-Easy
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const client = await prisma.client.findUnique({
      where: { id },
      include: { template: true },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: 'Клиент не найден' }, { status: 404 });
    }

    const allServers = await getAwgServers();
    const templateMap = await getTemplateAwgServers();
    const assignedIds = templateMap[client.templateId] || [];
    const assignedServers = allServers.filter(s => s.enabled && assignedIds.includes(s.id));

    if (assignedServers.length === 0) {
      return NextResponse.json({ success: true, servers: [], message: 'К тарифу этого клиента не привязаны серверы Amnezia WG' });
    }

    const serversStatus = [];
    for (const server of assignedServers) {
      const details = await amneziaGetPeerDetailsOnServer(server, client.email);
      if (details) {
        serversStatus.push({
          serverId: server.id,
          serverName: server.name,
          apiUrl: server.apiUrl,
          exists: details.exists,
          enabled: details.enabled || false,
          address: details.address || '',
          lastHandshakeAt: details.lastHandshakeAt || null,
          transferRx: details.transferRx || 0,
          transferTx: details.transferTx || 0,
        });
      } else {
        serversStatus.push({
          serverId: server.id,
          serverName: server.name,
          apiUrl: server.apiUrl,
          exists: false,
          error: true,
          message: 'Сервер недоступен или вернул ошибку',
        });
      }
    }

    return NextResponse.json({
      success: true,
      servers: serversStatus,
    });
  } catch (error: any) {
    console.error('Error checking Amnezia peer status:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при проверке статуса Amnezia' }, { status: 500 });
  }
}

// POST: Принудительно синхронизировать/создать пира на привязанных серверах Amnezia WG-Easy
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const client = await prisma.client.findUnique({
      where: { id },
      include: { template: true },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: 'Клиент не найден' }, { status: 404 });
    }

    const action = client.isActive ? 'add' : 'disable'; // Если активен — 'add' создаст или обновит (включит) пира
    await amneziaSyncClient(client.email, client.templateId, action);

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'SYNC_AMNEZIA_CLIENT',
        details: `Принудительная синхронизация Amnezia WG для клиента: ${client.name} (Email: ${client.email})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Запрос на синхронизацию Amnezia успешно отправлен на привязанные серверы',
    });
  } catch (error: any) {
    console.error('Error syncing Amnezia peer:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при синхронизации Amnezia' }, { status: 500 });
  }
}
