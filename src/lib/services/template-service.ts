import prisma from '@/lib/prisma';

export interface CreateTemplateParams {
  name: string;
  description?: string | null;
  inboundIds: number[];
  trafficLimitGB: number;
  limitIp: number;
  durationDays: number;
  flow?: string | null;
  awgServerIds?: string[];
}

export interface UpdateTemplateParams {
  name: string;
  description?: string | null;
  inboundIds: number[];
  trafficLimitGB: number;
  limitIp: number;
  durationDays: number;
  flow?: string | null;
  awgServerIds?: string[];
}

/**
 * Сервис для управления шаблонами VPN подключений и их связями с серверами
 */
export class TemplateService {
  /**
   * Получить список всех шаблонов с подсчетом клиентов и привязками Amnezia
   */
  static async getTemplatesList() {
    const templates = await prisma.template.findMany({
      include: {
        _count: {
          select: { clients: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Получаем привязки к серверам Amnezia
    let templateAwgMap: Record<string, string[]> = {};
    try {
      const setting = await prisma.appSetting.findUnique({
        where: { key: 'template_awg_servers' }
      });
      if (setting && setting.value) {
        templateAwgMap = JSON.parse(setting.value);
      }
    } catch (e) {
      console.warn('Failed to load template_awg_servers mapping in TemplateService:', e);
    }

    return templates.map(t => ({
      ...t,
      awgServerIds: templateAwgMap[t.id] || []
    }));
  }

  /**
   * Получить детальную информацию о конкретном шаблоне с его привязками Amnezia
   */
  static async getTemplateDetails(id: string) {
    const template = await prisma.template.findUnique({
      where: { id },
    });

    if (!template) return null;

    // Получаем привязки к серверам Amnezia
    let awgServerIds: string[] = [];
    try {
      const setting = await prisma.appSetting.findUnique({
        where: { key: 'template_awg_servers' }
      });
      if (setting && setting.value) {
        const templateAwgMap = JSON.parse(setting.value);
        awgServerIds = templateAwgMap[id] || [];
      }
    } catch (e) {
      console.warn('Failed to load template_awg_servers mapping in TemplateService:', e);
    }

    return {
      ...template,
      awgServerIds
    };
  }

  /**
   * Создать новый шаблон
   */
  static async createTemplate(params: CreateTemplateParams, adminId?: string) {
    const { name, description, inboundIds, trafficLimitGB, limitIp, durationDays, flow, awgServerIds } = params;
    const trimmedName = name.trim();

    if (!inboundIds || !Array.isArray(inboundIds) || inboundIds.length === 0) {
      throw new Error('Необходимо привязать хотя бы одно входящее подключение (Inbound)');
    }

    // Проверяем уникальность названия
    const existing = await prisma.template.findUnique({
      where: { name: trimmedName },
    });

    if (existing) {
      throw new Error('Шаблон с таким названием уже существует');
    }

    const template = await prisma.template.create({
      data: {
        name: trimmedName,
        description: description?.trim() || null,
        inboundIdsJson: JSON.stringify(inboundIds),
        trafficLimitGB: Number(trafficLimitGB) || 0,
        limitIp: Number(limitIp) || 0,
        durationDays: durationDays !== undefined && durationDays !== null ? Number(durationDays) : 30,
        flow: flow?.trim() || "",
      },
    });

    // Сохраняем связи с серверами Amnezia
    if (awgServerIds && Array.isArray(awgServerIds)) {
      try {
        const setting = await prisma.appSetting.findUnique({
          where: { key: 'template_awg_servers' }
        });
        let templateAwgMap: Record<string, string[]> = {};
        if (setting && setting.value) {
          templateAwgMap = JSON.parse(setting.value);
        }
        templateAwgMap[template.id] = awgServerIds;
        await prisma.appSetting.upsert({
          where: { key: 'template_awg_servers' },
          update: { value: JSON.stringify(templateAwgMap) },
          create: { key: 'template_awg_servers', value: JSON.stringify(templateAwgMap) }
        });
      } catch (e) {
        console.error('Failed to save template_awg_servers mapping in TemplateService:', e);
      }
    }

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'CREATE_TEMPLATE',
        details: `Создан шаблон VPN: ${template.name} (Лимит ГБ: ${template.trafficLimitGB}, Срок дней: ${template.durationDays})`,
        adminId: adminId,
      },
    });

    return template;
  }

  /**
   * Обновить шаблон
   */
  static async updateTemplate(id: string, params: UpdateTemplateParams, adminId?: string) {
    const { name, description, inboundIds, trafficLimitGB, limitIp, durationDays, flow, awgServerIds } = params;
    const trimmedName = name.trim();

    if (!inboundIds || !Array.isArray(inboundIds) || inboundIds.length === 0) {
      throw new Error('Необходимо привязать хотя бы одно входящее подключение (Inbound)');
    }

    const existing = await prisma.template.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error('Шаблон не найден');
    }

    // Проверяем уникальность названия при изменении
    if (trimmedName.toLowerCase() !== existing.name.toLowerCase()) {
      const nameDuplicate = await prisma.template.findUnique({
        where: { name: trimmedName },
      });
      if (nameDuplicate) {
        throw new Error('Шаблон с таким названием уже существует');
      }
    }

    const updatedTemplate = await prisma.template.update({
      where: { id },
      data: {
        name: trimmedName,
        description: description?.trim() || null,
        inboundIdsJson: JSON.stringify(inboundIds),
        trafficLimitGB: Number(trafficLimitGB) || 0,
        limitIp: Number(limitIp) || 0,
        durationDays: durationDays !== undefined && durationDays !== null ? Number(durationDays) : 30,
        flow: flow?.trim() || "",
      },
    });

    // Обновляем связи с серверами Amnezia
    if (awgServerIds && Array.isArray(awgServerIds)) {
      try {
        const setting = await prisma.appSetting.findUnique({
          where: { key: 'template_awg_servers' }
        });
        let templateAwgMap: Record<string, string[]> = {};
        if (setting && setting.value) {
          templateAwgMap = JSON.parse(setting.value);
        }
        templateAwgMap[id] = awgServerIds;
        await prisma.appSetting.upsert({
          where: { key: 'template_awg_servers' },
          update: { value: JSON.stringify(templateAwgMap) },
          create: { key: 'template_awg_servers', value: JSON.stringify(templateAwgMap) }
        });
      } catch (e) {
        console.error('Failed to save template_awg_servers mapping in TemplateService:', e);
      }
    }

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_TEMPLATE',
        details: `Обновлен шаблон VPN: ${updatedTemplate.name} (Лимит ГБ: ${updatedTemplate.trafficLimitGB}, Срок: ${updatedTemplate.durationDays} дн.)`,
        adminId: adminId,
      },
    });

    return updatedTemplate;
  }

  /**
   * Безопасное удаление шаблона (с проверкой зависимости клиентов)
   */
  static async deleteTemplate(id: string, adminId?: string) {
    const template = await prisma.template.findUnique({
      where: { id },
    });

    if (!template) {
      throw new Error('Шаблон не найден');
    }

    // 1. Проверяем, есть ли клиенты, привязанные к этому шаблону
    const clientsCount = await prisma.client.count({
      where: { templateId: id },
    });

    if (clientsCount > 0) {
      throw new Error(`Невозможно удалить шаблон, так как он назначен ${clientsCount} клиентам. Сначала переназначьте их на другой шаблон.`);
    }

    // 2. Удаляем шаблон из БД
    await prisma.template.delete({
      where: { id },
    });

    // Очищаем связи с серверами Amnezia
    try {
      const setting = await prisma.appSetting.findUnique({
        where: { key: 'template_awg_servers' }
      });
      if (setting && setting.value) {
        const templateAwgMap = JSON.parse(setting.value);
        if (templateAwgMap[id]) {
          delete templateAwgMap[id];
          await prisma.appSetting.update({
            where: { key: 'template_awg_servers' },
            data: { value: JSON.stringify(templateAwgMap) }
          });
        }
      }
    } catch (e) {
      console.error('Failed to clean up template_awg_servers mapping in TemplateService:', e);
    }

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_TEMPLATE',
        details: `Удален шаблон VPN: ${template.name}`,
        adminId: adminId,
      },
    });

    return true;
  }
}
