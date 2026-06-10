import prisma from '@/lib/prisma';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { 
  xuiAddClient, 
  xuiDeleteClient, 
  xuiGetInbounds, 
  xuiGetOnlineClients, 
  xuiGetNodeDomains, 
  xuiClearCache, 
  generateConfigLink, 
  getCleanLatinName 
} from '@/lib/xui';

export interface CreateClientParams {
  name?: string;
  names?: string | string[];
  companyId: string;
  templateId: string;
  customTrafficLimitGB?: number | null;
  customLimitIp?: number | null;
  customExpiresAt?: string | Date | null;
  customFlow?: string | null;
  customTgId?: string | null;
}

export interface UpdateClientParams {
  name?: string;
  companyId?: string;
  templateId?: string;
  customTrafficLimitGB?: number | null;
  customLimitIp?: number | null;
  customExpiresAt?: string | Date | null;
  customFlow?: string | null;
  customTgId?: string | null;
  isActive?: boolean;
}

/**
 * Сервис для управления VPN клиентами (сотрудниками)
 */
export class ClientService {
  /**
   * Получить список всех клиентов с динамическими нодами и статусом онлайн
   */
  static async getClientsList() {
    const clients = await prisma.client.findMany({
      include: {
        company: { select: { name: true } },
        template: {
          select: { name: true, trafficLimitGB: true, limitIp: true, durationDays: true, inboundIdsJson: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Загружаем онлайн-статусы и инбаунды с 3XUI
    let onlineEmails: string[] = [];
    let inbounds: any[] = [];
    try {
      [onlineEmails, inbounds] = await Promise.all([
        xuiGetOnlineClients(),
        xuiGetInbounds(),
      ]);
    } catch (e) {
      console.warn('Failed to fetch online clients or inbounds in ClientService:', e);
    }

    const safeOnlineEmails = Array.isArray(onlineEmails) ? onlineEmails : [];
    const safeInbounds = Array.isArray(inbounds) ? inbounds : [];

    const onlineEmailsLower = safeOnlineEmails.map(e => String(e).toLowerCase().trim());
    const inboundMap = new Map(safeInbounds.map(i => [i.id, i.remark || i.protocol]));

    return clients.map(client => {
      let templateInboundIds: number[] = [];
      try {
        templateInboundIds = JSON.parse(client.template?.inboundIdsJson || '[]');
      } catch (e) {}

      const clientEmailLower = client.email ? client.email.toLowerCase().trim() : '';
      const clientUuidLower = client.vpnUuid ? client.vpnUuid.toLowerCase().trim() : '';
      const actualInboundIds: number[] = [];

      for (const inbound of safeInbounds) {
        if (!inbound) continue;

        let settings: any = {};
        try {
          settings = typeof inbound.settings === 'string'
            ? JSON.parse(inbound.settings)
            : inbound.settings || {};
        } catch (e) {}
        const clientsArray = settings.clients || [];
        const hasSettingsMatch = clientsArray.some((c: any) =>
          (c.email && c.email.toLowerCase().trim() === clientEmailLower) ||
          (c.id && c.id.toLowerCase().trim() === clientUuidLower)
        );

        if (hasSettingsMatch) {
          actualInboundIds.push(inbound.id);
          continue;
        }

        const statsArray = inbound.clientStats || [];
        const hasStatsMatch = statsArray.some((s: any) =>
          (s.email && s.email.toLowerCase().trim() === clientEmailLower) ||
          (s.uuid && s.uuid.toLowerCase().trim() === clientUuidLower) ||
          (s.id && s.id.toLowerCase().trim() === clientUuidLower)
        );

        if (hasStatsMatch) {
          actualInboundIds.push(inbound.id);
        }
      }

      const finalInboundIds = actualInboundIds.length > 0 ? actualInboundIds : templateInboundIds;
      const nodeNames = finalInboundIds
        .map(id => inboundMap.get(id))
        .filter(Boolean) as string[];

      return {
        ...client,
        usedTrafficBytes: client.usedTrafficBytes ? client.usedTrafficBytes.toString() : '0',
        isOnline: onlineEmailsLower.includes(clientEmailLower) || 
                  onlineEmailsLower.includes(clientUuidLower),
        nodes: nodeNames,
      };
    });
  }

  /**
   * Получить детальную информацию о клиенте и сгенерированные ссылки
   */
  static async getClientDetails(id: string) {
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        company: true,
        template: true,
      },
    });

    if (!client) return null;

    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const nodeDomains = await xuiGetNodeDomains();
    const defaultDomain = nodeDomains['0'] || settingsMap.get('xui_address') || 'vpn.btw.com';

    let configLinks: string[] = [];
    try {
      const inbounds = await xuiGetInbounds();
      const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');

      for (const inboundId of templateInboundIds) {
        const inbound = inbounds.find(i => i.id === inboundId);
        if (inbound) {
          const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
          const nodeDomain = nodeDomains[inboundNodeId] || defaultDomain;
          const clientFlow = client.flow !== null ? client.flow : (client.template.flow || '');
          const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain, clientFlow, client.name);
          if (link) configLinks.push(link);
        }
      }
    } catch (xuiErr: any) {
      console.error('Failed to generate config links in ClientService:', xuiErr.message);
    }

    const subscriptionUrl = `${settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/sub/${client.subscriptionToken}`;
    
    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(subscriptionUrl);
    } catch (qrErr) {
      console.error('Failed to generate QR code in ClientService:', qrErr);
    }

    return {
      client: {
        ...client,
        usedTrafficBytes: client.usedTrafficBytes.toString(),
      },
      configLinks,
      subscriptionUrl,
      qrCodeDataUrl,
    };
  }

  /**
   * Создать одного или нескольких клиентов (с транзакционным откатом)
   */
  static async createClients(params: CreateClientParams, adminId?: string) {
    const {
      name,
      names,
      companyId,
      templateId,
      customTrafficLimitGB,
      customLimitIp,
      customExpiresAt,
      customFlow,
      customTgId,
    } = params;

    if (!companyId || !templateId) {
      throw new Error('Параметры companyId и templateId обязательны');
    }

    const namesArray: string[] = [];
    if (names) {
      if (Array.isArray(names)) {
        namesArray.push(...names.map(n => String(n).trim()).filter(Boolean));
      } else {
        namesArray.push(...String(names).split('\n').map(n => n.trim()).filter(Boolean));
      }
    } else if (name && name.trim() !== '') {
      namesArray.push(name.trim());
    }

    if (namesArray.length === 0) {
      throw new Error('ФИО сотрудника(ов) обязательно');
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const template = await prisma.template.findUnique({ where: { id: templateId } });

    if (!company) throw new Error('Компания не найдена');
    if (!template) throw new Error('Шаблон не найден');

    const trafficLimitGB = customTrafficLimitGB !== undefined && customTrafficLimitGB !== null
      ? Number(customTrafficLimitGB)
      : template.trafficLimitGB;

    const limitIp = customLimitIp !== undefined && customLimitIp !== null
      ? Number(customLimitIp)
      : template.limitIp;

    const flow = customFlow !== undefined && customFlow !== null ? customFlow.trim() : template.flow || '';
    const tgId = customTgId !== undefined && customTgId !== null ? customTgId.trim() : '';

    let expiresAt: Date | null = null;
    if (customExpiresAt) {
      expiresAt = new Date(customExpiresAt);
    } else if (template.durationDays > 0) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + template.durationDays);
      expiresAt = expDate;
    }

    const trafficBytesLimit = trafficLimitGB > 0
      ? BigInt(trafficLimitGB) * BigInt(1024 * 1024 * 1024)
      : BigInt(0);

    const expiryTimeMs = expiresAt ? expiresAt.getTime() : 0;
    const inboundIds: number[] = JSON.parse(template.inboundIdsJson || '[]');

    if (inboundIds.length === 0) {
      throw new Error('В выбранном шаблоне нет активных инбаундов 3XUI');
    }

    const createdClients = [];
    const failedNames = [];
    let lastError = '';

    for (const clientName of namesArray) {
      const clientUuid = crypto.randomUUID();
      const subToken = crypto.randomUUID();
      const cleanName = getCleanLatinName(clientName);
      const clientEmail = `${cleanName}_${clientUuid.slice(0, 8)}@btv.vpn`;

      // Регистрация на 3XUI
      const addedInboundIds: number[] = [];
      let isSuccess = true;
      let apiErrorMsg = '';

      for (const inboundId of inboundIds) {
        try {
          const added = await xuiAddClient(inboundId, {
            id: clientUuid,
            email: clientEmail,
            limitIp: limitIp,
            totalGB: Number(trafficBytesLimit),
            expiryTime: expiryTimeMs,
            enable: true,
            flow: flow,
            tgId: tgId,
            group: company.name
          });

          if (added) {
            addedInboundIds.push(inboundId);
          } else {
            isSuccess = false;
            apiErrorMsg = `Панель 3XUI отклонила добавление в Inbound ID ${inboundId}`;
            break;
          }
        } catch (err: any) {
          isSuccess = false;
          apiErrorMsg = `Ошибка подключения к API 3XUI: ${err.message}`;
          break;
        }
      }

      // Откат при сбоях
      if (!isSuccess) {
        console.warn(`Failure creating client "${clientName}". Rolling back inbounds: [${addedInboundIds.join(', ')}]...`);
        for (const addedId of addedInboundIds) {
          try {
            await xuiDeleteClient(addedId, clientEmail);
          } catch (e) {}
        }
        failedNames.push({ name: clientName, error: apiErrorMsg });
        lastError = apiErrorMsg;
        continue;
      }

      // Запись в базу данных
      try {
        const client = await prisma.client.create({
          data: {
            name: clientName,
            email: clientEmail,
            vpnUuid: clientUuid,
            subscriptionToken: subToken,
            trafficLimitGB: customTrafficLimitGB !== undefined && customTrafficLimitGB !== null ? Number(customTrafficLimitGB) : null,
            limitIp: customLimitIp !== undefined && customLimitIp !== null ? Number(customLimitIp) : null,
            expiresAt: expiresAt,
            flow: customFlow !== undefined && customFlow !== null ? customFlow.trim() : null,
            tgId: customTgId !== undefined && customTgId !== null ? customTgId.trim() : null,
            companyId: companyId,
            templateId: templateId,
          },
        });

        createdClients.push({
          ...client,
          usedTrafficBytes: client.usedTrafficBytes.toString(),
        });

        // Лог аудита
        await prisma.auditLog.create({
          data: {
            action: 'CREATE_CLIENT',
            details: `Создан VPN-клиент: ${client.name} (Компания: ${company.name}, Шаблон: ${template.name})`,
            adminId: adminId,
          },
        });
      } catch (dbErr: any) {
        console.error(`Failed to save client "${clientName}" in Postgres:`, dbErr.message);
        failedNames.push({ name: clientName, error: 'Ошибка записи в базу данных' });
        lastError = 'Ошибка записи в базу данных';

        // Откат 3XUI
        for (const addedId of addedInboundIds) {
          try {
            await xuiDeleteClient(addedId, clientEmail);
          } catch (e) {}
        }
      }
    }

    try {
      xuiClearCache();
    } catch (e) {}

    return {
      success: createdClients.length > 0,
      createdCount: createdClients.length,
      clients: createdClients,
      failed: failedNames,
      lastError
    };
  }

  /**
   * Обновить настройки клиента
   */
  static async updateClient(id: string, params: UpdateClientParams, adminId?: string) {
    const {
      name,
      companyId,
      templateId,
      customTrafficLimitGB,
      customLimitIp,
      customExpiresAt,
      customFlow,
      customTgId,
      isActive,
    } = params;

    const client = await prisma.client.findUnique({
      where: { id },
      include: { template: true },
    });

    if (!client) throw new Error('Клиент не найден');

    const targetCompanyId = companyId || client.companyId;
    const targetTemplateId = templateId || client.templateId;

    const company = await prisma.company.findUnique({ where: { id: targetCompanyId } });
    const newTemplate = await prisma.template.findUnique({ where: { id: targetTemplateId } });

    if (!company) throw new Error('Компания не найдена');
    if (!newTemplate) throw new Error('Шаблон не найден');

    const trafficLimitGB = customTrafficLimitGB !== undefined && customTrafficLimitGB !== null
      ? Number(customTrafficLimitGB)
      : newTemplate.trafficLimitGB;

    const limitIp = customLimitIp !== undefined && customLimitIp !== null
      ? Number(customLimitIp)
      : newTemplate.limitIp;

    const flow = customFlow !== undefined && customFlow !== null ? customFlow.trim() : newTemplate.flow || '';
    const tgId = customTgId !== undefined && customTgId !== null ? customTgId.trim() : '';

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

    // Синхронизация 3XUI
    const oldInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');
    const newInboundIds: number[] = JSON.parse(newTemplate.inboundIdsJson || '[]');

    // Удаляем из старых инбаундов
    for (const oldInboundId of oldInboundIds) {
      try {
        await xuiDeleteClient(oldInboundId, client.email);
      } catch (e: any) {
        console.error(`Failed to delete client ${client.email} from old Inbound ${oldInboundId}:`, e.message);
      }
    }

    // Добавляем в новые инбаунды
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
            flow: flow,
            tgId: tgId,
            templateId: targetTemplateId,
            group: company.name,
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

      // Откат при сбоях
      if (!apiSuccess) {
        console.warn(`Rollback new inbounds after edit failure: [${addedInbounds.join(', ')}]...`);
        for (const addedId of addedInbounds) {
          try {
            await xuiDeleteClient(addedId, client.email);
          } catch (e: any) {
            console.error(`Rollback failed for Inbound ${addedId}:`, e.message);
          }
        }
        throw new Error(apiErrorMsg);
      }
    }

    // Запись в базу данных
    const newTgId = customTgId !== undefined && customTgId !== null ? customTgId.trim() : client.tgId;
    const isTgIdCleared = client.tgId && !newTgId;

    const updatedClient = await prisma.client.update({
      where: { id },
      data: {
        name: name ? name.trim() : client.name,
        companyId: targetCompanyId,
        templateId: targetTemplateId,
        trafficLimitGB: customTrafficLimitGB !== undefined && customTrafficLimitGB !== null ? Number(customTrafficLimitGB) : null,
        limitIp: customLimitIp !== undefined && customLimitIp !== null ? Number(customLimitIp) : null,
        expiresAt: expiresAt,
        flow: customFlow !== undefined && customFlow !== null ? customFlow.trim() : null,
        tgId: newTgId,
        telegramUsername: isTgIdCleared ? '' : undefined,
        telegramFirstName: isTgIdCleared ? '' : undefined,
        isActive: isClientEnabled,
      },
    });

    // Лог аудита
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_CLIENT',
        details: `Обновлен VPN-клиент: ${updatedClient.name} (Активен: ${updatedClient.isActive}, Лимит ГБ: ${trafficLimitGB})`,
        adminId: adminId,
      },
    });

    try {
      xuiClearCache();
    } catch (e) {}

    return updatedClient;
  }

  /**
   * Удалить клиента
   */
  static async deleteClient(id: string, adminId?: string) {
    const client = await prisma.client.findUnique({
      where: { id },
      include: { template: true },
    });

    if (!client) throw new Error('Клиент не найден');

    // Удаляем из 3XUI
    let inboundIds: number[] = [];
    try {
      inboundIds = JSON.parse(client.template.inboundIdsJson || '[]');
    } catch (e) {}

    for (const inboundId of inboundIds) {
      try {
        await xuiDeleteClient(inboundId, client.email);
      } catch (err: any) {
        console.error(`Failed to delete client ${client.email} from 3XUI Inbound ${inboundId}:`, err.message);
      }
    }

    // Удаляем из PostgreSQL
    await prisma.client.delete({ where: { id } });

    // Лог аудита
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_CLIENT',
        details: `Удален VPN-клиент: ${client.name} (Email: ${client.email})`,
        adminId: adminId,
      },
    });

    try {
      xuiClearCache();
    } catch (e) {}

    return true;
  }
}
