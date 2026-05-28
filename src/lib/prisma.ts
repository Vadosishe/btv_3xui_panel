import { PrismaClient } from '@prisma/client';
import 'pg'; // Принудительный импорт для копирования pg в Docker standalone сборку
import { startTelegramPolling } from './telegram-polling';

const prismaClientSingleton = () => {
  return new PrismaClient();
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

// Запускаем фоновый опрос Telegram-бота в неблокирующем режиме
try {
  startTelegramPolling();
} catch (e) {
  console.error('Failed to auto-start Telegram polling inside prisma client:', e);
}
