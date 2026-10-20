/**
 * Конфигурация базы данных (универсальная: браузер + Node.js)
 *
 * Браузер:
 *   - подключается в HTML ДО js/auth.js и js/mobile.js
 *   - DB_CONFIG собирается из глобального объекта CREDENTIALS (credentials.js)
 *   - ENABLE_AUTH и DB_CONFIG экспортируются в window
 *
 * Node.js (server/src/config/db.js, services/dbAdapter.js):
 *   - приоритет настроек: переменные окружения (.env) → credentials.js → этот файл
 *
 * Используется сервером для:
 *   - настройки пути к файлу лога авторизации (AUTH_LOG_FILE)
 *   - названий коллекций PocketBase и констант матча
 */

// ============================================================================
// ИМПОРТ УЧЕТНЫХ ДАННЫХ
// ============================================================================

// Для браузера — credentials.js подключается в HTML перед этим файлом
// (глобальная переменная CREDENTIALS уже определена).
// Для Node.js — require('../credentials.js')
var _CREDENTIALS = (typeof CREDENTIALS !== 'undefined' && CREDENTIALS)
  ? CREDENTIALS
  : { server: {}, pocketbase: {} };

// В Node.js догружаем credentials.js, если их нет (например, файл подключён напрямую)
if (typeof module !== 'undefined' && module.exports && (!_CREDENTIALS.pocketbase || !_CREDENTIALS.pocketbase.url)) {
  try {
    _CREDENTIALS = require('../credentials.js');
  } catch (e) {
    console.warn('credentials.js не найден, используем пустые значения');
  }
}

// Безопасное чтение переменных окружения (в браузере process не определён)
function _env(name) {
  if (typeof process !== 'undefined' && process && process.env) {
    return process.env[name];
  }
  return undefined;
}

/**
 * Режим авторизации: 1 — вход обязателен (по умолчанию), 0 — гостевой режим.
 *
 * Приоритет:
 *   1) переменная окружения ENABLE_AUTH (сервер: .env / docker-compose);
 *   2) credentials.js → auth.enabled (единый источник для браузера и сервера);
 *   3) 1 — авторизация включена.
 *
 * В браузере process.env недоступен, поэтому для фронтенда значение берётся
 * из credentials.js (auth.enabled) — этот файл подключается в HTML до db-config.js.
 */
function _resolveEnableAuth() {
  var envValue = _env('ENABLE_AUTH');
  if (envValue !== undefined && envValue !== '') {
    return Number(envValue) === 0 ? 0 : 1;
  }
  if (_CREDENTIALS.auth && _CREDENTIALS.auth.enabled !== undefined && _CREDENTIALS.auth.enabled !== null) {
    return Number(_CREDENTIALS.auth.enabled) === 0 ? 0 : 1;
  }
  return 1;
}

/**
 * Конфигурация базы данных
 */
const DB_CONFIG = {
  // Включение/отключение авторизации
  // 1 — авторизация включена (по умолчанию), 0 — режим гостя без входа
  // (в гостевом режиме доступны создание/подключение игры и шаблоны)
  ENABLE_AUTH: _resolveEnableAuth(),

  // Провайдер базы данных (pocketbase | firebase)
  // Переопределяется переменной окружения DB_PROVIDER
  provider: _env('DB_PROVIDER') || 'pocketbase',

  // Учетные данные провайдеров (из credentials.js)
  server: _CREDENTIALS.server || {},
  pocketbase: _CREDENTIALS.pocketbase || {},

  // URL PocketBase (используется только если provider=pocketbase)
  // Переопределяется переменной окружения POCKETBASE_URL; для браузера
  // берётся префикс из credentials.js ('<APP_PREFIX>pb/', напр. '/vb/pb/' —
  // прокси nginx → pocketbase:8090), фоллбэк — docker-сеть (внутри неё PB
  // слушает ВСЕГДА 8090, см. dockerfile.pb; это НЕ хостовой POCKETBASE_PORT
  // из .env — публикация 0.0.0.0:8091->8090).
  pocketbaseUrl: _env('POCKETBASE_URL') || (_CREDENTIALS.pocketbase && _CREDENTIALS.pocketbase.url) || 'http://pocketbase:8090',

  // ============================================================================
  // НАЗВАНИЯ КОЛЛЕКЦИЙ POCKETBASE
  // ============================================================================
  collections: {
    VOLLEYBALL: _env('POCKETBASE_VOLLEYBALL_COLLECTION') || 'volleyball',
    MATCHES: _env('POCKETBASE_MATCHES_COLLECTION') || 'matches',
    USERS: _env('POCKETBASE_USERS_COLLECTION') || 'scoreusers',
    // Коллекция шаблонов оформления табло (используется DB.templates)
    TEMPLATES: _env('POCKETBASE_TEMPLATES_COLLECTION') || 'templates',
    AUTH_LOG: 'auth_log',
  },

  // ============================================================================
  // КОНСТАНТЫ МАТЧА
  // ============================================================================
  constants: {
    BEACH_SETS_TO_WIN: 2,
    BEACH_MAX_SETS: 3,
    CLASSIC_POINTS_TO_WIN: 25,
    CLASSIC_SETS_TO_WIN: 3,
    CLASSIC_MAX_SETS: 5,
    CLASSIC_SETS_TO_WIN_TWO: 2,
    CLASSIC_MAX_SETS_TWO: 3,
    CLASSIC_TIEBREAK_POINTS_TO_WIN: 15,
  },
};

// ============================================================================
// СЕРВЕРНЫЕ НАСТРОЙКИ (только Node.js — в браузере path недоступен)
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  const path = require('path');
  // Путь к файлу лога авторизации
  // По умолчанию: ./logs/auth.log (относительно корня проекта)
  DB_CONFIG.AUTH_LOG_FILE = _env('AUTH_LOG_FILE') || path.join(__dirname, '..', 'logs', 'auth.log');
}

// ============================================================================
// ОБРАТНАЯ СОВМЕСТИМОСТЬ — псевдонимы для старого кода (dbAdapter.js, common.js и др.)
// ============================================================================
const VOLLEYBALL_COLLECTION = DB_CONFIG.collections.VOLLEYBALL;
const MATCHES_COLLECTION = DB_CONFIG.collections.MATCHES;
const USERS_COLLECTION = DB_CONFIG.collections.USERS;
const GAME_CONSTANTS = DB_CONFIG.constants;

// Глобальные переменные для фронтенда (js/auth.js и js/mobile.js проверяют ENABLE_AUTH;
// этот файл подключается в браузере ДО auth.js/mobile.js)
if (typeof window !== 'undefined') {
  window.ENABLE_AUTH = DB_CONFIG.ENABLE_AUTH;
  window.DB_CONFIG = DB_CONFIG;
}

// Экспорт для Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DB_CONFIG,
    VOLLEYBALL_COLLECTION,
    MATCHES_COLLECTION,
    USERS_COLLECTION,
    GAME_CONSTANTS,
    ENABLE_AUTH: DB_CONFIG.ENABLE_AUTH,
  };
}
