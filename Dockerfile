# Этап 1: Установка зависимостей
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Копируем файлы зависимостей
COPY package.json package-lock.json ./
RUN npm install

# Этап 2: Сборка приложения
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Отключаем телеметрию Next.js на этапе сборки
ENV NEXT_TELEMETRY_DISABLED=1

# Генерируем клиент Prisma
RUN npx prisma generate

# Строим проект
RUN npm run build

# Этап 3: Запуск приложения
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Копируем публичные файлы и статику
COPY --from=builder /app/public ./public

# Копируем результаты standalone сборки
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/*.js ./

# Копируем все node_modules для корректной работы Prisma CLI с правами nextjs
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Автоматически создаем БД при запуске, накатываем структуру Prisma и запускаем Next.js
CMD node scripts/db-init.js && node node_modules/prisma/build/index.js db push --accept-data-loss && node server.js
