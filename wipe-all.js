const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=================================================");
  console.log("WARNING: This script will WIPE all clients from");
  console.log("PostgreSQL and delete them from the 3XUI panel!");
  console.log("=================================================\n");

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  readline.question('Are you absolutely sure you want to proceed? Type "YES" to continue: ', async (answer) => {
    if (answer.trim() !== 'YES') {
      console.log('Aborted.');
      readline.close();
      process.exit(0);
    }

    try {
      // 1. Fetch settings to contact 3XUI
      const settings = await prisma.appSetting.findMany();
      const settingsMap = new Map(settings.map(s => [s.key, s.value]));

      const scheme = settingsMap.get('xui_scheme') || 'http';
      const address = settingsMap.get('xui_address') || 'localhost';
      const port = settingsMap.get('xui_port') || '2053';
      let basePath = settingsMap.get('xui_base_path') || '/';
      const apiToken = settingsMap.get('xui_api_token') || '';

      if (!apiToken) {
        console.log("No 3XUI API token found in database. Wiping only Postgres database...");
      } else {
        if (!basePath.startsWith('/')) basePath = '/' + basePath;
        if (basePath.endsWith('/') && basePath.length > 1) basePath = basePath.slice(0, -1);
        const apiUrl = `${scheme}://${address}:${port}${basePath === '/' ? '' : basePath}`;

        // Get inbounds to delete clients from
        console.log(`Fetching inbounds from 3XUI (${apiUrl})...`);
        const inboundsRes = await fetch(`${apiUrl}/panel/api/inbounds/list`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          }
        });

        if (inboundsRes.ok) {
          const data = await inboundsRes.json();
          if (data && data.success && Array.isArray(data.obj)) {
            const inbounds = data.obj;
            console.log(`Found ${inbounds.length} inbounds.`);

            // Get all clients from DB to delete them
            const clients = await prisma.client.findMany();
            console.log(`Found ${clients.length} clients in local database.`);

            for (const client of clients) {
              console.log(`Deleting client ${client.email} from 3XUI inbounds...`);
              let inboundIds = [];
              try {
                // Try from template
                const template = await prisma.template.findUnique({ where: { id: client.templateId } });
                if (template) inboundIds = JSON.parse(template.inboundIdsJson || '[]');
              } catch (e) {}

              // Also delete from all inbounds just in case
              const allInboundIds = Array.from(new Set([...inboundIds, ...inbounds.map(i => i.id)]));

              for (const inboundId of allInboundIds) {
                // Delete by email
                try {
                  await fetch(`${apiUrl}/panel/api/inbounds/${inboundId}/delClientByEmail/${client.email}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiToken}` }
                  });
                } catch (e) {}
                
                // Delete by UUID
                try {
                  await fetch(`${apiUrl}/panel/api/inbounds/${inboundId}/delClient/${client.vpnUuid}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiToken}` }
                  });
                } catch (e) {}
              }
            }

            // Also delete groups
            const companies = await prisma.company.findMany();
            for (const company of companies) {
              console.log(`Deleting group ${company.name} from 3XUI...`);
              try {
                await fetch(`${apiUrl}/panel/api/clients/groups/delete`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiToken}`
                  },
                  body: JSON.stringify({ name: company.name })
                });
              } catch (e) {}
            }
          }
        }
      }

      // 2. Wipe Postgres tables
      console.log('Cleaning up database tables...');
      await prisma.auditLog.deleteMany();
      await prisma.vpnRequest.deleteMany();
      await prisma.client.deleteMany();
      await prisma.company.deleteMany();
      await prisma.template.deleteMany();

      console.log('\n✅ All data wiped successfully from Postgres and 3XUI!');
    } catch (err) {
      console.error('Error during wipe process:', err);
    } finally {
      readline.close();
      await prisma.$disconnect();
    }
  });
}

main().catch(console.error);
