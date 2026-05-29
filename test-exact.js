const server = {
  id: 'test-server-id',
  name: 'Test Server',
  apiUrl: 'http://5.129.229.25:51821/',
  apiPassword: '030499Vlad',
  enabled: true
};

let awgSessionCookies = {};

async function loginToAwgServer(server) {
  if (!server.apiPassword) return '';
  const apiUrl = server.apiUrl.endsWith('/') ? server.apiUrl.slice(0, -1) : server.apiUrl;
  try {
    const res = await fetch(`${apiUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: server.apiPassword }),
    });

    console.log(`Login Response Status: ${res.status}`);
    const setCookie = res.headers.get('set-cookie');
    console.log(`Login Set-Cookie header: ${setCookie}`);
    
    if (res.ok) {
      if (setCookie) {
        const match = setCookie.match(/connect\.sid=[^;]+/);
        if (match) {
          const cookie = match[0];
          awgSessionCookies[server.id] = cookie;
          console.log(`Parsed Cookie: ${cookie}`);
          return cookie;
        }
      }
    }
  } catch (err) {
    console.error(`Login failed:`, err.message);
  }
  return '';
}

async function awgServerRequest(server, path, method, body, isRetry = false) {
  const baseUrl = server.apiUrl.endsWith('/') ? server.apiUrl.slice(0, -1) : server.apiUrl;
  const url = `${baseUrl}${path}`;
  const headers = {
    'Accept': 'application/json',
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const sessionCookie = awgSessionCookies[server.id];
  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }

  console.log(`Sending ${method} ${url} with headers:`, JSON.stringify(headers));

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    console.log(`Response Status: ${res.status}`);

    if (res.status === 401 && !isRetry) {
      console.log(`Returned 401. Refreshing session...`);
      const freshCookie = await loginToAwgServer(server);
      if (freshCookie) {
        return awgServerRequest(server, path, method, body, true);
      }
    }

    if (!res.ok) {
      const text = await res.text();
      console.log(`Error Response Body: ${text}`);
      throw new Error(`API returned status ${res.status}`);
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`Request failed:`, err.message);
    throw err;
  }
}

async function fetchPeers(server) {
  try {
    let peers = await awgServerRequest(server, '/api/peers', 'GET');
    if (Array.isArray(peers)) return peers;
  } catch (e) {
    console.log(`GET /api/peers failed, trying Nuxt API...`);
  }

  let peers = await awgServerRequest(server, '/api/wireguard/client', 'GET');
  return peers;
}

async function run() {
  console.log("=== STEP 1: Login ===");
  await loginToAwgServer(server);

  console.log("\n=== STEP 2: Fetch Peers ===");
  const peers = await fetchPeers(server);
  console.log(`Fetched ${peers.length} peers.`);

  console.log("\n=== STEP 3: Create Peer ===");
  const clientEmail = 'test-final-creation@btv.vpn';
  
  // Check if exists
  let peer = peers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
  if (peer) {
    console.log("Peer already exists:", peer);
  } else {
    console.log("Peer does not exist. Creating...");
    try {
      let res = await awgServerRequest(server, '/api/peers', 'POST', { name: clientEmail });
      console.log("Created via Express:", res);
    } catch (e) {
      console.log("Express POST failed, trying Nuxt POST...");
      try {
        let res = await awgServerRequest(server, '/api/wireguard/client', 'POST', { name: clientEmail });
        console.log("Created via Nuxt:", res);
        
        // Re-fetch
        const freshPeers = await fetchPeers(server);
        const newlyCreated = freshPeers.find(p => p.name.toLowerCase().trim() === clientEmail.toLowerCase().trim());
        console.log("Found newly created peer in list:", newlyCreated);
      } catch (err) {
        console.error("Nuxt POST failed as well:", err.message);
      }
    }
  }
}

run().catch(console.error);
