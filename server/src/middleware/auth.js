/**
 * Middleware для проверки авторизации и ролей пользователей
 * Работает только с PocketBase
 */

/**
 * Декодирует и валидирует JWT (header + payload) без верификации подписи.
 * Проверяет структуру заголовка и обязательные поля payload.
 */
function decodeAndValidateJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  // Валидация заголовка
  let header;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header.alg || !header.typ || header.typ !== 'JWT') return null;

  // Валидация payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  return payload;
}

/**
 * Middleware для проверки аутентификации пользователя
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Требуется авторизация. Пожалуйста, войдите в систему.'
    });
  }

  const token = authHeader.split('Bearer ')[1];
  const dbConfig = req.app.locals.db;

  try {
    if (dbConfig.provider !== 'pocketbase') {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Unsupported database provider. Only PocketBase is supported.'
      });
    }

    {
      const payload = decodeAndValidateJwt(token);

      if (!payload || !payload.id || !payload.exp || payload.type !== 'auth') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Неверный или истекший токен авторизации.'
        });
      }

      // Проверка срока действия
      if (Date.now() >= payload.exp * 1000) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Токен авторизации истёк.'
        });
      }

      req.user = {
        uid: payload.id,
        email: '',
        role: 'user',
        claims: { role: 'user', admin: false }
      };
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Неверный или истекший токен авторизации.'
    });
  }
}

/**
 * Middleware для проверки роли администратора
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Требуется авторизация.'
    });
  }

  const isAdmin = req.user.claims?.admin === true || req.user.role === 'admin';

  if (!isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Доступ запрещен. Требуются права администратора.'
    });
  }

  next();
}

/**
 * Middleware для проверки роли (гибкая проверка)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Требуется авторизация.'
      });
    }

    const userRole = req.user.claims?.role || req.user.role || 'user';

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Доступ запрещен. Требуются права: ${allowedRoles.join(' или ')}.`
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireRole
};