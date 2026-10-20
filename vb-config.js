/**
 * Fallback-конфиг фронтенда: префикс same-origin путей.
 *
 * В Docker этот файл по HTTP НЕ отдаётся: nginx (см. nginx.conf.template,
 * `location = /vb-config.js`) возвращает то же содержимое, но со значением
 * переменной окружения APP_PREFIX — поэтому в контейнере префикс меняется
 * без пересборки статики.
 *
 * Файл нужен только при раздаче статики БЕЗ нашего nginx (например, локально
 * через Live Server / `python -m http.server`): тогда credentials.js берёт
 * префикс отсюда. Значение должно совпадать с APP_PREFIX вашего прокси.
 * По умолчанию — '/vb/'.
 *
 * Подключается в HTML ДО credentials.js (см. mobile.html и др.).
 */
window.VB_APP_PREFIX = '/vb/';
