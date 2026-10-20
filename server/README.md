# Volleyball Scoreboard API

REST API для управления волейбольным табло с интеграцией Firebase Firestore.

## Установка

```bash
cd server
npm install
```

## Настройка Firebase

### Вариант 1: Автоматическая настройка (рекомендуется)

```bash
npm run setup
```

Скрипт покажет инструкции по получению ключа.

### Вариант 2: Ручная настройка

1. Откройте Firebase Console:
   https://console.firebase.google.com/project/myvolleyscore/settings/serviceaccounts/adminsdk

2. Нажмите **"Generate new private key"**

3. Сохраните скачанный JSON-файл как `serviceAccountKey.json` в папке `server/`

4. Запустите скрипт настройки:
   ```bash
   node scripts/setup-simple.js
   ```

Или создайте `.env` файл вручную:
```env
FIREBASE_KEY_FILE_PATH=/home/zago/github/volleyball_scoreboard/server/serviceAccountKey.json
PORT=3000
```

## Запуск

```bash
# Development mode с авто-перезагрузкой
npm run dev

# Production mode
npm start
```

## API Endpoints

### Scoreboard

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `GET` | `/api/scoreboard/:game_id` | Получить состояние табло |
| `PATCH` | `/api/scoreboard/:game_id` | Обновить произвольные поля |
| `POST` | `/api/scoreboard/:game_id/score` | Изменить счёт (±1) |
| `POST` | `/api/scoreboard/:game_id/new-set` | Начать новый сет |
| `POST` | `/api/scoreboard/:game_id/swap-sides` | Смена сторон |
| `POST` | `/api/scoreboard/:game_id/period` | Изменить период |
| `POST` | `/api/scoreboard/:game_id/display` | Настроить отображение |
| `POST` | `/api/scoreboard/:game_id/label` | Обновить метку |
| `PUT` | `/api/scoreboard/:game_id/teams` | Обновить команды |
| `PATCH` | `/api/scoreboard/:game_id/settings` | Обновить настройки (в т.ч. произвольного варианта) |
| `POST` | `/api/scoreboard/:game_id/mode` | Переключить режим (пляжный/классический/произвольный) |
| `POST` | `/api/scoreboard/:game_id/reset` | Сбросить табло |

### Matches

| Метод | Endpoint | Описание |
|-------|----------|----------|
| `POST` | `/api/matches` | Сохранить результат матча |
| `GET` | `/api/matches` | Получить список матчей |
| `GET` | `/api/matches/:id` | Получить матч по ID |

---

## Примеры запросов

### Получить состояние табло
```bash
curl http://localhost:3000/api/scoreboard/test1
```

### Изменить счёт (+1 очко команде home)
```bash
curl -X POST http://localhost:3000/api/scoreboard/test1/score \
  -H "Content-Type: application/json" \
  -d '{"team": "home", "delta": 1}'
```

### Уменьшить счёт (-1 очко)
```bash
curl -X POST http://localhost:3000/api/scoreboard/test1/score \
  -H "Content-Type: application/json" \
  -d '{"team": "away", "delta": -1}'
```

### Новый сет
```bash
curl -X POST http://localhost:3000/api/scoreboard/test1/new-set
```

### Смена сторон
```bash
curl -X POST http://localhost:3000/api/scoreboard/test1/swap-sides
```

### Изменить период
```bash
curl -X POST http://localhost:3000/api/scoreboard/test1/period \
  -H "Content-Type: application/json" \
  -d '{"delta": 1}'
```

### Настроить отображение
```bash
# show: 0=none, 1=top, 2=bottom, 4=top label, 6=top label+bottom, 14=top label+bottom names
curl -X POST http://localhost:3000/api/scoreboard/test1/display \
  -H "Content-Type: application/json" \
  -d '{"show": 1}'
```

### Обновить метку
```bash
curl -X POST http://localhost:3000/api/scoreboard/test1/label \
  -H "Content-Type: application/json" \
  -d '{"custom_label": "Разминка"}'
```

### Обновить команды
```bash
curl -X PUT http://localhost:3000/api/scoreboard/test1/teams \
  -H "Content-Type: application/json" \
  -d '{
    "home_team": "Спарта",
    "home_color": "#ff0000",
    "away_team": "Динамо",
    "away_color": "#00ff00",
    "tournament_name": "НВЛ"
  }'
```

### Обновить настройки
```bash
curl -X PATCH http://localhost:3000/api/scoreboard/test1/settings \
  -H "Content-Type: application/json" \
  -d '{
    "invert_tablo": true,
    "unlimited_score": false
  }'
```

### Переключить режим (пляжный/классический)
```bash
# Включить пляжный волейбол
curl -X POST http://localhost:3000/api/scoreboard/test1/mode \
  -H "Content-Type: application/json" \
  -d '{"beach_mode": true}'

# Включить классический волейбол
curl -X POST http://localhost:3000/api/scoreboard/test1/mode \
  -H "Content-Type: application/json" \
  -d '{"beach_mode": false}'
```

### Сбросить табло
```bash
# С сохранением настроек команд
curl -X POST http://localhost:3000/api/scoreboard/test1/reset \
  -H "Content-Type: application/json" \
  -d '{"keep_settings": true}'

# Полный сброс
curl -X POST http://localhost:3000/api/scoreboard/test1/reset \
  -H "Content-Type: application/json" \
  -d '{"keep_settings": false}'
```

### Сохранить результат матча
```bash
curl -X POST http://localhost:3000/api/matches \
  -H "Content-Type: application/json" \
  -d '{
    "game_id": "test1",
    "setHistory": [{"home": 25, "away": 20}, {"home": 25, "away": 22}],
    "overallHome": 2,
    "overallAway": 0
  }'
```

### Получить список матчей
```bash
# Все матчи
curl http://localhost:3000/api/matches

# С фильтрами
curl "http://localhost:3000/api/matches?tournament=НВЛ&game_type=classic&limit=10"
```

---

## Структура данных табло

```json
{
  "id": "test1",
  "show": 1,
  "home_team": "Спарта",
  "home_color": "#ff0000",
  "home_score": 15,
  "home_fouls": 1,
  "home_sets": 0,
  "home_side": "left",
  "away_team": "Динамо",
  "away_color": "#00ff00",
  "away_score": 12,
  "away_fouls": 0,
  "away_sets": 0,
  "away_side": "right",
  "tournament_name": "НВЛ",
  "current_period": 2,
  "period_count": 5,
  "custom_label": "Табло",
  "beach_mode": false,
  "beach_current_set": 1,
  "beach_switch_message": "",
  "beach_match_finished": false,
  "classic_match_finished": false,
  "classic_tiebreak_switch_done": true,
  "classic_switch_needed": false,
  "classic_switch_message": "",
  "invert_tablo": false,
  "unlimited_score": false,
  "set_history": [{"home": 25, "away": 20}],
  "pending_new_set": false,
  "next_period": null,
  "pending_home_side": null,
  "pending_away_side": null,
  "lastEdited": "2026-02-27T10:00:00.000Z"
}
```

---

## Логика работы

### Пляжный волейбол (`beach_mode: true`)
- Матч до 2 побед в сетах (максимум 3 сета)
- 1-й и 2-й сет — до 21 очка
- 3-й сет — до 15 очков
- Смена сторон каждые 7 очков (1-2 сет) или 5 очков (3-й сет)

### Классический волейбол (`beach_mode: false`)
- Матч до 3 побед в сетах (максимум 5 сетов)
- Сеты 1-4 — до 25 очков
- 5-й сет (тай-брейк) — до 15 очков
- Смена сторон в 5-м сете при 8 очках

### Произвольный вариант (`custom_mode: true`)
- Свои правила: `count_wins` (побед в матче, по умолчанию 3),
  `score_wins` (очков в сет, 25), `score_tie` (очков в сете с номером
  `count_wins`, 15), `balance` (победа только с разницей 2 очка, false),
  `score_change` (смена сторон каждые N очков, **0 — отключено**),
  `count_timeouts` (таймаутов на команду за сет, 2)
- `period_count` = 9; несовместим с `beach_mode` и `two_wins_mode`
  (включение `custom_mode` выключает их автоматически)
- Режимы хранятся и в `matchmode` — 5-битной маске
  `beach|two_wins|invert|unlimited|custom`; мобильный клиент читает её в первую очередь

```bash
# Создать произвольную игру (смена сторон отключена)
curl -X POST http://localhost:3000/api/scoreboard/test1 \
  -H "Content-Type: application/json" \
  -d '{"custom_mode": true, "count_wins": 1, "score_wins": 21, "score_change": 0}'

# ...или включить произвольный режим у существующей игры и задать настройки
curl -X POST http://localhost:3000/api/scoreboard/test1/mode \
  -H "Content-Type: application/json" \
  -d '{"custom_mode": true}'

curl -X PATCH http://localhost:3000/api/scoreboard/test1/settings \
  -H "Content-Type: application/json" \
  -d '{"count_wins": 1, "score_wins": 21, "score_change": 0}'
```

---

## Обработка ошибок

API возвращает стандартные HTTP статусы:

| Код | Описание |
|-----|----------|
| `200` | Успех |
| `201` | Создано (для POST /api/matches) |
| `400` | Ошибка валидации запроса |
| `404` | Табло или матч не найдены |
| `500` | Внутренняя ошибка сервера |

Пример ответа при ошибке:
```json
{
  "error": "Bad Request",
  "message": "team must be \"home\" or \"away\""
}
```

---

## Тестирование

```bash
npm test
```

---

## Интеграция с frontend

Для интеграции с существующими HTML-страницами замените прямые вызовы Firebase на API:

```javascript
// Было (прямой вызов Firebase)
scoreboard_query.update({ home_score: newScore });

// Стало (вызов API)
fetch('/api/scoreboard/test1/score', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ team: 'home', delta: 1 })
})
.then(res => res.json())
.then(data => updateUI(data));
```

Готово!

Резюме
Создана полная серверная часть для управления волейбольным табло:

Файлы созданы:
server/src/index.js — Express сервер
server/src/config/firebase.js — конфигурация Firebase
server/src/services/scoreboardService.js — бизнес-логика (порт из ctl.js)
server/src/middleware/validators.js — валидаторы и обработка ошибок
server/src/routes/scoreboard.js — 12 endpoints для табло
server/src/routes/matches.js — 3 endpoints для матчей
server/scripts/setup-simple.js — скрипт настройки Firebase
server/README.md — полная документация API
SERVER_SETUP.md — краткая инструкция
Для запуска:
Получите Service Account Key:

Откройте https://console.firebase.google.com/project/myvolleyscore/settings/serviceaccounts/adminsdk
Нажмите “Generate new private key”
Сохраните файл как server/serviceAccountKey.json
Настройте и запустите:

cd server
npm run setup    # создаст .env файл
npm start        # запуск сервера
Проверьте:

curl http://localhost:3000/health