/**
 * Маршруты для аутентификации
 * Работает только с PocketBase
 *
 * Управление пользователями осуществляется через:
 * - админ-панель мобильного интерфейса (вкладка «Админ»)
 * - PocketBase Admin Dashboard (/_/)
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

function verifyPasswordServer(password, stored) {
  const parts = stored.split(':');
  const salt = Buffer.from(parts[0], 'hex');
  const hash = parts[1];
  return new Promise(function(resolve, reject) {
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST, function(err, derived) {
      if (err) return reject(err);
      resolve(derived.toString('hex') === hash);
    });
  });
}

const USERS_COLLECTION = process.env.POCKETBASE_USERS_COLLECTION || 'scoreusers';

let pbReaderClient = null;

async function getPbReaderClient() {
  if (pbReaderClient) return pbReaderClient;

  const PocketBase = require('pocketbase').default;
  let pbUrl = process.env.POCKETBASE_URL;
  if (!pbUrl) {
    try {
      const creds = require('../../../credentials.js');
      if (creds.pocketbase && creds.pocketbase.url) pbUrl = creds.pocketbase.url;
    } catch {}
  }
  pbUrl = pbUrl || 'http://localhost:8090';

  let userEmail, userPassword;
  try {
    const creds = require('../../../credentials.js');
    userEmail = creds.pocketbase?.user_email;
    userPassword = creds.pocketbase?.user_password;
  } catch {}

  if (!userEmail || !userPassword) return null;

  pbReaderClient = new PocketBase(pbUrl);
  try {
    await pbReaderClient.collection('app_users').authWithPassword(userEmail, userPassword);
  } catch {
    pbReaderClient = null;
  }
  return pbReaderClient;
}

async function getPbUserById(userId) {
  const client = await getPbReaderClient();
  if (!client) return null;
  try {
    return await client.collection(USERS_COLLECTION).getOne(userId);
  } catch {
    return null;
  }
}

/**
 * POST /api/auth/login
 * Войти по username/email и паролю, получить токен
 */
router.post('/login', async (req, res) => {
  try {
    const { identity, password } = req.body;

    if (!identity || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Требуется identity и password'
      });
    }

    const dbConfig = req.app.locals.db;

    if (dbConfig.provider !== 'pocketbase') {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Unsupported database provider. Only PocketBase is supported.'
      });
    }

    {
      // PocketBase: авторизуемся через коллекцию scoreusers
      // Создаём отдельный клиент БЕЗ admin-сессии для user-auth,
      // чтобы токен админа не конфликтовал с авторизацией пользователя
      const PocketBase = require('pocketbase').default;
      let pbUrl = process.env.POCKETBASE_URL;
      if (!pbUrl) {
        try {
          const creds = require('../../../credentials.js');
          if (creds.pocketbase && creds.pocketbase.url) pbUrl = creds.pocketbase.url;
        } catch {}
      }
      pbUrl = pbUrl || 'http://localhost:8090';
      const userClient = new PocketBase(pbUrl);
      let authData;

      // Пробуем войти по username (как делает фронтенд — сначала username, потом email)
      try {
        const username = identity.includes('@') ? identity.split('@')[0].toLowerCase() : identity.toLowerCase();
        authData = await userClient.collection(USERS_COLLECTION).authWithPassword(username, password);
      } catch {
        const email = identity.includes('@') ? identity.toLowerCase() : `${identity.toLowerCase()}@volleyball.local`;
        authData = await userClient.collection(USERS_COLLECTION).authWithPassword(email, password);
      }

      res.json({
        token: authData.token,
        refreshToken: authData.token, // PocketBase использует один токен
        expiresIn: 604800, // 7 дней (стандарт PocketBase)
        user: {
          uid: authData.record.id,
          email: authData.record.email,
          username: authData.record.username || authData.record.email.split('@')[0],
          role: authData.record.role || 'user',
          displayName: authData.record.name || authData.record.username || identity
        }
      });

    }
  } catch (error) {
    console.error('Login error:', error.message);

    let message = 'Неверные учётные данные';
    if (error.message?.includes('Failed to authenticate')) {
      message = 'Пользователь не найден или неверный пароль';
    }

    res.status(401).json({
      error: 'Unauthorized',
      message
    });
  }
});

/**
 * GET /api/auth/me
 * Получить информацию о текущем пользователе
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const dbConfig = req.app.locals.db;
    let user = {
      uid: req.user.uid,
      email: req.user.email,
      role: req.user.role,
      claims: req.user.claims
    };

    if (dbConfig.provider === 'pocketbase' && !user.email) {
      const record = await getPbUserById(req.user.uid);
      if (record) {
        user.email = record.email || '';
        user.role = record.role || 'user';
        user.claims = { role: user.role, admin: user.role === 'admin' };
      }
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/token
 * Получить информацию о текущем токене
 */
router.post('/token', requireAuth, async (req, res) => {
  try {
    const dbConfig = req.app.locals.db;
    let user = {
      uid: req.user.uid,
      email: req.user.email,
      role: req.user.role
    };

    if (dbConfig.provider === 'pocketbase' && !user.email) {
      const record = await getPbUserById(req.user.uid);
      if (record) {
        user.email = record.email || '';
        user.role = record.role || 'user';
      }
    }

    res.json({
      message: 'Используйте токен из заголовка Authorization',
      user
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/update-password
 * Смена пароля пользователя (PocketBase — обновление записи scoreusers)
 */
router.post('/update-password', requireAuth, async (req, res) => {
  try {
    const { uid, password } = req.body;

    if (!uid || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Требуется uid и password'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Пароль должен быть минимум 8 символов'
      });
    }

    const dbConfig = req.app.locals.db;

    if (dbConfig.provider !== 'pocketbase') {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Unsupported database provider. Only PocketBase is supported.'
      });
    }

    // Смена пароля выполняется администратором через PocketBase
    // (админ-панель мобильного интерфейса) или PocketBase Admin Dashboard
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Смена пароля через API недоступна. Используйте админ-панель (PocketBase Admin Dashboard).'
    });
  } catch (error) {
    console.error('Update password error:', error.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Не удалось обновить пароль: ' + error.message
    });
  }
});

/**
 * POST /api/auth/log
 * Запись события аутентификации в auth_log.
 * Сначала пробует записать в БД; если БД недоступна — пишет в файл.
 * Используется мобильной версией как fallback при недоступности БД.
 */
router.post('/log', async (req, res) => {
  const fs = require('fs');
  const path = require('path');

  const data = req.body || {};

  // Определяем IP-адрес клиента.
  // Если сервер стоит за прокси (nginx и т.п.), реальный IP приходит в x-forwarded-for.
  const forwarded = req.headers['x-forwarded-for'];
  const clientIp = (forwarded ? String(forwarded).split(',')[0].trim() : req.socket.remoteAddress || req.ip || '')
    .replace(/^::ffff:/, '');

  // Обогащаем данные события IP-адресом клиента (серверный источник — надёжнее клиентского)
  const logData = {
    ...data,
    ipAddress: clientIp
  };

  const logLine = JSON.stringify({
    ...logData,
    serverReceivedAt: new Date().toISOString()
  });

  // Путь к файлу лога (настраивается в db-config.js или по умолчанию)
  let logFilePath = 'logs/auth_log.log';
  try {
    const { DB_CONFIG } = require('../../../js/db-config');
    if (DB_CONFIG && DB_CONFIG.AUTH_LOG_FILE) {
      logFilePath = DB_CONFIG.AUTH_LOG_FILE;
    }
  } catch (e) {
    // используем значение по умолчанию
  }

  // Пытаемся записать в БД (auth_log коллекция)
  try {
    const dbConfig = req.app.locals.db;
    if (dbConfig && dbConfig.db) {
      const authLogCollection = process.env.AUTH_LOG_COLLECTION || 'auth_log';
      if (dbConfig.provider === 'pocketbase' && dbConfig.client) {
        await dbConfig.client.collection(authLogCollection).create(logData);
      }
      return res.json({ ok: true, target: 'db' });
    }
  } catch (dbError) {
    console.warn('[auth_log] БД недоступна, пишем в файл:', dbError.message);
  }

  // БД недоступна — пишем в файл
  try {
    const absolutePath = path.isAbsolute(logFilePath)
      ? logFilePath
      : path.join(__dirname, '..', '..', '..', logFilePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.appendFileSync(absolutePath, logLine + '\n', 'utf8');
    return res.json({ ok: true, target: 'file', file: logFilePath });
  } catch (fileError) {
    console.error('[auth_log] Не удалось записать в файл:', fileError.message);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Не удалось записать лог аутентификации'
    });
  }
});

module.exports = router;
