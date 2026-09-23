/**
 * Конфигурация базы данных для сервера
 *
 * Поддерживается только PocketBase.
 *
 * ВАЖНО: pocketbase@0.21.0 — ESM-модуль.
 * Для работы с CommonJS используется динамический import().
 *
 * REGRESSION-PROTECTION:
 * Если PocketBase недоступен (например, не запущен или нет доступа к ghcr.io),
 * функция initializeDb() НЕ бросает ошибку, а возвращает объект с
 * dbInstance.degraded = true. Это позволяет API-серверу и Swagger UI
 * работать в режиме «только документация + статика» без БД.
 */

// Приоритет: .env → db-config.js → pocketbase
let provider = process.env.DB_PROVIDER;
if (!provider || provider !== 'pocketbase') {
  try {
    const { DB_CONFIG } = require('../../../js/db-config');
    provider = DB_CONFIG.provider || 'pocketbase';
  } catch {
    provider = 'pocketbase';
  }
}

let dbInstance = null;

/**
 * Аутентификация как приложение (app_user)
 */
async function authenticateWithAppUser(client) {
  let userEmail, userPassword;
  try {
    const creds = require('../../../credentials.js');
    userEmail = creds.pocketbase?.user_email;
    userPassword = creds.pocketbase?.user_password;
  } catch {}

  if (userEmail && userPassword) {
    await client.collection('app_users').authWithPassword(userEmail, userPassword);
    console.log('✅ PocketBase authenticated as app_user');
  } else {
    console.log('⚠️ PocketBase connected without auth (no app_user credentials)');
  }
}

/**
 * Инициализация соединения с БД
 * @returns {Promise<{db: object, admin: object|null, client: object|null, degraded: boolean}>}
 *         degraded=true если БД недоступна (API работает в ограниченном режиме)
 */
async function initializeDb() {
  if (dbInstance) return dbInstance;

  if (provider !== 'pocketbase') {
    console.error(`❌ Unsupported DB provider: ${provider}. Only 'pocketbase' is supported.`);
    // Graceful degradation: не летим, а работаем без БД
    dbInstance = {
      provider,
      db: null,
      admin: null,
      client: null,
      degraded: true,
      error: `Unsupported DB provider: ${provider}`,
    };
    return dbInstance;
  }

  // Динамический import для ESM-модуля pocketbase
  let PocketBase, client;
  try {
    const PocketBaseModule = await import('pocketbase');
    PocketBase = PocketBaseModule.default;
  } catch (importError) {
    console.error('❌ Failed to import pocketbase module:', importError.message);
    dbInstance = {
      provider: 'pocketbase',
      db: null,
      admin: null,
      client: null,
      degraded: true,
      error: `Cannot import pocketbase: ${importError.message}`,
    };
    return dbInstance;
  }

  // Приоритет: .env → credentials.js (только абсолютный URL) → адрес в docker-сети
  let url = process.env.POCKETBASE_URL;
  let adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
  let adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;

  if (!url) {
    try {
      const creds = require('../../../credentials.js');
      // '/pb/' и прочие относительные пути — конфиг браузера, серверу не годятся
      if (creds.pocketbase && creds.pocketbase.url && !creds.pocketbase.url.startsWith('/')) {
        url = creds.pocketbase.url;
        console.log('ℹ️ PocketBase URL loaded from credentials.js');
      }
    } catch {}
  }

  // Внутреннее подключение к БД: имя сервиса в docker-сети compose
  url = url || 'http://pocketbase:8090';
  adminEmail = adminEmail || 'admin@example.com';
  adminPassword = adminPassword || '';

  try {
    client = new PocketBase(url);

    // Авторизуемся как админ для серверных операций
    if (adminEmail && adminPassword) {
      try {
        await client.admins.authWithPassword(adminEmail, adminPassword);
        console.log('✅ PocketBase admin authenticated');
      } catch {
        console.log('⚠️ PocketBase admin auth failed, trying app_users...');
        await authenticateWithAppUser(client);
      }
    } else {
      await authenticateWithAppUser(client);
    }

    dbInstance = {
      provider: 'pocketbase',
      db: null,
      admin: null,
      client,
      degraded: false,
      error: null,
    };
  } catch (error) {
    console.error('❌ PocketBase initialization error:', error.message);
    // Graceful degradation: не летим, а работаем без БД
    dbInstance = {
      provider: 'pocketbase',
      db: null,
      admin: null,
      client: null,
      degraded: true,
      error: error.message,
    };
  }

  return dbInstance;
}

/**
 * Получить текущий инстанс БД
 */
function getDb() {
  return dbInstance;
}

module.exports = {
  initializeDb,
  getDb,
  provider,
};
