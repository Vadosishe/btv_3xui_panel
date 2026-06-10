import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiGetInbounds, xuiClearCache, getXuiConfig, xuiRequest, xuiAddClient, xuiDeleteClient } from '@/lib/xui';
import crypto from 'crypto';

// Recursive BigInt serialization helper to prevent JSON.stringify errors
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = serializeBigInt(obj[key]);
    }
    return newObj;
  }
  return obj;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Get standard session
    const session = await getSession();
    
    // 2. Check API Key headers or search params
    const authHeader = req.headers.get('authorization') || '';
    const apiKeyHeader = req.headers.get('x-api-key') || '';
    const { searchParams } = new URL(req.url);
    const apiKeyParam = searchParams.get('key') || '';
    
    // Define expected key: Env variable or fallback hash of JWT_SECRET
    const jwtSecret = process.env.JWT_SECRET || 'btw_default_super_secret_key_change_me_in_prod_12345!';
    const expectedKey = process.env.DIAGNOSTIC_API_KEY || 
                        crypto.createHash('sha256').update(jwtSecret).digest('hex').slice(0, 32);
    
    let clientKey = apiKeyHeader || apiKeyParam;
    if (!clientKey && authHeader.startsWith('Bearer ')) {
      clientKey = authHeader.substring(7);
    }
    
    const isSessionAuth = !!session;
    const isApiKeyAuth = clientKey && clientKey === expectedKey;
    
    if (!isSessionAuth && !isApiKeyAuth) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    // Parse request body
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      // Empty body is okay for some actions
    }

    const { action } = body;

    // --- Action: get_api_key ---
    // Only return the API Key to authenticated session cookie owners (for UI display)
    if (action === 'get_api_key') {
      if (!isSessionAuth) {
        return NextResponse.json({ success: false, error: 'Доступ запрещен' }, { status: 403 });
      }
      return NextResponse.json({ success: true, apiKey: expectedKey });
    }

    // --- Action: xui_status ---
    if (action === 'xui_status') {
      const config = await getXuiConfig();
      let pingSuccess = false;
      let pingError = '';
      let inboundCount = 0;
      
      try {
        xuiClearCache();
        const inbounds = await xuiGetInbounds();
        pingSuccess = true;
        inboundCount = inbounds.length;
      } catch (err: any) {
        pingError = err.message;
      }

      return NextResponse.json({
        success: true,
        xuiConfiguredUrl: config.apiUrl,
        hasApiToken: !!config.apiToken,
        pingSuccess,
        pingError,
        inboundCount
      });
    }

    // --- Action: xui_inspect ---
    if (action === 'xui_inspect') {
      try {
        xuiClearCache();
        const inbounds = await xuiGetInbounds();
        return NextResponse.json({ success: true, inbounds });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: `Failed to inspect inbounds: ${err.message}` });
      }
    }

    // --- Action: xui_client_stats ---
    if (action === 'xui_client_stats') {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ success: false, error: 'Укажите email клиента' }, { status: 400 });
      }

      try {
        xuiClearCache();
        const inbounds = await xuiGetInbounds();
        const results: any[] = [];

        for (const inbound of inbounds) {
          // Parse settings clients
          let settings: any = {};
          try {
            settings = typeof inbound.settings === 'string'
              ? JSON.parse(inbound.settings)
              : inbound.settings || {};
          } catch (e) {}

          const clients = settings.clients || [];
          const matchedClients = clients.filter((c: any) => c.email && c.email.toLowerCase().trim() === email.toLowerCase().trim());

          // Parse clientStats
          const stats = inbound.clientStats || [];
          const matchedStats = stats.filter((s: any) => s.email && s.email.toLowerCase().trim() === email.toLowerCase().trim());

          if (matchedClients.length > 0 || matchedStats.length > 0) {
            results.push({
              inboundId: inbound.id,
              protocol: inbound.protocol,
              remark: inbound.remark,
              port: inbound.port,
              settingsClients: matchedClients,
              clientStats: matchedStats
            });
          }
        }

        return NextResponse.json({ success: true, email, results });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: `Failed to query client stats: ${err.message}` });
      }
    }

    // --- Action: test_xui_login ---
    if (action === 'test_xui_login') {
      const config = await getXuiConfig();
      const diagnosticLogs: string[] = [];
      diagnosticLogs.push(`Testing connectivity to 3XUI url: ${config.apiUrl}`);

      try {
        // Test base path / API
        diagnosticLogs.push(`Sending request to /panel/api/inbounds/list...`);
        const response = await xuiRequest('/panel/api/inbounds/list', 'GET');
        diagnosticLogs.push(`Success! Received response from 3XUI server.`);
        return NextResponse.json({
          success: true,
          logs: diagnosticLogs,
          responseSummary: {
            success: response.success,
            objType: typeof response.obj,
            objLength: Array.isArray(response.obj) ? response.obj.length : null
          }
        });
      } catch (err: any) {
        diagnosticLogs.push(`Error encountered: ${err.message}`);
        return NextResponse.json({
          success: false,
          logs: diagnosticLogs,
          error: err.message
        });
      }
    }

    // --- Action: db_inspect ---
    if (action === 'db_inspect') {
      const clientCount = await prisma.client.count();
      const companyCount = await prisma.company.count();
      const templateCount = await prisma.template.count();
      const logCount = await prisma.auditLog.count();
      const requestCount = await prisma.vpnRequest.count();
      const settingsCount = await prisma.appSetting.count();

      return NextResponse.json({
        success: true,
        counts: {
          client: clientCount,
          company: companyCount,
          template: templateCount,
          auditLog: logCount,
          vpnRequest: requestCount,
          appSetting: settingsCount
        }
      });
    }

    // --- Action: db_query ---
    if (action === 'db_query') {
      const { table, where, orderBy, take, skip } = body;
      if (!table) {
        return NextResponse.json({ success: false, error: 'Укажите название таблицы' }, { status: 400 });
      }

      const allowedTables = ['client', 'company', 'template', 'auditLog', 'appSetting', 'vpnRequest', 'admin'];
      const matchedTable = allowedTables.find(t => t.toLowerCase() === table.toLowerCase());

      if (!matchedTable) {
        return NextResponse.json({ success: false, error: `Доступ к таблице ${table} запрещен` }, { status: 403 });
      }

      try {
        const prismaModel = (prisma as any)[matchedTable];
        const records = await prismaModel.findMany({
          where: where || undefined,
          orderBy: orderBy || { createdAt: 'desc' },
          take: Math.min(take || 100, 200),
          skip: skip || 0,
        });

        return NextResponse.json({
          success: true,
          table: matchedTable,
          count: records.length,
          records: serializeBigInt(records)
        });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: `Database query failed: ${err.message}` });
      }
    }

    // --- Action: system_logs ---
    if (action === 'system_logs') {
      const take = Math.min(body.limit || 100, 200);
      const logs = await prisma.auditLog.findMany({
        include: {
          admin: {
            select: {
              name: true,
              email: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take
      });

      return NextResponse.json({ success: true, logs });
    }

    // --- Action: run_sync (VERBOSE SYNC RUNNER) ---
    if (action === 'run_sync') {
      const diagLogs: string[] = [];
      diagLogs.push(`[${new Date().toISOString()}] Starting manual verbose synchronization...`);
      
      try {
        // Clear cache
        xuiClearCache();
        diagLogs.push("xuiClearCache() executed successfully.");

        // 1. Get inbounds
        diagLogs.push("Fetching inbounds from 3XUI...");
        const inbounds = await xuiGetInbounds();
        diagLogs.push(`Fetched ${inbounds.length} inbounds.`);

        // Log inbound details
        inbounds.forEach((inb: any) => {
          diagLogs.push(`Inbound ID: ${inb.id}, Protocol: ${inb.protocol}, Port: ${inb.port}, Remark: "${inb.remark}"`);
        });

        // 1.5 Map emails to groups
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
        diagLogs.push(`Mapped ${Object.keys(emailToGroupMap).length} emails to XUI groups from inbound settings.`);

        // 2. Group clients
        diagLogs.push("Grouping clients from 3XUI inbound settings...");
        const clientStatsGrouped: Record<string, any> = {};

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
        diagLogs.push(`Found ${Object.keys(clientStatsGrouped).length} unique clients in settings.clients.`);

        // 2.2 Layer client stats
        diagLogs.push("Overlaying client traffic stats from 3XUI clientStats...");
        for (const inbound of inbounds) {
          const statsArray = inbound.clientStats || [];
          const inboundId = inbound.id;
          
          for (const stat of statsArray) {
            if (!stat.email) continue;
            const emailKey = stat.email.toLowerCase().trim();
            
            if (!clientStatsGrouped[emailKey]) {
              diagLogs.push(`Found client in clientStats but not settings.clients: ${stat.email} (Inbound: ${inboundId})`);
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
        diagLogs.push(`Total grouped clients to sync: ${Object.keys(clientStatsGrouped).length}`);

        // 3. Get DB clients
        diagLogs.push("Loading clients from PostgreSQL...");
        const dbClients = await prisma.client.findMany();
        const dbClientsMap = new Map(dbClients.map(c => [c.email.toLowerCase().trim(), c]));
        diagLogs.push(`Loaded ${dbClients.length} clients from Postgres.`);

        // Ensure default company
        let company = await prisma.company.findUnique({
          where: { name: 'Импортированные (3XUI)' },
        });
        if (!company) {
          diagLogs.push("Creating default company 'Импортированные (3XUI)'...");
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

        let syncCount = 0;
        let importCount = 0;
        let failedCount = 0;

        // 4. Sync loop
        diagLogs.push("Running synchronization loop...");
        for (const [emailKey, xuiClient] of Object.entries(clientStatsGrouped)) {
          const dbClient = dbClientsMap.get(emailKey);
          const totalUsedBytes = BigInt(xuiClient.up) + BigInt(xuiClient.down);

          if (dbClient) {
            // Update client
            try {
              const updateData: any = {
                usedTrafficBytes: totalUsedBytes,
                lastSyncedAt: new Date(),
                isActive: xuiClient.enable,
              };

              if (dbClient.name.endsWith(' (3XUI)') || dbClient.name === 'Главный Администратор (3XUI)' || dbClient.companyId === defaultCompanyId) {
                updateData.name = xuiClient.email;
              }

              // Group mapping
              const xuiGroupName = xuiClient.group ? xuiClient.group.trim() : '';
              if (dbClient.companyId === defaultCompanyId && xuiGroupName && xuiGroupName !== 'BTV Clients' && xuiGroupName !== 'Импортированные (3XUI)') {
                let groupCompany = await prisma.company.findUnique({ where: { name: xuiGroupName } });
                if (!groupCompany) {
                  diagLogs.push(`Creating company on the fly: "${xuiGroupName}" for existing client ${xuiClient.email}`);
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

              if (dbClient.expiresAt === null && xuiClient.expiryTime > 0) {
                updateData.expiresAt = new Date(xuiClient.expiryTime);
              }
              if (dbClient.trafficLimitGB === null && xuiClient.total > 0) {
                updateData.trafficLimitGB = Math.round(xuiClient.total / (1024 * 1024 * 1024));
              }

              await prisma.client.update({
                where: { id: dbClient.id },
                data: updateData
              });
              syncCount++;
            } catch (err: any) {
              diagLogs.push(`[ERROR] Failed to update client ${xuiClient.email}: ${err.message}`);
              failedCount++;
            }
          } else {
            // Import client
            try {
              let clientCompanyId = defaultCompanyId;
              const xuiGroupName = xuiClient.group ? xuiClient.group.trim() : '';
              
              if (xuiGroupName && xuiGroupName !== 'BTV Clients' && xuiGroupName !== 'Импортированные (3XUI)') {
                let groupCompany = await prisma.company.findUnique({ where: { name: xuiGroupName } });
                if (!groupCompany) {
                  diagLogs.push(`Creating company on the fly: "${xuiGroupName}" for imported client ${xuiClient.email}`);
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

              // Template
              if (!defaultTemplateId) {
                let template = await prisma.template.findUnique({ where: { name: 'Импортированный Шаблон' } });
                if (!template) {
                  diagLogs.push("Creating default template 'Импортированный Шаблон'...");
                  template = await prisma.template.create({
                    data: {
                      name: 'Импортированный Шаблон',
                      description: 'Автоматически созданный шаблон для импортированных клиентов',
                      inboundIdsJson: JSON.stringify(xuiClient.inboundIds),
                      trafficLimitGB: xuiClient.total > 0 ? Math.round(xuiClient.total / (1024 * 1024 * 1024)) : 0,
                      limitIp: 0,
                      durationDays: 30,
                    }
                  });
                }
                defaultTemplateId = template.id;
              }

              const vpnUuid = xuiClient.uuid || crypto.randomUUID();
              diagLogs.push(`Importing client: Name: "${xuiClient.email}", Email: "${xuiClient.email}", UUID: "${vpnUuid}", Active: ${xuiClient.enable}`);

              await prisma.client.create({
                data: {
                  name: xuiClient.email,
                  email: xuiClient.email,
                  vpnUuid: vpnUuid,
                  isActive: xuiClient.enable,
                  usedTrafficBytes: totalUsedBytes,
                  trafficLimitGB: xuiClient.total > 0 ? Math.round(xuiClient.total / (1024 * 1024 * 1024)) : null,
                  expiresAt: xuiClient.expiryTime > 0 ? new Date(xuiClient.expiryTime) : null,
                  companyId: clientCompanyId,
                  templateId: defaultTemplateId,
                  lastSyncedAt: new Date(),
                }
              });
              importCount++;
            } catch (err: any) {
              diagLogs.push(`[ERROR] Failed to import client ${xuiClient.email}: ${err.message}`);
              failedCount++;
            }
          }
        }

        // 4.5 Deactivate clients not in 3XUI
        let deactivateCount = 0;
        diagLogs.push("Checking for clients in Postgres that are missing from 3XUI...");
        for (const dbClient of dbClients) {
          const emailKey = dbClient.email.toLowerCase().trim();
          if (!clientStatsGrouped[emailKey] && dbClient.isActive) {
            try {
              diagLogs.push(`Deactivating local client: ${dbClient.email} because it is missing in 3XUI.`);
              await prisma.client.update({
                where: { id: dbClient.id },
                data: { isActive: false }
              });
              deactivateCount++;
            } catch (e: any) {
              diagLogs.push(`[ERROR] Failed to deactivate client ${dbClient.email}: ${e.message}`);
            }
          }
        }

        // Log audit
        let logDetails = `Синхронизация трафика (Диагностика). Обновлено: ${syncCount}, Импортировано: ${importCount}, Деактивировано: ${deactivateCount}, Ошибок: ${failedCount}`;
        await prisma.auditLog.create({
          data: {
            action: 'SYNC_TRAFFIC',
            details: logDetails,
            adminId: session?.userId || null,
          }
        });
        
        diagLogs.push(`[SUCCESS] Verbose sync complete. Sync: ${syncCount}, Import: ${importCount}, Deactivate: ${deactivateCount}, Failed: ${failedCount}`);

        return NextResponse.json({
          success: true,
          logs: diagLogs,
          results: {
            syncCount,
            importCount,
            deactivateCount,
            failedCount
          }
        });

      } catch (err: any) {
        diagLogs.push(`[FATAL ERROR] Sync process failed: ${err.message}`);
        return NextResponse.json({
          success: false,
          logs: diagLogs,
          error: err.message
        });
      }
    }

    // --- Action: diagnostic_dump ---
    if (action === 'diagnostic_dump') {
      try {
        const clients = await prisma.client.findMany();
        const companies = await prisma.company.findMany();
        const templates = await prisma.template.findMany();
        const vpnRequests = await prisma.vpnRequest.findMany();
        const settings = await prisma.appSetting.findMany();
        const logs = await prisma.auditLog.findMany({ take: 150, orderBy: { createdAt: 'desc' } });
        
        let inbounds: any[] = [];
        let xuiError = '';
        try {
          xuiClearCache();
          inbounds = await xuiGetInbounds();
        } catch (err: any) {
          xuiError = err.message;
        }
        
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          database: serializeBigInt({
            clients,
            companies,
            templates,
            vpnRequests,
            settings,
            logs
          }),
          xui: {
            inbounds,
            error: xuiError
          }
        });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: `Failed to compile diagnostic dump: ${err.message}` });
      }
    }

    // --- Action: test_clients_list ---
    if (action === 'test_clients_list') {
      try {
        const { ClientService } = await import('@/lib/services/client-service');
        const list = await ClientService.getClientsList();
        return NextResponse.json({ success: true, count: list.length, clients: list });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message, stack: err.stack });
      }
    }

    // --- Action: debug_rebind ---
    if (action === 'debug_rebind') {
      try {
        const diagLogs: string[] = [];
        const templateId = '4094bdc2-6d77-468e-b2ae-cd4a5e5124de';
        const template = await prisma.template.findUnique({ where: { id: templateId } });
        if (!template) return NextResponse.json({ success: false, error: 'Template not found' });
        const targetInboundIds = JSON.parse(template.inboundIdsJson || '[]');
        
        const client = await prisma.client.findFirst({
          where: { templateId, isActive: true, email: 'VladS' },
          include: { company: true }
        });
        if (!client) return NextResponse.json({ success: false, error: 'Client VladS not found' });
        
        diagLogs.push(`Testing rebind for client: ${client.email}`);
        diagLogs.push(`Target inbounds: ${targetInboundIds.join(', ')}`);

        const trafficLimitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : template.trafficLimitGB;
        const trafficBytesLimit = trafficLimitGB > 0
          ? BigInt(trafficLimitGB) * BigInt(1024 * 1024 * 1024)
          : BigInt(0);
        const limitIp = client.limitIp !== null ? client.limitIp : template.limitIp;
        const expiresAt = client.expiresAt;
        const expiryTimeMs = expiresAt ? expiresAt.getTime() : 0;
        const flow = client.flow !== null ? client.flow : (template.flow || '');

        for (const targetInboundId of targetInboundIds) {
          diagLogs.push(`Processing Inbound ID ${targetInboundId}`);
          try {
            const delRes = await xuiRequest(`/panel/api/inbounds/${targetInboundId}/delClientByEmail/${client.email}`, 'POST');
            diagLogs.push(`Delete By Email: ${JSON.stringify(delRes)}`);
          } catch (e: any) {
            diagLogs.push(`Delete By Email error: ${e.message}`);
          }

          try {
            const delUuidRes = await xuiRequest(`/panel/api/inbounds/${targetInboundId}/delClient/${client.vpnUuid}`, 'POST');
            diagLogs.push(`Delete By Uuid: ${JSON.stringify(delUuidRes)}`);
          } catch (e: any) {
            diagLogs.push(`Delete By Uuid error: ${e.message}`);
          }

          try {
            const added = await xuiRequest('/panel/api/clients/add', 'POST', {
              client: {
                id: client.vpnUuid,
                email: client.email,
                subId: client.vpnUuid.replace(/-/g, '').slice(0, 16),
                totalGB: Number(trafficBytesLimit),
                expiryTime: expiryTimeMs,
                limitIp,
                enable: true,
                flow,
                comment: 'BTV Client',
                group: client.company.name,
                reset: 0,
                security: 'none'
              },
              inboundIds: [targetInboundId],
            });
            diagLogs.push(`Add: ${JSON.stringify(added)}`);
          } catch (err: any) {
            diagLogs.push(`Add failed: ${err.message}`);
          }
        }
        return NextResponse.json({ success: true, logs: diagLogs });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message });
      }
    }

    return NextResponse.json({ success: false, error: `Неизвестное действие: ${action}` }, { status: 400 });

  } catch (error: any) {
    console.error('Debug API Route Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
