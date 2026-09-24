# 📋 Volleyball Scoreboard API — Документация

## Просмотр документации

### Вариант 1: Swagger UI (локальный сервер)

1. Установите зависимости:
   ```bash
   cd server
   npm install swagger-ui-express js-yaml --save
   ```

2. Добавьте в `server/src/index.js` перед `module.exports = app`:
   ```js
   // Swagger UI (только для разработки)
   if (process.env.NODE_ENV !== 'production') {
     const swaggerUi = require('swagger-ui-express');
     const yaml = require('js-yaml');
     const fs = require('fs');
     const swaggerDocument = yaml.load(fs.readFileSync('./swagger.yaml', 'utf8'));
     app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
     console.log(`📖 Swagger UI: http://localhost:${PORT}/api-docs`);
   }
   ```

3. Запустите сервер:
   ```bash
   npm run dev
   ```

4. Откройте **http://localhost:3000/api-docs**

### Вариант 2: Swagger Editor онлайн

- Откройте [Swagger Editor](https://editor.swagger.io/)
- Импортируйте файл `server/swagger.yaml`

### Вариант 3: VS Code расширение

- Установите расширение **"Swagger Viewer"** (Ajinkyawarade)
- Откройте `swagger.yaml`, нажмите `Ctrl+Shift+P` → `Swagger: Preview`

## Быстрый обзор эндпоинтов

| Группа | Метод | Путь | Описание |
|--------|-------|------|----------|
| **System** | `GET` | `/health` | Проверка работоспособности |
| **Auth** | `POST` | `/api/auth/login` | Войти и получить токен |
| **Auth** | `GET` | `/api/auth/me` | Текущий пользователь |
| **Auth** | `POST` | `/api/auth/token` | Информация о токене |
| **Scoreboard** | `POST` | `/api/scoreboard` | Создать новую игру |
| **Scoreboard** | `GET` | `/api/scoreboard/:game_id` | Получить состояние табло |
| **Scoreboard** | `PATCH` | `/api/scoreboard/:game_id` | Обновить поля |
| **Scoreboard** | `POST` | `/api/scoreboard/:game_id/score` | Изменить счёт |
| **Scoreboard** | `POST` | `/api/scoreboard/:game_id/new-set` | Новый сет |
| **Scoreboard** | `POST` | `/api/scoreboard/:game_id/swap-sides` | Смена сторон |
| **Scoreboard** | `POST` | `/api/scoreboard/:game_id/period` | Сменить период |
| **Scoreboard** | `POST` | `/api/scoreboard/:game_id/display` | Настроить отображение |
| **Scoreboard** | `POST` | `/api/scoreboard/:game_id/label` | Обновить метку |
| **Scoreboard** | `PUT` | `/api/scoreboard/:game_id/teams` | Обновить команды |
| **Scoreboard** | `PATCH` | `/api/scoreboard/:game_id/settings` | Обновить настройки |
| **Scoreboard** | `POST` | `/api/scoreboard/:game_id/mode` | Переключить режим |
| **Scoreboard** | `POST` | `/api/scoreboard/:game_id/reset` | Сбросить табло |
| **Matches** | `GET` | `/api/matches` | Список матчей |
| **Matches** | `POST` | `/api/matches` | Сохранить результат |
| **Matches** | `GET` | `/api/matches/:id` | Детали матча |

## Примеры запросов

### Войти и получить токен
```bash
# PocketBase — по username
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identity": "admin", "password": "Admin@12345"}'

# Firebase — по email
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identity": "admin@volleyball.local", "password": "Admin@12345"}'

# Ответ:
# {
#   "token": "eyJhbGciOi...",
#   "refreshToken": "...",
#   "expiresIn": 3600,
#   "user": { "uid": "...", "email": "...", "role": "admin" }
# }
```

### Создать новую игру
```bash
curl -X POST http://localhost:3000/api/scoreboard \
  -H "Content-Type: application/json" \
  -d '{
    "game_id": "final_2026",
    "home_team": "Динамо",
    "away_team": "Зенит",
    "tournament_name": "НВЛ",
    "venue": "Спорткомплекс Олимп"
  }'

# Ответ:
# {
#   "id": "final_2026",
#   "home_team": "Динамо",
#   "away_team": "Зенит",
#   "venue": "Спорткомплекс Олимп",
#   "home_score": 0, "away_score": 0,
#   "current_period": 1,
#   ...
# }
```

### Получить состояние табло
```bash
curl http://localhost:3000/api/scoreboard/game1
```

### Добавить очко домашней команде
```bash
curl -X POST http://localhost:3000/api/scoreboard/game1/score \
  -H "Content-Type: application/json" \
  -d '{"team": "home", "delta": 1}'
```

### Получить информацию о текущем пользователе
```bash
# 1. Сначала логинимся
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identity": "admin", "password": "Admin@12345"}' | jq -r '.token')

# 2. Используем токен
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### Переключить на пляжный волейбол
```bash
curl -X POST http://localhost:3000/api/scoreboard/game1/mode \
  -H "Content-Type: application/json" \
  -d '{"beach_mode": true}'
```

### Обновить команды и зал
```bash
curl -X PUT http://localhost:3000/api/scoreboard/game1/teams \
  -H "Content-Type: application/json" \
  -d '{
    "home_team": "Динамо",
    "away_team": "Зенит",
    "venue": "ДС Дружба"
  }'
```

### Сбросить табло с сохранением команд
```bash
curl -X POST http://localhost:3000/api/scoreboard/game1/reset \
  -H "Content-Type: application/json" \
  -d '{"keep_settings": true}'
```
