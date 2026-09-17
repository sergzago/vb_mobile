/**
 * Конфигурация базы данных
 *
 * Провайдер: 'pocketbase' — PocketBase (self-hosted).
 * Поддерживается только PocketBase.
 */

// ============================================================================
// ИМПОРТ УЧЕТНЫХ ДАННЫХ
// ============================================================================

// Для браузера — загружаем credentials из отдельного файла (подключается в HTML)
// Для Node.js — require('./credentials.js')
var CREDENTIALS = (typeof CREDENTIALS !== 'undefined') ? CREDENTIALS : { pocketbase: {} };

// ============================================================================
// ВЫБОР ПРОВАЙДЕРА БАЗЫ ДАННЫХ
// ============================================================================

var DB_CONFIG = {
  // Провайдер: только 'pocketbase'
  provider: 'pocketbase',

  // ============================================================================
  // POCKETBASE КОНФИГУРАЦИЯ (из credentials.js)
  // ============================================================================
  pocketbase: CREDENTIALS.pocketbase || {},

  // ============================================================================
  // НАЗВАНИЯ КОЛЛЕКЦИЙ
  // ============================================================================
  pocketbaseCollections: {
    VOLLEYBALL: 'volleyball1',
    MATCHES: 'matches1',
    USERS: 'scoreusers',
    AUTH_LOG: 'auth_log',
    TEMPLATES: 'templates1'
  },

  // Техническая коллекция для обычных пользователей приложения (не для бизнес-логики)
  pocketbaseAppUsersCollection: 'app_users',

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
    CLASSIC_TIEBREAK_POINTS_TO_WIN: 15
  },

  // ============================================================================
  // ПАРАМЕТРЫ АВТОРИЗАЦИИ
  // ============================================================================
  ENABLE_AUTH: 1, // 1 — включить, 0 — отключить
  SESSION_EXPIRY_DAYS: 3, // Срок жизни сессии в днях

  // ============================================================================
  // ЛОГИРОВАНИЕ АУТЕНТИФИКАЦИИ
  // ============================================================================
  // Таймаут (в секундах) ожидания ответа при входе в систему.
  // По истечении таймаута выводится ошибка и событие логируется.
  AUTH_LOGIN_TIMEOUT_SECONDS: 15,
  // Путь к файлу лога аутентификации (используется сервером, когда БД недоступна)
  AUTH_LOG_FILE: 'logs/auth_log.log',

  // ============================================================================
  // НАСТРОЙКИ ЛОГОТИПА
  // ============================================================================
  LOGO_FILE_NAME: 'logo_base64.txt',
  LOGO_BASE64: ''
};

// ============================================================================
// ОБРАТНАЯ СОВМЕСТИМОСТЬ — псевдонимы для старого кода
// ============================================================================

// Определяем коллекции (PocketBase)
DB_CONFIG.collections = DB_CONFIG.pocketbaseCollections;

var COLLECTIONS = DB_CONFIG.collections;
var VOLLEYBALL_COLLECTION = COLLECTIONS.VOLLEYBALL;
var MATCHES_COLLECTION = COLLECTIONS.MATCHES;
var USERS_COLLECTION = COLLECTIONS.USERS;
var TEMPLATES_COLLECTION = COLLECTIONS.TEMPLATES;
var GAME_CONSTANTS = DB_CONFIG.constants;
var ENABLE_AUTH = DB_CONFIG.ENABLE_AUTH;
var LOGO_FILE_NAME = DB_CONFIG.LOGO_FILE_NAME;
var LOGO_BASE64 = DB_CONFIG.LOGO_BASE64;

// ============================================================================
// ЭКСПОРТ ДЛЯ BACKEND (Node.js/CommonJS)
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  var fs = require('fs');
  var path = require('path');

  // Загружаем учетные данные для Node.js
  try {
    CREDENTIALS = require('../credentials.js');
  } catch (e) {
    console.warn('credentials.js не найден, используем пустые значения');
    CREDENTIALS = { pocketbase: {} };
  }

  // Обновляем DB_CONFIG после загрузки credentials
  DB_CONFIG.pocketbase = CREDENTIALS.pocketbase || {};

  try {
    LOGO_BASE64 = fs.readFileSync(path.join(__dirname, '..', LOGO_FILE_NAME), 'utf8').trim();
  } catch (e) {
    LOGO_BASE64 = '';
  }

  module.exports = {
    DB_CONFIG: DB_CONFIG,
    CREDENTIALS: CREDENTIALS,
    COLLECTIONS: COLLECTIONS,
    VOLLEYBALL_COLLECTION: VOLLEYBALL_COLLECTION,
    MATCHES_COLLECTION: MATCHES_COLLECTION,
    GAME_CONSTANTS: GAME_CONSTANTS,
    ENABLE_AUTH: ENABLE_AUTH,
    LOGO_BASE64: LOGO_BASE64,
    LOGO_FILE_NAME: LOGO_FILE_NAME
  };
}

// ============================================================================
// ЗАГРУЗКА ЛОГОТИПА (браузер)
// ============================================================================

function loadLogo(callback) {
  fetch(LOGO_FILE_NAME)
    .then(function(response) {
      if (response.ok) return response.text();
      throw new Error('Файл логотипа не найден');
    })
    .then(function(text) {
      LOGO_BASE64 = text.trim();
      DB_CONFIG.LOGO_BASE64 = LOGO_BASE64;
      if (callback) callback(LOGO_BASE64);
    })
    .catch(function(error) {
      console.error('Ошибка загрузки логотипа:', error);
      if (callback) callback('');
    });
}
