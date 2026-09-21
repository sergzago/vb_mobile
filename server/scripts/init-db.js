#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * ============================================================================
 * Инициализация структуры БД PocketBase (Volleyball Scoreboard)
 * ============================================================================
 * Создаёт в работающем PocketBase:
 *   1. коллекции приложения: volleyball, matches, scoreusers, auth_log,
 *      templates (структура берётся из pocketbase_collections_export.json),
 *      плюс служебную auth-коллекцию app_users;
 *   2. сервисного пользователя в app_users (credentials.js → user_email) —
 *      под ним API-сервер и фронтенд работают с БД;
 *   3. (опционально) администратора в scoreusers, если заданы переменные
 *      INIT_ADMIN_USERNAME / INIT_ADMIN_EMAIL / INIT_ADMIN_PASSWORD;
 *   4. самопроверку: авторизация сервисного пользователя и чтение коллекций —
 *      ровно то, что делает API-сервер при старте.
 *
 * Суперпользователя PocketBase скрипт НЕ создаёт (это делает CLI:
 * `docker exec volleyball_pb /pb/pocketbase superuser upsert EMAIL PASS`).
 * Обычно всё вместе выполняет scripts/init-pocketbase.sh.
 * Скрипт идемпотентен: существующие коллекции и пользователи не пересоздаются.
 *
 * Запуск внутри контейнера API (в образе есть node, внешних зависимостей нет):
 *   docker exec -i -e POCKETBASE_URL=http://pocketbase:8090 \
 *     volleyball_server node - < server/scripts/init-db.js
 *
 * Запуск на хосте (Node.js 18+):
 *   POCKETBASE_URL=http://localhost:8090 node server/scripts/init-db.js
 *
 * Переменные окружения:
 *   POCKETBASE_URL            - URL PocketBase (по умолчанию http://127.0.0.1:8090)
 *   POCKETBASE_ADMIN_EMAIL    - суперпользователь (по умолчанию admin@volleyball.local)
 *   POCKETBASE_ADMIN_PASSWORD - пароль суперпользователя
 *   APP_USER_EMAIL/PASSWORD   - переопределение сервисного пользователя
 *   PB_COLLECTIONS_FILE       - путь к pocketbase_collections_export.json
 *   INIT_ADMIN_*              - создание администратора в scoreusers
 *   INIT_RESET_APP_USER_PASSWORD=1 - сбросить пароль сервисного пользователя
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// АРГУМЕНТЫ КОМАНДНОЙ СТРОКИ
// ============================================================================
const opts = {
  collectionsFile: null,
  appUser: true,
  check: true,
  resetAppUserPassword: false,
  rules: 'auto', // auto | auth | guest | skip
};

(function parseArgs() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--collections') {
      opts.collectionsFile = argv[i + 1];
      i += 1;
    } else if (arg.indexOf('--collections=') === 0) {
      opts.collectionsFile = arg.slice('--collections='.length);
    } else if (arg === '--no-app-user') {
      opts.appUser = false;
    } else if (arg === '--no-check') {
      opts.check = false;
    } else if (arg === '--reset-app-user-password') {
      opts.resetAppUserPassword = true;
    } else if (arg === '--rules') {
      opts.rules = argv[i + 1];
      i += 1;
    } else if (arg.indexOf('--rules=') === 0) {
      opts.rules = arg.slice('--rules='.length);
    } else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      console.error('✗ Неизвестный аргумент: ' + arg + ' (см. --help)');
      process.exit(2);
    }
  }
  if (['auto', 'auth', 'guest', 'skip'].indexOf(opts.rules) === -1) {
    console.error('✗ --rules: допустимо auto | auth | guest | skip, получено: ' + opts.rules);
    process.exit(2);
  }
})();

function printHelp() {
  console.log([
    'Инициализация структуры БД PocketBase для Volleyball Scoreboard.',
    '',
    'Использование:',
    '  node server/scripts/init-db.js [опции]',
    '',
    'Опции:',
    '  --collections <путь>  файл с определениями коллекций',
    '                        (по умолчанию pb_schema.json, fallback —',
    '                        pocketbase_collections_export.json)',
    '  --rules <режим>       правила доступа: auto (по ENABLE_AUTH),',
    '                        auth (запись только для авторизованных),',
    '                        guest (полный публичный доступ),',
    '                        skip (не трогать правила)',
    '  --no-app-user         не создавать сервисного пользователя app_users',
    '  --reset-app-user-password  перезаписать пароль сервисного пользователя',
    '  --no-check            не выполнять самопроверку подключения',
    '  -h, --help            показать эту справку',
  ].join('\n'));
}

// ============================================================================
// КОНФИГУРАЦИЯ
// ============================================================================
// Имена коллекций в экспортах, которые приложение ожидает под другим именем
const RENAMED_COLLECTIONS = { templates1: 'templates' };

const CONFIG = {
  url: stripTrailingSlash(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090'),
  superuser: {
    email: process.env.POCKETBASE_ADMIN_EMAIL || 'admin@volleyball.local',
    password: process.env.POCKETBASE_ADMIN_PASSWORD || 'changeme_in_production',
  },
  appUser: opts.appUser ? resolveAppUser() : null,
  admin: resolveInitialAdmin(),
  collectionsFile: resolveCollectionsFile(),
};

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

/** Учётные данные сервисного пользователя: переменные окружения → credentials.js */
function resolveAppUser() {
  const envEmail = process.env.APP_USER_EMAIL || process.env.POCKETBASE_APP_USER_EMAIL;
  const envPassword = process.env.APP_USER_PASSWORD || process.env.POCKETBASE_APP_USER_PASSWORD;

  let credentials = null;
  const candidates = [
    '/usr/src/credentials.js',                          // монтируется в контейнер API
    path.join(__dirname, '..', '..', 'credentials.js'),  // корень репозитория
    path.join(process.cwd(), 'credentials.js'),
  ];
  for (const candidate of candidates) {
    try {
      credentials = require(candidate);
      break;
    } catch (err) {
      // пробуем следующий путь
    }
  }

  const pb = (credentials && credentials.pocketbase) || {};
  const email = envEmail || pb.user_email || '';
  const password = envPassword || pb.user_password || '';
  if (!email || !password) return null;

  return {
    email: email,
    password: password,
    username: String(email).split('@')[0] || 'app',
    name: 'App Service User',
  };
}

/** Опциональный администратор в scoreusers (только если заданы переменные INIT_ADMIN_*) */
function resolveInitialAdmin() {
  const username = process.env.INIT_ADMIN_USERNAME || '';
  const email = process.env.INIT_ADMIN_EMAIL || '';
  const password = process.env.INIT_ADMIN_PASSWORD || '';
  if (!username && !email && !password) return null;
  return {
    username: username || String(email || 'admin').split('@')[0],
    email: email || (username ? username + '@volleyball.local' : 'admin@volleyball.local'),
    password: password,
    name: process.env.INIT_ADMIN_NAME || 'Administrator',
    extra: { role: 'admin' },
  };
}

/** Путь к экспорту структуры: аргумент → env → известные места.
 *  Приоритет у pb_schema.json — актуальная структура (экспорт PocketBase):
 *  pocketbase_collections_export.json оставлен как fallback (старые БД). */
function resolveCollectionsFile() {
  const candidates = [
    opts.collectionsFile,
    process.env.PB_COLLECTIONS_FILE,
    '/tmp/pb_collections_export.json',                  // копирует scripts/init-pocketbase.sh
    path.join(__dirname, '..', '..', 'pb_schema.json'),
    path.join(process.cwd(), 'pb_schema.json'),
    path.join(__dirname, '..', '..', 'pocketbase_collections_export.json'),
    path.join(process.cwd(), 'pocketbase_collections_export.json'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (err) {
      // пробуем следующий путь
    }
  }
  return null;
}

// ============================================================================
// HTTP-ХЕЛПЕР (глобальный fetch, Node.js 18+)
// ============================================================================
async function request(method, urlPath, options) {
  const settings = options || {};
  const headers = { 'Content-Type': 'application/json' };
  if (settings.token) headers.Authorization = settings.token;

  let response;
  try {
    response = await fetch(CONFIG.url + urlPath, {
      method: method,
      headers: headers,
      body: settings.body === undefined ? undefined : JSON.stringify(settings.body),
    });
  } catch (err) {
    throw new Error('PocketBase недоступен по адресу ' + CONFIG.url + ' (' + err.message + ')');
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const details = data && data.data ? ' ' + JSON.stringify(data.data) : '';
    const message = (data && (data.message || data.error)) || response.statusText;
    const error = new Error(method + ' ' + urlPath + ' → HTTP ' + response.status + ': ' + message + details);
    error.status = response.status;
    throw error;
  }
  return data;
}

// ============================================================================
// ОПРЕДЕЛЕНИЯ КОЛЛЕКЦИЙ
// ============================================================================
/**
 * Служебная auth-коллекция сервисных пользователей приложения
 * (правила — из POCKETBASE_RULES.md: CRUD только у суперпользователя,
 * пользователь может менять свой профиль, авторизация разрешена всем).
 */
const APP_USERS_COLLECTION = {
  name: 'app_users',
  type: 'auth',
  system: false,
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
  authRule: '',
  manageRule: '@request.auth.id = id',
  passwordAuth: { enabled: true, identityFields: ['email'] },
  fields: [
    textField('username', { required: true, min: 3, max: 50 }),
    textField('name', { max: 100 }),
  ],
};

/** Поле-текст в формате PocketBase (плоские опции, как в экспорте) */
function textField(name, options) {
  const cfg = options || {};
  return {
    name: name,
    type: 'text',
    required: !!cfg.required,
    system: false,
    hidden: false,
    presentable: false,
    primaryKey: false,
    autogeneratePattern: '',
    pattern: '',
    min: cfg.min === undefined ? 0 : cfg.min,
    max: cfg.max === undefined ? 0 : cfg.max,
  };
}

/**
 * Приведение определения коллекции из экспорта к состоянию, пригодному для
 * создания в другом PocketBase:
 *   • переименование коллекций, которые приложение ждёт под другим именем
 *     (templates1 → templates);
 *   • удаление id коллекции — PocketBase сгенерирует новый (в экспорте id
 *     может совпадать с системными коллекциями, например scoreusers → _pb_users_auth_);
 *   • переименование индексов и замена таблицы в их SQL (индекс из экспорта
 *     scoreusers ссылался на таблицу users и конфликтовал с ней);
 *   • индексы по tokenKey/email пропускаются — PocketBase создаёт их сам.
 */
function normalizeCollection(definition) {
  const collection = JSON.parse(JSON.stringify(definition));

  if (RENAMED_COLLECTIONS[collection.name]) {
    const target = RENAMED_COLLECTIONS[collection.name];
    console.log('   • ' + collection.name + ' → ' + target + ' (имя, которое ожидает приложение)');
    collection.name = target;
  }

  delete collection.id;
  if (!Array.isArray(collection.fields)) collection.fields = [];

  collection.indexes = (collection.indexes || [])
    .filter(function (sql) {
      return !/`?(tokenKey|email)`?\s*[,)]/.test(sql);
    })
    .map(function (sql, index) {
      return sql
        .replace(/(CREATE\s+(?:UNIQUE\s+)?INDEX\s+)`?[^`\s]+`?/i, '$1idx_' + collection.name + '_' + (index + 1))
        .replace(/ON\s+`?[^`\s(]+`?/i, 'ON `' + collection.name + '`');
    });

  return collection;
}

/** Определения из pocketbase_collections_export.json + app_users */
function loadCollectionDefinitions() {
  if (!CONFIG.collectionsFile) {
    throw new Error(
      'не найден pocketbase_collections_export.json — укажите путь через --collections или PB_COLLECTIONS_FILE'
    );
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG.collectionsFile, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.collections || [];
  console.log('▸ Определения коллекций: ' + CONFIG.collectionsFile);

  const definitions = list.map(normalizeCollection);
  if (!definitions.some(function (c) { return c.name === 'app_users'; })) {
    definitions.push(normalizeCollection(APP_USERS_COLLECTION));
  }
  return definitions;
}

// ============================================================================
// ШАГИ ИНИЦИАЛИЗАЦИИ
// ============================================================================
async function authSuperuser() {
  try {
    const result = await request('POST', '/api/collections/_superusers/auth-with-password', {
      body: { identity: CONFIG.superuser.email, password: CONFIG.superuser.password },
    });
    console.log('✅ Суперпользователь аутентифицирован: ' + CONFIG.superuser.email);
    return result.token;
  } catch (err) {
    console.error('✗ Не удалось войти суперпользователем ' + CONFIG.superuser.email + ': ' + err.message);
    console.error('  Создайте суперпользователя в контейнере PocketBase:');
    console.error('    docker exec volleyball_pb /pb/pocketbase superuser upsert ' +
      CONFIG.superuser.email + ' <пароль>');
    throw err;
  }
}

async function listCollections(token) {
  const result = await request('GET', '/api/collections?perPage=200', { token: token });
  const byName = new Map();
  (result.items || []).forEach(function (collection) {
    byName.set(collection.name, collection);
  });
  return byName;
}

async function ensureCollections(token, definitions) {
  const existing = await listCollections(token);
  console.log('\n▸ Коллекции в БД: ' + (Array.from(existing.keys()).join(', ') || '(нет)'));

  const failures = [];
  let created = 0;
  let skipped = 0;

  for (const definition of definitions) {
    if (existing.has(definition.name)) {
      // Коллекция уже есть — доводим схему: добавляем поля, которых не хватает
      // (в старых БД могут отсутствовать новые поля, например show/timeout_active).
      const live = existing.get(definition.name);
      const liveNames = new Set((live.fields || []).map(function (f) { return f.name; }));
      const missing = (definition.fields || []).filter(function (f) { return !liveNames.has(f.name); });
      if (missing.length === 0) {
        console.log('   ⊘ ' + definition.name + ' — уже существует (схема актуальна)');
      } else {
        try {
          const mergedFields = (live.fields || []).concat(missing);
      // Выравнивание типов: если поле есть в live, но тип отличается от схемы
      // (например templates.logo_base64 text → editor), берём определение из
      // схемы, сохраняя id живого поля (данные не теряются).
      const defByName = {};
      (definition.fields || []).forEach(function (f) { defByName[f.name] = f; });
      mergedFields.forEach(function (f, i) {
        const def = defByName[f.name];
        if (def && liveNames.has(f.name) && def.type && def.type !== f.type) {
          mergedFields[i] = Object.assign({}, def, { id: f.id });
          console.log('   • ' + definition.name + '.' + f.name + ': тип ' + f.type + ' → ' + def.type);
        }
      });
      // Защита от id-коллизий: если id нового поля уже занят существующим
      // полем с другим именем (дефект старых экспортов), убираем id —
      // PocketBase сгенерирует уникальный и добавит поле как новое.
      const liveIds = new Set((live.fields || []).map(function (f) { return f.id; }));
      const usedIds = new Set();
      mergedFields.forEach(function (f) {
        if (f.id && liveNames.has(f.name)) {
          usedIds.add(f.id); // id существующего поля — сохраняется
        } else if (f.id && (liveIds.has(f.id) && !liveNames.has(f.name) || usedIds.has(f.id))) {
          delete f.id; // коллизия — пусть PB сгенерирует новый
        } else if (f.id) {
          usedIds.add(f.id);
        }
      });
          let fieldsPayload = mergedFields;
          try {
            await request('PATCH', '/api/collections/' + definition.name, {
              token: token,
              body: { fields: fieldsPayload },
            });
          } catch (errFirst) {
            // PocketBase запрещает менять тип существующего поля — повторяем
            // без смены типов (новые поля всё равно будут добавлены).
            if (/validation_field_type_change/.test(errFirst.message)) {
              const liveByType = {};
              (live.fields || []).forEach(function (f) { liveByType[f.name] = f.type; });
              fieldsPayload = mergedFields.map(function (f) {
                if (liveByType[f.name] && f.type !== liveByType[f.name]) {
                  return Object.assign({}, f, { type: liveByType[f.name] });
                }
                return f;
              });
              console.log('   • ' + definition.name + ' — смена типа поля запрещена PB, повтор без смены типов');
              await request('PATCH', '/api/collections/' + definition.name, {
                token: token,
                body: { fields: fieldsPayload },
              });
            } else {
              throw errFirst;
            }
          }
          console.log('   ✓ ' + definition.name + ' — добавлены поля: ' +
            missing.map(function (f) { return f.name; }).join(', '));
        } catch (err) {
          console.error('   ✗ ' + definition.name + ' — не удалось добавить поля: ' + err.message);
          failures.push(definition.name);
        }
      }
      skipped += 1;
      continue;
    }
    try {
      const result = await request('POST', '/api/collections', { token: token, body: definition });
      console.log('   ✓ ' + definition.name + ' — создана (' + (result.fields || []).length + ' полей)');
      created += 1;
    } catch (err) {
      console.error('   ✗ ' + definition.name + ' — ' + err.message);
      failures.push(definition.name);
    }
  }

  console.log('   Итого: создано ' + created + ', уже было ' + skipped + ', ошибок ' + failures.length);
  return failures;
}

/** Создаёт auth-запись, если её ещё нет (поиск по email) */
async function ensureAuthRecord(token, collection, wanted) {
  if (!wanted.email || !wanted.password) {
    console.log('   ⊘ ' + collection + ' — пропущено (не заданы email/пароль)');
    return;
  }

  const filter = 'filter=' + encodeURIComponent("(email='" + wanted.email + "')");
  const found = await request('GET', '/api/collections/' + collection + '/records?perPage=1&' + filter, {
    token: token,
  });
  const existing = (found.items || [])[0];

  if (existing) {
    if (opts.resetAppUserPassword && collection === 'app_users') {
      await request('PATCH', '/api/collections/' + collection + '/records/' + existing.id, {
        token: token,
        body: { password: wanted.password, passwordConfirm: wanted.password },
      });
      console.log('   ✓ ' + collection + ': пароль пользователя ' + wanted.email + ' обновлён');
    } else {
      console.log('   ⊘ ' + collection + ': пользователь ' + wanted.email + ' уже существует');
    }
    return;
  }

  const body = {
    email: wanted.email,
    username: wanted.username,
    name: wanted.name,
    password: wanted.password,
    passwordConfirm: wanted.password,
    emailVisibility: true,
  };
  Object.assign(body, wanted.extra || {});

  const record = await request('POST', '/api/collections/' + collection + '/records', { token: token, body: body });
  console.log('   ✓ ' + collection + ': создан пользователь ' + (record.email || wanted.email));
}

// ============================================================================
// ПРАВИЛА ДОСТУПА (режим определяется ENABLE_AUTH)
// ============================================================================
/** Коллекции, правила которых переключаются режимом авторизации */
const RULED_COLLECTIONS = ['volleyball', 'matches', 'templates'];

/** Читает ENABLE_AUTH: переменная окружения → credentials.js → 1 */
function resolveEnableAuth() {
  const env = process.env.ENABLE_AUTH;
  if (env !== undefined && env !== '') return Number(env) === 0 ? 0 : 1;
  try {
    const credentials = require(path.join(__dirname, '..', '..', 'credentials.js'));
    if (credentials.auth && credentials.auth.enabled !== undefined) {
      return Number(credentials.auth.enabled) === 0 ? 0 : 1;
    }
  } catch (err) { /* credentials.js не найден — берём значение по умолчанию */ }
  return 1;
}

/** Итоговый режим правил: auto → по ENABLE_AUTH, иначе — как задано */
function resolveRulesMode() {
  if (opts.rules !== 'auto') return opts.rules;
  return resolveEnableAuth() === 0 ? 'guest' : 'auth';
}

/**
 * Применяет правила доступа к коллекциям согласно режиму:
 *   auth  — чтение публичное, запись только авторизованным (ENABLE_AUTH=1);
 *   guest — полный публичный доступ (ENABLE_AUTH=0).
 */
async function applyAccessRules(token, definitions) {
  const mode = resolveRulesMode();
  if (mode === 'skip') {
    console.log('\n▸ Правила доступа: пропущены (--rules=skip)');
    return;
  }

  const rules = mode === 'guest'
    ? { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' }
    : { listRule: '', viewRule: '', createRule: '@request.auth.id != ""', updateRule: '@request.auth.id != ""', deleteRule: '@request.auth.id != ""' };

  console.log('\n▸ Правила доступа (режим: ' + mode + ', ENABLE_AUTH=' + resolveEnableAuth() + '):');
  const byName = {};
  (Array.isArray(definitions) ? definitions : definitions.collections || []).forEach(function (d) {
    byName[RENAMED_COLLECTIONS[d.name] || d.name] = d;
  });

  let updated = 0;
  let failed = 0;
  for (const name of RULED_COLLECTIONS) {
    // В guest-режиме не трогаем коллекции, у которых в схеме заданы
    // строгие правила (например, служебные) — применяем только к data-коллекциям
    const def = byName[name];
    if (!def) continue;
    // auth-коллекции (scoreusers/app_users/auth_log) не переключаем:
    // их правила из схемы уже корректны для обоих режимов
    const body = Object.assign({}, rules);
    try {
      await request('PATCH', '/api/collections/' + name, { token: token, body: body });
      console.log('   ✓ ' + name + ': ' + (mode === 'guest' ? 'публичный доступ (гость)' : 'запись только для авторизованных'));
      updated += 1;
    } catch (err) {
      console.error('   ✗ ' + name + ': ' + err.message);
      failed += 1;
    }
  }
  if (updated === 0 && failed === 0) {
    console.log('   ⊘ нет коллекций для обновления правил');
  }
}

/** Проверка ровно того подключения, которое использует API-сервер */
async function selfCheck() {
  console.log('\n▸ Самопроверка (как подключается API-сервер):');
  if (!CONFIG.appUser) {
    console.log('   ⊘ пропущена — нет учётных данных сервисного пользователя');
    return true;
  }

  try {
    const auth = await request('POST', '/api/collections/app_users/auth-with-password', {
      body: { identity: CONFIG.appUser.email, password: CONFIG.appUser.password },
    });
    console.log('   ✓ авторизация app_users: ' + CONFIG.appUser.email);

    for (const collection of ['volleyball', 'templates']) {
      const list = await request('GET', '/api/collections/' + collection + '/records?perPage=1', {
        token: auth.token,
      });
      console.log('   ✓ чтение ' + collection + ': записей ' + list.totalItems);
    }
    return true;
  } catch (err) {
    console.error('   ✗ ' + err.message);
    return false;
  }
}

// ============================================================================
// ЗАПУСК
// ============================================================================
function printHeader() {
  console.log('=== Инициализация БД PocketBase (Volleyball Scoreboard) ===');
  console.log('URL:                    ' + CONFIG.url);
  console.log('Суперпользователь:      ' + CONFIG.superuser.email);
  console.log('Сервисный пользователь: ' + (CONFIG.appUser ? CONFIG.appUser.email : '(пропущен)'));
  console.log('Админ в scoreusers:     ' + (CONFIG.admin ? CONFIG.admin.email : '(не создаётся)'));
}

async function main() {
  printHeader();

  const token = await authSuperuser();
  const definitions = loadCollectionDefinitions();
  const collectionFailures = await ensureCollections(token, definitions);
  await applyAccessRules(token, definitions);

  console.log('\n▸ Пользователи:');
  if (CONFIG.appUser) await ensureAuthRecord(token, 'app_users', CONFIG.appUser);
  if (CONFIG.admin) await ensureAuthRecord(token, 'scoreusers', CONFIG.admin);

  const checkOk = opts.check ? await selfCheck() : true;

  console.log('');
  console.log('=== Результат ===');
  if (collectionFailures.length) {
    console.error('✗ Коллекции с ошибками: ' + collectionFailures.join(', '));
  }
  if (!checkOk) {
    console.error('✗ Самопроверка подключения не прошла');
  }
  if (collectionFailures.length || !checkOk) {
    process.exit(1);
  }

  console.log('✓ Структура БД готова, сервисный пользователь может работать с данными');
  console.log('');
  console.log('Дальше — перезапустите контейнер API, чтобы он подключился к БД:');
  console.log('  docker restart volleyball_server   # или просто ./scripts/init-pocketbase.sh');
  console.log('Админка PocketBase: http://localhost:8090/_/');
}

main().catch(function (err) {
  console.error('\n✗ Ошибка: ' + err.message);
  process.exit(1);
});
