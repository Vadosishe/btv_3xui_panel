import prisma from '@/lib/prisma';

export interface CreateCompanyParams {
  name: string;
  description?: string | null;
}

export interface UpdateCompanyParams {
  name: string;
  description?: string | null;
  isActive?: boolean;
}

/**
 * Сервис для управления B2B компаниями и их группами на VPN серверах
 */
export class CompanyService {
  /**
   * Получить список всех компаний с подсчетом клиентов
   */
  static async getCompaniesList() {
    return prisma.company.findMany({
      include: {
        _count: {
          select: { clients: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Получить детальную информацию о конкретной компании с её клиентами
   */
  static async getCompanyDetails(id: string) {
    return prisma.company.findUnique({
      where: { id },
      include: {
        clients: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  /**
   * Создать новую компанию (с автосозданием группы на 3XUI)
   */
  static async createCompany(params: CreateCompanyParams, adminId?: string) {
    const { name, description } = params;
    const trimmedName = name.trim();

    // Проверяем уникальность названия
    const existing = await prisma.company.findUnique({
      where: { name: trimmedName },
    });

    if (existing) {
      throw new Error('Компания с таким названием уже существует');
    }

    const company = await prisma.company.create({
      data: {
        name: trimmedName,
        description: description?.trim() || null,
      },
    });

    // Создаем группу на сервере 3XUI
    try {
      const { xuiCreateGroup } = await import('@/lib/xui');
      await xuiCreateGroup(company.name);
    } catch (e) {
      console.warn('Failed to sync company creation as group on 3XUI:', e);
    }

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'CREATE_COMPANY',
        details: `Создана компания: ${company.name}`,
        adminId: adminId,
      },
    });

    return company;
  }

  /**
   * Обновить компанию (с переименованием группы на 3XUI)
   */
  static async updateCompany(id: string, params: UpdateCompanyParams, adminId?: string) {
    const { name, description, isActive } = params;
    const trimmedName = name.trim();

    const existing = await prisma.company.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new Error('Компания не найдена');
    }

    // Проверяем уникальность названия, если оно изменилось
    if (trimmedName.toLowerCase() !== existing.name.toLowerCase()) {
      const nameDuplicate = await prisma.company.findUnique({
        where: { name: trimmedName },
      });
      if (nameDuplicate) {
        throw new Error('Компания с таким названием уже существует');
      }
    }

    const oldName = existing.name;
    const nameChanged = trimmedName.toLowerCase() !== oldName.toLowerCase();

    const updatedCompany = await prisma.company.update({
      where: { id },
      data: {
        name: trimmedName,
        description: description?.trim() || null,
        isActive: isActive ?? existing.isActive,
      },
    });

    // Переименовываем группу на сервере 3XUI
    if (nameChanged) {
      try {
        const { xuiRenameGroup } = await import('@/lib/xui');
        await xuiRenameGroup(oldName, updatedCompany.name);
      } catch (e) {
        console.warn('Failed to sync company rename as group on 3XUI:', e);
      }
    }

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'UPDATE_COMPANY',
        details: `Обновлена компания: ${updatedCompany.name} (Активна: ${updatedCompany.isActive})`,
        adminId: adminId,
      },
    });

    return updatedCompany;
  }

  /**
   * Удалить компанию (с каскадным удалением её клиентов в 3XUI!)
   */
  static async deleteCompany(id: string, adminId?: string) {
    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        clients: {
          include: {
            template: true,
          },
        },
      },
    });

    if (!company) {
      throw new Error('Компания не найдена');
    }

    console.log(`Deleting company ${company.name} and cleaning up ${company.clients.length} clients in 3XUI...`);

    // 1. Сначала удаляем каждого клиента этой компании из XUI на всех инбаундах по их шаблонам
    const { xuiDeleteClient } = await import('@/lib/xui');
    for (const client of company.clients) {
      try {
        const inboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');
        for (const inboundId of inboundIds) {
          await xuiDeleteClient(inboundId, client.email);
        }
      } catch (xuiErr: any) {
        console.error(`Failed to delete client ${client.email} from 3XUI during company deletion:`, xuiErr.message);
      }
    }

    // 2. Удаляем компанию из БД (база каскадно удалит и записи клиентов из таблицы Client)
    await prisma.company.delete({
      where: { id },
    });

    // Удаляем группу на сервере 3XUI
    try {
      const { xuiDeleteGroup } = await import('@/lib/xui');
      await xuiDeleteGroup(company.name);
    } catch (e) {
      console.warn('Failed to sync company deletion as group on 3XUI:', e);
    }

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_COMPANY',
        details: `Удалена компания: ${company.name} и все её сотрудники (${company.clients.length} пользователей)`,
        adminId: adminId,
      },
    });

    return true;
  }
}
