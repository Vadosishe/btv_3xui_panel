import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiAddClient, xuiDeleteClient, xuiCreateGroup } from '@/lib/xui';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { action } = await req.json();

    if (action === 'rebind_all') {
      // 1. Получаем все компании, шаблоны и активных клиентов
      const companies = await prisma.company.findMany();
      const templates = await prisma.template.findMany();
      const clients = await prisma.client.findMany({
        where: { isActive: true },
        include: {
          company: true,
          template: true,
        },
      });

      console.log(`Starting bulk re-binding for ${clients.length} clients...`);

      // 2. Сначала принудительно создаем группы для всех компаний в 3XUI
      for (const company of companies) {
        try {
          await xuiCreateGroup(company.name);
        } catch (e) {
          console.warn(`Failed to create group ${company.name} during bulk rebind:`, e);
        }
      }

      // 3. Для каждого клиента: удаляем из инбаундов и добавляем заново с верными настройками
      let successCount = 0;
      let failCount = 0;

      for (const client of clients) {
        let inboundIds: number[] = [];
        try {
          inboundIds = JSON.parse(client.template.inboundIdsJson || '[]');
        } catch (e) {
          continue;
        }

        if (inboundIds.length === 0) continue;

        // Лимит трафика
        const trafficLimitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : client.template.trafficLimitGB;
        const trafficBytesLimit = trafficLimitGB > 0
          ? BigInt(trafficLimitGB) * BigInt(1024 * 1024 * 1024)
          : BigInt(0);

        // Лимит IP
        const limitIp = client.limitIp !== null ? client.limitIp : client.template.limitIp;

        // Срок действия
        const expiresAt = client.expiresAt;
        const expiryTimeMs = expiresAt ? expiresAt.getTime() : 0;

        // Flow
        const flow = client.flow !== null ? client.flow : (client.template.flow || '');

        let clientSuccess = true;

        for (const inboundId of inboundIds) {
          try {
            // Удаляем старую запись (если была)
            await xuiDeleteClient(inboundId, client.email).catch(() => {});
            
            // Добавляем заново
            const added = await xuiAddClient(inboundId, {
              id: client.vpnUuid,
              email: client.email,
              limitIp,
              totalGB: Number(trafficBytesLimit),
              expiryTime: expiryTimeMs,
              enable: true,
              flow,
              tgId: client.tgId || '',
              templateId: client.templateId,
              group: client.company.name,
            });

            if (!added) {
              clientSuccess = false;
            }
          } catch (err) {
            clientSuccess = false;
          }
        }

        if (clientSuccess) {
          successCount++;
        } else {
          failCount++;
        }
      }

      await prisma.auditLog.create({
        data: {
          action: 'REBIND_ALL_CLIENTS',
          details: `Принудительно пересоздано клиентов на 3X-UI: ${successCount} успешно, ${failCount} сбоев`,
          adminId: session.userId,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Успешно пересоздано клиентов: ${successCount}. Ошибок: ${failCount}.`,
      });
    }

    if (action === 'sync_groups') {
      // Синхронизация групп из базы данных в 3XUI
      const companies = await prisma.company.findMany();
      let successCount = 0;

      for (const company of companies) {
        try {
          const created = await xuiCreateGroup(company.name);
          if (created) successCount++;
        } catch (e) {}
      }

      await prisma.auditLog.create({
        data: {
          action: 'SYNC_GROUPS_TO_XUI',
          details: `Синхронизировано групп (компаний) с 3XUI: ${successCount}`,
          adminId: session.userId,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Успешно создано/проверено групп в 3X-UI: ${successCount} из ${companies.length}`,
      });
    }

    return NextResponse.json({ success: false, error: 'Неизвестное действие' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in settings rebind-all route:', error);
    return NextResponse.json({ success: false, error: `Внутренняя ошибка: ${error.message}` }, { status: 500 });
  }
}
