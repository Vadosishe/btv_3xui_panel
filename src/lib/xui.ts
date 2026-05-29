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
      let responseBody = '';
      try {
        responseBody = await res.text();
      } catch (bodyErr) {}
      
      const errorMsg = `3XUI API error on ${method} ${url}: Status ${res.status}. Response: ${responseBody.slice(0, 300)}`;
      throw new Error(errorMsg);
    }

    const data = await res.json();
    return data as T;
  } catch (error: any) {
    console.error(`Request to 3XUI API (${path}) failed:`, error.message);
    throw error;
  }
}

// Кэш для инбаундов 3XUI (для радикального ускорения загрузки страниц подписки)
let cachedInbounds: any[] | null = null;
let cachedInboundsTime = 0;

/**
 * Получить список всех инбаундов (входящих подключений) с кэшированием на 1 минуту
 */
export async function xuiGetInbounds(): Promise<any[]> {
  const now = Date.now();
  if (cachedInbounds && (now - cachedInboundsTime < 60000)) {
    return cachedInbounds;
  }

  try {
    const data = await xuiRequest('/panel/api/inbounds/list', 'GET');
    if (data.success && Array.isArray(data.obj)) {
      cachedInbounds = data.obj;
      cachedInboundsTime = now;
      return data.obj;
    }
  } catch (err) {
    console.error('Error fetching inbounds from 3XUI, using cached fallback if available:', err);
    if (cachedInbounds) {
      return cachedInbounds;
    }
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
  // Определение корректного flow на основе настроек инбаунда
  let finalFlow = client.flow || '';
  try {
    const inbounds = await xuiGetInbounds();
    const inbound = inbounds.find(i => i.id === inboundId);
    if (inbound) {
      const protocol = inbound.protocol.toLowerCase();
      let streamSettings: any = {};
      try {
        streamSettings = typeof inbound.streamSettings === 'string'
          ? JSON.parse(inbound.streamSettings)
          : inbound.streamSettings || {};
      } catch (e) {}

      const security = streamSettings.security || 'none';
      const network = streamSettings.network || 'tcp';

      // flow (например, xtls-rprx-vision) поддерживается ТОЛЬКО для VLESS с Reality/TLS поверх TCP
      if (protocol === 'vless' && (security === 'reality' || security === 'tls') && network === 'tcp') {
        if (!finalFlow || finalFlow === 'none') {
          finalFlow = 'xtls-rprx-vision';
        }
      } else {
        // Во всех остальных случаях параметр flow должен быть полностью пустым
        finalFlow = '';
      }
    }
  } catch (err) {
    console.warn(`Failed to inspect inbound ${inboundId} for flow validation:`, err);
  }

  // Настройки клиента для 3XUI Merlin
  const clientPayload = {
    id: client.id,
    email: client.email,
    subId: client.id.replace(/-/g, '').slice(0, 16), // Генерируем 16 hex символов для subId
    totalGB: client.totalGB ?? 0, // В байтах
    expiryTime: client.expiryTime ?? 0, // Unix timestamp
    tgId: client.tgId ? Number(client.tgId) : 0,
    limitIp: client.limitIp ?? 0,
    enable: client.enable ?? true,
    flow: finalFlow,
    comment: 'BTV Client'
  };

  const body = {
    client: clientPayload,
    inboundIds: [inboundId],
  };

  const data = await xuiRequest('/panel/api/clients/add', 'POST', body);
  return !!data.success;
}

/**
 * Удалить клиента из входящего подключения
 */
/**
 * Транслитерация кириллицы в латиницу и очистка строки для email/remark
 */
export function getCleanLatinName(name: string): string {
  const ru: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ы': 'y', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh',
    'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
    'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts',
    'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ы': 'Y', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya'
  };
  
  const latin = name.split('').map(char => ru[char] || char).join('');
  const clean = latin.toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
    
  return clean || 'client';
}

/**
 * Удалить клиента из входящего подключения
 */
export async function xuiDeleteClient(inboundId: number, clientUuid: string): Promise<boolean> {
  const email = clientUuid.includes('@')
    ? clientUuid
    : `client_${clientUuid.slice(0, 8)}@btv.vpn`;

  const data = await xuiRequest(`/panel/api/clients/del/${email}`, 'POST');
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
  // Определение корректного flow на основе настроек инбаунда
  let finalFlow = client.flow || '';
  try {
    const inbounds = await xuiGetInbounds();
    const inbound = inbounds.find(i => i.id === inboundId);
    if (inbound) {
      const protocol = inbound.protocol.toLowerCase();
      let streamSettings: any = {};
      try {
        streamSettings = typeof inbound.streamSettings === 'string'
          ? JSON.parse(inbound.streamSettings)
          : inbound.streamSettings || {};
      } catch (e) {}

      const security = streamSettings.security || 'none';
      const network = streamSettings.network || 'tcp';

      // flow (например, xtls-rprx-vision) поддерживается ТОЛЬКО для VLESS с Reality/TLS поверх TCP
      if (protocol === 'vless' && (security === 'reality' || security === 'tls') && network === 'tcp') {
        if (!finalFlow || finalFlow === 'none') {
          finalFlow = 'xtls-rprx-vision';
        }
      } else {
        // Во всех остальных случаях параметр flow должен быть полностью пустым
        finalFlow = '';
      }
    }
  } catch (err) {
    console.warn(`Failed to inspect inbound ${inboundId} for flow validation:`, err);
  }

  const clientPayload = {
    id: client.id,
    email: client.email,
    subId: client.id.replace(/-/g, '').slice(0, 16),
    totalGB: client.totalGB ?? 0,
    expiryTime: client.expiryTime ?? 0,
    tgId: client.tgId ? Number(client.tgId) : 0,
    limitIp: client.limitIp ?? 0,
    enable: client.enable ?? true,
    flow: finalFlow,
    comment: 'BTV Client'
  };

  const body = {
    client: clientPayload,
    inboundIds: [inboundId],
  };

  const data = await xuiRequest(`/panel/api/clients/update/${client.email}`, 'POST', body);
  return !!data.success;
}

/**
 * Получить объем трафика клиента по его Email
 * Возвращает { id, inboundId, email, up, down, expiryTime, total }
 */
export async function xuiGetClientTraffic(email: string): Promise<any | null> {
  const data = await xuiRequest(`/panel/api/clients/traffic/${email}`, 'GET');
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
 * @param customFlow У кастомный Reality Flow
 * @param clientName ФИО сотрудника для красивой ремарки/лейбла
 */
export function generateConfigLink(
  inbound: any,
  clientUuid: string,
  clientEmail: string,
  customDomainOrIp: string,
  customFlow?: string | null,
  clientName?: string
): string {
  const protocol = inbound.protocol.toLowerCase();
  const port = inbound.port;

  // Если задано имя клиента — транслитерируем его для красивого лейбла, иначе берем префикс email
  const cleanName = clientName ? getCleanLatinName(clientName) : clientEmail.split('@')[0];
  const remark = encodeURIComponent(`${inbound.remark || 'VPN'}_${cleanName}`);

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

  // Генерируем параметры транспорта (WS, gRPC, mKCP и т.д.) для полной переносимости настроек
  let transportParams = '';
  if (network === 'ws') {
    const wsSettings = streamSettings.wsSettings || {};
    const path = wsSettings.path || '/';
    const host = wsSettings.headers?.Host || wsSettings.headers?.host || '';
    transportParams += `&path=${encodeURIComponent(path)}`;
    if (host) transportParams += `&host=${encodeURIComponent(host)}`;
  } else if (network === 'grpc') {
    const grpcSettings = streamSettings.grpcSettings || {};
    const serviceName = grpcSettings.serviceName || '';
    if (serviceName) transportParams += `&serviceName=${encodeURIComponent(serviceName)}`;
    const mode = grpcSettings.mode || '';
    if (mode) transportParams += `&mode=${encodeURIComponent(mode)}`;
  } else if (network === 'http' || network === 'h2') {
    const httpSettings = streamSettings.httpSettings || streamSettings.h2Settings || {};
    const path = httpSettings.path || '/';
    let host = '';
    if (Array.isArray(httpSettings.host)) {
      host = httpSettings.host[0] || '';
    } else if (typeof httpSettings.host === 'string') {
      host = httpSettings.host;
    }
    transportParams += `&path=${encodeURIComponent(path)}`;
    if (host) transportParams += `&host=${encodeURIComponent(host)}`;
  } else if (network === 'kcp') {
    const kcpSettings = streamSettings.kcpSettings || {};
    const headerType = kcpSettings.header?.type || 'none';
    transportParams += `&headerType=${encodeURIComponent(headerType)}`;
    const seed = kcpSettings.seed || '';
    if (seed) transportParams += `&seed=${encodeURIComponent(seed)}`;
  } else if (network === 'quic') {
    const quicSettings = streamSettings.quicSettings || {};
    const quicSecurity = quicSettings.security || 'none';
    const key = quicSettings.key || '';
    const headerType = quicSettings.header?.type || 'none';
    transportParams += `&quicSecurity=${encodeURIComponent(quicSecurity)}&key=${encodeURIComponent(key)}&headerType=${encodeURIComponent(headerType)}`;
  } else if (network === 'tcp') {
    // Поддержка HTTP обфускации для TCP
    const tcpSettings = streamSettings.tcpSettings || {};
    const headerType = tcpSettings.header?.type || 'none';
    if (headerType === 'http') {
      transportParams += `&headerType=http`;
      const request = tcpSettings.header?.request || {};
      const headers = request.headers || {};
      let host = '';
      const hostHeader = headers.Host || headers.host || '';
      if (Array.isArray(hostHeader)) {
        host = hostHeader[0] || '';
      } else if (typeof hostHeader === 'string') {
        host = hostHeader;
      }
      if (host) transportParams += `&host=${encodeURIComponent(host)}`;

      let path = '';
      const pathVal = request.path || '';
      if (Array.isArray(pathVal)) {
        path = pathVal[0] || '';
      } else if (typeof pathVal === 'string') {
        path = pathVal;
      }
      if (path) transportParams += `&path=${encodeURIComponent(path)}`;
    }
  }

  if (protocol === 'vless') {
    // Формируем VLESS ссылку
    let link = `vless://${clientUuid}@${customDomainOrIp}:${port}?type=${network}&security=${security}${transportParams}`;

    if (security === 'reality') {
      const realitySettings = streamSettings.realitySettings || {};
      const settingsObj = realitySettings.settings || {};
      
      const sni = realitySettings.serverNames?.[0] || settingsObj.serverNames?.[0] || realitySettings.dest?.split(':')?.[0] || settingsObj.dest?.split(':')?.[0] || '';
      const pbk = settingsObj.publicKey || realitySettings.publicKey || '';
      const fp = settingsObj.fingerprint || realitySettings.fingerprint || 'chrome';
      const spiderX = settingsObj.spiderX !== undefined ? settingsObj.spiderX : (realitySettings.spiderX || '/');
      const sid = realitySettings.shortIds?.[0] || settingsObj.shortIds?.[0] || '';

      link += `&sni=${encodeURIComponent(sni)}&pbk=${encodeURIComponent(pbk)}&fp=${fp}`;
      if (sid) link += `&sid=${sid}`;
      if (spiderX) link += `&spx=${encodeURIComponent(spiderX)}`;
      
      // flow (например, xtls-rprx-vision) поддерживается ТОЛЬКО для TCP
      if (network === 'tcp') {
        const flowVal = customFlow !== undefined && customFlow !== null ? customFlow.trim() : 'xtls-rprx-vision';
        if (flowVal && flowVal !== 'none') {
          link += `&flow=${flowVal}`;
        }
      }
    } else if (security === 'tls') {
      const tlsSettings = streamSettings.tlsSettings || {};
      const sni = tlsSettings.serverName || '';
      if (sni) link += `&sni=${encodeURIComponent(sni)}`;
      
      // flow поддерживается только для TCP
      if (network === 'tcp' && customFlow && customFlow !== 'none') {
        link += `&flow=${customFlow.trim()}`;
      }
    }

    link += `#${remark}`;
    return link;
  }

  if (protocol === 'trojan') {
    // Формируем Trojan ссылку
    let link = `trojan://${clientUuid}@${customDomainOrIp}:${port}?type=${network}&security=${security}${transportParams}`;
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

  if (protocol === 'vmess') {
    // Формируем VMess ссылку (Base64 JSON в соответствии со стандартом v2rayN/v2rayNG/Nekobox)
    const vmessJson: any = {
      v: "2",
      ps: decodeURIComponent(remark),
      add: customDomainOrIp,
      port: Number(port),
      id: clientUuid,
      aid: "0",
      scy: "auto",
      net: network,
      type: "none",
      host: "",
      path: "",
      tls: security === 'none' ? 'none' : 'tls',
      sni: "",
      fp: ""
    };

    // Параметры транспорта в VMess JSON
    if (network === 'ws') {
      const wsSettings = streamSettings.wsSettings || {};
      vmessJson.path = wsSettings.path || '/';
      const host = wsSettings.headers?.Host || wsSettings.headers?.host || '';
      if (host) vmessJson.host = host;
    } else if (network === 'grpc') {
      const grpcSettings = streamSettings.grpcSettings || {};
      vmessJson.path = grpcSettings.serviceName || '';
      vmessJson.type = 'grpc';
    } else if (network === 'tcp') {
      const tcpSettings = streamSettings.tcpSettings || {};
      const headerType = tcpSettings.header?.type || 'none';
      if (headerType === 'http') {
        vmessJson.type = 'http';
        const request = tcpSettings.header?.request || {};
        const headers = request.headers || {};
        let host = '';
        const hostHeader = headers.Host || headers.host || '';
        if (Array.isArray(hostHeader)) {
          host = hostHeader[0] || '';
        } else if (typeof hostHeader === 'string') {
          host = hostHeader;
        }
        if (host) vmessJson.host = host;

        let path = '';
        const pathVal = request.path || '';
        if (Array.isArray(pathVal)) {
          path = pathVal[0] || '';
        } else if (typeof pathVal === 'string') {
          path = pathVal;
        }
        if (path) vmessJson.path = path;
      }
    } else if (network === 'kcp') {
      const kcpSettings = streamSettings.kcpSettings || {};
      vmessJson.type = kcpSettings.header?.type || 'none';
    } else if (network === 'quic') {
      const quicSettings = streamSettings.quicSettings || {};
      vmessJson.type = quicSettings.header?.type || 'none';
      vmessJson.host = quicSettings.security || 'none';
      vmessJson.path = quicSettings.key || '';
    } else if (network === 'http' || network === 'h2') {
      const httpSettings = streamSettings.httpSettings || streamSettings.h2Settings || {};
      vmessJson.path = httpSettings.path || '/';
      let host = '';
      if (Array.isArray(httpSettings.host)) {
        host = httpSettings.host[0] || '';
      } else if (typeof httpSettings.host === 'string') {
        host = httpSettings.host;
      }
      if (host) vmessJson.host = host;
    }

    if (security === 'tls') {
      const tlsSettings = streamSettings.tlsSettings || {};
      vmessJson.sni = tlsSettings.serverName || '';
      vmessJson.alpn = tlsSettings.alpn ? tlsSettings.alpn.join(',') : '';
    } else if (security === 'reality') {
      const realitySettings = streamSettings.realitySettings || {};
      const settingsObj = realitySettings.settings || {};
      vmessJson.tls = 'reality';
      vmessJson.sni = realitySettings.serverNames?.[0] || settingsObj.serverNames?.[0] || realitySettings.dest?.split(':')?.[0] || settingsObj.dest?.split(':')?.[0] || '';
      vmessJson.fp = settingsObj.fingerprint || realitySettings.fingerprint || 'chrome';
    }

    const base64Vmess = Buffer.from(JSON.stringify(vmessJson)).toString('base64');
    return `vmess://${base64Vmess}`;
  }

  return '';
}

// Кэш для доменов нод 3XUI
let cachedNodeDomains: Record<string, string> | null = null;
let cachedNodeDomainsTime = 0;

/**
 * Получить список всех нод и построить динамический маппинг ID -> Домен с кэшированием на 3 минуты
 */
export async function xuiGetNodeDomains(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedNodeDomains && (now - cachedNodeDomainsTime < 180000)) {
    return cachedNodeDomains;
  }

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
      cachedNodeDomains = nodeDomains;
      cachedNodeDomainsTime = now;
      return nodeDomains;
    }
  } catch (err: any) {
    console.error('Failed to fetch node list from 3XUI, using cached fallback if available:', err.message);
    if (cachedNodeDomains) {
      return cachedNodeDomains;
    }
  }

  return nodeDomains;
}

/**
 * Очистить кэш инбаундов и нод (например, при сохранении настроек или изменении шаблонов)
 */
export function xuiClearCache(): void {
  cachedInbounds = null;
  cachedInboundsTime = 0;
  cachedNodeDomains = null;
  cachedNodeDomainsTime = 0;
}

/**
 * Получить список email-ов клиентов, находящихся в сети (онлайн) прямо сейчас
 */
export async function xuiGetOnlineClients(): Promise<string[]> {
  try {
    const data = await xuiRequest('/panel/api/clients/onlines', 'POST');
    if (data.success && Array.isArray(data.obj)) {
      return data.obj.map((email: any) => String(email));
    }
  } catch (err: any) {
    console.error('Failed to fetch online clients from 3XUI:', err.message);
  }
  return [];
}
