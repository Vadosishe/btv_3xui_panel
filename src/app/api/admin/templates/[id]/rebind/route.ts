import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiAddClient, xuiDeleteClient, xuiGetInbounds } from '@/lib/xui';

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

    // 1. Получаем шаблон
    const template = await prisma.template.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ success: false, error: 'Шаблон не найден' }, { status: 404 });
    }

    let targetInboundIds: number[] = [];
    try {
      targetInboundIds = JSON.parse(template.inboundIdsJson || '[]');
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Ошибка структуры инбаундов в шаблоне' }, { status: 500 });
    }

    if (targetInboundIds.length === 0) {
      return NextResponse.json({ success: false, error: 'В шаблоне нет активных инбаундов 3XUI' }, { status: 400 });
    }

    // 2. Получаем всех активных клиентов этого шаблона
    const clients = await prisma.client.findMany({
      where: { templateId: id, isActive: true },
      include: { company: true },
    });

    if (clients.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Нет активных клиентов, назначенных на этот шаблон.',
      });
    }

    // 3. Получаем все инбаунды 3XUI, чтобы понять, из каких инбаундов нужно удалить клиентов
    const allInbounds = await xuiGetInbounds().catch(() => [] as any[]);

    console.log(`Re-binding ${clients.length} clients of template "${template.name}" to inbounds: [${targetInboundIds.join(', ')}]...`);

    let successCount = 0;
    let failCount = 0;

    for (const client of clients) {
      // Находим инбаунды на 3XUI, где этот клиент зарегистрирован сейчас
      const currentInboundIds: number[] = [];
      for (const inbound of allInbounds) {
        let settings: any = {};
        try {
          settings = typeof inbound.settings === 'string'
            ? JSON.parse(inbound.settings)
            : inbound.settings || {};
        } catch (e) {}
        
        const clientsArray = settings.clients || [];
        if (clientsArray.some((c: any) => c.email?.toLowerCase().trim() === client.email.toLowerCase().trim())) {
          currentInboundIds.push(inbound.id);
        }
      }

      // Удаляем из всех инбаундов, на которых он есть, но которых нет в шаблоне
      for (const currentInboundId of currentInboundIds) {
        if (!targetInboundIds.includes(currentInboundId)) {
          try {
            await xuiDeleteClient(currentInboundId, client.email);
          } catch (e) {
            console.error(`Failed to delete client ${client.email} from unwanted Inbound ${currentInboundId}:`, e);
          }
        }
      }

      // Добавляем/обновляем на всех инбаундах шаблона
      let clientSuccess = true;
      
      const trafficLimitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : template.trafficLimitGB;
      const trafficBytesLimit = trafficLimitGB > 0
        ? BigInt(trafficLimitGB) * BigInt(1024 * 1024 * 1024)
        : BigInt(0);
      const limitIp = client.limitIp !== null ? client.limitIp : template.limitIp;
      const expiresAt = client.expiresAt;
      const expiryTimeMs = expiresAt ? expiresAt.getTime() : 0;
      const flow = client.flow !== null ? client.flow : (template.flow || '');

      for (const targetInboundId of targetInboundIds) {
        try {
          // Сначала удаляем (для полной перепривязки/перезаписи конфига с верными параметрами)
          await xuiDeleteClient(targetInboundId, client.email).catch(() => {});

          const added = await xuiAddClient(targetInboundId, {
            id: client.vpnUuid,
            email: client.email,
            limitIp,
            totalGB: Number(trafficBytesLimit),
            expiryTime: expiryTimeMs,
            enable: true,
            flow,
            tgId: client.tgId || '',
            templateId: template.id,
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
        action: 'REBIND_TEMPLATE_CLIENTS',
        details: `Перепривязаны ноды/инбаунды для шаблона "${template.name}": ${successCount} успешно, ${failCount} сбоев`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Перепривязано клиентов шаблона: ${successCount} успешно, ошибок: ${failCount}`,
    });
  } catch (error: any) {
    console.error('Error in template rebind route:', error);
    return NextResponse.json({ success: false, error: `Внутренняя ошибка: ${error.message}` }, { status: 500 });
  }
}
