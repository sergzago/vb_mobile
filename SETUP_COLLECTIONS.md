# Создание коллекций в PocketBase

Этот документ описывает способы создания необходимых коллекций для приложения Volleyball Scoreboard.

## Необходимые коллекции

Приложению требуются следующие коллекции:

1. **volleyball** — данные игровых табло
2. **matches** — история матчей
3. **auth_log** — журнал авторизаций
4. **scoreusers** — пользователи (auth collection)

## Способ 1: Через админ-панель PocketBase (Рекомендуется)

### Шаг 1: Открыть админ-панель

Откройте браузер и перейдите по адресу:
```
http://zago.my.to:8090/_/
```

### Шаг 2: Войти как администратор

- Email: `supervisor@volleyball.local`
- Password: `Mer1in00`

### Шаг 3: Создать коллекции

Для каждой коллекции нажмите **"New collection"** и настройте:

---

#### Коллекция: `volleyball`

**Settings:**
- Collection name: `volleyball`
- Collection type: **Base**

**API Rules:**
- List rule: `@request.auth.id != ""`
- View rule: `@request.auth.id != ""`
- Create rule: `@request.auth.id != ""`
- Update rule: `@request.auth.id != ""`
- Delete rule: `role = "admin"`

**Fields:**
| Field name | Type | Required | Unique | Options |
|-----------|------|----------|--------|---------|
| `id` | Text | ❌ | ✅ | |
| `home_team` | Text | ❌ | ❌ | |
| `away_team` | Text | ❌ | ❌ | |
| `home_score` | Number | ❌ | ❌ | |
| `away_score` | Number | ❌ | ❌ | |
| `home_sets` | Number | ❌ | ❌ | |
| `away_sets` | Number | ❌ | ❌ | |
| `current_set` | Number | ❌ | ❌ | |
| `home_sets_history` | JSON | ❌ | ❌ | |
| `away_sets_history` | JSON | ❌ | ❌ | |
| `serving_team` | Text | ❌ | ❌ | |
| `status` | Select | ❌ | ❌ | Values: `not_started`, `in_progress`, `finished`, `paused` |
| `match_type` | Select | ❌ | ❌ | Values: `classic`, `beach` |
| `lastEdited` | Date | ❌ | ❌ | |
| `created` | Date | ❌ | ❌ | |

---

#### Коллекция: `matches`

**Settings:**
- Collection name: `matches`
- Collection type: **Base**

**API Rules:**
- List rule: `@request.auth.id != ""`
- View rule: `@request.auth.id != ""`
- Create rule: `@request.auth.id != ""`
- Update rule: `@request.auth.id != ""`
- Delete rule: `role = "admin"`

**Fields:**
| Field name | Type | Required | Options |
|-----------|------|----------|---------|
| `game_id` | Text | ❌ | |
| `date_time` | Date | ❌ | |
| `home_team` | Text | ❌ | |
| `away_team` | Text | ❌ | |
| `home_score` | Number | ❌ | |
| `away_score` | Number | ❌ | |
| `home_sets` | Number | ❌ | |
| `away_sets` | Number | ❌ | |
| `match_type` | Select | ❌ | Values: `classic`, `beach` |
| `is_deleted` | Check | ❌ | |
| `deleted_at` | Date | ❌ | |
| `notes` | Text | ❌ | |

---

#### Коллекция: `auth_log`

**Settings:**
- Collection name: `auth_log`
- Collection type: **Base**

**API Rules:**
- List rule: `role = "admin"`
- View rule: `role = "admin"`
- Create rule: `` (пусто — все могут создавать)
- Update rule: `role = "admin"`
- Delete rule: `role = "admin"`

**Fields:**
| Field name | Type | Required | Options |
|-----------|------|----------|---------|
| `username` | Text | ❌ | |
| `event` | Text | ❌ | |
| `timestamp` | Date | ❌ | |
| `ip_address` | Text | ❌ | |
| `user_agent` | Text | ❌ | |
| `details` | JSON | ❌ | |

---

#### Коллекция: `scoreusers`

**Settings:**
- Collection name: `scoreusers`
- Collection type: **Auth** (важно!)

**API Rules:**
- List rule: `id = @request.auth.id`
- View rule: `id = @request.auth.id`
- Create rule: `` (пусто — все могут создавать)
- Update rule: `id = @request.auth.id`
- Delete rule: `role = "admin"`

**Auth fields:**
- Username: включено
- Email: включено
- Email visibility: **Visible**

**Fields:**
| Field name | Type | Required | Unique | Options |
|-----------|------|----------|--------|---------|
| `username` | Text | ✅ | ✅ | Min: 3, Max: 50 |
| `name` | Text | ❌ | ❌ | Max: 100 |
| `role` | Select | ❌ | ❌ | Values: `admin`, `user`, `moderator` |
| `avatar` | File | ❌ | ❌ | Max files: 1, Mime types: `image/jpeg`, `image/png`, `image/gif` |

---

## Способ 2: Через скрипт (с сервера)

Если у вас есть SSH доступ к серверу, где запущен PocketBase:

```bash
cd /home/zago/github/volleyball_scoreboard/server
node scripts/create-collections.js
```

Или с переменными окружения:

```bash
POCKETBASE_URL=http://localhost:8090 \
POCKETBASE_ADMIN_EMAIL=supervisor@volleyball.local \
POCKETBASE_ADMIN_PASSWORD=Mer1in00 \
node scripts/create-collections.js
```

## Способ 3: Импорт из JSON

PocketBase поддерживает импорт коллекций из JSON файла.

1. Создайте файл `collections-export.json` с экспортом коллекций
2. В админ-панели: **Settings → Import collections**
3. Вставьте содержимое JSON файла

## Проверка

После создания коллекций:

1. Откройте консоль браузера (F12)
2. Загрузите страницу приложения
3. В консоли должно быть:
   ```
   [DB] Все необходимые коллекции найдены в PocketBase
   ```

## Устранение проблем

### Ошибка CORS

Если видите ошибку CORS:
```
Access to fetch at 'http://zago.my.to:8090/...' has been blocked by CORS policy
```

**Решение:**
- Убедитесь, что PocketBase настроен с правильными CORS заголовками
- При использовании Nginx/Apache добавьте заголовки:
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization
  ```

### Коллекция не создаётся

- Проверьте, что PocketBase запущен
- Проверьте учётные данные администратора
- Посмотрите логи PocketBase сервера

## Конфигурация

Параметры подключения находятся в `/js/db-config.js`:

```javascript
pocketbase: {
  // same-origin: nginx проксирует <APP_PREFIX>pb/ (по умолчанию /vb/pb/)
  // → контейнер pocketbase:8090 (внутри docker). Префикс задаётся APP_PREFIX.
  url: '/vb/pb/',
  adminEmail: 'supervisor@volleyball.local',
  adminPassword: 'Mer1in00'
}
```
