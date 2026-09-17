/**
 * Модуль администрирования пользователей для мобильного интерфейса.
 *
 * Перенесён с десктопной страницы admin.html. Работает только с PocketBase:
 *  - список пользователей (коллекция scoreusers) + журнал входов (auth_log);
 *  - создание / редактирование / удаление пользователей через отдельный
 *    PocketBase-клиент, авторизованный как сервисный пользователь app_users
 *    (чтобы не перезаписывать токен текущего администратора в localStorage).
 *
 * Использование: window.MobileAdmin.onTabShown() при открытии вкладки "Админ".
 */
(function() {
  'use strict';

  var ADMIN_AUTH_KEY = 'pocketbase_auth';

  var _adminPb = null;      // отдельный клиент, авторизованный как app_users
  var _users = [];          // enriched-список пользователей
  var _currentUsername = null;
  var _initialized = false;
  var _deepLinkDone = false;
  var _alertTimer = null;

  function el(id) { return document.getElementById(id); }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function errText(err) {
    if (!err) return 'Неизвестная ошибка';
    var msg = err.message || (err.response && err.response.message) || String(err);
    try {
      var fieldErrors = (err.response && err.response.data) || err.data;
      if (fieldErrors && typeof fieldErrors === 'object') {
        var parts = [];
        Object.keys(fieldErrors).forEach(function(k) {
          var fe = fieldErrors[k];
          if (fe && fe.message) parts.push(k + ': ' + fe.message);
        });
        if (parts.length) msg += ' (' + parts.join('; ') + ')';
      }
    } catch (e) {}
    return msg;
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      var str = String(value).replace(' ', 'T');
      var d = new Date(str);
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleString('ru-RU');
    } catch (e) {
      return String(value);
    }
  }

  // ======================================================================
  // Отдельный PocketBase-клиент для админских операций.
  // authWithPassword перезаписывает токен в localStorage — поэтому
  // сохраняем токен реального пользователя и восстанавливаем его сразу
  // после авторизации сервисного пользователя app_users.
  // ======================================================================

  function getAdminPbClient() {
    if (_adminPb) return Promise.resolve(_adminPb);
    return DB.init().then(function() {
      if (typeof PocketBase === 'undefined') {
        throw new Error('PocketBase SDK не загружен');
      }
      var savedUserAuth = localStorage.getItem(ADMIN_AUTH_KEY);
      _adminPb = new PocketBase(DB_CONFIG.pocketbase.url);
      return _adminPb.collection('app_users').authWithPassword(
        DB_CONFIG.pocketbase.user_email,
        DB_CONFIG.pocketbase.user_password
      ).then(function() {
        // Восстанавливаем токен реального пользователя в localStorage.
        // Админский клиент продолжает работать с токеном в памяти.
        if (savedUserAuth) {
          localStorage.setItem(ADMIN_AUTH_KEY, savedUserAuth);
        } else {
          localStorage.removeItem(ADMIN_AUTH_KEY);
        }
        return _adminPb;
      }).catch(function(err) {
        if (savedUserAuth) {
          localStorage.setItem(ADMIN_AUTH_KEY, savedUserAuth);
        } else {
          localStorage.removeItem(ADMIN_AUTH_KEY);
        }
        throw err;
      });
    });
  }

  // ======================================================================
  // ROLE / UI STATE
  // ======================================================================

  function resolveRole(cb) {
    var cu = DB.getCurrentUser();
    if (cu) {
      _currentUsername = cu.username;
      DB.users.get(cu.username)
        .then(function(userData) { cb((userData && userData.role) === 'admin' ? 'admin' : 'user'); })
        .catch(function() { cb('user'); });
      return;
    }
    // Пользователь ещё не определён (DB.init в процессе) —
    // ждём событие авторизации и определяем роль из данных authStore
    var waited = false;
    DB.auth.onAuthStateChanged(function(user) {
      if (waited || !user) return;
      waited = true;
      _currentUsername = user.username || (user.email ? user.email.split('@')[0] : '');
      cb(user.role === 'admin' ? 'admin' : 'user');
    });
  }

  function showPanel() {
    el('adminContent').style.display = '';
    el('adminDenied').style.display = 'none';
  }

  function showDenied() {
    el('adminContent').style.display = 'none';
    el('adminDenied').style.display = '';
  }

  // ======================================================================
  // ALERTS
  // ======================================================================

  function showAlert(message, type) {
    var box = el('adminAlert');
    if (!box) return;
    box.textContent = message;
    box.className = 'admin-alert ' + (type === 'error' ? 'error' : 'success');
    box.style.display = 'block';
    if (_alertTimer) clearTimeout(_alertTimer);
    _alertTimer = setTimeout(function() { box.style.display = 'none'; }, 5000);
  }

  // ======================================================================
  // USERS LIST
  // ======================================================================

  function mapUser(r, logs) {
    var uname = r.username || (r.email || '').split('@')[0];
    var lastLogin = null;
    if (logs) {
      for (var i = 0; i < logs.length; i++) {
        if (logs[i].username === uname) { lastLogin = logs[i]; break; }
      }
    }
    return {
      id: r.id,
      username: uname,
      email: r.email,
      displayName: r.name || uname,
      role: r.role || 'user',
      created: r.created,
      lastLogin: lastLogin
    };
  }

  function loadUsers() {
    var list = el('adminUsersList');
    if (!list) return;
    list.innerHTML = '<div class="loading"><div class="spinner"></div> Загрузка...</div>';

    getAdminPbClient().then(function(pb) {
      return pb.collection(DB_CONFIG.collections.USERS)
        .getFullList({ sort: '+created' })
        .then(function(records) {
          return pb.collection('auth_log')
            .getFullList({ sort: '-loginAt', perPage: 50 })
            .then(function(logs) {
              _users = records.map(function(r) { return mapUser(r, logs); });
              renderUsers();
            })
            .catch(function() {
              // журнал недоступен — показываем список без последних входов
              _users = records.map(function(r) { return mapUser(r, null); });
              renderUsers();
            });
        });
    }).catch(function(err) {
      list.innerHTML = '<div class="admin-empty">Ошибка загрузки пользователей: ' +
        esc(errText(err)) + '</div>';
    });
  }

  function renderUsers() {
    var list = el('adminUsersList');
    if (!list) return;

    if (!_users.length) {
      list.innerHTML = '<div class="admin-empty">Пользователи не найдены</div>';
      return;
    }

    var html = '';
    _users.forEach(function(u) {
      var isSelf = u.username === _currentUsername;
      var roleClass = u.role === 'admin' ? 'admin' : 'user';
      var roleText = u.role === 'admin' ? 'Администратор' : 'Пользователь';
      var lastLogin = u.lastLogin
        ? '<span class="admin-history-link" data-history="' + esc(u.username) + '">' +
          esc(formatDate(u.lastLogin.loginAt)) + '</span>' +
          (u.lastLogin.ipAddress ? ' <span class="admin-ip">IP: ' + esc(u.lastLogin.ipAddress) + '</span>' : '')
        : '—';

      html +=
        '<div class="admin-user-item">' +
          '<div class="admin-user-info">' +
            '<div class="admin-user-name">@' + esc(u.username) +
              ' <span class="admin-role-badge ' + roleClass + '">' + roleText + '</span></div>' +
            '<div class="admin-user-sub">Имя: ' + esc(u.displayName || '—') + '</div>' +
            '<div class="admin-user-sub">Email: ' + esc(u.email || '—') + '</div>' +
            '<div class="admin-user-sub">Создан: ' + esc(formatDate(u.created)) + '</div>' +
            '<div class="admin-user-sub">Последний вход: ' + lastLogin + '</div>' +
          '</div>' +
          '<div class="admin-user-actions">' +
            '<button class="btn btn-secondary btn-sm" data-edit="' + esc(u.id) + '"' +
              (isSelf ? ' disabled title="Текущий пользователь"' : '') + '>✏️</button>' +
            (isSelf ? '' :
              '<button class="btn btn-danger btn-sm" data-del="' + esc(u.id) +
              '" data-delname="' + esc(u.username) + '">🗑️</button>') +
          '</div>' +
        '</div>';
    });

    list.innerHTML = html;
  }

  // ======================================================================
  // CREATE / EDIT / DELETE / HISTORY
  // ======================================================================

  function createUser(e) {
    e.preventDefault();
    var username = el('adminNewUsername').value.trim().toLowerCase();
    var password = el('adminNewPassword').value;
    var displayName = el('adminNewDisplayName').value.trim();
    var role = el('adminNewRole').value;

    if (!/^[a-z0-9_]+$/.test(username)) {
      showAlert('Имя пользователя: только латиница, цифры и подчеркивание', 'error');
      return;
    }
    if (password.length < 8) {
      showAlert('Пароль должен содержать минимум 8 символов', 'error');
      return;
    }

    getAdminPbClient().then(function(pb) {
      return pb.collection(DB_CONFIG.collections.USERS).create({
        username: username,
        email: username + '@volleyball.local',
        password: password,
        passwordConfirm: password,
        name: displayName || username,
        role: role,
        emailVisibility: true
      });
    }).then(function() {
      el('adminAddUserForm').reset();
      showAlert('Пользователь @' + username + ' успешно создан', 'success');
      loadUsers();
    }).catch(function(err) {
      showAlert('Ошибка создания пользователя: ' + errText(err), 'error');
    });
  }

  function openEdit(id) {
    var user = null;
    for (var i = 0; i < _users.length; i++) {
      if (_users[i].id === id) { user = _users[i]; break; }
    }
    if (!user) { showAlert('Пользователь не найден', 'error'); return; }

    el('adminEditUid').value = user.id;
    el('adminEditEmail').value = user.email || '';
    el('adminEditPassword').value = '';
    el('adminEditDisplayName').value = user.displayName || '';
    el('adminEditRole').value = user.role || 'user';

    el('adminEditUserModal').classList.remove('hidden');
  }

  function closeEdit() {
    el('adminEditUserModal').classList.add('hidden');
  }

  function saveEdit() {
    var uid = el('adminEditUid').value;
    var password = el('adminEditPassword').value;
    var displayName = el('adminEditDisplayName').value.trim();
    var role = el('adminEditRole').value;

    var data = { name: displayName, role: role };
    if (password) {
      if (password.length < 8) {
        showAlert('Пароль должен содержать минимум 8 символов', 'error');
        return;
      }
      data.password = password;
      data.passwordConfirm = password;
    }

    getAdminPbClient().then(function(pb) {
      return pb.collection(DB_CONFIG.collections.USERS).update(uid, data);
    }).then(function() {
      closeEdit();
      showAlert('Пользователь успешно обновлён', 'success');
      loadUsers();
    }).catch(function(err) {
      showAlert('Ошибка обновления пользователя: ' + errText(err), 'error');
    });
  }

  function removeUser(id, username) {
    if (!window.confirm('Вы уверены, что хотите удалить пользователя @' + username + '?')) {
      return;
    }
    getAdminPbClient().then(function(pb) {
      return pb.collection(DB_CONFIG.collections.USERS).delete(id);
    }).then(function() {
      showAlert('Пользователь @' + username + ' удалён', 'success');
      loadUsers();
    }).catch(function(err) {
      showAlert('Ошибка удаления пользователя: ' + errText(err), 'error');
    });
  }

  function showHistory(username) {
    var body = el('adminHistoryBody');
    body.innerHTML = '<div class="loading"><div class="spinner"></div> Загрузка...</div>';
    el('adminHistoryModal').classList.remove('hidden');

    getAdminPbClient().then(function(pb) {
      var escaped = String(username).replace(/"/g, '\\"');
      return pb.collection('auth_log').getFullList({
        filter: 'username = "' + escaped + '"',
        sort: '-loginAt'
      });
    }).then(function(logs) {
      if (!logs || !logs.length) {
        body.innerHTML = '<div class="admin-empty">История входов пуста</div>';
        return;
      }
      var html = '';
      logs.forEach(function(log) {
        html +=
          '<div class="admin-history-item">' +
            '<div class="admin-history-date">' + esc(formatDate(log.loginAt)) + '</div>' +
            '<div class="admin-history-sub">IP: ' + esc(log.ipAddress || '—') + '</div>' +
            (log.status ? '<div class="admin-history-sub">Статус: ' + esc(log.status) + '</div>' : '') +
          '</div>';
      });
      body.innerHTML = html;
    }).catch(function(err) {
      body.innerHTML = '<div class="admin-empty">Ошибка загрузки истории: ' + esc(errText(err)) + '</div>';
    });
  }

  function closeHistory() {
    el('adminHistoryModal').classList.add('hidden');
  }

  // ======================================================================
  // INIT
  // ======================================================================

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Список: делегирование кликов (edit / delete / история входов)
    el('adminUsersList').addEventListener('click', function(e) {
      var editBtn = e.target.closest('[data-edit]');
      var delBtn = e.target.closest('[data-del]');
      var histLink = e.target.closest('[data-history]');
      if (editBtn && !editBtn.disabled) {
        openEdit(editBtn.getAttribute('data-edit'));
      } else if (delBtn) {
        removeUser(delBtn.getAttribute('data-del'), delBtn.getAttribute('data-delname'));
      } else if (histLink) {
        showHistory(histLink.getAttribute('data-history'));
      }
    });

    // Добавление пользователя
    el('adminAddUserForm').addEventListener('submit', createUser);

    // Редактирование пользователя
    el('adminEditCancel').addEventListener('click', closeEdit);
    el('adminEditSave').addEventListener('click', function(e) {
      e.preventDefault();
      saveEdit();
    });
    el('adminEditUserForm').addEventListener('submit', function(e) {
      e.preventDefault();
      saveEdit();
    });

    // История входов
    el('adminHistoryClose').addEventListener('click', closeHistory);

    // Обновление списка
    el('adminRefreshBtn').addEventListener('click', loadUsers);
  }

  /**
   * Вызывается при открытии вкладки "Админ"
   * (кнопка вкладки скрыта для не-администраторов — здесь двойная проверка)
   */
  function onTabShown() {
    resolveRole(function(role) {
      if (role !== 'admin') { showDenied(); return; }
      init();
      showPanel();
      loadUsers();
    });
  }

  /**
   * Deep-link: /mobile.html?tab=pageAdmin (redirect со старой admin.html,
   * ссылка "Админ-панель" в ctl.html)
   */
  function initDeepLink() {
    var tab = new URLSearchParams(window.location.search).get('tab');
    if (!tab) return;
    var btn = document.querySelector('.tab-btn[data-tab="' + tab + '"]');
    if (!btn) return;

    DB.init().then(function() {
      DB.auth.onAuthStateChanged(function(user) {
        if (!user) return;
        // Ждём, пока mobile.js раскроет админ-вкладки после проверки роли
        var attempts = 0;
        (function poll() {
          if (_deepLinkDone || attempts > 20) return;
          attempts++;
          if (!btn.classList.contains('admin-hidden')) {
            _deepLinkDone = true;
            btn.click();
          } else {
            setTimeout(poll, 250);
          }
        })();
      });
    }).catch(function() {});
  }

  // Register tab click hook + deep link
  function registerHooks() {
    var btn = document.querySelector('.tab-btn[data-tab="pageAdmin"]');
    if (btn) btn.addEventListener('click', onTabShown);
    initDeepLink();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerHooks);
  } else {
    registerHooks();
  }

  window.MobileAdmin = {
    onTabShown: onTabShown,
    loadUsers: loadUsers
  };
})();



