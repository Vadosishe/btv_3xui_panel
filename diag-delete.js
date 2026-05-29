const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = 'test_e74cb5d0@btv.vpn';
  console.log(`\n==========================================`);
  console.log(`Diagnosing Deletion for email: ${email}`);
  console.log(`==========================================\n`);

  // 1. Find Client in DB
  const client = await prisma.client.findUnique({
    where: { email },
    include: { template: true }
  });

  if (!client) {
    console.log(`[ERROR] Client with email '${email}' not found in DB!`);
    process.exit(1);
  }

  console.log(`[OK] Client found in DB. Template ID: ${client.templateId}`);

  // Load awg_servers
  const serversSetting = await prisma.appSetting.findUnique({
    where: { key: 'awg_servers' }
  });
  let servers = [];
  if (serversSetting && serversSetting.value) {
    servers = JSON.parse(serversSetting.value);
  }
  console.log(`Registered servers: ${servers.length}`);

  // Test session login
  const server = servers[0];
  const cleanUrl = server.apiUrl.endsWith('/') ? server.apiUrl.slice(0, -1) : server.apiUrl;

  try {
    console.log(`Logging in to Amnezia...`);
    const loginRes = await fetch(`${cleanUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: server.apiPassword || '' }),
    });

    const setCookie = loginRes.headers.get('set-cookie');
    let cookie = '';
    if (setCookie) {
      cookie = setCookie.match(/connect\.sid=[^;]+/)[0];
    }
    console.log(`Login Status: ${loginRes.status}, Cookie: ${cookie}`);

    // Fetch peers
    console.log(`Fetching peers via Nuxt API GET /api/wireguard/client...`);
    const getRes = await fetch(`${cleanUrl}/api/wireguard/client`, {
      headers: { 'Cookie': cookie, 'Accept': 'application/json' }
    });
    console.log(`GET Status: ${getRes.status}`);
    const peers = await getRes.json();
    console.log(`Total peers: ${peers.length}`);

    const peer = peers.find(p => p.name.toLowerCase().trim() === email.toLowerCase().trim());
    if (peer) {
      console.log(`Found peer on server:`, peer);
      console.log(`Deleting peer via Nuxt API DELETE /api/wireguard/client/${peer.id}...`);
      const delRes = await fetch(`${cleanUrl}/api/wireguard/client/${peer.id}`, {
        method: 'DELETE',
        headers: { 'Cookie': cookie, 'Accept': 'application/json' }
      });
      console.log(`DELETE Response Status: ${delRes.status}`);
      console.log(`DELETE Response Body: ${await delRes.text()}`);
    } else {
      console.log(`Peer not found on server.`);
    }

  } catch (err) {
    console.error(`[ERROR] Network error:`, err.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
