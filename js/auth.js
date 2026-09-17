/**
 * Общий модуль авторизации для клиентских страниц
 * Работает через единый DB интерфейс (PocketBase)
 * Подключается после db-config.js и db-interface.js
 */

// Глобальные переменные
window.AuthModule = (function() {
    // Проверка включена ли авторизация
    const isAuthEnabled = (typeof ENABLE_AUTH !== 'undefined') ? ENABLE_AUTH === 1 : true;

    let currentUser = null;
    let currentRole = null;
    let idToken = null;
    
    // Флаг для предотвращения автоматического редиректа при logout
    let skipRedirectOnLogout = false;

    /**
     * Проверка авторизации пользователя
     * @param {string} requiredRole - Требуемая роль ('user' или 'admin')
     * @param {string|null} redirectUrl - URL для перенаправления если не авторизован
     *        (null — страница сама обрабатывает неавторизованное состояние)
     * @returns {Promise<boolean>} - true если авторизован
     */
    async function checkAuth(requiredRole = 'user', redirectUrl = 'mobile.html') {
        // Если авторизация отключена, всегда возвращаем true
        if (!isAuthEnabled) {
            currentRole = requiredRole === 'admin' ? 'admin' : 'user';
            return true;
        }

        // Убеждаемся что DB инициализирован
        try {
            await DB.init();
        } catch (error) {
            console.error('Failed to initialize DB in checkAuth:', error);
            return false;
        }

        return new Promise((resolve, reject) => {
            DB.auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    // Перенаправляем только если redirectUrl задан явно.
                    // При logout (skipRedirectOnLogout) страница остаётся на месте.
                    if (!skipRedirectOnLogout && redirectUrl !== null && redirectUrl) {
                        window.location.href = redirectUrl;
                    }
                    resolve(false);
                    return;
                }

                currentUser = user;
                currentRole = user.role || (user.data ? user.data.role : 'user') || 'user';

                // Проверяем роль
                if (requiredRole === 'admin' && currentRole !== 'admin') {
                    // Если требуется админ, а у пользователя роль user —
                    // отправляем в мобильный интерфейс
                    if (redirectUrl !== null && redirectUrl) {
                        window.location.href = 'mobile.html';
                    }
                    resolve(false);
                    return;
                }

                resolve(true);
            });
        });
    }

    /**
     * Получение текущего пользователя
     * @returns {Object|null}
     */
    function getCurrentUser() {
        // Ensure displayname is always present if username is
        if (currentUser && currentUser.username && !currentUser.displayname) {
            currentUser.displayname = currentUser.displayName || currentUser.username;
        }
        return currentUser;
    }

    /**
     * Получение текущей роли пользователя
     * @returns {string|null}
     */
    function getCurrentRole() {
        return currentRole;
    }

    /**
     * Получение ID токена
     * @returns {string|null}
     */
    function getIdToken() {
        return idToken;
    }

     /**
      * Выход из системы
      * @returns {Promise<void>}
      */
         async function logout() {
          // Если авторизация отключена, просто остаёмся в мобильном интерфейсе
          if (!isAuthEnabled) {
              window.location.href = 'mobile.html';
              return;
          }

         try {
             // Убеждаемся что DB инициализирован
             try {
                 await DB.init();
             } catch (error) {
                 console.error('Failed to initialize DB in logout:', error);
             }
             // При выходе не перенаправляем — показываем форму входа
             skipRedirectOnLogout = true;
             await DB.auth.logout();
             currentUser = null;
             currentRole = null;
             idToken = null;
             skipRedirectOnLogout = false;
             // Обновляем UI для отображения состояния "не авторизован"
             if (typeof window.updateUserInfo === 'function') {
                 window.updateUserInfo();
             }
         } catch (error) {
             console.error('Logout error:', error);
             skipRedirectOnLogout = false;
             // Даже при ошибке обновляем UI
             currentUser = null;
             currentRole = null;
             idToken = null;
             if (typeof window.updateUserInfo === 'function') {
                 window.updateUserInfo();
             }
         }
     }

    /**
     * Получение заголовков для API запросов
     * @returns {Object}
     */
    function getAuthHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken || ''}`
        };
    }

    /**
     * Авторизованный fetch запрос
     * @param {string} url
     * @param {Object} options
     * @returns {Promise<Response>}
     */
    async function fetch(url, options = {}) {
        options.headers = {
            ...options.headers,
            ...getAuthHeaders()
        };
        return window.fetch(url, options);
    }

    /**
     * Доступ к внутреннему auth-объекту провайдера
     * (обратная совместимость — используется только для нативных вызовов)
     * Lazy getter — возвращает null если DB ещё не инициализирован
     */
    function getAuth() {
        try {
            return DB.auth.getAuthInstance();
        } catch (e) {
            return null;
        }
    }

    // Публичный API модуля
    return {
        checkAuth,
        getCurrentUser,
        getCurrentRole,
        getIdToken,
        logout,
        getAuthHeaders,
        fetch,
        get auth() {
            return getAuth();
        }
    };
})();
