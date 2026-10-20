#!/usr/bin/env bash
# =============================================================================
# Сборка Docker-образов стека с автоматическими повторами
# =============================================================================
# Проблема: первый проход `docker compose build` может упасть на разрешении
# базовых образов (alpine:3.21, node:18-alpine, nginx:alpine), если в момент
# сборки registry-1.docker.io недоступен (обрыв сети, отсутствие IPv6-маршрута
# при AAAA-ответе DNS и т.п.). Ошибки выглядят как:
#   failed to resolve source metadata for docker.io/library/alpine:3.21
#   dial tcp [...]: network is unreachable
# На втором проходе сеть обычно уже отвечает, и сборка проходит.
#
# Скрипт повторяет сборку ТОЛЬКО при сетевых ошибках resolve/pull; ошибки
# самих Dockerfile (syntax error, failed RUN) не ретраятся — они детерминированы.
#
# Использование (из корня репозитория):
#   ./scripts/build.sh                  # все сервисы, до 3 попыток
#   ./scripts/build.sh server           # только API-сервер
#   BUILD_ATTEMPTS=5 ./scripts/build.sh # больше попыток
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

ATTEMPTS="${BUILD_ATTEMPTS:-3}"
DELAY="${BUILD_RETRY_DELAY:-5}"   # базовая пауза, удваивается после каждой попытки

# Маркеры транзиентных сетевых ошибок при resolve/pull базовых образов.
# Всё остальное (ошибки сборки слоёв) считаем фатальным и не повторяем.
NETWORK_ERROR_PATTERN='failed to resolve source metadata|network is unreachable|connection reset|i/o timeout|dial tcp|no such host|server misbehaving|toomanyrequests|EOF|unexpected EOF|TLS handshake'

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker не найден в PATH" >&2
  exit 1
fi

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

attempt=1
while :; do
  echo "== Попытка $attempt/$ATTEMPTS: docker compose build $*"
  docker compose build "$@" 2>&1 | tee "$LOG"
  status=${PIPESTATUS[0]}

  if [ "$status" -eq 0 ]; then
    echo "✓ Сборка успешна (попытка $attempt/$ATTEMPTS)"
    exit 0
  fi

  # Повторяем только при сетевой ошибке в выводе последней попытки
  if ! grep -qE "$NETWORK_ERROR_PATTERN" "$LOG"; then
    echo "✗ Сборка упала с ошибкой, не связанной со сетью — повтор не нужен" >&2
    exit "$status"
  fi

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "✗ Сетевая ошибка сборки после $ATTEMPTS попыток — см. вывод выше" >&2
    exit "$status"
  fi

  echo "! Сетевая ошибка registry — повтор через ${DELAY}с ..."
  sleep "$DELAY"
  DELAY=$((DELAY * 2))
  attempt=$((attempt + 1))
done
