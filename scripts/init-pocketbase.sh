#!/usr/bin/env bash
# ============================================================================
# Инициализация БД PocketBase в контейнерах Volleyball Scoreboard
# ============================================================================
# Что делает:
#   1. создаёт/обновляет суперпользователя PocketBase (CLI внутри контейнера);
#   2. создаёт структуру БД (коллекции volleyball, matches, scoreusers,
#      auth_log, templates, app_users) и сервисного пользователя app_users;
#   3. перезапускает контейнер API, чтобы он подключился к БД;
#   4. показывает состояние /health обоих контейнеров.
#
# Использование:
#   ./scripts/init-pocketbase.sh [опции]
#
# Опции:
#   --pb-container NAME    контейнер PocketBase     (по умолчанию volleyball_pb)
#   --api-container NAME   контейнер API-сервера    (по умолчанию volleyball_server)
#   --collections FILE     файл структуры БД        (по умолчанию
#                          ./pb_schema.json, fallback —
#                          ./pocketbase_collections_export.json;
#                          если на хосте нет ни того ни другого — берётся
#                          запечённая в образ API копия /usr/src/pb_schema.json)
#   --no-restart           не перезапускать контейнер API
#   --no-app-user          не создавать сервисного пользователя app_users
#   --reset-app-user-password  перезаписать пароль сервисного пользователя
#   --no-check             без самопроверки подключения
#   --rules MODE           правила доступа: auto (по ENABLE_AUTH из .env),
#                          auth, guest, skip
#   -h, --help             эта справка
#
# Переменные окружения (иначе берутся из корневого .env):
#   POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD
#   POCKETBASE_PORT   — хостовой порт PB (для итоговой ссылки; внутри — 8090)
#   API_PORT          — хостовой порт API (для итоговой ссылки; внутри — 3000)
#   FRONTEND_PORT     — хостовой порт фронтенда (админка PB через /pb/_/)
#   POCKETBASE_INTERNAL_URL — адрес PB внутри Docker-сети
#                          (по умолчанию http://pocketbase:8090)
#   INIT_ADMIN_USERNAME / INIT_ADMIN_EMAIL / INIT_ADMIN_PASSWORD
#     — дополнительно создать администратора в scoreusers
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PB_CONTAINER="${PB_CONTAINER:-volleyball_pb}"
API_CONTAINER="${API_CONTAINER:-volleyball_server}"
COLLECTIONS_FILE=""
INIT_JS_HOST="$ROOT_DIR/server/scripts/init-db.js"
INIT_JS="$INIT_JS_HOST"
RESTART=1
INIT_ARGS=()

usage() {
  # Печатает весь шапочный комментарий (до строки set -euo...), не зависимо
  # от того, насколько он вырастет
  sed -n '2,/^set -euo pipefail/ {/^set -euo pipefail/!p}' "${BASH_SOURCE[0]}" \
    | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pb-container) PB_CONTAINER="$2"; shift 2 ;;
    --api-container) API_CONTAINER="$2"; shift 2 ;;
    --collections) COLLECTIONS_FILE="$2"; shift 2 ;;
    --no-restart) RESTART=0; shift ;;
    --no-app-user|--no-check|--reset-app-user-password) INIT_ARGS+=("$1"); shift ;;
    --rules) INIT_ARGS+=(--rules "$2"); shift 2 ;;
    --rules=*) INIT_ARGS+=("$1"); shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "✗ Неизвестный аргумент: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# Приоритет: pb_schema.json (актуальная структура, экспорт PocketBase),
# fallback — старый pocketbase_collections_export.json
if [[ -z "$COLLECTIONS_FILE" ]]; then
  if [[ -n "${PB_COLLECTIONS_FILE:-}" ]]; then
    COLLECTIONS_FILE="$PB_COLLECTIONS_FILE"
  elif [[ -f "$ROOT_DIR/pb_schema.json" ]]; then
    COLLECTIONS_FILE="$ROOT_DIR/pb_schema.json"
  elif [[ -f "$ROOT_DIR/pocketbase_collections_export.json" ]]; then
    COLLECTIONS_FILE="$ROOT_DIR/pocketbase_collections_export.json"
  else
    # На хосте файлов нет — используем запечённую в образ API копию
    COLLECTIONS_FILE=""
  fi
fi

# Значения из корневого .env — так же, как их видит docker compose
env_file_value() {
  local key="$1"
  [[ -f "$ROOT_DIR/.env" ]] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" "$ROOT_DIR/.env" | tail -n 1
}

PB_ADMIN_EMAIL="${POCKETBASE_ADMIN_EMAIL:-$(env_file_value POCKETBASE_ADMIN_EMAIL)}"
PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:-admin@volleyball.local}"
PB_ADMIN_PASSWORD="${POCKETBASE_ADMIN_PASSWORD:-$(env_file_value POCKETBASE_ADMIN_PASSWORD)}"
PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-Mer1in}"
# Внутренний адрес PocketBase — только контейнерная сеть: PB слушает 8090
# внутри контейнера всегда (dockerfile.pb), POCKETBASE_PORT из .env — хостовой.
# Переопределяется POCKETBASE_INTERNAL_URL в окружении или в .env.
PB_INTERNAL_URL="${POCKETBASE_INTERNAL_URL:-$(env_file_value POCKETBASE_INTERNAL_URL)}"
PB_INTERNAL_URL="${PB_INTERNAL_URL:-http://pocketbase:8090}"
PB_PUBLIC_PORT="${POCKETBASE_PORT:-$(env_file_value POCKETBASE_PORT)}"
PB_PUBLIC_PORT="${PB_PUBLIC_PORT:-8090}"
# Хостовой порт API (для итоговых ссылок); внутри контейнера всегда 3000
API_PUBLIC_PORT="${API_PORT:-$(env_file_value API_PORT)}"
API_PUBLIC_PORT="${API_PUBLIC_PORT:-3000}"
# Хостовой порт фронтенда — прокси /pb/ (админка PB для браузера/сети)
FE_PUBLIC_PORT="${FRONTEND_PORT:-$(env_file_value FRONTEND_PORT)}"
FE_PUBLIC_PORT="${FE_PUBLIC_PORT:-8080}"

step() { printf '\n== %s\n' "$*"; }

# ---------------------------------------------------------------- проверки ---
# Файлы на хосте НЕ обязательны: init-db.js и pb_schema.json запечены
# в образ API (server/Dockerfile). Файл с хоста имеет приоритет — так удобно
# обновлять схему/скрипт при локальной разработке.
command -v docker >/dev/null 2>&1 || { echo "✗ docker не найден в PATH" >&2; exit 1; }

for container in "$PB_CONTAINER" "$API_CONTAINER"; do
  if [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo false)" != "true" ]]; then
    echo "✗ контейнер $container не запущен." >&2
    echo "  Поднимите стек:  docker compose up -d   (или docker compose -f docker-compose.yml up -d)" >&2
    exit 1
  fi
done

if [[ ! -f "$INIT_JS" ]]; then
  if docker exec "$API_CONTAINER" sh -c 'test -f /usr/src/app/scripts/init-db.js' 2>/dev/null; then
    echo "• $INIT_JS_HOST не найден на хосте — используем скрипт из образа API"
    INIT_JS=""
  else
    echo "✗ не найден $INIT_JS_HOST, и он не запечён в образ API" >&2
    exit 1
  fi
fi

if [[ -n "$COLLECTIONS_FILE" ]]; then
  [[ -f "$COLLECTIONS_FILE" ]] || { echo "✗ не найден файл структуры БД: $COLLECTIONS_FILE" >&2; exit 1; }
elif ! docker exec "$API_CONTAINER" sh -c 'test -f /usr/src/pb_schema.json' 2>/dev/null; then
  echo "✗ pb_schema.json не найден ни на хосте, ни в образе API" >&2
  exit 1
fi

# ------------------------------------------------------------- 1. суперюзер ---
step "1/4 Суперпользователь PocketBase ($PB_ADMIN_EMAIL)"
docker exec "$PB_CONTAINER" /pb/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" \
  | sed 's/^/   /'

# -------------------------------------------------- 2. структура БД и юзеры ---
step "2/4 Структура БД и сервисный пользователь"

# Схема: файл с хоста копируется в контейнер; если на хосте его нет —
# используется запечённая в образ копия (/usr/src/pb_schema.json).
if [[ -n "$COLLECTIONS_FILE" ]]; then
  docker cp "$COLLECTIONS_FILE" "$API_CONTAINER:/tmp/pb_collections_export.json" >/dev/null
  PB_SCHEMA_FILE=/tmp/pb_collections_export.json
else
  PB_SCHEMA_FILE=/usr/src/pb_schema.json
  echo "• pb_schema.json не найден на хосте — используем схему из образа API"
fi

INIT_ENV=(
  -e POCKETBASE_URL="$PB_INTERNAL_URL"
  -e POCKETBASE_ADMIN_EMAIL="$PB_ADMIN_EMAIL"
  -e POCKETBASE_ADMIN_PASSWORD="$PB_ADMIN_PASSWORD"
  -e PB_COLLECTIONS_FILE="$PB_SCHEMA_FILE"
  -e APP_USER_EMAIL="${APP_USER_EMAIL:-}"
  -e APP_USER_PASSWORD="${APP_USER_PASSWORD:-}"
  -e INIT_ADMIN_USERNAME="${INIT_ADMIN_USERNAME:-}"
  -e INIT_ADMIN_EMAIL="${INIT_ADMIN_EMAIL:-}"
  -e INIT_ADMIN_PASSWORD="${INIT_ADMIN_PASSWORD:-}"
  -e INIT_RESET_APP_USER_PASSWORD="${INIT_RESET_APP_USER_PASSWORD:-}"
  -e ENABLE_AUTH="${ENABLE_AUTH:-$(env_file_value ENABLE_AUTH)}"
)

# Скрипт: файл с хоста (через stdin) либо запечённый в образ
# /usr/src/app/scripts/init-db.js
if [[ -n "$INIT_JS" ]]; then
  docker exec -i "${INIT_ENV[@]}" \
    "$API_CONTAINER" node - "${INIT_ARGS[@]+"${INIT_ARGS[@]}"}" < "$INIT_JS"
else
  docker exec -i "${INIT_ENV[@]}" \
    "$API_CONTAINER" node /usr/src/app/scripts/init-db.js "${INIT_ARGS[@]+"${INIT_ARGS[@]}"}"
fi

# ------------------------------------------------------- 3. перезапуск API ---
if [[ "$RESTART" -eq 1 ]]; then
  step "3/4 Перезапуск контейнера API ($API_CONTAINER) — подключение к БД при старте"
  docker restart "$API_CONTAINER" >/dev/null
  sleep 6
  docker logs --tail 12 "$API_CONTAINER" 2>&1 | sed 's/^/   /'
else
  step "3/4 Перезапуск API пропущен (--no-restart)"
  echo "   Не забудьте: docker restart $API_CONTAINER"
fi

# ------------------------------------------------------------ 4. проверка ---
step "4/4 Проверка /health"
printf '   PocketBase: '
# 8090 — фиксированный внутренний порт контейнера PB (не путать с POCKETBASE_PORT)
docker exec "$PB_CONTAINER" wget -q -O - http://127.0.0.1:8090/api/health 2>/dev/null || printf 'нет ответа'
printf '\n   API:        '
# Порт берётся из окружения самого контейнера (задаёт compose: PORT=3000)
docker exec "$API_CONTAINER" sh -c 'wget -q -O - "http://127.0.0.1:${PORT:-3000}/health"' 2>/dev/null || printf 'нет ответа'
printf '\n'

echo
echo "== Готово =="
echo "   Админка PocketBase: http://localhost:$PB_PUBLIC_PORT/_/  ($PB_ADMIN_EMAIL)"
echo "     (порт PB опубликован на 0.0.0.0 — доступен и из сети;"
echo "      через браузер также: http://localhost:$FE_PUBLIC_PORT/pb/_/)"
echo "   API (хост):         http://localhost:$API_PUBLIC_PORT/health"
echo "   Статус API должен быть \"ok\", а не \"degraded\"."
