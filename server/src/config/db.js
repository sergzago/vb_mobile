/**
 * Конфигурация базы данных для сервера
 *
 * Поддерживается только PocketBase.
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
 * @returns {Promise<{db: object, admin: object|null, client: object|null}>}
 */
async function initializeDb() {
  if (dbInstance) return dbInstance;

  if (provider !== 'pocketbase') {
    throw new Error(`Unsupported DB provider: ${provider}. Only 'pocketbase' is supported.`);
  }

  {
    const PocketBase = require('pocketbase').default;

    // Приоритет: .env → credentials.js → localhost:8090
    let url = process.env.POCKETBASE_URL;
    let adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
    let adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;

    if (!url) {
      try {
        const creds = require('../../../credentials.js');
        if (creds.pocketbase && creds.pocketbase.url) {
          url = creds.pocketbase.url;
          console.log('ℹ️ PocketBase URL loaded from credentials.js');
        }
      } catch {}
    }

    url = url || 'http://localhost:8090';
    adminEmail = adminEmail || 'admin@example.com';
    adminPassword = adminPassword || '';

    try {
      const client = new PocketBase(url);

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
      };
    } catch (error) {
      console.error('❌ PocketBase initialization error:', error.message);
      throw error;
    }
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
