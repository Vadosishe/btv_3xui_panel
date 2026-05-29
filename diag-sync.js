const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: node diag-sync.js <clientEmail>");
    console.log("Example: node diag-sync.js test@btv.vpn");
    process.exit(1);
  }

  const email = args[0].trim();
  console.log(`\n==========================================`);
  console.log(`Diagnosing Amnezia Sync for email: ${email}`);
  console.log(`==========================================\n`);

  // 1. Find Client in DB
  const client = await prisma.client.findUnique({
    where: { email },
    include: { template: true }
  });

  if (!client) {
    console.log(`[ERROR] Client with email '${email}' not found in Postgres database!`);
    process.exit(1);
  }

  console.log(`[OK] Client found:`);
  console.log(`  - ID: ${client.id}`);
  console.log(`  - Name: ${client.name}`);
  console.log(`  - Email: ${client.email}`);
  console.log(`  - Template ID: ${client.templateId}`);
  console.log(`  - Template Name: ${client.template ? client.template.name : 'NONE'}`);
  console.log(`  - Active Status: ${client.isActive}`);

  // 2. Load awg_servers
  const serversSetting = await prisma.appSetting.findUnique({
    where: { key: 'awg_servers' }
  });

  let servers = [];
  if (serversSetting && serversSetting.value) {
    servers = JSON.parse(serversSetting.value);
  }

  console.log(`\n[INFO] Registered Amnezia servers in DB: ${servers.length}`);
  servers.forEach(s => {
    console.log(`  - Server ID: ${s.id}`);
    console.log(`    Name: ${s.name}`);
    console.log(`    URL: ${s.apiUrl}`);
    console.log(`    Enabled: ${s.enabled}`);
  });

  if (servers.length === 0) {
    console.log(`[ERROR] No Amnezia servers registered in settings!`);
    process.exit(1);
  }

  // 3. Load template_awg_servers mapping
  const mappingSetting = await prisma.appSetting.findUnique({
    where: { key: 'template_awg_servers' }
  });

  let mapping = {};
  if (mappingSetting && mappingSetting.value) {
    mapping = JSON.parse(mappingSetting.value);
  }

  console.log(`\n[INFO] Template mapping in DB:`);
  console.log(JSON.stringify(mapping, null, 2));

  const assignedIds = mapping[client.templateId] || [];
  console.log(`\n[INFO] Assigned server IDs for client's template (${client.templateId}):`);
  console.log(JSON.stringify(assignedIds));

  const assignedServers = servers.filter(s => s.enabled && assignedIds.includes(s.id));
  console.log(`[INFO] Active assigned servers: ${assignedServers.length}`);
  assignedServers.forEach(s => {
    console.log(`  - ${s.name} (${s.apiUrl})`);
  });

  if (assignedServers.length === 0) {
    console.log(`\n[ERROR] No active Amnezia servers are assigned to this client's template!`);
    console.log(`[REMEDY] Please go to the "Templates" tab in the admin UI, edit the template "${client.template ? client.template.name : 'NONE'}", check the box for your Amnezia server, and click Save.`);
    process.exit(1);
  }

  // 4. Test actual sync
  console.log(`\n=== Testing Actual API Request to Amnezia ===`);
  const server = assignedServers[0];
  const cleanUrl = server.apiUrl.endsWith('/') ? server.apiUrl.slice(0, -1) : server.apiUrl;
  
  console.log(`Connecting to ${cleanUrl}...`);
  try {
    const loginRes = await fetch(`${cleanUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: server.apiPassword || '' }),
    });

    console.log(`Login Status: ${loginRes.status}`);
    const setCookie = loginRes.headers.get('set-cookie');
    let sessionCookie = '';
    if (setCookie) {
      const match = setCookie.match(/connect\.sid=[^;]+/);
      if (match) {
        sessionCookie = match[0];
        console.log(`Obtained Cookie: ${sessionCookie}`);
      }
    }

    if (!sessionCookie) {
      console.log(`[ERROR] Failed to obtain session cookie!`);
      process.exit(1);
    }

    // Try to create peer
    console.log(`\nCreating peer '${email}' on Amnezia...`);
    const createRes = await fetch(`${cleanUrl}/api/wireguard/client`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({ name: email })
    });

    console.log(`Creation Response Status: ${createRes.status}`);
    const bodyText = await createRes.text();
    console.log(`Creation Response Body: ${bodyText}`);

  } catch (err) {
    console.error(`[ERROR] Network request failed:`, err.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
