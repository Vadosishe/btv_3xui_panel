import prisma from './prisma';

export interface AwgServer {
  id: string;
  name: string;
  apiUrl: string;
  apiPassword?: string;
  enabled: boolean;
}

// Сессионные куки для каждого сервера (хранятся в оперативной памяти процесса)
let awgSessionCookies: Record<string, string> = {};

/**
 * Получить список всех AWG серверов из настроек приложения
 */
export async function getAwgServers(): Promise<AwgServer[]> {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: 'awg_servers' }
    });
    if (setting && setting.value) {
      return JSON.parse(setting.value);
    }
  } catch (e) {
    console.error('Failed to load awg_servers settings:', e);
  }
  return [];
}

/**
 * Получить связи шаблонов и серверов Amnezia
 */
export async function getTemplateAwgServers(): Promise<Record<string, string[]>> {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: 'template_awg_servers' }
    });
    if (setting && setting.value) {
      return JSON.parse(setting.value);
    }
  } catch (e) {
    console.error('Failed to load template_awg_servers settings:', e);
  }
  return {};
}

/**
 * Выполнить авторизацию на конкретном AWG сервере
 */
async function loginToAwgServer(server: AwgServer): Promise<string> {
  if (!server.apiPassword) return '';
  const apiUrl = server.apiUrl.endsWith('/') ? server.apiUrl.slice(0, -1) : server.apiUrl;
  try {
    const res = await fetch(`${apiUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: server.apiPassword }),
      cache: 'no-store',
    });

    if (res.ok) {
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/connect\.sid=[^;]+/);
        if (match) {
          const cookie = match[0];
          awgSessionCookies[server.id] = cookie;
          return cookie;
        }
      }
    }
  } catch (err: any) {
    console.error(`Failed to login to AWG Server ${server.name} (${server.id}):`, err.message);
  }
  return '';
}

/**
 * Универсальный метод отправки запросов к API конкретного AWG сервера
 */
async function awgServerRequest<T = any>(
  server: AwgServer,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: any,
  isRetry = false
): Promise<T | null> {
  if (!server.enabled) return null;

  const baseUrl = server.apiUrl.endsWith('/') ? server.apiUrl.slice(0, -1) : server.apiUrl;
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const sessionCookie = awgSessionCookies[server.id];
  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

    if (res.status === 401 && !isRetry) {
      console.log(`AWG Server ${server.name} API returned 401. Refreshing session...`);
      const freshCookie = await loginToAwgServer(server);
      if (freshCookie) {
        return awgServerRequest<T>(server, path, method, body, true);
      }
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AWG Server ${server.name} API returned status ${res.status}: ${text}`);
    }

    if (res.status === 204) {
      return { success: true } as any;
    }

    const data = await res.json();
    return data as T;
  } catch (err: any) {
    console.error(`Request to AWG Server ${server.name} failed on ${method} ${path}:`, err.message);
    return null;
  }
}

/**
 * Создать клиента (пира) на конкретном сервере Amnezia
 */
export async function amneziaAddPeerOnServer(server: AwgServer, clientEmail: string): Promise<any | null> {
  try {
    const peers = await awgServerRequest<any[]>(server, '/api/peers', 'GET');
    if (Array.isArray(peers)) {
      const existing = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
      if (existing) {
        return existing;
      }
    }
    return await awgServerRequest<any>(server, '/api/peers', 'POST', { name: clientEmail });
  } catch (err: any) {
    console.error(`Failed to add peer in AWG Server ${server.name}:`, err.message);
    return null;
  }
}

/**
 * Удалить клиента (пира) на конкретном сервере Amnezia
 */
export async function amneziaDeletePeerOnServer(server: AwgServer, clientEmail: string): Promise<boolean> {
  try {
    const peers = await awgServerRequest<any[]>(server, '/api/peers', 'GET');
    if (Array.isArray(peers)) {
      const peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
      if (peer) {
        await awgServerRequest(server, `/api/peers/${peer.id}`, 'DELETE');
        return true;
      }
    }
  } catch (err: any) {
    console.error(`Failed to delete peer in AWG Server ${server.name}:`, err.message);
  }
  return false;
}

/**
 * Включить или выключить пира на конкретном сервере Amnezia
 */
export async function amneziaTogglePeerOnServer(server: AwgServer, clientEmail: string, enable: boolean): Promise<boolean> {
  try {
    const peers = await awgServerRequest<any[]>(server, '/api/peers', 'GET');
    if (Array.isArray(peers)) {
      const peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
      if (peer) {
        const action = enable ? 'enable' : 'disable';
        await awgServerRequest(server, `/api/peers/${peer.id}/${action}`, 'POST');
        return true;
      }
    }
  } catch (err: any) {
    console.error(`Failed to toggle peer in AWG Server ${server.name} to ${enable}:`, err.message);
  }
  return false;
}

/**
 * Синхронизировать действия по клиенту на всех AWG-серверах, привязанных к его шаблону
 */
export async function amneziaSyncClient(
  clientEmail: string,
  templateId: string,
  action: 'add' | 'delete' | 'enable' | 'disable'
): Promise<void> {
  try {
    const servers = await getAwgServers();
    if (servers.length === 0) return;

    const templateMap = await getTemplateAwgServers();
    const assignedServerIds = templateMap[templateId] || [];
    if (assignedServerIds.length === 0) return;

    const assignedServers = servers.filter(s => s.enabled && assignedServerIds.includes(s.id));
    if (assignedServers.length === 0) return;

    console.log(`[AWG MULTI SYNC] Action: ${action} for ${clientEmail} on servers: ${assignedServers.map(s => s.name).join(', ')}`);

    await Promise.all(
      assignedServers.map(async (server) => {
        try {
          if (action === 'add') {
            await amneziaAddPeerOnServer(server, clientEmail);
          } else if (action === 'delete') {
            await amneziaDeletePeerOnServer(server, clientEmail);
          } else if (action === 'enable') {
            await amneziaTogglePeerOnServer(server, clientEmail, true);
          } else if (action === 'disable') {
            await amneziaTogglePeerOnServer(server, clientEmail, false);
          }
        } catch (serverErr: any) {
          console.error(`[AWG MULTI SYNC] Failed for ${server.name} with action ${action}:`, serverErr.message);
        }
      })
    );
  } catch (err: any) {
    console.error('[AWG MULTI SYNC] Global synchronization error:', err.message);
  }
}

/**
 * Сгенерировать и получить конфиги AWG для всех серверов, привязанных к шаблону клиента
 */
export async function amneziaGetClientConfigs(
  clientEmail: string,
  templateId: string
): Promise<{ serverId: string; serverName: string; config: string }[]> {
  const configsList: { serverId: string; serverName: string; config: string }[] = [];
  try {
    const servers = await getAwgServers();
    const templateMap = await getTemplateAwgServers();
    const assignedServerIds = templateMap[templateId] || [];

    const assignedServers = servers.filter(s => s.enabled && assignedServerIds.includes(s.id));
    if (assignedServers.length === 0) return configsList;

    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));

    const jc = settingsMap.get('awg_jc') || '4';
    const jmin = settingsMap.get('awg_jmin') || '40';
    const jmax = settingsMap.get('awg_jmax') || '70';
    const s1 = settingsMap.get('awg_s1') || '5';
    const s2 = settingsMap.get('awg_s2') || '10';
    const h1 = settingsMap.get('awg_h1') || '1';
    const h2 = settingsMap.get('awg_h2') || '2';
    const h3 = settingsMap.get('awg_h3') || '3';
    const h4 = settingsMap.get('awg_h4') || '4';

    await Promise.all(
      assignedServers.map(async (server) => {
        try {
          const peers = await awgServerRequest<any[]>(server, '/api/peers', 'GET');
          if (!Array.isArray(peers)) return;

          let peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
          if (!peer) {
            console.log(`[AWG ON-DEMAND SYNC] Peer ${clientEmail} not found on server ${server.name} during bulk config fetch. Creating on-demand...`);
            peer = await amneziaAddPeerOnServer(server, clientEmail);
          }
          if (!peer) return;

          const baseUrl = server.apiUrl.endsWith('/') ? server.apiUrl.slice(0, -1) : server.apiUrl;
          const rawUrl = `${baseUrl}/api/peers/${peer.id}/config`;
          const headers: Record<string, string> = {};
          
          const sessionCookie = awgSessionCookies[server.id];
          if (sessionCookie) {
            headers['Cookie'] = sessionCookie;
          }

          const res = await fetch(rawUrl, { headers, cache: 'no-store' });
          if (!res.ok) return;

          let configText = await res.text();

          const lines = configText.split('\n');
          const interfaceIdx = lines.findIndex(line => line.trim().toLowerCase() === '[interface]');
          
          if (interfaceIdx !== -1) {
            const awgParams = [
              `Jc = ${jc}`,
              `Jmin = ${jmin}`,
              `Jmax = ${jmax}`,
              `S1 = ${s1}`,
              `S2 = ${s2}`,
              `H1 = ${h1}`,
              `H2 = ${h2}`,
              `H3 = ${h3}`,
              `H4 = ${h4}`
            ];
            lines.splice(interfaceIdx + 1, 0, ...awgParams);
            configText = lines.join('\n');
          }

          configsList.push({
            serverId: server.id,
            serverName: server.name,
            config: configText
          });
        } catch (serverErr: any) {
          console.error(`Failed to fetch peer config from AWG Server ${server.name}:`, serverErr.message);
        }
      })
    );
  } catch (err: any) {
    console.error('Failed to retrieve Amnezia WG client configurations:', err.message);
  }

  return configsList;
}

/**
 * Сгенерировать и получить конфиг AWG для конкретного сервера по его объекту
 */
export async function amneziaGetPeerConfigOnServer(
  server: AwgServer,
  clientEmail: string
): Promise<string | null> {
  try {
    const peers = await awgServerRequest<any[]>(server, '/api/peers', 'GET');
    if (!Array.isArray(peers)) return null;

    let peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
    if (!peer) {
      console.log(`[AWG ON-DEMAND SYNC] Peer ${clientEmail} not found on server ${server.name} during config get. Creating on-demand...`);
      peer = await amneziaAddPeerOnServer(server, clientEmail);
    }
    if (!peer) return null;

    const baseUrl = server.apiUrl.endsWith('/') ? server.apiUrl.slice(0, -1) : server.apiUrl;
    const rawUrl = `${baseUrl}/api/peers/${peer.id}/config`;
    const headers: Record<string, string> = {};
    
    const sessionCookie = awgSessionCookies[server.id];
    if (sessionCookie) {
      headers['Cookie'] = sessionCookie;
    }

    const res = await fetch(rawUrl, { headers, cache: 'no-store' });
    if (!res.ok) return null;

    let configText = await res.text();

    const settings = await prisma.appSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));

    const jc = settingsMap.get('awg_jc') || '4';
    const jmin = settingsMap.get('awg_jmin') || '40';
    const jmax = settingsMap.get('awg_jmax') || '70';
    const s1 = settingsMap.get('awg_s1') || '5';
    const s2 = settingsMap.get('awg_s2') || '10';
    const h1 = settingsMap.get('awg_h1') || '1';
    const h2 = settingsMap.get('awg_h2') || '2';
    const h3 = settingsMap.get('awg_h3') || '3';
    const h4 = settingsMap.get('awg_h4') || '4';

    const lines = configText.split('\n');
    const interfaceIdx = lines.findIndex(line => line.trim().toLowerCase() === '[interface]');
    
    if (interfaceIdx !== -1) {
      const awgParams = [
        `Jc = ${jc}`,
        `Jmin = ${jmin}`,
        `Jmax = ${jmax}`,
        `S1 = ${s1}`,
        `S2 = ${s2}`,
        `H1 = ${h1}`,
        `H2 = ${h2}`,
        `H3 = ${h3}`,
        `H4 = ${h4}`
      ];
      lines.splice(interfaceIdx + 1, 0, ...awgParams);
      configText = lines.join('\n');
    }

    return configText;
  } catch (err: any) {
    console.error(`Failed to build AWG config for server ${server.name}:`, err.message);
    return null;
  }
}

/**
 * Получить детальную информацию о пире с конкретного сервера
 */
export async function amneziaGetPeerDetailsOnServer(
  server: AwgServer,
  clientEmail: string
): Promise<{ exists: boolean; enabled?: boolean; address?: string; lastHandshakeAt?: string; transferRx?: number; transferTx?: number } | null> {
  try {
    const peers = await awgServerRequest<any[]>(server, '/api/peers', 'GET');
    if (!Array.isArray(peers)) return { exists: false };

    const peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
    if (!peer) return { exists: false };

    return {
      exists: true,
      enabled: peer.enabled,
      address: peer.address,
      lastHandshakeAt: peer.lastHandshakeAt,
      transferRx: peer.transferRx,
      transferTx: peer.transferTx
    };
  } catch (err: any) {
    console.error(`Failed to get peer details from AWG Server ${server.name}:`, err.message);
    return null;
  }
}

/**
 * Получить конфиг конкретного сервера по ID (или первый активный, если ID опущен)
 */
export async function amneziaGetPeerConfig(clientEmail: string, serverId?: string): Promise<string | null> {
  const servers = await getAwgServers();
  if (servers.length === 0) return null;

  let targetServer = servers.find(s => s.id === serverId && s.enabled);
  if (!targetServer && serverId === undefined) {
    targetServer = servers.find(s => s.enabled);
  }

  if (!targetServer) return null;
  return amneziaGetPeerConfigOnServer(targetServer, clientEmail);
}

// Старая совместимость для API
export async function amneziaAddPeer(clientEmail: string): Promise<any | null> {
  const servers = await getAwgServers();
  const active = servers.find(s => s.enabled);
  if (active) return amneziaAddPeerOnServer(active, clientEmail);
  return null;
}

export async function amneziaDeletePeer(clientEmail: string): Promise<boolean> {
  const servers = await getAwgServers();
  const active = servers.find(s => s.enabled);
  if (active) return amneziaDeletePeerOnServer(active, clientEmail);
  return false;
}

export async function amneziaTogglePeer(clientEmail: string, enable: boolean): Promise<boolean> {
  const servers = await getAwgServers();
  const active = servers.find(s => s.enabled);
  if (active) return amneziaTogglePeerOnServer(active, clientEmail, enable);
  return false;
}
