# Docker Deploy — Volleyball Scoreboard
Кратко последовательность действий:
1. Собираем образ
docker compose build
Если хотим установить на локальный компьютер, то
docker compose up -d --build
2. Сохраняем образы 
docker save vb_mobile-pocketbase:0.36.6 vb_mobile-server:latest vb_mobile-frontend | gzip > deploy/vb_mobile-images.tar.gz
3. Копируем образы на сервер
scp -o "ProxyJump zago@zago.404.mn:11022" deploy/vb_mobile-images.tar.gz  zago@10.74.8.75:/tmp/
# Если необходимо скопировать новые файлы для docker compose:
# scp -o "ProxyJump zago@zago.404.mn:11022" deploy/vb_mobile-images.tar.gz docker-compose.yml docker-compose.pb.yml .env pb_schema.json scripts/init-pocketbase.sh  zago@10.74.8.75:/tmp/

4. На сервере в каталоге с проектом (/opt/volleyball-mobile)
docker compose down
gunzip -c /tmp/vb_mobile-images.tar.gz | docker load 
docker compose up -d

Полная инструкция по сборке Docker-образа API-сервера, копированию на удалённый сервер и запуску через Docker Compose / Docker Swarm.

---

## Содержание

1. [Требования](#требования)
2. [Локальная сборка](#локальная-сборка)
3. [Локальный запуск для проверки](#локальный-запуск-для-проверки)
4. [Сохранение образа](#сохранение-образа)
5. [Копирование на сервер](#копирование-на-сервер)
6. [Загрузка и запуск на сервере](#загрузка-и-запуск-на-сервере)
7. [Проверка работоспособности](#проверка-работоспособности)
8. [Обновление на сервере](#обновление-на-сервере)
9. [Миграция на Docker Swarm](#миграция-на-docker-swarm)
10. [Переменные окружения](#переменные-окружения)
11. [Потенциальные проблемы](#потенциальные-проблемы)
12. [Структура проекта для деплоя](#структура-проекта-для-деплоя)
13. [Чек-лист перед production-deploy](#чек-лист-перед-production-deploy)

---

## Требования

### На машине сборки (локально / CI)

- Docker Engine 20.10+
- Docker Compose 2.x
- tar, gzip (для упаковки)
- ~500 МБ свободного места для сборки

### На целевом сервере

- Docker Engine 20.10+
- Docker Compose 2.x (для Compose-режима) ИЛИ Docker Swarm (для Swarm-режима)
- Открытые порты:
  - 8090 — PocketBase (опционально)
  - 3000 — API
  - 8080 — Frontend (Nginx)
- Дисковое пространство: ~300 МБ для образов + место под данные

---

## Локальная сборка

Состав стека (см. `docker-compose.yml` + `docker-compose.pb.yml`, склеиваются
переменной `COMPOSE_FILE` из `.env`):

- **pocketbase** — собирается из `dockerfile.pb` (бинарник с официального релиза, `PB_VERSION`);
- **server** — Node.js API (`server/Dockerfile`, контекст — корень репозитория);
- **frontend** — свой образ из `Dockerfile.frontend` (статика + nginx с прокси
  `<APP_PREFIX>pb/` и `<APP_PREFIX>api/`).

### 1. Собрать образы

```bash
cd /home/zago/github/vb_mobile

# все три сервиса (COMPOSE_FILE из .env: docker-compose.yml:docker-compose.pb.yml)
docker compose build

# или только API
docker compose build server
```

> 💡 Если первый проход упал на загрузке базовых образов
> (`failed to resolve source metadata ... alpine/node/nginx`, `dial tcp ...`) —
> registry docker.io был временно недоступен. Повторите сборку или
> воспользуйтесь скриптом с автоматическими повторами (только сетевые
> ошибки ретраятся, ошибки Dockerfile — нет):
>
> ```bash
> ./scripts/build.sh              # все сервисы, до 3 попыток с backoff
> ./scripts/build.sh server       # только API
> BUILD_ATTEMPTS=5 ./scripts/build.sh
> ```

> ⚠️ Собирать нужно **из корня репозитория**: у сервисов `server` и `frontend`
> `context: .` — образы запекают `js/`, `credentials.js`, `pb_schema.json` и
> статику. Отдельный `cd server && docker build .` больше не работает.

Результат:
- `vb_mobile-pocketbase:<PB_VERSION>` (по умолчанию 0.36.6)
- `vb_mobile-server:latest` — ~200-300 МБ (node:18-alpine + зависимости)
- `vb_mobile-frontend:latest` — nginx:alpine + статика

### 1.1. Порт PocketBase внутри сети всегда 8090

Внутри docker-сети контейнер PocketBase слушает **всегда `8090`**

(`dockerfile.pb`: `--http=0.0.0.0:8090`). `POCKETBASE_PORT` из `.env`

— это **только хостовая публикация** `0.0.0.0:${POCKETBASE_PORT}:8090`
(внешний доступ задуман): внутри сети на этом порту ничего не слушает,
поэтому подставлять его в адреса `pocketbase:<порт>` **нельзя**
(будет `connection refused`).

Отсюда правила:

- `POCKETBASE_URL` в `.env` — адрес **внутри сети**, всегда
  `http://pocketbase:8090` (меняется только для внешней/хостовой БД вне стека);
- фоллбэк в `js/db-config.js` — тоже всегда `http://pocketbase:8090`
  (внутрь образов хостовой порт НЕ запекается, поэтому при смене
  `POCKETBASE_PORT` пересборка не нужна — достаточно `docker compose up -d`);
- браузер ходит к БД и API по **уникальному префиксу** `<APP_PREFIX>` (по
  умолчанию `/vb/`), а не по корневым `/pb/`, `/api/` — чтобы не конфликтовать
  с чужими путями на общем домене и с внешним reverse-proxy;
- `credentials.js` отдаёт пути `<APP_PREFIX>pb/` (`pocketbase.url`) и
  `<APP_PREFIX>api/` (`server.prefix`), а nginx фронтенда
  (`nginx.conf.template`) проксирует их в **docker-имена сервисов**
  `pocketbase:8090` и `server:3000` соответственно;
- префикс подставляется в конфиг nginx на старте контейнера из `APP_PREFIX`
  (envsubst) и тем же значением отдаётся браузеру — `/vb-config.js` →
  `window.VB_APP_PREFIX`, поэтому смена префикса не требует пересборки;
- сервер, в свою очередь, обращается к БД напрямую —
  `POCKETBASE_URL=http://pocketbase:8090`.

```bash
# Проверить текущее значение внутри собранных образов (должен быть 8090)
docker run --rm --entrypoint grep vb_mobile-server:latest \
  'pocketbase:' /usr/src/js/db-config.js
```

> ⚠️ Образы собираются под архитектуру машины сборки. Для сервера с другой
> архитектурой (например, arm64) используйте `docker buildx build --platform`.

### 1.2. Развёртывание под подпутём (`https://домен/myvb/`)

Приложение можно опубликовать не от корня домена, а под подпутём — пути БД/API
подстраиваются автоматически:

- `credentials.js` (`_appDir()`) строит их от **каталога текущей страницы**:
  под подпутём получается `/myvb/vb/pb/` и `/myvb/vb/api/`, в корне — `/vb/pb/`;
- `sw.js` (service worker) и `manifest.json` используют **относительные** пути.

Требование к внешнему reverse-proxy — **срезать** подпуть при проксировании в
контейнер фронтенда, чтобы внутри него пути остались `/vb/pb/`, `/vb/api/` и
статика (`APP_PREFIX` в `.env` менять при этом НЕ нужно):

```nginx
# Внешний nginx на хосте: https://домен/myvb/ → контейнер фронтенда
location /myvb/ {
    proxy_pass http://127.0.0.1:8081/;   # завершающий '/' обязателен — срезает /myvb/
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE realtime (<APP_PREFIX>pb/api/realtime): без буферизации
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

Проверка (подставьте свой домен/подпуть):

```bash
curl -s https://домен/myvb/vb-config.js      # window.VB_APP_PREFIX="/vb/";
curl -s https://домен/myvb/vb/pb/api/health  # {"message":"API is healthy.",...}
```

> ⚠️ Если в браузере ранее открывалась старая версия — очистите кэш или сделайте
> Ctrl+Shift+R: service worker мог закешировать прежние (корневые) пути. Версия
> кэша в `sw.js` поднята до `v12`, поэтому новый SW перезапишет старый кэш.


---

## Локальный запуск для проверки

### Полный стек

`COMPOSE_FILE` в `.env` уже склеивает оба compose-файла, поэтому:

```bash
cd /home/zago/github/vb_mobile
docker compose up -d          # pocketbase + server + frontend
```

Проверка:

```bash
# API сервер
curl http://localhost:3000/health

# Swagger UI (включён по умолчанию: ENABLE_SWAGGER=true)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api-docs/

# PocketBase через прокси фронтенда (так же ходит браузер).
# APP_PREFIX по умолчанию /vb/ (см. .env)
curl http://localhost:8080/vb/pb/api/health

# API сервер через прокси фронтенда (так же ходит браузер: <APP_PREFIX>api/...)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/vb/api/auth/log
#    200 — nginx проксирует <APP_PREFIX>api/ в server:3000; 502 — server не запущен

# Frontend
curl -s http://localhost:8080 | head -10

# Логи
docker compose logs -f server

# Остановка
docker compose down
```

### Только API и фронтенд (без контейнера PocketBase)

```bash
docker compose -f docker-compose.yml up -d
```

PocketBase при этом должен быть доступен по адресу из `POCKETBASE_URL` (.env);
до его доступности API вернёт `"status":"degraded"`, но не упадёт.

---

## Сохранение образа

После успешной сборки сохранить образ в архив:

```bash
cd /home/zago/github/vb_mobile
mkdir -p deploy

# Сохранить API образ
docker save vb_mobile-server:latest -o deploy/vb_mobile-server.tar

tar czf deploy/vb_mobile-server.tar.gz -C deploy vb_mobile-server.tar

# Проверка размера
ls -lh deploy/vb_mobile-server.tar.gz
```

Если используется docker compose, можно сохранить конкретный образ по ID:

docker save vb_mobile-pocketbase:0.36.6 vb_mobile-server:latest vb_mobile-frontend | gzip > deploy/vb_mobile-images.tar.gz
scp -o "ProxyJump zago@zago.404.mn:11022" deploy/vb_mobile-images.tar.gz  zago@10.74.8.75:/tmp/
scp -o "ProxyJump zago@zago.404.mn:11022" docker-compose.yml docker-compose.pb.yml .env pb_schema.json scripts/init-pocketbase.sh  zago@10.74.8.75:/tmp/


```bash
# Узнать ID образа
docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' | grep vb_mobile-server

# Сохранить по ID
docker save <IMAGE_ID> -o deploy/vb_mobile-server.tar
```

---

## Копирование на сервер

### По SSH (scp)

```bash
# Синхронное копирование
scp -P <SSH_PORT> deploy/vb_mobile-server.tar.gz user@server.example.com:/tmp/

# Или через rsync (быстрее для повторных загрузок)
rsync -avz -e "ssh -p <SSH_PORT>" deploy/vb_mobile-server.tar.gz user@server.example.com:/tmp/
```

### По HTTP (если есть веб-сервер)

```bash
# На машине сборки — раздать файл
cd deploy
python3 -m http.server 8765 &

# На сервере — загрузить
curl -O http://build-server.example.com:8765/vb_mobile-server.tar.gz
```

### По сети (docker save | ssh | docker load) — one-liner

```bash
docker save vb_mobile-server:latest | ssh -C user@server.example.com 'docker load'
```

---

## Загрузка и запуск на сервере

### Подготовка сервера

Фронтенд монтирует **весь корень репозитория** (html/js/css, `credentials.js`),
а init-скрипту нужны `scripts/`, `server/scripts/`, `pb_schema.json`,
`credentials.js`. Проще всего скопировать репозиторий целиком:

```bash
# С машины сборки
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude '.history' \
  --exclude 'deploy' --exclude 'pb_data' \
  ./ user@server.example.com:/opt/volleyball-mobile/
```

Либо вручную создать структуру и скопировать файлы:

```bash
ssh user@server.example.com
mkdir -p /opt/volleyball-mobile/{server,scripts,logs}
```

### 1. Загрузить образы

```bash
# Из tar.gz (API)
gunzip -c /tmp/vb_mobile-server.tar.gz | docker load

# Проверить
docker images | grep -E 'vb_mobile-(api|pocketbase)'
```

### 2. Создать .env файл

```bash
cat > /opt/volleyball-mobile/.env << 'EOF'
# Состав стека: pocketbase + server + frontend одной командой
COMPOSE_FILE=docker-compose.yml:docker-compose.pb.yml

# Порты
POCKETBASE_PORT=8090
API_PORT=3000
FRONTEND_PORT=8080

# PocketBase
POCKETBASE_ENV=production
PB_VERSION=0.36.6

# Режим авторизации: 1 — вход обязателен, 0 — гостевой режим
ENABLE_AUTH=0

# API сервер
DB_PROVIDER=pocketbase
POCKETBASE_URL=http://pocketbase:8090
POCKETBASE_ADMIN_EMAIL=admin@volleyball.local
POCKETBASE_ADMIN_PASSWORD=ваш_пароль
ALLOWED_ORIGINS=https://ваш-домен.ru
API_NODE_ENV=production
ENABLE_SWAGGER=false

# Frontend
FRONTEND_HOST=ваш-домен.ru
EOF
```

### 3. Проверить server/.env и credentials.js

`server/.env` и `credentials.js` копируются вместе с репозиторием; при
необходимости поправьте в них адрес PocketBase, пароли и `auth.enabled`
(для браузера; должен совпадать с `ENABLE_AUTH` в `.env`).

### 4. Файлы проекта

При rsync-копировании (шаг «Подготовка сервера») уже на месте. Если копировали
вручную, необходим минимум:

```bash
scp docker-compose.yml docker-compose.pb.yml dockerfile.pb nginx.conf.template \
    credentials.js pb_schema.json \
    user@server.example.com:/opt/volleyball-mobile/
scp -r scripts server user@server.example.com:/opt/volleyball-mobile/
```

### 5. Запустить сервисы

```bash
cd /opt/volleyball-mobile

# По умолчанию (COMPOSE_FILE в .env) поднимается весь стек:
# pocketbase (из dockerfile.pb) + server + frontend
docker compose up -d

# Только API и фронтенд, без контейнера PocketBase
# (внешняя/хостовая БД — задайте POCKETBASE_URL в .env):
docker compose -f docker-compose.yml up -d

# Проверить статус (все три контейнера, pocketbase и server — healthy)
docker compose ps

# Показать логи
docker compose logs -f

# Логи только PocketBase
docker compose logs -f pocketbase

# Остановка
docker compose down
```

---

## Инициализация БД и PocketBase (первый запуск)

Свежий контейнер PocketBase пустой: в нём нет ни суперпользователя, ни коллекций,
поэтому API-серверу не с чем работать. Инициализация выполняется одним скриптом
из корня проекта:

```bash
./scripts/init-pocketbase.sh
```

Что делает скрипт:

1. создаёт/обновляет суперпользователя PocketBase
   (`docker exec volleyball_pb /pb/pocketbase superuser upsert EMAIL PASS`);
2. создаёт структуру БД из **`pb_schema.json`** — коллекции `volleyball`,
   `matches`, `scoreusers`, `auth_log`, `templates` и служебную `app_users`
   (источник схемы переопределяется: `PB_SCHEMA_FILE=... ./scripts/init-pocketbase.sh`,
   fallback — устаревший `pocketbase_collections_export.json`);
3. создаёт сервисного пользователя `app_users` из `credentials.js`
   (`app@volleyball.local`) — под ним API-сервер и фронтенд работают с данными;
4. применяет правила доступа согласно `ENABLE_AUTH` (см. опцию `--rules`);
5. перезапускает контейнер API (клиент БД кэшируется при старте) и печатает
   состояние `/health` обоих контейнеров.

Скрипт идемпотентен — повторный запуск ничего не ломает и не пересоздаёт.

Полезные опции:

```bash
./scripts/init-pocketbase.sh --help
./scripts/init-pocketbase.sh --no-restart          # не перезапускать API
./scripts/init-pocketbase.sh --reset-app-user-password

# правила доступа: auto (по ENABLE_AUTH, по умолчанию) | auth | guest | skip
./scripts/init-pocketbase.sh --rules=auth

# дополнительно создать администратора в scoreusers (вкладка «Админ» в приложении)
INIT_ADMIN_USERNAME=admin INIT_ADMIN_EMAIL=admin@volleyball.local \
INIT_ADMIN_PASSWORD=secret123 ./scripts/init-pocketbase.sh
```

> Поменяли `ENABLE_AUTH` (в `.env` и в `credentials.js → auth.enabled`)?
> Перезапустите `./scripts/init-pocketbase.sh`, чтобы правила коллекций
> соответствовали новому режиму.

Внутри контейнера структуру можно создать и без обёртки:

```bash
docker cp pb_schema.json volleyball_server:/tmp/
docker exec -i -e POCKETBASE_URL=http://pocketbase:8090 volleyball_server \
  node - < server/scripts/init-db.js
```

После инициализации `GET /health` должен возвращать `status: "ok"`, а не `degraded`;
в логах сервера появится `✅ PocketBase authenticated as app_user`.

---

## Проверка работоспособности

### Быстрая проверка

```bash
# Healthcheck API
curl -s http://localhost:3000/health | jq .

# Ожидаемый ответ:
# {
#   "status": "ok",
#   "provider": "pocketbase",
#   "timestamp": "2024-..."
# }
```

### Проверка через внешний адрес

```bash
# Frontend
curl -s -o /dev/null -w "%{http_code}" http://ваш-домен.ru:8080

# API
curl -s -o /dev/null -w "%{http_code}" http://ваш-домен.ru:3000/health

# PocketBase Admin (если запущен)
curl -s -o /dev/null -w "%{http_code}" http://ваш-домен.ru:8090/_/
```

### Логи

```bash
# Все сервисы
docker compose logs --tail=100

# Конкретный сервис
docker compose logs --tail=100 server
docker compose logs --tail=100 pocketbase
```

---

## Обновление на сервере

### Когда образ обновился локально

```bash
# 1. Собрать новый образ
docker compose build server

# 2. Сохранить
docker save vb_mobile-server:latest -o deploy/vb_mobile-server.tar
tar czf deploy/vb_mobile-server.tar.gz -C deploy vb_mobile-server.tar

# 3. Скопировать на сервер
scp deploy/vb_mobile-server.tar.gz user@server.example.com:/tmp/

# 4. На сервере — загрузить и перезапустить
ssh user@server.example.com << 'EOS'
cd /opt/volleyball-mobile
gunzip -c /tmp/vb_mobile-server.tar.gz | docker load
docker compose down
docker compose up -d
docker system prune -f
EOS
```

### Без даунтайма (rolling update)

Если используется Docker Swarm — см. раздел "Миграция на Docker Swarm".
Для Compose-режима downtime неизбежен при обновлении API.

---

## Миграция на Docker Swarm

Docker Swarm позволяет делать blue/green деплой без простоев.

### 1. Инициализация Swarm (на сервере)

```bash
ssh user@server.example.com
docker swarm init
```

Если серверов несколько — используются manager/worker ноды.

### 2. Подготовка стека

Создать docker-stack.yml (аналог docker-compose.yml, но с параметрами для Swarm).
Образы к моменту деплоя должны существовать на ноде (соберите на сервере:
`docker compose build` или загрузите через `docker load` — Swarm сам сборку
не выполняет):

```yaml
version: "3.8"

services:
  pocketbase:
    image: vb_mobile-pocketbase:${PB_VERSION:-0.36.6}
    ports:
      - "${POCKETBASE_PORT:-8090}:8090"
    volumes:
      - pb_data:/pb/pb_data
    environment:
      - POCKETBASE_ENV=${POCKETBASE_ENV:-production}
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8090/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  server:
    image: vb_mobile-server:latest
    ports:
      - "${API_PORT:-3000}:3000"
    volumes:
      - ./server/.env:/usr/src/app/.env:ro
    environment:
      - NODE_ENV=${API_NODE_ENV:-production}
      - PORT=3000
      - DB_PROVIDER=${DB_PROVIDER:-pocketbase}
      - POCKETBASE_URL=http://pocketbase:8090
      - POCKETBASE_ADMIN_EMAIL=${POCKETBASE_ADMIN_EMAIL:-admin@volleyball.local}
      - POCKETBASE_ADMIN_PASSWORD=${POCKETBASE_ADMIN_PASSWORD:-}
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-*}
      - ENABLE_SWAGGER=false
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 10s
        failure_action: rollback
      restart_policy:
        condition: on-failure
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 5
  # Внимание: Swarm игнорирует depends_on — порядок старта не гарантирован.
  # До готовности PocketBase /health вернёт "degraded", затем восстановится.

  frontend:
    image: nginx:alpine
    ports:
      - "${FRONTEND_PORT:-8080}:80"
    volumes:
      - ./:/usr/share/nginx/html:ro
      - ./nginx.conf.template:/etc/nginx/templates/default.conf.template:ro
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
    depends_on:
      api:
        condition: service_healthy

volumes:
  pb_data:
    driver: local
```

### 3. Deploy стека

```bash
# Создать .env на сервере (см. выше)
cd /opt/volleyball-mobile

# Deploy
docker stack deploy -c docker-stack.yml volleyball

# Статус
docker stack services volleyball
docker service ls

# Логи
docker service logs volleyball_server
docker service logs volleyball_frontend
docker service logs volleyball_pocketbase
```

### 4. Обновление в Swarm (без даунтайма)

```bash
# 1. Загрузить новый образ
gunzip -c /tmp/vb_mobile-server.tar.gz | docker load

# 2. Поднять новый образ (Swarm сам сделает rolling update)
docker service update --image vb_mobile-server:latest volleyball_server

# 3. Следить за обновлением
docker service ps volleyball_server

# 4. Удалить старые образы
docker image prune -f
```

### 5. Откат при проблемах

```bash
# Откатиться к предыдущей ревизии
docker service update --rollback volleyball_server
```

### 6. Удаление стека

```bash
docker stack rm volleyball
```

---

## Переменные окружения

### docker-compose.yml (корневой .env)

`COMPOSE_FILE=docker-compose.yml:docker-compose.pb.yml` в `.env` склеивает оба
файла: `docker compose up -d` поднимает весь стек (pocketbase + server +
frontend). Явный флаг `-f docker-compose.yml` перекрывает `COMPOSE_FILE`
и запускает только server + frontend (без контейнера PocketBase).

Порты и переменные PocketBase-контейнера (`POCKETBASE_ENV`, `PB_VERSION`,
`POCKETBASE_MEMORY_LIMIT`) используются только файлом `docker-compose.pb.yml`.
`POCKETBASE_PORT` — **только хостовая публикация** `0.0.0.0:${POCKETBASE_PORT}:8090`
(внутрь образов он НЕ запекается: фоллбэк в `js/db-config.js` — всегда
`http://pocketbase:8090`, см. «Локальная сборка → 1.1»). Поэтому при смене
`POCKETBASE_PORT` пересборка образов **не нужна** — достаточно
`docker compose up -d`.

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| POCKETBASE_PORT | 8090 | Только хостовая публикация PocketBase (`0.0.0.0:порт→8090`); внутрь образов не запекается |
| API_PORT | 3000 | Порт API сервера (только хостовой; внутри контейнера фиксирован 3000) |
| FRONTEND_PORT | 8080 | Порт фронтенда |
| APP_PREFIX | /vb/ | Уникальный префикс same-origin путей (`<префикс>pb/`, `<префикс>api/`); рендерится в nginx из шаблона и отдаётся браузеру в `/vb-config.js` |
| POCKETBASE_ENV | production | Режим PocketBase |
| POCKETBASE_URL | http://pocketbase:8090 | URL PocketBase для API |
| POCKETBASE_ADMIN_EMAIL | admin@volleyball.local | Email админа PB |
| POCKETBASE_ADMIN_PASSWORD | — | Пароль админа PB |
| ALLOWED_ORIGINS | * | CORS origins (разделённые пробелом) |
| API_NODE_ENV | production | NODE_ENV для API |
| ENABLE_SWAGGER | true | Включить Swagger UI |
| FRONTEND_HOST | localhost | Host для Nginx |

### server/.env (только для запуска API вне Docker)

> В Docker-режиме этот файл **не монтируется**: все переменные приходят из
> `environment:` в `docker-compose.yml`. Таблица ниже — для локального запуска
> `node server/src/index.js` на хосте.

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| PORT | 3000 | Порт, который слушает API |
| POCKETBASE_URL | http://localhost:8090 | URL PocketBase (на хосте — loopback) |
| POCKETBASE_ADMIN_EMAIL | admin@volleyball.local | Email админа PB |
| POCKETBASE_ADMIN_PASSWORD | — | Пароль админа PB |
| ALLOWED_ORIGINS | * | CORS origins |
| NODE_ENV | production | Режим Node.js |
| ENABLE_SWAGGER | true | Включить Swagger UI |

---

## Потенциальные проблемы

### 1. PocketBase-образ (историческая справка: ранее был denied из ghcr.io)

Внешний образ с ghcr.io больше не используется: `docker-compose.pb.yml`
собирает PocketBase локально из `dockerfile.pb` (бинарник скачивается
с официального GitHub-релиза) и включается в стек через `COMPOSE_FILE`.

**Решения:**
- Собрать образ: `docker compose build pocketbase` (затем `docker compose up -d`)
- Задать другую версию: `PB_VERSION=0.40.4 docker compose build pocketbase`
- Или запустить PocketBase вне Docker (бинарник на хосте) и использовать
  только `docker compose -f docker-compose.yml up -d`, указав `POCKETBASE_URL` в `.env`

### 2. API работает, но данные не читаются (PocketBase недоступен)

Сервер не падает при недоступной БД: `/health` вернёт `"status":"degraded"`,
а запросы к коллекциям будут завершаться ошибкой. Проверьте:
- `POCKETBASE_URL` в `.env` (для `docker-compose.pb.yml` — `http://pocketbase:8090`)
- доступность PocketBase: `curl http://localhost:8090/api/health`
- логи: `docker compose logs -f server`

### 3. Swagger UI не работает в production

Swagger UI управляется переменной `ENABLE_SWAGGER` (в `server/src/index.js`:
включён, если `ENABLE_SWAGGER=true` **или** `NODE_ENV != production`).
По умолчанию в `.env.example` он включён; для продакшена с закрытым внешним
доступом к порту 3000 можно оставить. Чтобы выключить:

```bash
# В .env на сервере
ENABLE_SWAGGER=false
# и перезапустить
docker compose restart server
```

Проверка: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api-docs/`

### 4. CORS ошибки

```bash
# В server/.env
ALLOWED_ORIGINS=https://ваш-домен.ru
```

Или * для разработки (не для продакшена).

### 5. Кнопка «Сохранить» не работает, в консоли браузера ошибки сети

Браузер ходит в PocketBase через **same-origin путь `<APP_PREFIX>pb/`** (по
умолчанию `/vb/pb/`; см. `credentials.js` → `pocketbase.url`): nginx фронтенда
проксирует его в контейнер `pocketbase` (см. `nginx.conf.template`, location
`${APP_PREFIX}pb/`). Если сохранение не работает:

```bash
# 1) прокси отвечает JSON'ом PocketBase (а не HTML мобильной страницы)?
curl http://localhost:8080/vb/pb/api/health
#    {"message":"API is healthy.",...}

# 2) если 502 — контейнер pocketbase не запущен или называется иначе
docker compose ps
# для внешней/хостовой БД: nginx не найдёт контейнер "pocketbase" —
# тогда замените upstream в nginx.conf.template (set $pb_upstream ...) на адрес БД
```

Префикс задаётся переменной `APP_PREFIX` (.env): при её смене достаточно
`docker compose up -d frontend` — пересборка не нужна (nginx рендерит конфиг из
шаблона при старте и отдаёт префикс браузеру в `/vb-config.js`).
После изменения самого шаблона пересоберите фронтенд
(`docker compose build frontend`) и перечитайте конфиг:
`docker exec volleyball_frontend nginx -s reload`.
Также выполните жёсткое обновление страницы (Ctrl+Shift+R), чтобы браузер
забрал свежий `credentials.js` (service worker кэширует GET-ответы).

### 6. Данные PocketBase не сохраняются после пересоздания контейнера

Убедиться, что каталог с БД подключен bind-mount'ом (в `docker-compose.pb.yml`):

```yaml
volumes:
  - ./pb_data:/pb/pb_data
```

### 6. Нет места на сервере

```bash
# Очистить неиспользуемые образы
docker image prune -a -f

# Очистить всё неиспользуемое
docker system prune -a -f

# Проверить место
df -h
docker system df
```

### 7. Порты уже заняты

```bash
# Проверить, кто занимает порт
sudo lsof -i :3000
sudo lsof -i :8080
sudo lsof -i :8090

# Или
ss -tlnp | grep -E '3000|8080|8090'

# Закрыть процесс или сменить порт в .env
```

---

## Структура проекта для деплоя

```
vb_mobile/
├── docker-compose.yml         # Оркестрация без PocketBase (server + frontend)
├── docker-compose.pb.yml      # То же + локальный контейнер PocketBase
├── dockerfile.pb              # Dockerfile образа PocketBase
├── pb_data/                   # Данные PocketBase (создаётся при запуске)
├── docker-stack.yml           # Оркестрация (Swarm) — создать отдельно
├── .env                       # Переменные окружения проекта
├── nginx.conf.template        # Шаблон конфига Nginx (envsubst: APP_PREFIX)
├── credentials.js             # Учётные данные БД (фронтенд + сервер)
├── vb-config.js               # Fallback-префикс путей (в Docker отдаёт nginx из APP_PREFIX)
├── server/
│   ├── Dockerfile             # Сборка образа API
│   ├── .dockerignore          # Исключения для Docker build
│   ├── .env                   # Переменные API сервера (монтируется в контейнер)
│   ├── package.json           # Зависимости Node.js
│   └── src/
│       └── index.js          # Точка входа API
├── pb_migrations/             # Миграции PocketBase (опционально)
└── deploy/                    # Артефакты для передачи на сервер
    └── vb_mobile-server.tar.gz  # Сохранённый образ API
```

---

## Чек-лист перед production-deploy

- [ ] Образ vb_mobile-server собран без ошибок
- [ ] .env файлы настроены на сервере (пароли, origins, порты)
- [ ] credentials.js не содержит секретов (или используется credentials.local.js)
- [ ] Swagger UI отключён в production (ENABLE_SWAGGER=false)
- [ ] Порты открыты на сервере (firewall / security groups)
- [ ] Проверена связность: сервер -> PocketBase (если используется)
- [ ] Настроено резервное копирование pb_data (если используется PocketBase)
- [ ] Настроено логирование (docker logs / внешняя система)
- [ ] Настроен мониторинг (healthcheck, alerting)

