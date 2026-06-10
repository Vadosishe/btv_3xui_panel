import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiGetInbounds, xuiClearCache } from '@/lib/xui';
import crypto from 'crypto';

// Продвинутая синхронизация трафика и автоматический импорт клиентов из 3XUI в PostgreSQL
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    console.log('Starting client traffic synchronization and auto-import from 3XUI...');
    
    // Сбрасываем кэш перед ручным запуском синхронизации, чтобы гарантировать получение свежих данных
    try {
      xuiClearCache();
    } catch (e) {}

    // 1. Получаем все инбаунды и статистику клиентов с сервера 3XUI
    let inbounds: any[] = [];
    try {
      inbounds = await xuiGetInbounds();
    } catch (err: any) {
      console.error('Failed to get inbounds from 3XUI during sync:', err.message);
      return NextResponse.json({ 
        success: false, 
        error: `Не удалось подключиться к панели 3XUI: ${err.message}` 
      }, { status: 502 });
    }

    // 1.5. Строим маппинг email -> название группы на основе настроек inbounds
    const emailToGroupMap: Record<string, string> = {};
    for (const inbound of inbounds) {
      let settings: any = {};
      try {
        settings = typeof inbound.settings === 'string'
          ? JSON.parse(inbound.settings)
          : inbound.settings || {};
      } catch (e) {}
      
      const clients = settings.clients || [];
      for (const client of clients) {
        if (client.email && client.group) {
          emailToGroupMap[client.email.toLowerCase().trim()] = client.group;
        }
      }
    }

    // 2. Группируем настройки и статистику клиентов по уникальному email
    const clientStatsGrouped: Record<string, {
      email: string;
      uuid: string;
      up: number;
      down: number;
      expiryTime: number;
      total: number;
      enable: boolean;
      inboundIds: number[];
      group?: string;
    }> = {};

    // 2.1. Сначала собираем клиентов из настроек инбаундов (settings.clients), чтобы учесть даже тех, у кого нет трафика
    for (const inbound of inbounds) {
      const inboundId = inbound.id;
      let settings: any = {};
      try {
        settings = typeof inbound.settings === 'string'
          ? JSON.parse(inbound.settings)
          : inbound.settings || {};
      } catch (e) {}

      const clients = settings.clients || [];
      for (const client of clients) {
        if (!client.email) continue;
        const emailKey = client.email.toLowerCase().trim();
        const uuid = client.id || client.password || client.auth || '';

        if (!clientStatsGrouped[emailKey]) {
          clientStatsGrouped[emailKey] = {
            email: client.email,
            uuid: uuid,
            up: 0,
            down: 0,
            expiryTime: client.expiryTime || 0,
            total: client.totalGB || client.total || 0,
            enable: client.enable !== false,
            inboundIds: inboundId !== undefined ? [inboundId] : [],
            group: client.group || '',
          };
        } else {
          if (inboundId !== undefined && !clientStatsGrouped[emailKey].inboundIds.includes(inboundId)) {
            clientStatsGrouped[emailKey].inboundIds.push(inboundId);
          }
        }
      }
    }

    // 2.2. Накладываем данные из clientStats (трафик, статус активности)
    for (const inbound of inbounds) {
      const statsArray = inbound.clientStats || [];
      const inboundId = inbound.id;
      
      for (const stat of statsArray) {
        if (!stat.email) continue;
        const emailKey = stat.email.toLowerCase().trim();
        
        if (!clientStatsGrouped[emailKey]) {
          clientStatsGrouped[emailKey] = {
            email: stat.email,
            uuid: (stat.uuid && typeof stat.uuid === 'string') ? stat.uuid : '',
            up: 0,
            down: 0,
            expiryTime: stat.expiryTime || 0,
            total: stat.total || 0,
            enable: stat.enable !== false,
            inboundIds: inboundId !== undefined ? [inboundId] : [],
            group: emailToGroupMap[emailKey] || '',
          };
        }

        const group = clientStatsGrouped[emailKey];
        group.up += Number(stat.up || 0);
        group.down += Number(stat.down || 0);
        
        // Перезаписываем лимиты и статус если они есть в статистике
        group.enable = group.enable && (stat.enable !== false);
        
        if (stat.expiryTime > 0 && (group.expiryTime === 0 || stat.expiryTime < group.expiryTime)) {
          group.expiryTime = stat.expiryTime;
        }
        if (stat.total > 0 && (group.total === 0 || stat.total < group.total)) {
          group.total = stat.total;
        }
        if (inboundId !== undefined && !group.inboundIds.includes(inboundId)) {
          group.inboundIds.push(inboundId);
        }
      }
    }

    // 3. Получаем всех клиентов из БД
    const dbClients = await prisma.client.findMany();
    const dbClientsMap = new Map(dbClients.map(c => [c.email.toLowerCase().trim(), c]));

    let syncCount = 0;
    let importCount = 0;
    let failedCount = 0;

    // Обеспечиваем наличие технической компании для импорта
    let company = await prisma.company.findUnique({
      where: { name: 'Импортированные (3XUI)' },
    });
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: 'Импортированные (3XUI)',
          description: 'Техническая компания для клиентов, импортированных напрямую из 3XUI',
          isActive: true,
        },
      });
    }
    const defaultCompanyId = company.id;

    let defaultTemplateId = '';

    // 4. Проходим по всем клиентам из 3XUI
    for (const [emailKey, xuiClient] of Object.entries(clientStatsGrouped)) {
      const dbClient = dbClientsMap.get(emailKey);
      const totalUsedBytes = BigInt(xuiClient.up) + BigInt(xuiClient.down);

      if (dbClient) {
        // --- ОБНОВЛЕНИЕ СУЩЕСТВУЮщего КЛИЕНТА ---
        try {
          const updateData: any = {
            usedTrafficBytes: totalUsedBytes,
            lastSyncedAt: new Date(),
            isActive: xuiClient.enable,
          };

          // Автоматически очищаем старые суффиксы и восстанавливаем оригинальное имя с 3XUI при синхронизации
          if (
            dbClient.name.endsWith(' (3XUI)') || 
            dbClient.name === 'Главный Администратор (3XUI)' || 
            dbClient.companyId === defaultCompanyId
          ) {
            updateData.name = xuiClient.email;
          }

          // Если клиент находится в технической компании импорта, но в 3XUI ему задана группа,
          // переносим его в соответствующую компанию (автоматически создавая её при необходимости)
          const xuiGroupName = xuiClient.group ? xuiClient.group.trim() : '';
          if (
            dbClient.companyId === defaultCompanyId && 
            xuiGroupName && 
            xuiGroupName !== 'BTV Clients' && 
            xuiGroupName !== 'Импортированные (3XUI)'
          ) {
            let groupCompany = await prisma.company.findUnique({
              where: { name: xuiGroupName }
            });
            if (!groupCompany) {
              groupCompany = await prisma.company.create({
                data: {
                  name: xuiGroupName,
                  description: `Автоматически созданная компания на основе группы 3XUI "${xuiGroupName}"`,
                  isActive: true
                }
              });
            }
            updateData.companyId = groupCompany.id;
          }

          // Синхронизируем срок действия и лимит трафика только если они не переопределены индивидуально
          if (dbClient.expiresAt === null && xuiClient.expiryTime > 0) {
            updateData.expiresAt = new Date(xuiClient.expiryTime);
          }
          if (dbClient.trafficLimitGB === null && xuiClient.total > 0) {
            updateData.trafficLimitGB = Math.round(xuiClient.total / (1024 * 1024 * 1024));
          }

          await prisma.client.update({
            where: { id: dbClient.id },
            data: updateData,
          });
          syncCount++;
        } catch (err: any) {
          console.error(`Failed to update client ${xuiClient.email}:`, err.message);
          failedCount++;
        }
      } else {
        // --- АВТОИМПОРТ НОВОГО КЛИЕНТА ---
        try {
          // Определяем компанию на основе группы из 3XUI (создавая компанию если не существует)
          let clientCompanyId = defaultCompanyId;
          const xuiGroupName = xuiClient.group ? xuiClient.group.trim() : '';
          
          if (
            xuiGroupName && 
            xuiGroupName !== 'BTV Clients' && 
            xuiGroupName !== 'Импортированные (3XUI)'
          ) {
            let groupCompany = await prisma.company.findUnique({
              where: { name: xuiGroupName }
            });
            if (!groupCompany) {
              groupCompany = await prisma.company.create({
                data: {
                  name: xuiGroupName,
                  description: `Автоматически созданная компания на основе группы 3XUI "${xuiGroupName}"`,
                  isActive: true
                }
              });
            }
            clientCompanyId = groupCompany.id;
          }

          // Обеспечиваем наличие технического шаблона для импорта
          if (!defaultTemplateId) {
            let template = await prisma.template.findUnique({
              where: { name: 'Импортированный Шаблон' },
            });
            if (!template) {
              template = await prisma.template.create({
                data: {
                  name: 'Импортированный Шаблон',
                  description: 'Автоматически созданный шаблон для импортированных клиентов',
                  inboundIdsJson: JSON.stringify(xuiClient.inboundIds),
                  trafficLimitGB: xuiClient.total > 0 ? Math.round(xuiClient.total / (1024 * 1024 * 1024)) : 0,
                  limitIp: 0,
                  durationDays: 30,
                },
              });
            }
            defaultTemplateId = template.id;
          }

          // Сохраняем имя в оригинальном виде из 3XUI
          const displayName = xuiClient.email;
          const vpnUuid = xuiClient.uuid || crypto.randomUUID();

          await prisma.client.create({
            data: {
              name: displayName,
              email: xuiClient.email,
              vpnUuid: vpnUuid,
              isActive: xuiClient.enable,
              usedTrafficBytes: totalUsedBytes,
              trafficLimitGB: xuiClient.total > 0 ? Math.round(xuiClient.total / (1024 * 1024 * 1024)) : null,
              expiresAt: xuiClient.expiryTime > 0 ? new Date(xuiClient.expiryTime) : null,
              companyId: clientCompanyId,
              templateId: defaultTemplateId,
              lastSyncedAt: new Date(),
            },
          });

          importCount++;
        } catch (err: any) {
          console.error(`Failed to import client ${xuiClient.email}:`, err.message);
          failedCount++;
        }
      }
    }

    // 4.5. Деактивируем клиентов в Postgres, которых нет на 3XUI
    let deactivateCount = 0;
    for (const dbClient of dbClients) {
      const emailKey = dbClient.email.toLowerCase().trim();
      if (!clientStatsGrouped[emailKey] && dbClient.isActive) {
        try {
          await prisma.client.update({
            where: { id: dbClient.id },
            data: { isActive: false }
          });
          deactivateCount++;
        } catch (e) {
          console.error(`Failed to deactivate missing client ${dbClient.email}:`, e);
        }
      }
    }

    // 5. Логируем аудит синхронизации
    let logDetails = `Синхронизация трафика и конфигураций успешно завершена. Обновлено клиентов: ${syncCount}`;
    if (importCount > 0) {
      logDetails += `, импортировано новых: ${importCount}`;
    }
    if (deactivateCount > 0) {
      logDetails += `, деактивировано (удалено с 3XUI): ${deactivateCount}`;
    }
    if (failedCount > 0) {
      logDetails += `, ошибок: ${failedCount}`;
    }

    await prisma.auditLog.create({
      data: {
        action: 'SYNC_TRAFFIC',
        details: logDetails,
        adminId: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Синхронизация трафика и импорт клиентов успешно завершены',
      syncCount,
      importCount,
      deactivateCount,
      failedCount,
    });

  } catch (error: any) {
    console.error('Error during traffic sync and client import:', error);
    return NextResponse.json({ 
      success: false, 
      error: `Внутренняя ошибка сервера при синхронизации: ${error.message}` 
    }, { status: 500 });
  }
}
