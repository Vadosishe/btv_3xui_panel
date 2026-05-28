import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiGetInbounds } from '@/lib/xui';
import crypto from 'crypto';

// Продвинутая синхронизация трафика и автоматический импорт клиентов из 3XUI в PostgreSQL
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    console.log('Starting client traffic synchronization and auto-import from 3XUI...');
    
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

    // 2. Группируем статистику клиентов по уникальному email
    const clientStatsGrouped: Record<string, {
      email: string;
      uuid: string;
      up: number;
      down: number;
      expiryTime: number;
      total: number;
      enable: boolean;
      inboundIds: number[];
    }> = {};

    for (const inbound of inbounds) {
      const statsArray = inbound.clientStats || [];
      const inboundId = inbound.id;
      
      for (const stat of statsArray) {
        if (!stat.email) continue;
        const emailKey = stat.email.toLowerCase().trim();
        
        if (!clientStatsGrouped[emailKey]) {
          clientStatsGrouped[emailKey] = {
            email: stat.email,
            uuid: stat.uuid || stat.id || '',
            up: 0,
            down: 0,
            expiryTime: stat.expiryTime || 0,
            total: stat.total || 0,
            enable: stat.enable !== false,
            inboundIds: [],
          };
        }

        const group = clientStatsGrouped[emailKey];
        group.up += Number(stat.up || 0);
        group.down += Number(stat.down || 0);
        
        // Клиент активен, только если он активен во всех инбаундах
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

    let defaultCompanyId = '';
    let defaultTemplateId = '';

    // 4. Проходим по всем клиентам из 3XUI
    for (const [emailKey, xuiClient] of Object.entries(clientStatsGrouped)) {
      const dbClient = dbClientsMap.get(emailKey);
      const totalUsedBytes = BigInt(xuiClient.up) + BigInt(xuiClient.down);

      if (dbClient) {
        // --- ОБНОВЛЕНИЕ СУЩЕСТВУЮЩЕГО КЛИЕНТА ---
        try {
          const updateData: any = {
            usedTrafficBytes: totalUsedBytes,
            lastSyncedAt: new Date(),
            isActive: xuiClient.enable,
          };

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
          // Обеспечиваем наличие технической компании для импорта
          if (!defaultCompanyId) {
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
            defaultCompanyId = company.id;
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

          // Генерируем красивое имя
          let displayName = xuiClient.email;
          if (displayName.includes('@')) {
            displayName = displayName.split('@')[0];
          }
          displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
          if (displayName.toLowerCase() === 'admins') {
            displayName = 'Главный Администратор (3XUI)';
          } else {
            displayName = displayName + ' (3XUI)';
          }

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
              companyId: defaultCompanyId,
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

    // 5. Логируем аудит синхронизации
    let logDetails = `Синхронизация трафика и конфигураций успешно завершена. Обновлено клиентов: ${syncCount}`;
    if (importCount > 0) {
      logDetails += `, импортировано новых: ${importCount}`;
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
