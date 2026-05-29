import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiGetInbounds, generateConfigLink, xuiGetNodeDomains } from '@/lib/xui';
import QRCode from 'qrcode';
import JSZip from 'jszip';

// Helper function to generate mock Amnesia profile JSON for backup/redundant channels
function generateAmneziaMockConfig(client: any, nodeDomain: string): string {
  const amneziaProfile = {
    description: `BTV VPN (Amnezia) - ${client.name}`,
    hostName: nodeDomain,
    userName: 'admin',
    port: 22,
    sshKey: '-----BEGIN OPENSSH PRIVATE KEY-----\\n...\\n-----END OPENSSH PRIVATE KEY-----',
    containers: [
      {
        container: 'amnezia-wg',
        enable: true,
        port: 51820,
        settings: {
          privateKey: 'MOCK_PRIVATE_KEY_WILL_BE_GENERATED_BY_AMNEZIA_SERVER',
          publicKey: 'MOCK_PUBLIC_KEY_WILL_BE_GENERATED_BY_AMNEZIA_SERVER',
          ip: '10.0.8.2',
          serverPublicKey: 'MOCK_SERVER_PUBLIC_KEY_FROM_AMNEZIA_INSTALLED_CONTAINER',
          presharedKey: '',
          mtu: 1360,
          dns: '1.1.1.1'
        }
      },
      {
        container: 'amnezia-shadowsocks',
        enable: true,
        port: 8388,
        settings: {
          password: 'MOCK_SHADOWSOCKS_PASSWORD',
          cipher: 'aes-256-gcm'
        }
      }
    ]
  };

  return JSON.stringify(amneziaProfile, null, 2);
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const body = await req.json();
    const { clientIds, companyId } = body;

    let whereClause: any = {};
    if (clientIds && Array.isArray(clientIds) && clientIds.length > 0) {
      whereClause = { id: { in: clientIds } };
    } else if (companyId) {
      whereClause = { companyId: companyId };
    } else {
      return NextResponse.json({ success: false, error: 'Не указаны клиенты или компания для экспорта' }, { status: 400 });
    }

    // Fetch clients along with company and template info
    const clients = await prisma.client.findMany({
      where: whereClause,
      include: {
        company: true,
        template: true,
      },
    });

    if (clients.length === 0) {
      return NextResponse.json({ success: false, error: 'Клиенты не найдены' }, { status: 404 });
    }

    // Retrieve global panel URL settings
    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    const appPanelUrl = settingsMap.get('app_panel_url') || process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    // Retrieve node list and active 3XUI inbounds once to prevent redundant API queries
    const nodeDomains = await xuiGetNodeDomains();
    const defaultDomain = settingsMap.get('xui_address') || 'vpn.btw.com';
    let inbounds: any[] = [];
    try {
      inbounds = await xuiGetInbounds();
    } catch (e) {
      console.warn('Failed to fetch inbounds for zip exporter:', e);
    }

    const zip = new JSZip();

    for (const client of clients) {
      const companyName = client.company?.name || 'B2B Clients';
      const clientName = client.name || `client_${client.id.slice(0, 8)}`;
      
      // Sanitize directory names to prevent ZIP parsing issues or path traversal
      const sanitizedCompany = companyName.replace(/[\\/:*?"<>|]/g, '_');
      const sanitizedClient = clientName.replace(/[\\/:*?"<>|]/g, '_');
      const folderPath = `${sanitizedCompany}/${sanitizedClient}`;

      // 1. Subscription URL Link
      const subscriptionUrl = `${appPanelUrl}/api/sub/${client.subscriptionToken}`;
      zip.file(`${folderPath}/btv-subscription-link.txt`, subscriptionUrl);

      // 2. VLESS/Reality Raw Connection Links
      let configLinks: string[] = [];
      try {
        const templateInboundIds: number[] = JSON.parse(client.template.inboundIdsJson || '[]');
        const clientFlow = client.flow !== null ? client.flow : (client.template.flow || '');

        for (const inboundId of templateInboundIds) {
          const inbound = inbounds.find(i => i.id === inboundId);
          if (inbound) {
            const inboundNodeId = inbound.nodeId !== undefined ? String(inbound.nodeId) : '0';
            const nodeDomain = nodeDomains[inboundNodeId] || nodeDomains['0'] || defaultDomain;
            const link = generateConfigLink(inbound, client.vpnUuid, client.email, nodeDomain, clientFlow, client.name);
            if (link) {
              configLinks.push(link);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to generate VLESS configs for client ${client.id}:`, err);
      }
      
      const vlessContent = configLinks.join('\n');
      zip.file(`${folderPath}/vless-connection-links.txt`, vlessContent);

      // 3. Backup Amnezia VPN config (.vpn / .conf)
      try {
        const { amneziaGetPeerConfig } = await import('@/lib/amnezia');
        const realAwgConfig = await amneziaGetPeerConfig(client.email);
        if (realAwgConfig) {
          zip.file(`${folderPath}/btv-amnezia-config.conf`, realAwgConfig);
        } else {
          // Fallback to mock .vpn if integration is disabled or no peer found
          const amneziaNodeDomain = nodeDomains['0'] || defaultDomain;
          const amneziaConfig = generateAmneziaMockConfig(client, amneziaNodeDomain);
          zip.file(`${folderPath}/btv-amnezia-config.vpn`, amneziaConfig);
        }
      } catch (err) {
        console.warn(`Failed to fetch real AWG config for ZIP exporter for ${client.email}:`, err);
        const amneziaNodeDomain = nodeDomains['0'] || defaultDomain;
        const amneziaConfig = generateAmneziaMockConfig(client, amneziaNodeDomain);
        zip.file(`${folderPath}/btv-amnezia-config.vpn`, amneziaConfig);
      }

      // 4. Binary Subscription QR Code PNG
      try {
        const qrCodeDataUrl = await QRCode.toDataURL(subscriptionUrl, { width: 400 });
        const qrBase64 = qrCodeDataUrl.split(',')[1];
        const qrBuffer = Buffer.from(qrBase64, 'base64');
        zip.file(`${folderPath}/btv-subscription-qr.png`, qrBuffer);
      } catch (qrErr) {
        console.error(`Failed to generate QR PNG for client ${client.id}:`, qrErr);
      }
    }

    // Generate ZIP buffer asynchronously
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Log the action to database audits
    await prisma.auditLog.create({
      data: {
        action: 'EXPORT_CONFIGS',
        details: `Экспортировано конфигураций архивом ZIP для ${clients.length} клиентов (Метод: Bulk ZIP Exporter)`,
        adminId: session.userId,
      },
    });

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="btv-vpn-configs.zip"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Error exporting clients configs:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при экспорте конфигураций' }, { status: 500 });
  }
}
