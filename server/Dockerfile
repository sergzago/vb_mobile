# =============================================================================
# Volleyball Scoreboard — API сервер (Node.js/Express)
# =============================================================================
# Контекст сборки — КОРЕНЬ репозитория (docker-compose: context: .),
# чтобы запечь общие файлы, которые код ищет ВНЕ каталога приложения:
#   require('../../../credentials.js')   → /usr/src/credentials.js
#   require('../../../js/db-config')     → /usr/src/js/db-config
#   init-скрипту: pb_schema.json         → /usr/src/pb_schema.json
#
# На сервере нужен только готовый образ: server/.env, credentials.js, js/ и
# схема в контейнер НЕ монтируются (переменные приходят из environment:
# docker-compose, файлы — из этого образа).
# =============================================================================
FROM node:18-alpine

WORKDIR /usr/src/app

# Зависимости (слой кэшируется, пока не меняется package.json/package-lock.json)
COPY server/package*.json ./
# --omit=dev — актуальная замена устаревшего --only=production (npm ≥ 9);
# --no-audit/--no-fund — убирает лишние сетевые запросы при высоком RTT до registry
RUN npm ci --omit=dev --no-audit --no-fund

# Исходники API, init-скрипт, swagger
COPY server/src ./src
COPY server/scripts ./scripts
COPY server/swagger.yaml ./

# Общие файлы (пути резолва см. шапку)
COPY js /usr/src/js
COPY credentials.js /usr/src/credentials.js
COPY pb_schema.json /usr/src/pb_schema.json
COPY pocketbase_collections_export.json /usr/src/pocketbase_collections_export.json

# Логи авторизации: в docker-compose монтируется named volume server_logs.
# Каталог создаём заранее и отдаём пользователю node: Docker копирует владельца
# в первый смонтированный named volume, иначе запись из контейнера не сработает.
RUN mkdir -p /usr/src/logs \
 && chown -R node:node /usr/src/app /usr/src/js /usr/src/credentials.js /usr/src/logs

# Порт, который слушает приложение
EXPOSE 3000

# Не запускаем от root для безопасности
USER node

# Запуск приложения
CMD [ "node", "src/index.js" ]
