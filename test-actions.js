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

    const setCookie = res.headers.get('set-cookie');
    if (res.ok && setCookie) {
      const match = setCookie.match(/connect\.sid=[^;]+/);
      if (match) {
        const cookie = match[0];
        awgSessionCookies[server.id] = cookie;
        return cookie;
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

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if ((res.status === 401 || res.status === 500) && !isRetry) {
      const freshCookie = await loginToAwgServer(server);
      if (freshCookie) {
        return awgServerRequest(server, path, method, body, true);
      }
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API returned status ${res.status}: ${text}`);
    }

    if (res.status === 204) {
      return { success: true };
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
    // console.log(`GET /api/peers failed, trying Nuxt API...`);
  }

  let peers = await awgServerRequest(server, '/api/wireguard/client', 'GET');
  return peers;
}

async function run() {
  console.log("=== STEP 1: Login ===");
  await loginToAwgServer(server);
  console.log("Login successful.");

  console.log("\n=== STEP 2: Fetch Peers ===");
  const peers = await fetchPeers(server);
  console.log(`Fetched ${peers.length} peers from server.`);

  // 1. Delete orphan: test_e74cb5d0@btv.vpn
  const email1 = 'test_e74cb5d0@btv.vpn';
  const peer1 = peers.find(p => p.name.toLowerCase().trim() === email1.toLowerCase().trim());
  if (peer1) {
    console.log(`Found peer '${email1}' on server (ID: ${peer1.id}). Deleting...`);
    const res = await awgServerRequest(server, `/api/wireguard/client/${peer1.id}`, 'DELETE');
    console.log(`Delete result for '${email1}':`, res);
  } else {
    console.log(`Peer '${email1}' is not on server.`);
  }

  // 2. Delete orphan: test2_8b7499cf@btv.vpn
  const email2 = 'test2_8b7499cf@btv.vpn';
  const peer2 = peers.find(p => p.name.toLowerCase().trim() === email2.toLowerCase().trim());
  if (peer2) {
    console.log(`Found peer '${email2}' on server (ID: ${peer2.id}). Deleting...`);
    const res = await awgServerRequest(server, `/api/wireguard/client/${peer2.id}`, 'DELETE');
    console.log(`Delete result for '${email2}':`, res);
  } else {
    console.log(`Peer '${email2}' is not on server.`);
  }

  // 3. Create a brand new test peer
  const testEmail = 'temporary-test-peer@btv.vpn';
  console.log(`\n=== STEP 3: Create Temporary Test Peer '${testEmail}' ===`);
  const createRes = await awgServerRequest(server, '/api/wireguard/client', 'POST', { name: testEmail });
  console.log("POST Create response:", createRes);

  // Re-fetch to check if it exists and get its ID
  const peersAfterCreate = await fetchPeers(server);
  const createdPeer = peersAfterCreate.find(p => p.name.toLowerCase().trim() === testEmail.toLowerCase().trim());
  console.log("Newly created peer from list:", createdPeer);

  if (createdPeer) {
    console.log(`\n=== STEP 4: Delete Temporary Test Peer (ID: ${createdPeer.id}) ===`);
    const deleteRes = await awgServerRequest(server, `/api/wireguard/client/${createdPeer.id}`, 'DELETE');
    console.log("DELETE response:", deleteRes);

    // Verify it is gone
    const finalPeers = await fetchPeers(server);
    const checked = finalPeers.find(p => p.name.toLowerCase().trim() === testEmail.toLowerCase().trim());
    console.log("Checked after delete (should be undefined):", checked);
  }
}

run().catch(console.error);
