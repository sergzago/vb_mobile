# Правила доступа PocketBase

## Обзор

Доступ контролируется через **Manage Rule** — единое правило для всех CRUD-операций.
Контроль по ролям (`admin`/`user`) осуществляется на уровне приложения (`admin.html`).

> **Гостевой режим (`ENABLE_AUTH=0`).** Авторизация отключается в
> `credentials.js` → `auth.enabled = 0` (фронтенд) и в `.env` → `ENABLE_AUTH=0`
> (сервер, см. `server/src/middleware/auth.js`). Токен в этом режиме не выдаётся,
> поэтому коллекции, используемые мобильным интерфейсом (`volleyball`,
> `matches`, `templates`), должны иметь **публичные правила** (`""`), иначе
> создание игры и шаблоны будут недоступны. Серверные маршруты при
> `ENABLE_AUTH=0` пропускают запросы без токена, но `requireAdmin`/`requireRole`
> по-прежнему запрещают доступ гостю.

## Коллекции

### `volleyball`
| Правило | Значение |
|---------|----------|
| Manage Rule | `@request.auth.id != ""` |

**Описание:** Все CRUD-операции доступны любому авторизованному пользователю из `app_users`.

---

### `matches`
| Правило | Значение |
|---------|----------|
| Manage Rule | `@request.auth.id != ""` |

**Описание:** Все CRUD-операции доступны любому авторизованному пользователю. Публичное чтение настраивается отдельно (List/View = `""`).

---

### `scoreusers`
| Правило | Значение |
|---------|----------|
| Manage Rule | `@request.auth.id != ""` |

**Описание:** Все CRUD-операции (включая смену паролей) доступны любому авторизованному пользователю. Контроль ролей — в коде приложения.

**Поля:**
- `username` (text, required)
- `email` (email, required)
- `password` (password, required)
- `name` (text)
- `role` (text) — `admin` или `user`
- `emailVisibility` (bool)

---

### `auth_log`
| Правило | Значение |
|---------|----------|
| Manage Rule | `@request.auth.id != ""` |

**Описание:** Все операции доступны авторизованным пользователям.

---

### `app_users`
| Правило | Значение |
|---------|----------|
| Manage Rule | `@request.auth.id = id` |
| Auth Rule | *(пусто)* |

**Описание:** 
- Пользователи могут редактировать только свой профиль
- Авторизация разрешена для всех (пустое Auth Rule)
- Создание/удаление — только через суперпользователя PocketBase

**Поля:**
- `username` (text, required)
- `email` (email, required)
- `password` (password, required)
- `name` (text)
- `emailVisibility` (bool)

---

## Режимы доступа (ENABLE_AUTH)

Правила коллекций `volleyball`, `matches`, `templates` переключаются
init-скриптом в зависимости от режима авторизации:

| `ENABLE_AUTH` | list/view | create/update/delete | Кто пишет |
|---|---|---|---|
| `1` (auth) | `""` (публично) | `@request.auth.id != ""` | только вошедшие |
| `0` (guest) | `""` (публично) | `""` (публично) | все (гостевой режим) |

Чтение всегда публичное — зрители открывают `tablo.html` / `results.html`
без входа. Auth-коллекции (`scoreusers`, `app_users`, `auth_log`) режимом
не переключаются — их правила из схемы корректны в обоих режимах.

**Сменили `ENABLE_AUTH` в `.env` → перезапустите init-скрипт:**

```bash
./scripts/init-pocketbase.sh                 # режим возьмётся из .env (auto)
./scripts/init-pocketbase.sh --rules=auth    # принудительно auth-режим
./scripts/init-pocketbase.sh --rules=guest   # принудительно гостевой
./scripts/init-pocketbase.sh --rules=skip    # не трогать правила
```

Логика: `server/scripts/init-db.js` → `applyAccessRules()`. В браузере режим
задаётся `credentials.js → auth.enabled` (см. `js/db-config.js`).

## Как настроить

1. Откройте **PocketBase Admin UI** (`https://zago.my.to/vb/pb/_/`)
2. Перейдите в **Settings → Collections**
3. Для каждой коллекции установите правила из таблицы выше
4. Сохраните

### Автоматически (Docker)

Правила и поля этих коллекций (плюс `app_users` и сервисный пользователь из
`credentials.js`) создаёт скрипт инициализации:

```bash
./scripts/init-pocketbase.sh          # суперпользователь + структура БД + сервисный пользователь
```

Определения коллекций берутся из `pocketbase_collections_export.json`
(`templates1` создаётся под именем `templates`, как ожидает приложение),
логика скрипта — `server/scripts/init-db.js`.

---

## Технические пользователи

Файл `credentials.js`:

```js
pocketbase: {
  // APP_PREFIX + 'pb/' (по умолчанию '/vb/pb/'): same-origin;
  // nginx фронтенда проксирует <APP_PREFIX>pb/ → pocketbase:8090
  url: '/vb/pb/',
  user_email: 'app@volleyball.local',   // Технический пользователь
  user_password: '...'
}
```

Этот пользователь используется для всех операций с данными (создание матчей, управление пользователями, логирование).
