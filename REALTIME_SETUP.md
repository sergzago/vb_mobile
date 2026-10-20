# Настройка realtime-push (SSE) для PocketBase

Realtime-обновления (мгновенная синхронизация табло, пульта и мобильного
интерфейса) работают через SSE-соединение `GET/POST /api/realtime`.

## 1. Соответствие версий PocketBase и JS SDK

Клиент загружает SDK `pocketbase@0.26.8` (`js/db-interface.js`).
Формат realtime-подписок изменился в PocketBase **v0.23**, поэтому сервер
должен быть **не ниже 0.23**. Версия PocketBase задаётся в `dockerfile.pb`
(и переопределяется переменной `PB_VERSION` в `docker-compose.pb.yml`).

При смене SDK не забудьте обновить и сервер, и наоборот.

## 2. Реверс-прокси (nginx)

SSE не работает через прокси «по умолчанию» — nginx буферизует ответ.
Для локации, которая проксирует PocketBase (в проекте — субпуть
`<APP_PREFIX>pb/`, по умолчанию `/vb/pb/`; см. `nginx.conf.template`), нужно:

```nginx
location ${APP_PREFIX}pb/ {
    resolver 127.0.0.11 valid=30s ipv6=off;
    set $pb_upstream http://pocketbase:8090;   # в docker-сети; вне docker — 127.0.0.1:8090
    rewrite ^${APP_PREFIX}pb/(.*)$ /$1 break;
    proxy_pass $pb_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection '';        # keep-alive для SSE
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_buffering off;                   # КРИТИЧНО для SSE
    proxy_cache off;
    proxy_read_timeout 3600s;              # держать соединение открытым
    proxy_send_timeout 3600s;
    chunked_transfer_encoding on;
}
```

Без `proxy_buffering off` SSE-соединение не устанавливается, у клиента
нет `clientId`, и каждый `POST /api/realtime` возвращает **404**.

## 3. Проверка

1. Открыть страницу, DevTools → Network:
   - `GET .../api/realtime` должен иметь статус **200** и тип `eventsource`,
     соединение — висеть открытым;
   - после него `POST .../api/realtime` — **204** (подписка принята).
2. Изменить счёт на одном клиенте — на остальных обновление приходит
   мгновенно (без ожидания страховочного опроса).

## 4. Откат

Если SSE через прокси настроить невозможно, в `credentials.js` установите
`realtime: false` — SSE-подписка отключается, всё работает через
страховочный опрос (задержка ~1–2 сек, см. оптимизацию кэша
`findRecordByCustomId` в `js/db-interface.js`).
