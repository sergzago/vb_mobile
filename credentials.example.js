/**
 * Шаблон учетных данных провайдеров базы данных
 *
 * ⚠️  Скопируйте этот файл в credentials.js и заполните реальными значениями:
 *     cp credentials.example.js credentials.js
 *
 * 🔒 Файл credentials.js добавлен в .gitignore и не синхронизируется через Git 
 */

// ============================================================================
// ПРЕФИКС SAME-ORIGIN ПУТЕЙ (настраиваемый)
// ============================================================================
// Фронтенд обращается к БД и API по относительным путям внутри текущего origin.
// Nginx фронтенда проксирует их в docker-сеть:
//     <APP_PREFIX>pb/  → контейнер pocketbase:8090
//     <APP_PREFIX>api/ → контейнер server:3000
// Префикс НЕ корневой (не '/pb/' и не '/api/'), чтобы не конфликтовать с чужими
// путями на общем домене и с внешним reverse-proxy.
// Значение присоединяется к КАТАЛОГУ текущей страницы, поэтому работает и под
// подпутём: https://host/myvb/ + vb/ → /myvb/vb/.
// Приоритет: window.VB_APP_PREFIX (рантайм, из APP_PREFIX nginx) → 'vb/'.
function _appDir() {
  try {
    if (typeof window === 'undefined' || !window.location) return '/';
    var href = (typeof document !== 'undefined' && document.baseURI)
      ? document.baseURI
      : window.location.href;
    if (href) {
      var dir = new URL('.', href).pathname;
      if (dir) return dir;
    }
  } catch (e) {}
  return '/';
}

var APP_PREFIX_SUFFIX = (typeof window !== 'undefined' && window.VB_APP_PREFIX)
  ? String(window.VB_APP_PREFIX)
  : 'vb/';
APP_PREFIX_SUFFIX = APP_PREFIX_SUFFIX.replace(/^\/+/, '').replace(/\/+$/, '') + '/';

var APP_PREFIX = _appDir().replace(/\/+$/, '') + '/' + APP_PREFIX_SUFFIX;

var CREDENTIALS = {
  // ============================================================================
  // СЕРВЕР (Node.js API)
  // ============================================================================
  server: {
    url: '',                        // Абсолютный URL API ('' = текущий origin)
    prefix: APP_PREFIX + 'api/'     // Same-origin путь API (nginx → server:3000)
  },

  // ============================================================================
  // POCKETBASE УЧЕТНЫЕ ДАННЫЕ
  // ============================================================================
  pocketbase: {
    // URL для браузера (PocketBase SDK): same-origin, nginx → pocketbase:8090
    url: APP_PREFIX + 'pb/',
    // Администратор (для управления пользователями)
    adminEmail: 'admin@example.com',
    adminPassword: 'your_admin_password',

    // Обычный пользователь (для чтения/записи данных в коллекциях)
    // Создается через: node create-pocketbase-user.js
    user_email: 'app@example.com',
    user_password: 'your_app_user_password'
  }
};

// Экспорт для Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CREDENTIALS;
}
