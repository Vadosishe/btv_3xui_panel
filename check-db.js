const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== App settings in database ===");
  const settings = await prisma.appSetting.findMany();
  for (const s of settings) {
    console.log(`Key: ${s.key}`);
    console.log(`Value: ${s.value}`);
    console.log("------------------------");
  }

  console.log("=== Clients count ===");
  const count = await prisma.client.count();
  console.log(`Total clients in DB: ${count}`);

  console.log("=== Templates count ===");
  const templates = await prisma.template.findMany();
  for (const t of templates) {
    console.log(`Template ID: ${t.id}, Name: ${t.name}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
