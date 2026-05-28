import prisma from './prisma';

// Структура учетных данных 3XUI
interface XuiConfig {
  apiUrl: string;
  apiToken: string;
}

/**
 * Получить настройки 3XUI из базы данных (AppSetting) или из окружения
 */
async function getXuiConfig(): Promise<XuiConfig> {
  const settings = await prisma.appSetting.findMany();
  const settingsMap = new Map(settings.map(s => [s.key, s.value]));

  const scheme = settingsMap.get('xui_scheme') || 'http';
  const address = settingsMap.get('xui_address') || 'localhost';
  const port = settingsMap.get('xui_port') || '2053';
  let basePath = settingsMap.get('xui_base_path') || '/';
  const apiToken = settingsMap.get('xui_api_token') || process.env.XUI_API_TOKEN || '';

  // Нормализуем base path
  if (!basePath.startsWith('/')) {
    basePath = '/' + basePath;
  }
  if (basePath.endsWith('/') && basePath.length > 1) {
    basePath = basePath.slice(0, -1);
  }

  // Собираем apiUrl
  const apiUrl = `${scheme}://${address}:${port}${basePath === '/' ? '' : basePath}`;

  return {
    apiUrl,
    apiToken,
  };
}

/**
 * Универсальный метод отправки запросов к API 3XUI с Bearer авторизацией
 */
async function xuiRequest<T = any>(
  path: string,
  method: 'GET' | 'POST',
  body?: any
): Promise<T> {
  const config = await getXuiConfig();
  const url = `${config.apiUrl}${path}`;
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (config.apiToken) {
    // Токен-авторизация (Bearer Token) — не требует логина, сессий и обходит CSRF
    headers['Authorization'] = `Bearer ${config.apiToken}`;
  }

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`3XUI API error on ${path}: Status ${res.status}`);
    }

    const data = await res.json();
    return data as T;
  } catch (error: any) {
    console.error(`Request to 3XUI API (${path}) failed:`, error.message);
    throw error;
  }
}

/**
 * Получить список всех инбаундов (входящих подключений)
 */
export async function xuiGetInbounds(): Promise<any[]> {
  const data = await xuiRequest('/panel/api/inbounds/list', 'GET');
  if (data.success && Array.isArray(data.obj)) {
    return data.obj;
  }
  return [];
}

/**
 * Получить один инбаунд по ID
 */
export async function xuiGetInbound(inboundId: number): Promise<any | null> {
  const data = await xuiRequest(`/panel/api/inbounds/get/${inboundId}`, 'GET');
  if (data.success && data.obj) {
    return data.obj;
  }
  return null;
}

/**
 * Добавить клиента во входящее подключение
 * @param inboundId ID инбаунда в 3XUI
 * @param client { id: string (UUID), email: string, limitIp: number, totalGB: number, expiryTime: number, enable: boolean }
 */
export async function xuiAddClient(
  inboundId: number,
  client: {
    id: string;
    email: string;
    limitIp?: number;
    totalGB?: number;
    expiryTime?: number;
    enable?: boolean;
    flow?: string;
    tgId?: string;
  }
): Promise<boolean> {
  // Настройки клиента
  const clientPayload = {
    id: client.id,
    email: client.email,
    limitIp: client.limitIp ?? 0,
    totalGB: client.totalGB ?? 0, // В байтах в 3XUI, обработка должна быть на уровне вызова
    expiryTime: client.expiryTime ?? 0, // Unix timestamp в миллисекундах
    enable: client.enable ?? true,
    tgId: client.tgId ?? '',
    subId: '',
    flow: client.flow ?? '',
  };

  const body = {
    id: inboundId,
    settings: JSON.stringify({
      clients: [clientPayload],
    }),
  };

  const data = await xuiRequest('/panel/api/inbounds/addClient', 'POST', body);
  return !!data.success;
}

/**
 * Удалить клиента из входящего подключения
 */
export async function xuiDeleteClient(inboundId: number, clientUuid: string): Promise<boolean> {
  const data = await xuiRequest(`/panel/api/inbounds/${inboundId}/delClient/${clientUuid}`, 'POST');
  return !!data.success;
}

/**
 * Обновить параметры клиента
 */
export async function xuiUpdateClient(
  inboundId: number,
  clientUuid: string,
  client: {
    id: string;
    email: string;
    limitIp?: number;
    totalGB?: number;
    expiryTime?: number;
    enable?: boolean;
    flow?: string;
    tgId?: string;
  }
): Promise<boolean> {
  const clientPayload = {
    id: client.id,
    email: client.email,
    limitIp: client.limitIp ?? 0,
    totalGB: client.totalGB ?? 0,
    expiryTime: client.expiryTime ?? 0,
    enable: client.enable ?? true,
    flow: client.flow ?? '',
    tgId: client.tgId ?? '',
  };

  const body = {
    id: inboundId,
    settings: JSON.stringify({
      clients: [clientPayload],
    }),
  };

  const data = await xuiRequest(`/panel/api/inbounds/updateClient/${clientUuid}`, 'POST', body);
  return !!data.success;
}

/**
 * Получить объем трафика клиента по его Email
 * Возвращает { id, inboundId, email, up, down, expiryTime, total }
 */
export async function xuiGetClientTraffic(email: string): Promise<any | null> {
  const data = await xuiRequest(`/panel/api/inbounds/getClientTraffics/${email}`, 'GET');
  if (data.success && data.obj) {
    return data.obj;
  }
  return null;
}

/**
 * Сгенерировать ссылку подключения (vless, trojan, shadowsocks) на основе настроек инбаунда 3XUI
 * @param inbound Объект инбаунда из 3XUI
 * @param clientUuid UUID клиента
 * @param clientEmail Email клиента (для ремарки)
 * @param customDomainOrIp Кастомный домен или IP ноды, на которой работает клиент
 */
export function generateConfigLink(
  inbound: any,
  clientUuid: string,
  clientEmail: string,
  customDomainOrIp: string
): string {
  const protocol = inbound.protocol.toLowerCase();
  const port = inbound.port;
  const remark = encodeURIComponent(`${inbound.remark || 'VPN'}_${clientEmail.split('@')[0]}`);

  // Парсим настройки стрима (безопасность, tls, reality)
  let streamSettings: any = {};
  try {
    streamSettings = typeof inbound.streamSettings === 'string' 
      ? JSON.parse(inbound.streamSettings) 
      : inbound.streamSettings || {};
  } catch (e) {
    streamSettings = {};
  }

  const security = streamSettings.security || 'none';
  const network = streamSettings.network || 'tcp';

  if (protocol === 'vless') {
    // Формируем VLESS ссылку
    let link = `vless://${clientUuid}@${customDomainOrIp}:${port}?type=${network}&security=${security}`;

    if (security === 'reality') {
      const realitySettings = streamSettings.realitySettings || {};
      const sni = realitySettings.serverNames?.[0] || realitySettings.dest?.split(':')?.[0] || '';
      const pbk = realitySettings.publicKey || '';
      const sid = realitySettings.shortIds?.[0] || '';
      const fp = realitySettings.fingerprint || 'chrome';
      const spiderX = realitySettings.spiderX || '/';

      link += `&sni=${encodeURIComponent(sni)}&pbk=${encodeURIComponent(pbk)}&fp=${fp}`;
      if (sid) link += `&sid=${sid}`;
      if (spiderX) link += `&spx=${encodeURIComponent(spiderX)}`;
      link += `&flow=xtls-rprx-vision`; // Стандартный flow для Reality
    } else if (security === 'tls') {
      const tlsSettings = streamSettings.tlsSettings || {};
      const sni = tlsSettings.serverName || '';
      if (sni) link += `&sni=${encodeURIComponent(sni)}`;
    }

    link += `#${remark}`;
    return link;
  }

  if (protocol === 'trojan') {
    // Формируем Trojan ссылку
    let link = `trojan://${clientUuid}@${customDomainOrIp}:${port}?type=${network}&security=${security}`;
    if (security === 'tls') {
      const tlsSettings = streamSettings.tlsSettings || {};
      const sni = tlsSettings.serverName || '';
      if (sni) link += `&sni=${encodeURIComponent(sni)}`;
    }
    link += `#${remark}`;
    return link;
  }

  if (protocol === 'shadowsocks') {
    // Для Shadowsocks UUID выступает паролем (или пароль хранится в настройках, но обычно в 3XUI это password/id)
    // Формат: ss://base64(method:password)@host:port#remark
    let settings: any = {};
    try {
      settings = typeof inbound.settings === 'string' 
        ? JSON.parse(inbound.settings) 
        : inbound.settings || {};
    } catch (e) {
      settings = {};
    }

    const method = settings.method || 'aes-256-gcm';
    const credentials = Buffer.from(`${method}:${clientUuid}`).toString('base64');
    return `ss://${credentials}@${customDomainOrIp}:${port}#${remark}`;
  }

  return '';
}

/**
 * Получить список всех нод и построить динамический маппинг ID -> Домен
 */
export async function xuiGetNodeDomains(): Promise<Record<string, string>> {
  const nodeDomains: Record<string, string> = {};
  
  // По умолчанию Нода 0 — это сам главный (Master) сервер 3XUI
  const config = await getXuiConfig();
  try {
    const mainHost = new URL(config.apiUrl).hostname;
    nodeDomains['0'] = mainHost;
  } catch (e) {
    nodeDomains['0'] = 'vpn.btw.com';
  }

  try {
    const data = await xuiRequest('/panel/api/nodes/list', 'GET');
    if (data.success && Array.isArray(data.obj)) {
      data.obj.forEach((node: any) => {
        if (node.id !== undefined && node.address) {
          nodeDomains[String(node.id)] = node.address;
        }
      });
    }
  } catch (err: any) {
    console.error('Failed to fetch node list from 3XUI:', err.message);
  }

  return nodeDomains;
}

/**
 * Получить список email-ов клиентов, находящихся в сети (онлайн) прямо сейчас
 */
export async function xuiGetOnlineClients(): Promise<string[]> {
  try {
    const data = await xuiRequest('/panel/api/inbounds/onlines', 'POST');
    if (data.success && Array.isArray(data.obj)) {
      return data.obj.map((email: any) => String(email));
    }
  } catch (err: any) {
    console.error('Failed to fetch online clients from 3XUI:', err.message);
  }
  return [];
}
