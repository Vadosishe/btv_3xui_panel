import prisma from './prisma';

interface AwgPeersResponse {
  id: string;
  name: string;
  isEnabled: boolean;
  address: string;
  publicKey: string;
  createdAt: string;
  updatedAt: string;
}

// Сессионный cookie для API amnezia-wg-easy (хранится в оперативной памяти процесса)
let awgSessionCookie = '';

/**
 * Получить настройки интеграции Amnezia WG из базы данных
 */
async function getAwgSettings() {
  const settings = await prisma.appSetting.findMany();
  const settingsMap = new Map(settings.map(s => [s.key, s.value]));

  const enabled = settingsMap.get('awg_enabled') === 'true';
  const apiUrl = settingsMap.get('awg_api_url') || 'http://localhost:51821';
  const password = settingsMap.get('awg_api_password') || '';

  return {
    enabled,
    apiUrl: apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl,
    password,
    settingsMap
  };
}

/**
 * Выполнить авторизацию в API wg-easy и получить сессионный cookie
 */
async function loginToAwgEasy(apiUrl: string, password?: string): Promise<string> {
  if (!password) return '';
  try {
    const res = await fetch(`${apiUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    });

    if (res.ok) {
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        // Извлекаем только значение сессии (например, connect.sid=...)
        const match = setCookie.match(/connect\.sid=[^;]+/);
        if (match) {
          awgSessionCookie = match[0];
          return awgSessionCookie;
        }
      }
    }
  } catch (err: any) {
    console.error('Failed to login to Amnezia WG Easy API:', err.message);
  }
  return '';
}

/**
 * Универсальный хелпер запросов к API amnezia-wg-easy с авто-авторизацией
 */
async function awgRequest<T = any>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: any,
  isRetry = false
): Promise<T | null> {
  const settings = await getAwgSettings();
  if (!settings.enabled) return null;

  const url = `${settings.apiUrl}${path}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  // Если cookie уже сохранен — используем его
  if (awgSessionCookie) {
    headers['Cookie'] = awgSessionCookie;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

    if (res.status === 401 && !isRetry) {
      // Сессия истекла или отсутствует. Пробуем авторизоваться
      console.log('Amnezia WG Easy API returned 401. Refreshing session...');
      const freshCookie = await loginToAwgEasy(settings.apiUrl, settings.password);
      if (freshCookie) {
        // Повторяем запрос с новыми куками
        return awgRequest<T>(path, method, body, true);
      }
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Amnezia WG Easy API returned status ${res.status}: ${text}`);
    }

    // Если запрос был DELETE или пустой POST/GET, возвращаем пустой успех
    if (res.status === 204) {
      return { success: true } as any;
    }

    const data = await res.json();
    return data as T;
  } catch (err: any) {
    console.error(`Request to Amnezia WG Easy failed on ${method} ${path}:`, err.message);
    return null;
  }
}

/**
 * Создать клиента (пира) в Amnezia WireGuard
 */
export async function amneziaAddPeer(clientEmail: string): Promise<AwgPeersResponse | null> {
  try {
    // Пробуем сначала найти существующего пира с таким же именем, чтобы не плодить дубликаты
    const peers = await awgRequest<AwgPeersResponse[]>('/api/peers', 'GET');
    if (Array.isArray(peers)) {
      const existing = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
      if (existing) {
        return existing;
      }
    }

    // Создаем нового пира
    const peer = await awgRequest<AwgPeersResponse>('/api/peers', 'POST', { name: clientEmail });
    return peer;
  } catch (err: any) {
    console.error('Failed to add peer in Amnezia WG:', err.message);
    return null;
  }
}

/**
 * Удалить клиента (пира) в Amnezia WireGuard
 */
export async function amneziaDeletePeer(clientEmail: string): Promise<boolean> {
  try {
    const peers = await awgRequest<AwgPeersResponse[]>('/api/peers', 'GET');
    if (Array.isArray(peers)) {
      const peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
      if (peer) {
        await awgRequest(`/api/peers/${peer.id}`, 'DELETE');
        return true;
      }
    }
  } catch (err: any) {
    console.error('Failed to delete peer in Amnezia WG:', err.message);
  }
  return false;
}

/**
 * Включить или выключить клиента (пира) в Amnezia WireGuard
 */
export async function amneziaTogglePeer(clientEmail: string, enable: boolean): Promise<boolean> {
  try {
    const peers = await awgRequest<AwgPeersResponse[]>('/api/peers', 'GET');
    if (Array.isArray(peers)) {
      const peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
      if (peer) {
        const action = enable ? 'enable' : 'disable';
        await awgRequest(`/api/peers/${peer.id}/${action}`, 'POST');
        return true;
      }
    }
  } catch (err: any) {
    console.error(`Failed to ${enable ? 'enable' : 'disable'} peer in Amnezia WG:`, err.message);
  }
  return false;
}

/**
 * Сгенерировать и получить файл конфигурации AWG 2.0 (.conf) для клиента с параметрами обфускации
 */
export async function amneziaGetPeerConfig(clientEmail: string): Promise<string | null> {
  try {
    const settings = await getAwgSettings();
    if (!settings.enabled) return null;

    const peers = await awgRequest<AwgPeersResponse[]>('/api/peers', 'GET');
    if (!Array.isArray(peers)) return null;

    const peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
    if (!peer) return null;

    // Забираем сырой стандартный конфиг WireGuard с API wg-easy
    const rawUrl = `${settings.apiUrl}/api/peers/${peer.id}/config`;
    const headers: Record<string, string> = {};
    if (awgSessionCookie) {
      headers['Cookie'] = awgSessionCookie;
    }

    const res = await fetch(rawUrl, { headers, cache: 'no-store' });
    if (!res.ok) return null;

    let configText = await res.text();

    // Извлекаем параметры маскировки AWG из настроек БД
    const jc = settings.settingsMap.get('awg_jc') || '4';
    const jmin = settings.settingsMap.get('awg_jmin') || '40';
    const jmax = settings.settingsMap.get('awg_jmax') || '70';
    const s1 = settings.settingsMap.get('awg_s1') || '5';
    const s2 = settings.settingsMap.get('awg_s2') || '10';
    const h1 = settings.settingsMap.get('awg_h1') || '1';
    const h2 = settings.settingsMap.get('awg_h2') || '2';
    const h3 = settings.settingsMap.get('awg_h3') || '3';
    const h4 = settings.settingsMap.get('awg_h4') || '4';

    // Внедряем 9 параметров обфускации в секцию [Interface]
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
      
      // Вставляем параметры сразу после строки [Interface]
      lines.splice(interfaceIdx + 1, 0, ...awgParams);
      configText = lines.join('\n');
    }

    return configText;
  } catch (err: any) {
    console.error('Failed to build Amnezia WG config:', err.message);
    return null;
  }
}
