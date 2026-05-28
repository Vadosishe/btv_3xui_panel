import prisma from './prisma';

// Структура учетных данных 3XUI
interface XuiConfig {
  apiUrl: string;
  username: string;
  password: string;
  apiToken: string;
}

// Кэш сессионной куки для предотвращения повторной авторизации
let cachedCookie: string | null = null;
let lastLoginTime = 0;
const SESSION_TTL = 20 * 60 * 1000; // 20 минут TTL сессии

/**
 * Получить настройки 3XUI из базы данных (AppSetting) или из окружения
 */
async function getXuiConfig(): Promise<XuiConfig> {
  const settings = await prisma.appSetting.findMany();
  const settingsMap = new Map(settings.map(s => [s.key, s.value]));

  const apiUrl = settingsMap.get('xui_api_url') || process.env.XUI_API_URL || 'http://localhost:2053';
  const username = settingsMap.get('xui_username') || process.env.XUI_USERNAME || 'admin';
  const password = settingsMap.get('xui_password') || process.env.XUI_PASSWORD || 'admin';
  const apiToken = settingsMap.get('xui_api_token') || process.env.XUI_API_TOKEN || '';

  // Удаляем завершающий слеш из URL
  return {
    apiUrl: apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl,
    username,
    password,
    apiToken,
  };
}

/**
 * Выполнить вход в панель 3XUI и получить сессионную куку
 */
export async function xuiLogin(force = false): Promise<string> {
  const now = Date.now();
  if (cachedCookie && !force && (now - lastLoginTime < SESSION_TTL)) {
    return cachedCookie;
  }

  const config = await getXuiConfig();
  const loginUrl = `${config.apiUrl}/login`;

  try {
    const params = new URLSearchParams();
    params.append('username', config.username);
    params.append('password', config.password);

    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params,
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`3XUI login failed: Status ${res.status}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(`3XUI login unsuccessful: ${json.msg || 'Unknown error'}`);
    }

    // Извлекаем куку session из заголовков set-cookie
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error('3XUI login failed: No set-cookie header received');
    }

    // Ищем куку session=...
    const match = setCookie.match(/session=([^;]+)/);
    if (!match) {
      throw new Error('3XUI login failed: Session cookie not found in set-cookie header');
    }

    cachedCookie = `session=${match[1]}`;
    lastLoginTime = now;
    return cachedCookie;
  } catch (error: any) {
    console.error('Error logging in to 3XUI API:', error.message);
    throw error;
  }
}

/**
 * Универсальный метод отправки запросов к API 3XUI с авто-логином
 */
async function xuiRequest<T = any>(
  path: string,
  method: 'GET' | 'POST',
  body?: any,
  isRetry = false
): Promise<T> {
  const config = await getXuiConfig();
  const url = `${config.apiUrl}${path}`;
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (config.apiToken) {
    // Токен-авторизация (Bearer Token) — не требует логина, сессий и обходит CSRF
    headers['Authorization'] = `Bearer ${config.apiToken}`;
  } else {
    // Традиционная сессионная кука
    const cookie = await xuiLogin();
    headers['Cookie'] = cookie;
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

    // Если получили 401/Unauthorized, возможно сессия истекла (актуально только для авторизации по кукам)
    if (res.status === 401 && !isRetry && !config.apiToken) {
      console.log('3XUI session expired (401), re-authenticating...');
      await xuiLogin(true); // Форсируем логин
      return xuiRequest(path, method, body, true); // Пробуем снова
    }

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
    tgId: '',
    subId: '',
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
  }
): Promise<boolean> {
  const clientPayload = {
    id: client.id,
    email: client.email,
    limitIp: client.limitIp ?? 0,
    totalGB: client.totalGB ?? 0,
    expiryTime: client.expiryTime ?? 0,
    enable: client.enable ?? true,
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
