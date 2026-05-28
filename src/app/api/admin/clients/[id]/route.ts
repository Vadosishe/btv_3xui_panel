import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiAddClient, xuiDeleteClient, xuiGetInbounds, generateConfigLink } from '@/lib/xui';
import QRCode from 'qrcode';

// 1. Получить детальную информацию о клиенте + сгенерированные VPN-ссылки
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        company: true,
        template: true,
      },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: 'Клиент не найден' }, { status: 404 });
    }

    // Извлекаем домены нод из настроек
    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    
    // JSON-карта ID нод в домены, например: {"0":"nl1.btw.com", "1":"nl2.btw.com"}
    const nodeDomainsRaw = settingsMap.get('xui_node_domains') || '{}';
    let nodeDomains: Record<string, string> = {};
    try {
      nodeDomains = JSON.parse(nodeDomainsRaw);
    } catch (e) {
      nodeDomains = {};
    }

    // Дефолтный домен (хост главного сервера)
    const defaultDomain = settingsMap.get('xui_address') || 'vpn.btw.com';

    // Получаем инбаунды с 3XUI, чтобы спарсить Reality/TLS настройки и сгенерировать ссылки
    let configLinks: string[] = [];
    try {
      const inbounds = await xuiGetInbounds();
      const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');

      for (const inboundId of templateInboundIds) {
        const inbound = inbounds.find(i => i.id === inboundId);
        if (inbound) {
          // Вычисляем, к каким нодам привязан инбаунд
          const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
          const nodeDomain = nodeDomains[inboundNodeId] || defaultDomain;

          const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain);
          if (link) {
            configLinks.push(link);
          }
        }
      }
    } catch (xuiErr: any) {
      console.error('Failed to generate config links from XUI inbounds:', xuiErr.message);
    }

    // Персональная ссылка подписки (Smart Subscription Link)
    const subscriptionUrl = `${settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/sub/${client.subscriptionToken}`;

    // Генерируем QR-код для ссылки подписки в Base64 Data URL
    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(subscriptionUrl);
    } catch (qrErr) {
      console.error('Failed to generate QR code:', qrErr);
    }

    return NextResponse.json({
      success: true,
      client: {
        ...client,
        usedTrafficBytes: client.usedTrafficBytes.toString(),
      },
      configLinks,
      subscriptionUrl,
      qrCodeDataUrl,
    });
  } catch (error: any) {
    console.error('Error fetching client details:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении данных клиента' }, { status: 500 });
  }
}

// 2. Обновить клиента (с изменением тарифов / шаблонов на 3XUI серверах)
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const {
      name,
      companyId,
      templateId,
      customTrafficLimitGB,
      customLimitIp,
      customExpiresAt,
      isActive,
    } = await req.json();

    // 1. Находим существующего клиента
    const client = await prisma.client.findUnique({
      where: { id },
      include: { template: true },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: 'Клиент не найден' }, { status: 404 });
    }

    // 2. Валидируем компанию и шаблон, если они меняются
    const targetCompanyId = companyId || client.companyId;
    const targetTemplateId = templateId || client.templateId;

    const company = await prisma.company.findUnique({ where: { id: targetCompanyId } });
    const newTemplate = await prisma.template.findUnique({ where: { id: targetTemplateId } });

    if (!company) {
      return NextResponse.json({ success: false, error: 'Выбранная компания не найдена' }, { status: 404 });
    }
    if (!newTemplate) {
      return NextResponse.json({ success: false, error: 'Выбранный шаблон не найден' }, { status: 404 });
    }

    // Вычисляем новые лимиты
    const trafficLimitGB = customTrafficLimitGB !== undefined && customTrafficLimitGB !== null
      ? Number(customTrafficLimitGB)
      : newTemplate.trafficLimitGB;

    const limitIp = customLimitIp !== undefined && customLimitIp !== null
      ? Number(customLimitIp)
      : newTemplate.limitIp;

    let expiresAt: Date | null = null;
    if (customExpiresAt) {
      expiresAt = new Date(customExpiresAt);
    } else if (newTemplate.durationDays > 0) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + newTemplate.durationDays);
      expiresAt = expDate;
    }

    const trafficBytesLimit = trafficLimitGB > 0
      ? BigInt(trafficLimitGB) * BigInt(1024 * 1024 * 1024)
      : BigInt(0);

    const expiryTimeMs = expiresAt ? expiresAt.getTime() : 0;
    const isClientEnabled = isActive !== undefined ? !!isActive : client.isActive;

    // 3. --- Синхронизация изменений с 3XUI серверами ---
    const oldInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');
    const newInboundIds: number[] = JSON.parse(newTemplate.inboundIdsJson || '[]');

    // Для максимальной надежности:
    // Удаляем клиента из ВСЕХ старых инбаундов
    for (const oldInboundId of oldInboundIds) {
      try {
        await xuiDeleteClient(oldInboundId, client.vpnUuid);
      } catch (e: any) {
        console.error(`Failed to delete client ${client.email} from old Inbound ${oldInboundId}:`, e.message);
      }
    }

    // Добавляем клиента во ВСЕ новые инбаунды с обновленными параметрами (если клиент включен)
    const addedInbounds: number[] = [];
    let apiSuccess = true;
    let apiErrorMsg = '';

    if (isClientEnabled) {
      for (const newInboundId of newInboundIds) {
        try {
          const added = await xuiAddClient(newInboundId, {
            id: client.vpnUuid,
            email: client.email,
            limitIp: limitIp,
            totalGB: Number(trafficBytesLimit),
            expiryTime: expiryTimeMs,
            enable: true,
          });

          if (added) {
            addedInbounds.push(newInboundId);
          } else {
            apiSuccess = false;
            apiErrorMsg = `3XUI rejected adding to Inbound ${newInboundId}`;
            break;
          }
        } catch (err: any) {
          apiSuccess = false;
          apiErrorMsg = `3XUI API error: ${err.message}`;
          break;
        }
      }

      // Откат при сбоях добавления
      if (!apiSuccess) {
        console.warn(`Rollback new inbounds after edit failure: [${addedInbounds.join(', ')}]...`);
        for (const addedId of addedInbounds) {
          try {
            await xuiDeleteClient(addedId, client.vpnUuid);
          } catch (e: any) {
            console.error(`Rollback failed for Inbound ${addedId}:`, e.message);
          }
        }
        return NextResponse.json({ success: false, error: `Не удалось обновить настройки на VPN серверах: ${apiErrorMsg}` }, { status: 502 });
      }
    }

    // 4. --- Сохраняем обновленные данные в Postgres ---
    const updatedClient = await prisma.client.update({
      where: { id },
      data: {
        name: name ? name.trim() : client.name,
        companyId: targetCompanyId,
        templateId: targetTemplateId,
        trafficLimitGB: customTrafficLimitGB !== undefined && customTrafficLimitGB !== null ? Number(customTrafficLimitGB) : null,
        limitIp: customLimitIp !== undefined && customLimitIp !== null ? Number(customLimitIp) : null,
        expiresAt: expiresAt,
        isActive: isClientEnabled,
      },
    });

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_CLIENT',
        details: `Обновлен VPN-клиент: ${updatedClient.name} (Активен: ${updatedClient.isActive}, Лимит ГБ: ${trafficLimitGB})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      client: {
        ...updatedClient,
        usedTrafficBytes: updatedClient.usedTrafficBytes.toString(),
      },
    });
  } catch (error: any) {
    console.error('Error updating client:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при обновлении клиента' }, { status: 500 });
  }
}

// 3. Удалить клиента
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    // Находим клиента с шаблоном для удаления из 3XUI
    const client = await prisma.client.findUnique({
      where: { id },
      include: { template: true },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: 'Клиент не найден' }, { status: 404 });
    }

    // 1. Удаляем клиента на серверах 3XUI во всех инбаундах по его шаблону
    let inboundIds: number[] = [];
    try {
      inboundIds = JSON.parse(client.template.inboundIdsJson || '[]');
    } catch (e) {}

    for (const inboundId of inboundIds) {
      try {
        await xuiDeleteClient(inboundId, client.vpnUuid);
      } catch (err: any) {
        console.error(`Failed to delete client ${client.email} from 3XUI Inbound ${inboundId}:`, err.message);
      }
    }

    // 2. Удаляем запись из БД Postgres
    await prisma.client.delete({
      where: { id },
    });

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_CLIENT',
        details: `Удален VPN-клиент: ${client.name} (Email: ${client.email})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true, message: 'Клиент успешно удален из БД и серверов VPN' });
  } catch (error: any) {
    console.error('Error deleting client:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при удалении клиента' }, { status: 500 });
  }
}
