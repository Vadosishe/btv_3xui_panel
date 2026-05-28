const { Client } = require('pg');

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn('DATABASE_URL не установлена. Пропускаем автосоздание БД.');
    process.exit(0);
  }

  // Регулярное выражение для парсинга стандартного URL Postgres:
  // postgresql://n8n_user:P0stgr3s!Pass456@postgres:5432/vpn_panel_db?schema=public
  const regex = /^(?:postgresql|postgres):\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?#]+)/;
  const match = dbUrl.match(regex);
  
  if (!match) {
    console.warn('Строка DATABASE_URL не соответствует стандартному формату postgresql. Пропускаем автосоздание БД.');
    process.exit(0);
  }

  const [, user, password, host, port, targetDb] = match;

  // Если целевая БД совпадает со стандартными, создавать ничего не нужно
  if (targetDb === 'n8n' || targetDb === 'postgres') {
    console.log(`Целевая база данных "${targetDb}" является стандартной. Автосоздание пропущено.`);
    process.exit(0);
  }

  // Временно подключаемся к существующей на вашем сервере базе 'n8n' для выполнения запроса
  const tempConnectionUrl = `postgresql://${user}:${password}@${host}:${port}/n8n`;
  
  console.log(`Подключаемся к базе n8n на ${host}:${port} для проверки существования БД "${targetDb}"...`);
  
  const client = new Client({
    connectionString: tempConnectionUrl,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();

    // Попытка обновить версию локали для template1, чтобы исправить ошибку Postgres
    try {
      await client.query('ALTER DATABASE template1 REFRESH COLLATION VERSION');
      console.log('Локаль template1 успешно обновлена.');
    } catch (localeErr) {
      // Игнорируем ошибку прав, если пользователь не суперпользователь
    }

    // Проверяем, существует ли целевая база данных
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);

    if (res.rows.length === 0) {
      console.log(`База данных "${targetDb}" не найдена. Создаем её...`);
      
      try {
        await client.query(`CREATE DATABASE "${targetDb}"`);
        console.log(`УСПЕХ: База данных "${targetDb}" успешно создана!`);
      } catch (createErr) {
        // Если стандартное создание упало из-за локали, попробуем обновить локаль текущей БД и повторить
        try {
          await client.query('ALTER DATABASE postgres REFRESH COLLATION VERSION');
        } catch (e) {}
        
        throw createErr;
      }
    } else {
      console.log(`База данных "${targetDb}" уже существует. Дополнительных действий не требуется.`);
    }
  } catch (err) {
    console.warn(`[ВНИМАНИЕ] Не удалось автоматически создать базу данных "${targetDb}":`, err.message);
    console.warn('----------------------------------------------------------------------');
    console.warn('СОВЕТ: Если у вас ошибка несовместимости локали (collation mismatch),');
    console.warn('вы можете использовать существующую БД "n8n" в изолированной схеме!');
    console.warn('Для этого просто измените DATABASE_URL в docker-compose.yml на:');
    console.warn('DATABASE_URL=postgresql://n8n_user:P0stgr3s!Pass456@postgres:5432/n8n?schema=vpn_panel');
    console.warn('Панель будет работать в изолированном пространстве vpn_panel внутри базы n8n и ничего не сломает.');
    console.warn('----------------------------------------------------------------------');
  } finally {
    try {
      await client.end();
    } catch (e) {}
  }
}

main().then(() => process.exit(0));
