/**
 * Шаблон учетных данных провайдеров базы данных
 *
 * ⚠️  Скопируйте этот файл в credentials.js и заполните реальными значениями:
 *     cp credentials.example.js credentials.js
 *
 * 🔒 Файл credentials.js добавлен в .gitignore и не синхронизируется через Git 
 */

var CREDENTIALS = {
  // ============================================================================
  // СЕРВЕР (Node.js API)
  // ============================================================================
  server: {
    url: '' // URL Node.js API сервера (пустая строка = текущий origin)
  },

  // ============================================================================
  // POCKETBASE УЧЕТНЫЕ ДАННЫЕ
  // ============================================================================
  pocketbase: {
    // URL для браузера (PocketBase SDK). '/pb/' — same-origin путь,
    // который nginx фронтенда проксирует в контейнер pocketbase (nginx.conf).
    // Так приложение работает и по http://localhost:8080, и по https://домен —
    // без CORS и без указания протокола/порта.
    url: '/pb/',
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
