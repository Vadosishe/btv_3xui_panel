import { renderErrorPage, renderSubscriptionPortal } from './render';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { xuiGetInbounds, generateConfigLink, xuiGetNodeDomains, xuiGetClientTraffic } from '@/lib/xui';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const startTime = Date.now();
  try {
    const { token } = await params;
    const { searchParams } = new URL(req.url);
    const format = searchParams.get('format');
    const acceptHeader = req.headers.get('accept') || '';
    const isBrowser = acceptHeader.includes('text/html') && !format;

    // 1. Ищем клиента по токену подписки
    const t0 = Date.now();
    const client = await prisma.client.findUnique({
      where: { subscriptionToken: token },
      include: {
        company: true,
        template: true,
      },
    });
    const t1 = Date.now();
    console.log(`[SUB API BENCHMARK] Fetch client by token: ${t1 - t0}ms`);

    // Фоновая On-Demand автосинхронизация трафика этого клиента из 3XUI
    if (client) {
      try {
        const traffic = await xuiGetClientTraffic(client.email);
        if (traffic) {
          const totalUsed = BigInt(traffic.up || 0) + BigInt(traffic.down || 0);
          if (totalUsed !== client.usedTrafficBytes) {
            client.usedTrafficBytes = totalUsed; // Обновляем в памяти для рендеринга страницы и заголовков
            
            // Асинхронно сохраняем в БД в фоне, не блокируя ответ клиенту
            prisma.client.update({
              where: { id: client.id },
              data: { usedTrafficBytes: totalUsed, lastSyncedAt: new Date() }
            }).catch(dbErr => console.error('Failed to update synced traffic for client on sub request:', dbErr));
          }
        }
      } catch (err) {
        console.warn('Failed to sync traffic from XUI on sub request:', err);
      }
    }

    // 2. Получаем ссылку поддержки и домен из настроек
    const t2 = Date.now();
    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const t3 = Date.now();
    console.log(`[SUB API BENCHMARK] Fetch settings: ${t3 - t2}ms`);

    // Обработка веб-отвязки Telegram со страницы подписки
    const action = searchParams.get('action');
    if (action === 'unbind' && client) {
      await prisma.client.update({
        where: { id: client.id },
        data: {
          tgId: '',
          telegramUsername: '',
          telegramFirstName: '',
        },
      });

      // Записываем лог в БД
      await prisma.auditLog.create({
        data: {
          action: 'UNLINK_TELEGRAM',
          details: `Клиент ${client.name} (${client.email}) отвязал свой Telegram через веб-кабинет подписки`,
        },
      });

      const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      return NextResponse.redirect(`${appPanelUrl}/api/sub/${client.subscriptionToken}`);
    }

    const supportLink = settingsMap.get('btw_support_link') || 'https://t.me/btw_support_bot';
    const tgBotUsername = settingsMap.get('xui_telegram_bot_username') || '';

    // Проверяем активность подписки
    const now = new Date();
    const isExpired = client?.expiresAt ? new Date(client.expiresAt) < now : false;
    const isCompanyActive = client?.company?.isActive ?? false;
    const isClientActive = client?.isActive ?? false;

    const isActive = client && isClientActive && isCompanyActive && !isExpired;

    // --- СЦЕНАРИЙ 3: Запрос конфигурации AmneziaVPN (Реальный AWG / Резервный плейсхолдер) ---
    if (format === 'amnezia') {
      if (!client) {
        return new NextResponse(JSON.stringify({ error: 'Подписка не найдена' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      if (!isActive) {
        return new NextResponse(JSON.stringify({ error: 'Подписка недействительна или заблокирована' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }

      const serverId = searchParams.get('server') || undefined;

      // Пробуем получить реальный конфиг Amnezia WireGuard (AWG 1.0) через интеграционный модуль
      try {
        const { amneziaGetPeerConfig, getAwgServers } = await import('@/lib/amnezia');
        const realAwgConfig = await amneziaGetPeerConfig(client.email, serverId);
        
        if (realAwgConfig) {
          let filename = `btv-awg-${client.vpnUuid.substring(0, 8)}.conf`;
          try {
            const servers = await getAwgServers();
            const srv = servers.find(s => s.id === serverId);
            if (srv) {
              const cleanSrvName = encodeURIComponent(srv.name.replace(/\s+/g, '_'));
              filename = `btv-awg-${cleanSrvName}-${client.vpnUuid.substring(0, 8)}.conf`;
            }
          } catch (e) {}

          return new NextResponse(realAwgConfig, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Cache-Control': 'no-store',
            },
          });
        }
      } catch (err) {
        console.warn('Failed to fetch real AWG config, falling back to mock container:', err);
      }

      // Откат к плейсхолдеру (стандартный mock-профиль), если API выключено или недоступно
      const nodeDomains = await xuiGetNodeDomains();
      const defaultDomain = settingsMap.get('xui_address') || 'vpn.btw.com';
      const nodeDomain = nodeDomains['0'] || defaultDomain;

      const amneziaConfig = generateAmneziaMockConfig(client, nodeDomain);

      return new NextResponse(amneziaConfig, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="btv-vpn-${client.vpnUuid.substring(0, 8)}.vpn"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // --- СЦЕНАРИЙ 1: Запрос из БРАУЗЕРА (показываем красивый веб-портал) ---
    if (isBrowser) {
      if (!client) {
        return new NextResponse(renderErrorPage('Подписка не найдена', 'Убедитесь в корректности ссылки или обратитесь в поддержку.'), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
          status: 404,
        });
      }

      if (!isActive) {
        let reason = 'Подписка приостановлена администратором.';
        if (isExpired) {
          reason = `Срок действия подписки истек ${new Date(client.expiresAt!).toLocaleDateString('ru-RU')}.`;
        } else if (!isCompanyActive) {
          reason = `Обслуживание вашей компании (${client.company.name}) временно приостановлено.`;
        }
        return new NextResponse(renderErrorPage('Доступ к VPN ограничен', reason, supportLink), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        });
      }

      // Если активен — вычисляем лимиты и генерируем ссылки для ручного копирования
      const limitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : client.template.trafficLimitGB;
      const limitBytes = limitGB > 0 ? BigInt(limitGB) * BigInt(1024 * 1024 * 1024) : BigInt(0);
      const usedBytes = client.usedTrafficBytes;
      
      const usedGBText = (Number(usedBytes) / (1024 * 1024 * 1024)).toFixed(2);
      const limitGBText = limitGB > 0 ? `${limitGB} GB` : 'Безлимит';
      const progressPercent = limitGB > 0 
        ? Math.min(100, Math.round((Number(usedBytes) / Number(limitBytes)) * 100)) 
        : 0;

      // Динамически получаем доменные имена нод из API 3XUI
      const t4 = Date.now();
      const nodeDomains = await xuiGetNodeDomains();
      const t5 = Date.now();
      console.log(`[SUB API BENCHMARK] Get node domains: ${t5 - t4}ms`);

      let configLinks: string[] = [];
      const t6 = Date.now();
      try {
        const inbounds = await xuiGetInbounds();
        const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');

        const clientFlow = client.flow !== null ? client.flow : (client.template.flow || '');
        for (const inboundId of templateInboundIds) {
          const inbound = inbounds.find(i => i.id === inboundId);
          if (inbound) {
            const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
            const nodeDomain = nodeDomains[inboundNodeId] || nodeDomains['0'] || 'vpn.btw.com';
            const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain, clientFlow, client.name);
            if (link) configLinks.push(link);
          }
        }
      } catch (e) {}
      const t7 = Date.now();
      console.log(`[SUB API BENCHMARK] Fetch inbounds and gen config links: ${t7 - t6}ms`);

      // Отдаем красивую HTML страницу
      const t8 = Date.now();
      let qrCodeDataUrl = '';
      try {
        const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
        const personalSubUrl = `${appPanelUrl}/api/sub/${client.subscriptionToken}`;
        qrCodeDataUrl = await QRCode.toDataURL(personalSubUrl);
      } catch (qrErr) {}
      const t9 = Date.now();
      console.log(`[SUB API BENCHMARK] Generate QR code: ${t9 - t8}ms`);
      console.log(`[SUB API BENCHMARK] TOTAL TIME BROWSER SUB API: ${Date.now() - startTime}ms`);

      // Получаем назначенные Amnezia-серверы для шаблона клиента
      let clientAwgServers: any[] = [];
      try {
        const { getAwgServers, getTemplateAwgServers } = await import('@/lib/amnezia');
        const allAwgServers = await getAwgServers();
        const templateMap = await getTemplateAwgServers();
        const assignedServerIds = templateMap[client.templateId] || [];
        clientAwgServers = allAwgServers.filter(s => s.enabled && assignedServerIds.includes(s.id));
      } catch (e) {
        console.error('Failed to fetch assigned AWG servers for browser sub:', e);
      }

      return new NextResponse(renderSubscriptionPortal(client, usedGBText, limitGBText, progressPercent, configLinks, supportLink, tgBotUsername, qrCodeDataUrl, clientAwgServers), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }

    // --- СЦЕНАРИЙ 2: Запрос из VPN КЛИЕНТА (возвращаем Base64 список конфигов) ---
    if (!isActive) {
      // Для неактивных клиентов отдаем пустую подписку с заголовками лимитов
      const limitGB = client?.trafficLimitGB !== null && client?.trafficLimitGB !== undefined ? client.trafficLimitGB : (client?.template?.trafficLimitGB || 0);
      const limitBytes = limitGB > 0 ? BigInt(limitGB) * BigInt(1024 * 1024 * 1024) : BigInt(0);
      const usedBytes = client?.usedTrafficBytes || BigInt(0);
      const expiryTimestamp = client?.expiresAt ? Math.floor(new Date(client.expiresAt).getTime() / 1000) : 0;

      return new NextResponse('', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Subscription-Userinfo': `upload=0; download=${usedBytes.toString()}; total=${limitBytes.toString()}; expire=${expiryTimestamp}`,
          'profile-update-interval': '12',
        }
      });
    }

    // Получаем инбаунды и генерируем конфиги
    // Динамически получаем доменные имена нод из API 3XUI
    const t4 = Date.now();
    const nodeDomains = await xuiGetNodeDomains();
    const t5 = Date.now();
    console.log(`[SUB API BENCHMARK] (Client) Get node domains: ${t5 - t4}ms`);

    const t6 = Date.now();
    const inbounds = await xuiGetInbounds();
    const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');
    let configs: string[] = [];

    const clientFlow = client.flow !== null ? client.flow : (client.template.flow || '');
    for (const inboundId of templateInboundIds) {
      const inbound = inbounds.find(i => i.id === inboundId);
      if (inbound) {
        const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
        const nodeDomain = nodeDomains[inboundNodeId] || nodeDomains['0'] || 'vpn.btw.com';
        const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain, clientFlow, client.name);
        if (link) configs.push(link);
      }
    }
    const t7 = Date.now();
    console.log(`[SUB API BENCHMARK] (Client) Fetch inbounds and gen config links: ${t7 - t6}ms`);
    console.log(`[SUB API BENCHMARK] TOTAL TIME CLIENT SUB API: ${Date.now() - startTime}ms`);

    // Соединяем конфиги переносом строки и кодируем в Base64
    const subscriptionContent = configs.join('\n');
    const base64Content = Buffer.from(subscriptionContent).toString('base64');

    const limitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : client.template.trafficLimitGB;
    const limitBytes = limitGB > 0 ? BigInt(limitGB) * BigInt(1024 * 1024 * 1024) : BigInt(0);
    const usedBytes = client.usedTrafficBytes;
    const expiryTimestamp = client.expiresAt ? Math.floor(new Date(client.expiresAt).getTime() / 1000) : 0;

    return new NextResponse(base64Content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Subscription-Userinfo': `upload=0; download=${usedBytes.toString()}; total=${limitBytes.toString()}; expire=${expiryTimestamp}`,
        'profile-update-interval': '12',
      },
    });
  } catch (error: any) {
    console.error('Subscription Endpoint Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}


/**
 * ARCHITECTURE PLACEHOLDER: Future integration with AmnesiaVPN.
 * Generates a mock Amnesia connection profile (.vpn JSON format) for the client.
 * Replace this mock implementation with active server API calls to the Amnesia management service.
 */
function generateAmneziaMockConfig(client: any, nodeDomain: string): string {
  const amneziaProfile = {
    description: `BTV VPN (Amnezia) - ${client.name}`,
    hostName: nodeDomain,
    userName: "admin",
    port: 22,
    sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----\\n...\\n-----END OPENSSH PRIVATE KEY-----",
    containers: [
      {
        container: "amnezia-wg",
        enable: true,
        port: 51820,
        settings: {
          privateKey: "MOCK_PRIVATE_KEY_WILL_BE_GENERATED_BY_AMNEZIA_SERVER",
          publicKey: "MOCK_PUBLIC_KEY_WILL_BE_GENERATED_BY_AMNEZIA_SERVER",
          ip: "10.0.8.2",
          serverPublicKey: "MOCK_SERVER_PUBLIC_KEY_FROM_AMNEZIA_INSTALLED_CONTAINER",
          presharedKey: "",
          mtu: 1360,
          dns: "1.1.1.1"
        }
      },
      {
        container: "amnezia-shadowsocks",
        enable: true,
        port: 8388,
        settings: {
          password: "MOCK_SHADOWSOCKS_PASSWORD",
          cipher: "aes-256-gcm"
        }
      }
    ]
  };

  return JSON.stringify(amneziaProfile, null, 2);
}
