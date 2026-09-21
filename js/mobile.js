(function() {
  'use strict';

  var BASE_URL = window.location.href.replace(/\/[^\/]*$/, '/');
  var DEMO_MODE = false;
  var mobileScoreboardData = {};
  var mobileGameConnected = false;
  var pendingMatchFinish = null;
  var pendingSetFinish = null; // Добавлено для подтверждения завершения сета
  var matchWasAlreadyFinished = false;
  var _subscribeCallCount = 0;
  var _initialDataLoaded = false;
  var timeoutTimerInterval = null;
  var timeoutRemainingSeconds = 0;
  var pendingTimeout = null;
  var pendingGameSelect = null;
  var _currentUserInfo = null;
  var _userRole = 'user';
  var _localCustomMode = false;
  var _customFieldsEditing = false;
  var _recordExists = false;
  var _localSettingsDirty = false;
  var _localBeachMode = false;
  var _localTwoWinsMode = false;
  var _localInvertTablo = false;
  var _localUnlimitedScore = false;
  var _localCustomSettings = {
    count_wins: 1,
    score_wins: 21,
    score_tie: 15,
    balance: true,
    score_change: 7,
    count_timeouts: 1
  };

  var DEMO_DEFAULT_DATA = {
    home_team: 'Команда А',
    away_team: 'Команда Б',
    home_color: '#ff0000',
    away_color: '#0000ff',
    tournament_name: 'Демо-турнир',
    venue: 'Демо-зал',
    home_score: 0,
    away_score: 0,
    home_sets: 0,
    away_sets: 0,
    home_fouls: 0,
    away_fouls: 0,
    current_period: 1,
    period_count: 5,
    set_history: [],
    matchmode: '00000',
    beach_mode: false,
    two_wins_mode: false,
    invert_tablo: false,
    unlimited_score: false,
    custom_mode: false,
    show: 1,
    timeout_active: false,
    prev_show: 1,
    custom_label: '',
    home_side: 'left',
    away_side: 'right',
    home_timeouts: 0,
    away_timeouts: 0,
    classic_match_finished: false,
    beach_match_finished: false,
    beach_current_set: 1,
    beach_switch_message: '',
    classic_tiebreak_switch_done: true,
    pending_new_set: false
  };

  // ===== HELPERS =====

  function ensureNumber(value) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  function generateUUID() {
    if (typeof uuid === 'function') return uuid();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function show(el) { el.style.display = ''; }
  function hide(el) { el.style.display = 'none'; }

  function buildMatchmode() {
    return (_localBeachMode ? 1 : 0) + '' + (_localTwoWinsMode ? 1 : 0) + '' +
           (_localInvertTablo ? 1 : 0) + '' + (_localUnlimitedScore ? 1 : 0) + '' +
           (_localCustomMode ? 1 : 0);
  }

  function applyMatchmode(code) {
    if (!code || code.length !== 5) return;
    _localBeachMode = code[0] === '1';
    _localTwoWinsMode = code[1] === '1';
    _localInvertTablo = code[2] === '1';
    _localUnlimitedScore = code[3] === '1';
    _localCustomMode = code[4] === '1';
    document.getElementById('mobileBeachMode').checked = _localBeachMode;
    document.getElementById('mobileTwoWinsMode').checked = _localTwoWinsMode;
    document.getElementById('mobileInvertTablo').checked = _localInvertTablo;
    document.getElementById('mobileUnlimitedScore').checked = _localUnlimitedScore;
    document.getElementById('mobileCustomMode').checked = _localCustomMode;
    document.getElementById('mobileTwoWinsMode').disabled = _localBeachMode || _localCustomMode;
    document.getElementById('mobileBeachMode').disabled = _localTwoWinsMode || _localCustomMode;
    document.getElementById('mobileUnlimitedScore').disabled = _localCustomMode;
    document.getElementById('mobileCustomMode').disabled = _localBeachMode || _localTwoWinsMode;
  }

  function loadCustomSettingsFromData(data) {
    if (data['count_wins'] != null) _localCustomSettings.count_wins = ensureNumber(data['count_wins']);
    if (data['score_wins'] != null) _localCustomSettings.score_wins = ensureNumber(data['score_wins']);
    if (data['score_tie'] != null) _localCustomSettings.score_tie = ensureNumber(data['score_tie']);
    if (data['balance'] != null) _localCustomSettings.balance = !!data['balance'];
    if (data['score_change'] != null) _localCustomSettings.score_change = ensureNumber(data['score_change']);
    if (data['count_timeouts'] != null) _localCustomSettings.count_timeouts = ensureNumber(data['count_timeouts']);
    document.getElementById('customSetsToWin').value = _localCustomSettings.count_wins;
    document.getElementById('customPointsToWin').value = _localCustomSettings.score_wins;
    document.getElementById('customTiebreakPoints').value = _localCustomSettings.score_tie;
    document.getElementById('customBalance').checked = _localCustomSettings.balance;
    document.getElementById('customSideSwitchPoints').value = _localCustomSettings.score_change;
    document.getElementById('customMaxTimeouts').value = _localCustomSettings.count_timeouts;
  }

  function buildSavePayload() {
    var payload = {
      matchmode: buildMatchmode(),
      beach_mode: _localBeachMode,
      two_wins_mode: _localTwoWinsMode,
      invert_tablo: _localInvertTablo,
      unlimited_score: _localUnlimitedScore,
      custom_mode: _localCustomMode,
      template_id: document.getElementById('mobileTemplateSelect').value || ''
    };
    if (_localCustomMode) {
      syncCustomSettings();
      payload.count_wins = _localCustomSettings.count_wins;
      payload.score_wins = _localCustomSettings.score_wins;
      payload.score_tie = _localCustomSettings.score_tie;
      payload.balance = _localCustomSettings.balance;
      payload.score_change = _localCustomSettings.score_change;
      payload.count_timeouts = _localCustomSettings.count_timeouts;
      payload.period_count = 9;
    }
    return payload;
  }

  function showControlContent() {
    hide(document.getElementById('controlLoading'));
    show(document.getElementById('controlContent'));
  }

  function getCurrentUserInfo() {
    if (DEMO_MODE) {
      return { username: 'test', displayname: 'test' };
    }
    return _currentUserInfo || {};
  }

  function update_db(data) {
    var userInfo = getCurrentUserInfo();
    if (userInfo.username) {
      data.username = userInfo.username;
      data.displayname = userInfo.displayname;
    }
    data.lastEdited = DB.serverTimestamp();

    if (DEMO_MODE) {
      Object.keys(data).forEach(function(key) {
        if (data[key] === DB.deleteField() || data[key] === '__PB_DELETE_FIELD__') {
          delete mobileScoreboardData[key];
        } else {
          mobileScoreboardData[key] = data[key];
        }
      });
      // Обновляем все вкладки, чтобы UI был консистентным
      updateSettingsUI(mobileScoreboardData);
      updateControlUI(mobileScoreboardData);
      updateTeamsUI(mobileScoreboardData);
      return;
    }
    // Напрямую используем DB.scoreboard.update, чтобы получить Promise с обновленными данными
    DB.scoreboard.update(game_id, data)
      .then(function(updatedDoc) {
        if (updatedDoc) {
          // Сбрасываем флаг "грязных" настроек после успешного обновления в БД
          _localSettingsDirty = false;
          mobileScoreboardData = DB.utils.getPlainObject(updatedDoc);
        }
      }).catch(function(err) {
        console.error("Mobile update failed:", err);
      });
  }

  // Функция для сохранения настроек в зависимости от состояния игры
  function saveSettings() {
    if (_recordExists) { // Если запись игры существует, сохраняем сразу
      update_db(buildSavePayload());
    } else { // Если записи нет, просто помечаем настройки как измененные локально
      _localSettingsDirty = true;
    }
  }

  // ===== AUTH =====

  /**
   * Права гостевого режима (ENABLE_AUTH=0 — работа без авторизации).
   * Без входа должны быть доступны создание/подключение игры и редактор
   * шаблонов. Вкладка «Админ» (управление пользователями) остаётся скрытой,
   * т.к. требует авторизации.
   */
  function applyGuestPermissions() {
    var connectBtn = document.getElementById('connectGameBtn');
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.title = '';
    }
    var templatesTab = document.querySelector('.tab-btn[data-tab="pageTemplates"]');
    if (templatesTab) {
      templatesTab.classList.remove('admin-hidden');
    }
  }

  function initAuth() {
    if (typeof ENABLE_AUTH !== 'undefined' && ENABLE_AUTH === 0) {
      showApp();
      document.getElementById('mobileUserInfo').textContent = 'Гость';
      // Гостевой режим: игра и шаблоны доступны без входа
      applyGuestPermissions();
      // БД нужна и без авторизации: правила PocketBase для коллекций
      // volleyball/matches/templates допускают публичный доступ.
      // Список шаблонов перечитываем после init — showApp() вызывается раньше,
      // когда SDK ещё не загружен (и его вызов не срабатывает).
      DB.init().then(function() {
        loadGamesList();
        if (typeof loadMobileTemplateSelect === 'function') {
          loadMobileTemplateSelect();
        }
      }).catch(function(err) {
        console.error('[Mobile] Guest DB init failed:', err);
      });
      return;
    }

    // Always show login form as fallback (ensures demo mode works without any DB)
    var loginFallback = setTimeout(function() {
      showLogin();
    }, 3000);

    DB.init().then(function() {
      clearTimeout(loginFallback);
      DB.auth.onAuthStateChanged(function(user) {
        if (!user) {
          showLogin();
          return;
        }

        var username = user.email ? user.email.split('@')[0] : user.username || '';
        _currentUserInfo = { username: username, displayname: user.displayName || user.name || username };
        DB.users.get(username).then(function(userData) {
          var role = 'user';
          if (userData && userData.role) role = userData.role;
          _userRole = role;
          _currentUserInfo = { username: username, displayname: userData.displayName || userData.name || username };
          showApp(user.email || username, role);

          if (role === 'admin') {
            document.querySelectorAll('.admin-tab').forEach(function(el) {
              el.classList.remove('admin-hidden');
            });
            // Активируем кнопку "Подключиться" для администратора
            document.getElementById('connectGameBtn').disabled = false;
          } else {
            // Для обычных пользователей кнопка остается неактивной (disabled)
            document.getElementById('connectGameBtn').disabled = true;
            document.getElementById('connectGameBtn').title = 'Доступно только администраторам';
          }
          loadGamesList();
        }).catch(function() {
          showApp(user.email || username, 'user');
          loadGamesList();
        });
      }).catch(function() {
        // В случае ошибки авторизации, убедимся, что кнопка неактивна
        document.getElementById('connectGameBtn').disabled = true;
      });
    }).catch(function(e) {
      clearTimeout(loginFallback);
      console.error('DB init failed:', e);
      showLogin();
    });
  }

  function showLogin() {
    show(document.getElementById('loginPage'));
    hide(document.getElementById('appContainer'));
  }

  function showApp(userInfo, role) {
    hide(document.getElementById('loginPage'));
    show(document.getElementById('appContainer'));
    if (userInfo) {
      var infoText = userInfo + (role === 'admin' ? ' (Админ)' : '');
      if (DEMO_MODE) {
        document.getElementById('mobileUserInfo').innerHTML = infoText + ' <span class="demo-badge">ДЕМО</span>';
      } else {
        document.getElementById('mobileUserInfo').textContent = infoText;
      }
    }
    // Загружаем список шаблонов после того, как DB инициализирован
    if (typeof loadMobileTemplateSelect === 'function') {
      loadMobileTemplateSelect();
    }
  }

  function showError(msg) {
    var errorEl = document.getElementById('loginError');
    errorEl.textContent = msg;
    errorEl.classList.add('visible');
  }

  function hideError() {
    var errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    errorEl.classList.remove('visible');
  }

  // ===== ЛОГИРОВАНИЕ АУТЕНТИФИКАЦИИ =====

  // Таймаут входа (сек). Настраивается в db-config.js (DB_CONFIG.AUTH_LOGIN_TIMEOUT_SECONDS)
  function getLoginTimeoutSeconds() {
    if (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.AUTH_LOGIN_TIMEOUT_SECONDS != null) {
      return parseInt(DB_CONFIG.AUTH_LOGIN_TIMEOUT_SECONDS, 10) || 15;
    }
    return 15;
  }

  // Формирование объекта события для auth_log
  function buildAuthLogData(extra) {
    var data = {
      username: (extra && extra.username) || '',
      uid: (extra && extra.uid) || '',
      email: (extra && extra.email) || '',
      loginAt: new Date().toISOString(),
      userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '',
      isAdminPage: false
    };
    if (extra) {
      for (var key in extra) {
        if (key !== 'username' && key !== 'uid' && key !== 'email') {
          data[key] = extra[key];
        }
      }
    }
    return data;
  }

  // Логирование в файл через серверный API (используется, когда БД недоступна)
  function logAuthToFile(data) {
    // URL сервера: приоритет CREDENTIALS.server.url, иначе текущий origin
    var serverBase = '';
    try {
      if (typeof CREDENTIALS !== 'undefined' && CREDENTIALS.server && CREDENTIALS.server.url) {
        serverBase = CREDENTIALS.server.url;
      }
    } catch (e) {}
    if (!serverBase) {
      serverBase = window.location.origin;
    }
    var serverUrl = serverBase.replace(/\/+$/, '') + '/api/auth/log';
    try {
      return fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(function() {
        // Если и сервер недоступен — пишем в консоль
        console.warn('[auth_log] Сервер недоступен, событие не записано в файл:', data);
      });
    } catch (e) {
      console.warn('[auth_log] Не удалось записать в файл:', e);
      return Promise.resolve();
    }
  }

  // Запись события аутентификации в auth_log.
  // Сначала пробуем БД, при недоступности БД — логируем в файл через сервер.
  function logAuthEvent(data) {
    var logData = buildAuthLogData(data);
    var dbAvailable = false;

    // Пробуем записать в БД
    try {
      if (typeof DB !== 'undefined' && DB.auth && typeof DB.auth.logAuthEvent === 'function') {
        return DB.auth.logAuthEvent(logData).then(function() {
          return { target: 'db' };
        }).catch(function() {
          // БД недоступна — логируем в файл
          return logAuthToFile(logData).then(function() {
            return { target: 'file' };
          });
        });
      }
    } catch (e) {
      dbAvailable = false;
    }

    // DB недоступен — логируем в файл
    return logAuthToFile(logData).then(function() {
      return { target: 'file' };
    });
  }

  function doLogin() {
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value;
    var btn = document.getElementById('loginBtn');

    if (!username || !password) {
      showError('Введите логин и пароль');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Вход...';
    hideError();

    if (username === 'test' && password === 'testpassw') {
      DEMO_MODE = true;
      btn.disabled = false;
      btn.textContent = 'Войти';
      setupMockDB();
      showApp('test', 'user');
      // В демо-режиме кнопка неактивна
      document.getElementById('connectGameBtn').disabled = true;
      loadGamesList();
      return;
    }

    // Таймаут входа (сек)
    var timeoutSeconds = getLoginTimeoutSeconds();
    var timedOut = false;

    // Логируем начало попытки входа

    // Таймер таймаута
    var timeoutTimer = setTimeout(function() {
      timedOut = true;
      btn.disabled = false;
      btn.textContent = 'Войти';
      var msg = 'Превышено время ожидания ответа (' + timeoutSeconds + ' сек). Попробуйте ещё раз.';
      showError(msg);
      // Логируем событие таймаута
    }, timeoutSeconds * 1000);

    DB.auth.login(username, password).then(function(userData) {
      if (timedOut) return;
      clearTimeout(timeoutTimer);
      btn.disabled = false;
      btn.textContent = 'Войти';
      var role = userData.role || 'user';
      _userRole = role;
      _currentUserInfo = { username: userData.username || username, displayname: userData.displayName || userData.username || username };
      showApp(userData.displayName || userData.username || username, role);

      if (role === 'admin') {
        document.querySelectorAll('.admin-tab').forEach(function(el) {
          el.classList.remove('admin-hidden');
        });
        document.getElementById('connectGameBtn').disabled = false;
      } else {
        document.getElementById('connectGameBtn').disabled = true;
        document.getElementById('connectGameBtn').title = 'Доступно только администраторам';
      }
      loadGamesList();

      // Логируем успешный вход
    }).catch(function(err) {
      if (timedOut) return;
      clearTimeout(timeoutTimer);
      btn.disabled = false;
      btn.textContent = 'Войти';
      var msg = err.message || 'Ошибка авторизации';
      if (msg.includes('не найден') || msg.includes('Неверный пароль')) {
        msg = 'Неверный логин или пароль';
      } else if (msg.includes('сеть') || msg.includes('fetch')) {
        msg = 'Ошибка сети. Проверьте подключение к интернету.';
      } else if (msg.includes('importKey') || msg.includes('deriveBits') || msg.includes('crypto.subtle')) {
        msg = 'Ошибка авторизации: страница открыта по HTTP. Для входа используйте HTTPS или localhost.';
      }
      showError(msg);

      // Логируем неудачный вход
    });
  }

  function doLogout() {
    _currentUserInfo = null;
    _userRole = 'user';
    if (DEMO_MODE) {
      DEMO_MODE = false;
      mobileGameConnected = false;
      mobileScoreboardData = {};
      stopPolling();
      showLogin();
      return;
    }
    AuthModule.logout().then(function() {
      mobileGameConnected = false;
      showLogin();
    });
  }

  function setupMockDB() {
    var _mockData = {};
    window.scoreboard_query = {
      update: function(data) {
        Object.keys(data).forEach(function(k) {
          _mockData[k] = data[k];
        });
      }
    };
    window.DB = {
      init: function() { return Promise.resolve(); },
      serverTimestamp: function() { return new Date().toISOString(); },
      deleteField: function() { return null; },
      getProvider: function() { return 'mock'; },
      isInitialized: function() { return true; },
      auth: {
        login: function() { return Promise.reject(new Error('Demo mode')); },
        logout: function() { return Promise.resolve(); },
        onAuthStateChanged: function(cb) { cb(null); },
        getAuthInstance: function() { return null; },
        createUser: function() { return Promise.reject(new Error('Demo mode')); },
        deleteUser: function() { return Promise.reject(new Error('Demo mode')); },
        getUserRole: function() { return Promise.resolve('user'); },
        logAuthEvent: function() { return Promise.resolve(); }
      },
      scoreboard: {
        get: function(gameId) { return Promise.resolve(_mockData); },
        subscribe: function() { return function() {}; },
        update: function(gameId, data) {
          Object.keys(data).forEach(function(k) {
            _mockData[k] = data[k];
          });
          return Promise.resolve();
        },
        create: function() { return Promise.resolve(); },
        delete: function() { return Promise.resolve(); }
      },
      matches: {
        add: function() { return Promise.resolve({ id: 'demo-' + Date.now() }); },
        query: function() { return Promise.resolve([]); },
        softDelete: function() { return Promise.resolve(); },
        delete: function() { return Promise.resolve(); }
      },
      users: {
        get: function() { return Promise.resolve({ role: 'user' }); },
        update: function() { return Promise.resolve(); },
        updatePassword: function() { return Promise.resolve(); },
        delete: function() { return Promise.resolve(); }
      },
      templates: {
        list: function() { return Promise.resolve([]); },
        get: function() { return Promise.resolve(null); },
        subscribe: function() { return function() {}; },
        update: function() { return Promise.resolve(); },
        delete: function() { return Promise.resolve(); },
        getDefaultTemplate: function() { return {}; }
      }
    };
  }

  // ===== TABS =====

  function initTabs() {
    var tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var target = this.getAttribute('data-tab');
        tabBtns.forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        document.querySelectorAll('.tab-page').forEach(function(p) { p.classList.remove('active'); });
        document.getElementById(target).classList.add('active');
        if (target === 'pageGames') loadGamesList();
        // Инициализируем визуальный редактор шаблонов при открытии вкладки
        if (target === 'pageTemplates' && typeof TemplatesVisualMobile !== 'undefined') {
          TemplatesVisualMobile.init();
        }
      });
    });
  }

  // ===== GAMES LIST =====

  var _gamesListData = {};

  function loadGamesList() {
    var container = document.getElementById('gamesListContainer');
    container.innerHTML = '<div class="loading"><div class="spinner"></div> Загрузка...</div>';
    _gamesListData = {};

    DB.scoreboard.queryAll().then(function(results) {
      if (!results || results.length === 0) {
        container.innerHTML = '<div class="games-empty">Нет игр</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < results.length; i++) {
        var g = results[i];
        var finished = !!g.classic_match_finished || !!g.beach_match_finished;
        var home = g.home_team || 'Home';
        var away = g.away_team || 'Away';
        var hs = ensureNumber(g.home_score);
        var as = ensureNumber(g.away_score);
        var period = g.current_period || 1;
        var gid = g.id || '';
        _gamesListData[gid] = g;

        html += '<div class="game-item' + (finished ? ' game-item-finished' : '') + '" data-game-id="' + gid + '">' +
          '<div class="game-item-title">' + home + ' — ' + away + (finished ? ' <span style="color:var(--text-muted);font-weight:400;font-size:12px;">(завершена)</span>' : '') + '</div>' +
          '<div class="game-item-sub">' + (g.tournament_name || '') + (g.venue ? ' · ' + g.venue : '') + ' · ID: ' + gid + '</div>' +
          '<div class="game-item-score">' + hs + ' : ' + as + ' <span style="font-size:12px;color:var(--text-muted);font-weight:400;">(Сет ' + period + ')</span></div>' +
          '</div>';
      }
      container.innerHTML = html;

      container.querySelectorAll('.game-item').forEach(function(item) {
        item.addEventListener('click', function() {
          var gid = this.getAttribute('data-game-id');
          if (!gid) return;
          var g = _gamesListData[gid];
          if (!g) return;

          var home = g.home_team || 'Home';
          var away = g.away_team || 'Away';
          var tournament = g.tournament_name || '';
          var venue = g.venue || '';
          var user = g.displayname || g.username || '—';
          var finished = !!g.classic_match_finished || !!g.beach_match_finished;

          var info = '<div style="text-align:center;">' +
            '<div style="font-size:18px;font-weight:600;margin-bottom:8px;">' + home + ' — ' + away + '</div>' +
            '<div style="font-size:14px;color:var(--text-secondary);margin-bottom:4px;">' + tournament + (venue ? ' · ' + venue : '') + '</div>' +
            '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Судья: ' + user + (finished ? ' · Завершена' : '') + '</div>' +
            '<div style="font-size:14px;">Вы уверены, что хотите загрузить игру<br><b>' + gid + '</b>?</div>' +
            '</div>';

          pendingGameSelect = gid;
          document.getElementById('mobileGameSelectInfo').innerHTML = info;
          document.getElementById('mobileGameSelectDelete').style.display = _userRole === 'admin' ? '' : 'none';
          document.getElementById('mobileGameSelectModal').classList.remove('hidden');
        });
      });
    }).catch(function(err) {
      console.error('Failed to load games:', err);
      container.innerHTML = '<div class="games-empty">Ошибка загрузки</div>';
    });
  }

  function confirmGameSelect() {
    document.getElementById('mobileGameSelectModal').classList.add('hidden');
    if (!pendingGameSelect) return;
    var gid = pendingGameSelect;
    pendingGameSelect = null;
    document.getElementById('mobileGameId').value = gid;
    connectToGame();
    var tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function(b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-page').forEach(function(p) { p.classList.remove('active'); });
    document.querySelector('.tab-btn[data-tab="pageSettings"]').classList.add('active');
    document.getElementById('pageSettings').classList.add('active');
  }

  function cancelGameSelect() {
    document.getElementById('mobileGameSelectModal').classList.add('hidden');
    pendingGameSelect = null;
  }

  // ===== GAME CONNECTION =====

  function connectToGame() {
    var gameId = document.getElementById('mobileGameId').value.trim();
    if (!gameId) {
      alert('Введите Game ID');
      return;
    }

    window.game_id = gameId;
    mobileGameConnected = true;

    show(document.getElementById('settingsModeCard'));
    show(document.getElementById('teamsCard'));
    show(document.getElementById('teamsNamesCard'));
    hide(document.getElementById('teamsLoading'));

    document.getElementById('controlLoading').textContent = 'Загрузка...';
    show(document.getElementById('controlLoading'));
    hide(document.getElementById('controlContent'));

    updateLinks();
    _localSettingsDirty = false; // Сбрасываем флаг при подключении к игре

    if (DEMO_MODE) {
      Object.keys(DEMO_DEFAULT_DATA).forEach(function(key) {
        mobileScoreboardData[key] = DEMO_DEFAULT_DATA[key];
      });
      _recordExists = true;
      update_db({});
      updateSettingsUI(mobileScoreboardData);
      updateTeamsUI(mobileScoreboardData);
      updateControlUI(mobileScoreboardData);
      showControlContent();
      return;
    }

    subscribeToGame();

    DB.scoreboard.get(game_id).then(function(data) {
      if (data) {
        applyGameData(data);
      } else {
        _recordExists = false;
        document.getElementById('controlLoading').textContent = 'Заполните данные команд';
      }
    }).catch(function() {
      _recordExists = false;
      document.getElementById('controlLoading').textContent = 'Заполните данные команд';
    });
  }

  function applyGameData(data) {
    _recordExists = true;
    Object.keys(data).forEach(function(key) {
      mobileScoreboardData[key] = data[key];
    });
    _localSettingsDirty = false; // Сбрасываем флаг при применении данных игры
    updateSettingsUI(mobileScoreboardData);
    updateTeamsUI(mobileScoreboardData);
    updateControlUI(mobileScoreboardData);
    showControlContent();
  }

  // ===== SUBSCRIPTION =====

  var _pollInterval = null;
  var _lastPollPayload = null;

  function startPolling() {
    if (_pollInterval) clearInterval(_pollInterval);
    _pollInterval = setInterval(function() {
      if (!mobileGameConnected || !game_id) return;
      DB.scoreboard.get(game_id).then(function(data) {
        if (!data) return;
        // Тяжёлая перерисовка UI только если данные реально изменились:
        // опрос каждую секунду не должен гонять DOM-обновления впустую
        var serialized = JSON.stringify(data);
        if (serialized === _lastPollPayload) return;
        _lastPollPayload = serialized;
        Object.keys(data).forEach(function(key) {
          mobileScoreboardData[key] = data[key];
        });
        updateSettingsUI(mobileScoreboardData);
        updateControlUI(mobileScoreboardData);
      }).catch(function() {});
    }, 1000);
  }

  function stopPolling() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  function subscribeToGame() {
    DB.scoreboard.subscribe(game_id, function(data) {
      if (!data) {
        return;
      }

      // Merge instead of replace — PocketBase SSE may omit fields
      _recordExists = true;
      Object.keys(data).forEach(function(key) {
        if (key !== 'id') mobileScoreboardData[key] = data[key];
      });
      // PocketBase system id shadows custom id field — use get('id') for custom game ID
      if (typeof data.get === 'function') {
        var customId = data.get('id');
        if (customId) mobileScoreboardData['id'] = customId;
      }
      // Keep fields that PocketBase SSE might have dropped
      var merged = mobileScoreboardData;

      _subscribeCallCount++;
      if (!_initialDataLoaded) {
        _initialDataLoaded = true;
        var beachMode = !!merged['beach_mode'];
        var beachFinished = beachMode && merged['beach_match_finished'];
        var classicFinished = (!beachMode) && merged['classic_match_finished'];
        if (beachFinished || classicFinished) {
          matchWasAlreadyFinished = true;
        }
      }

      // Обновляем список шаблонов при получении данных игры
      // (на случай, если список ещё не загрузился или изменился в другом окне)
      loadMobileTemplateSelect();

      updateSettingsUI(merged);
      updateTeamsUI(merged);
      updateControlUI(merged);
      showControlContent();
    }, function(error) {
      console.error('Error listening to scoreboard:', error);
    });

    startPolling();
  }

  // ===== SETTINGS UI =====

  function updateSettingsUI(data) {
    if (!_localSettingsDirty) {
      var matchmode = data['matchmode'];
      if (matchmode) {
        applyMatchmode(matchmode);
      } else {
        _localBeachMode = !!data['beach_mode'];
        _localTwoWinsMode = !!data['two_wins_mode'];
        _localInvertTablo = !!data['invert_tablo'];
        _localUnlimitedScore = !!data['unlimited_score'];
        _localCustomMode = !!data['custom_mode'];
        document.getElementById('mobileBeachMode').checked = _localBeachMode;
        document.getElementById('mobileTwoWinsMode').checked = _localTwoWinsMode;
        document.getElementById('mobileInvertTablo').checked = _localInvertTablo;
        document.getElementById('mobileUnlimitedScore').checked = _localUnlimitedScore;
        document.getElementById('mobileCustomMode').checked = _localCustomMode;
        document.getElementById('mobileTwoWinsMode').disabled = _localBeachMode || _localCustomMode;
        document.getElementById('mobileBeachMode').disabled = _localTwoWinsMode || _localCustomMode;
        document.getElementById('mobileUnlimitedScore').disabled = _localCustomMode;
        document.getElementById('mobileCustomMode').disabled = _localBeachMode || _localTwoWinsMode;
      }
    }

    // Обновляем выбор шаблона (всегда, не только при !_localSettingsDirty)
    var templateId = data['template_id'] || '';
    var select = document.getElementById('mobileTemplateSelect');
    // Устанавливаем значение только если список уже загружен (есть option'ы)
    if (select.options.length > 1) {
      select.value = templateId;
    }
    // Если список ещё не загружен — loadMobileTemplateSelect() восстановит значение после загрузки

    var customCard = document.getElementById('customSettingsCard');
    if (_localCustomMode) {
      customCard.style.display = '';
      if (!_customFieldsEditing && !_localSettingsDirty) loadCustomSettingsFromData(data);
    } else {
      customCard.style.display = 'none';
      _customFieldsEditing = false;
    }
  }

  // ===== TEAMS UI =====

  function updateTeamsUI(data) {
    document.getElementById('mobileTournament').value = data['tournament_name'] || 'НВЛ';
    document.getElementById('mobileVenue').value = data['venue'] || '';
    document.getElementById('mobileHomeTeam').value = data['home_team'] || '';
    document.getElementById('mobileAwayTeam').value = data['away_team'] || '';
    document.getElementById('mobileHomeColor').value = data['home_color'] || '#ff0000';
    document.getElementById('mobileHomeColorHex').value = data['home_color'] || '#ff0000';
    document.getElementById('mobileAwayColor').value = data['away_color'] || '#00ff00';
    document.getElementById('mobileAwayColorHex').value = data['away_color'] || '#00ff00';

    if (typeof data['tournament_name'] === 'undefined') {
      update_db({ tournament_name: 'НВЛ' });
    }
    if (typeof data['venue'] === 'undefined') {
      update_db({ venue: '' });
    }
  }

  // ===== CONTROL UI =====

  function updateControlUI(data) {
    var beachMode = _localBeachMode;
    var unlimitedScore = _localUnlimitedScore;

    document.getElementById('mHomeTeam').textContent = data['home_team'] || 'Home';
    document.getElementById('mAwayTeam').textContent = data['away_team'] || 'Away';
    document.getElementById('mHomeTeamFouls').textContent = data['home_team'] || 'Home';
    document.getElementById('mAwayTeamFouls').textContent = data['away_team'] || 'Away';

    var venueEl = document.getElementById('controlVenue');
    if (venueEl) venueEl.textContent = data['venue'] || '';

    // Учёт имени пользователя, последним изменившего игру (приходит в данных подписки)
    var lastEditedEl = document.getElementById('controlLastEdited');
    if (lastEditedEl) {
      var editorName = data['displayname'] || data['displayName'] || data['username'] || '';
      var lastEditedTime = data['lastEdited'];
      if (editorName) {
        var timeStr = '';
        if (lastEditedTime) {
          try {
            var d = new Date(typeof lastEditedTime === 'string' ? lastEditedTime : lastEditedTime.toDate ? lastEditedTime.toDate() : lastEditedTime);
            if (!isNaN(d.getTime())) {
              timeStr = ' в ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) +
                        ' ' + ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
            }
          } catch (e) { timeStr = ''; }
        }
        // Не подсвечиваем своё же имя как "другого пользователя"
        var ownName = getCurrentUserInfo().displayname || getCurrentUserInfo().username || '';
        lastEditedEl.textContent = ownName && ownName === editorName
          ? 'Последнее изменение: вы' + timeStr
          : 'Последнее изменение: ' + editorName + timeStr;
      } else {
        lastEditedEl.textContent = '';
      }
    }

    document.getElementById('mHomeScore').textContent = ensureNumber(data['home_score']);
    document.getElementById('mAwayScore').textContent = ensureNumber(data['away_score']);
    document.getElementById('mHomeFouls').textContent = beachMode ? ensureNumber(data['home_sets']) : data['home_fouls'];
    document.getElementById('mAwayFouls').textContent = beachMode ? ensureNumber(data['away_sets']) : data['away_fouls'];
    document.getElementById('mPeriod').textContent = data['current_period'];
    var mCustomLabelEl = document.getElementById('mCustomLabel');
    // Не перезаписываем поле, пока в нём идёт набор текста — иначе
    // страховочный опрос (1 сек) затирает вводимое значение данными из БД
    if (mCustomLabelEl && document.activeElement !== mCustomLabelEl) {
      mCustomLabelEl.value = data['custom_label'] || '';
    }

    var homeSide = data['home_side'] || 'left';
    var homeOrder = homeSide === 'left' ? 1 : 2;
    var awayOrder = homeOrder === 1 ? 2 : 1;
    var scoreCard = document.getElementById('controlScoreCard');
    var homeBlock = scoreCard.querySelector('.team-score-block:first-child');
    var awayBlock = scoreCard.querySelector('.team-score-block:last-child');
    if (homeBlock) homeBlock.style.order = homeOrder;
    if (awayBlock) awayBlock.style.order = awayOrder;

    var setsCard = document.getElementById('controlSetsCard');
    var homeFoulsBlock = setsCard.querySelector('.team-score-block:first-child');
    var awayFoulsBlock = setsCard.querySelector('.team-score-block:last-child');
    if (homeFoulsBlock) homeFoulsBlock.style.order = homeOrder;
    if (awayFoulsBlock) awayFoulsBlock.style.order = awayOrder;

    var beachFinished = beachMode && data['beach_match_finished'];
    var classicFinished = (!beachMode) && data['classic_match_finished'];
    var matchPending = !!pendingMatchFinish;
    var setPending = !!pendingSetFinish; // Добавлено
    var matchFinished = beachFinished || classicFinished || matchPending || setPending; // Обновлено

    var statusEl = document.getElementById('mobileMatchStatus');
    if (matchPending) {
      // Если матч в ожидании подтверждения, показываем соответствующий статус
      statusEl.className = 'match-status pending';
      statusEl.textContent = 'Ожидание подтверждения...';
      show(statusEl);
    } else if (matchFinished) {
      statusEl.className = 'match-status finished';
      statusEl.textContent = 'Матч завершён';
      show(statusEl);
    } else {
      hide(statusEl);
    }

    var pendingNewSet = !!data['pending_new_set'];
    var startOfSet = ensureNumber(data['home_score']) === 0 && ensureNumber(data['away_score']) === 0;
    // Признак активного таймаута — отдельное поле, не связанное с режимом отображения (show).
    // Раньше show===6 означал и "верх+низ", и таймаут, из-за чего выбор "Верх+низ" блокировал счёт.
    var isTimeoutActive = !!data['timeout_active'];
    
    // Highlight active show button
    var currentShow = ensureNumber(data['show']);
    document.querySelectorAll('.show-select').forEach(function(btn) {
      var val = parseInt(btn.getAttribute('data-val'), 10);
      btn.classList.toggle('active', val === currentShow);
    });

    var scoreButtonsDisabled = pendingNewSet || matchFinished || isTimeoutActive || setPending; // Обновлено
    document.querySelectorAll('.score-btn').forEach(function(btn) { btn.disabled = scoreButtonsDisabled; });

    // Во время таймаута блокируем кнопки показа табло: случайное нажатие
    // сбрасывает show=6 и «выключает» таймаут, рассинхронизируя страницы
    document.querySelectorAll('.show-select').forEach(function(btn) { btn.disabled = isTimeoutActive; });

    var foulButtonsDisabled = !startOfSet && !pendingNewSet && !matchFinished;
    document.querySelectorAll('.foul-btn').forEach(function(btn) { btn.disabled = foulButtonsDisabled; });

    var timeoutBaseDisabled = pendingNewSet || matchFinished || startOfSet;
    if (isCustomMode()) syncCustomSettings();
    var maxTimeouts = isCustomMode() ? getCustomMaxTimeouts() : (beachMode ? 1 : 2);
    var homeTimeouts = ensureNumber(data['home_timeouts']);
    var awayTimeouts = ensureNumber(data['away_timeouts']);

    document.querySelectorAll('.timeout-btn').forEach(function(btn) { btn.classList.remove('blinking'); });

    if (isTimeoutActive) {
      var currentLabel = data['custom_label'] || '';
      var homeTeam = data['home_team'] || '';
      var awayTeam = data['away_team'] || '';
      var isHomeTimeout = currentLabel === 'Таймаут ' + homeTeam;
      var isAwayTimeout = currentLabel === 'Таймаут ' + awayTeam;

      document.querySelector('.timeout-btn[data-team="home"]').disabled = timeoutBaseDisabled || isAwayTimeout || (homeTimeouts >= maxTimeouts && !isHomeTimeout);
      document.querySelector('.timeout-btn[data-team="away"]').disabled = timeoutBaseDisabled || isHomeTimeout || (awayTimeouts >= maxTimeouts && !isAwayTimeout);

      if (isHomeTimeout) document.querySelector('.timeout-btn[data-team="home"]').classList.add('blinking');
      if (isAwayTimeout) document.querySelector('.timeout-btn[data-team="away"]').classList.add('blinking');
    } else {
      document.querySelector('.timeout-btn[data-team="home"]').disabled = timeoutBaseDisabled || homeTimeouts >= maxTimeouts;
      document.querySelector('.timeout-btn[data-team="away"]').disabled = timeoutBaseDisabled || awayTimeouts >= maxTimeouts;
    }

    var newSetBtn = document.querySelector('.new-set-btn');
    var sideSwitchBtn = document.querySelector('.side-switch-btn');
    var resetBtn = document.querySelector('.reset-btn');
    var periodBtns = document.querySelectorAll('.period-btn');
    
    newSetBtn.disabled = !pendingNewSet || matchFinished;
    sideSwitchBtn.disabled = matchFinished;
    periodBtns.forEach(function(btn) {
      var enablePeriodButtons = (unlimitedScore || startOfSet || pendingNewSet || !!data['classic_match_finished'] || !!data['beach_match_finished']) && !matchPending;
      btn.disabled = !enablePeriodButtons;
    });

    if (pendingNewSet && !matchFinished) {
      newSetBtn.style.background = '#e94560';
      newSetBtn.style.color = 'white';
    } else {
      newSetBtn.style.background = '';
      newSetBtn.style.color = '';
    }

    var classicSwitchNeeded = !!data['classic_switch_needed'];
    var beachSwitchMessage = data['beach_switch_message'];
    sideSwitchBtn.classList.toggle('blinking', (beachMode && !!beachSwitchMessage) || classicSwitchNeeded);

    renderSetHistoryCtl(data['set_history']);
  }

  function renderSetHistoryCtl(history) {
    var items = history;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch(e) { items = []; }
    }
    if (!Array.isArray(items)) items = [];
    var el = document.getElementById('mSetHistory');
    if (!el) return;
    if (items.length === 0) {
      el.innerHTML = '&nbsp;';
      return;
    }
    var homeTeam = mobileScoreboardData['home_team'] || 'Home';
    var awayTeam = mobileScoreboardData['away_team'] || 'Away';
    var scoresParts = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i] || {};
      scoresParts.push((entry.home != null ? entry.home : '-') + ':' + (entry.away != null ? entry.away : '-'));
    }
    el.innerHTML = homeTeam + ' - ' + awayTeam + ':<br>' + scoresParts.join(' ');
  }

  // ===== LINKS =====

  function updateLinks() {
    if (!mobileGameConnected) return;
    var gid = document.getElementById('mobileGameId').value.trim();
    if (!gid) return;

    var base = BASE_URL;
    document.getElementById('linkScoreboard').href = base + 'sb.html?game=' + gid;
    document.getElementById('linkTablo').href = base + 'tablo.html?game=' + gid;
    document.getElementById('linkResults').href = base + 'results.html';
    document.getElementById('linkOnline').href = base + 'online.html';
  }

  // ===== MODALS =====

  function showMatchFinishDialog(update, setHistory, overallHome, overallAway, mode) {
    if (matchWasAlreadyFinished) {
      saveMatchResult(setHistory, overallHome, overallAway);
      update_db(update);
      return;
    }
    var homeTeam = mobileScoreboardData['home_team'] || 'Команда 1';
    var awayTeam = mobileScoreboardData['away_team'] || 'Команда 2';
    var winner = overallHome > overallAway ? homeTeam : awayTeam;
    document.getElementById('mobileMatchFinishText').innerHTML =
      'Игра завершена!<br>Победитель: <b>' + winner + '</b> (' + overallHome + ':' + overallAway + ')<br><br>Завершить игру?';

    pendingMatchFinish = { update: update, setHistory: setHistory, overallHome: overallHome, overallAway: overallAway, mode: mode };
    document.getElementById('mobileMatchFinishModal').classList.remove('hidden');
  }

  function confirmMatchFinish() {
    if (!pendingMatchFinish) return;
    var data = pendingMatchFinish;
    saveMatchResult(data.setHistory, data.overallHome, data.overallAway);
    update_db(data.update);
    pendingMatchFinish = null;
    document.getElementById('mobileMatchFinishModal').classList.add('hidden');
  }

  function cancelMatchFinish() {
    if (!pendingMatchFinish) return;
    matchWasAlreadyFinished = false;
    pendingMatchFinish = null;
    document.getElementById('mobileMatchFinishModal').classList.add('hidden');
  }

  /**
   * Показать модальное окно подтверждения завершения сета.
   */
  function showMobileSetFinishDialog(update) {
    console.log('[Mobile] showMobileSetFinishDialog вызван.');

    // Сохраняем данные для последующего использования
    pendingSetFinish = {
      update: update
    };

    document.getElementById('mobileSetFinishModal').classList.remove('hidden');
    // Блокируем кнопки на время подтверждения
    document.querySelectorAll('.score-btn').forEach(function(btn) { btn.disabled = true; });
  }

  /**
   * Подтвердить завершение сета — обновить БД.
   */
  function confirmMobileSetFinish() {
    if (!pendingSetFinish) return;

    update_db(pendingSetFinish.update);

    pendingSetFinish = null;
    document.getElementById('mobileSetFinishModal').classList.add('hidden');
    // Разблокировка кнопок произойдет при следующем обновлении данных из БД
  }

  /**
   * Отменить завершение сета — НЕ фиксировать счёт.
   */
  function cancelMobileSetFinish() {
    if (!pendingSetFinish) return;
    pendingSetFinish = null;
    document.getElementById('mobileSetFinishModal').classList.add('hidden');
    document.querySelectorAll('.score-btn').forEach(function(btn) { btn.disabled = false; });
  }
  function saveMatchResult(setHistory, overallHome, overallAway) {
    if (DEMO_MODE) return;

    var isBeach = _localBeachMode;
    var twoWinsMode = _localTwoWinsMode;
    var userInfo = getCurrentUserInfo();

    if (typeof overallHome === 'undefined' || typeof overallAway === 'undefined') {
      if (isBeach) {
        overallHome = ensureNumber(mobileScoreboardData['home_sets']);
        overallAway = ensureNumber(mobileScoreboardData['away_sets']);
      } else {
        overallHome = ensureNumber(mobileScoreboardData['home_fouls']);
        overallAway = ensureNumber(mobileScoreboardData['away_fouls']);
      }
    }

    var matchData = {
      date_time: DB.serverTimestamp(),
      home_team: mobileScoreboardData['home_team'],
      away_team: mobileScoreboardData['away_team'],
      tournament_name: mobileScoreboardData['tournament_name'] || 'НВЛ',
      venue: mobileScoreboardData['venue'] || '',
      overall_score: overallHome + ':' + overallAway,
      sets_score: setHistory || mobileScoreboardData['set_history'] || [],
      game_type: isBeach ? 'beach' : 'classic',
      two_wins_mode: twoWinsMode,
      game_id: game_id,
      username: userInfo.username || '',
      displayname: userInfo.displayname || '',
      is_deleted: false,
      template_id: mobileScoreboardData['template_id'] || ''
    };

    DB.matches.add(matchData).then(function(docRef) {
      console.log('Match saved:', docRef.id);
      DB.scoreboard.update(game_id, { last_match_id: docRef.id }).catch(function() {});
    }).catch(function(err) {
      console.error('Error saving match:', err);
    });
  }

  // ===== TIMEOUT MODAL =====

  function showTimeoutModal(teamName) {
    stopTimeoutTimer();
    timeoutRemainingSeconds = 30;
    document.getElementById('mobileTimeoutTimer').textContent = '30';
    document.getElementById('mobileTimeoutTimer').style.color = '#e17055';
    document.getElementById('mobileTimeoutTeam').textContent = 'Таймаут: ' + teamName;
    document.getElementById('mobileTimeoutTitle').textContent = '⏸️ Таймаут - ' + teamName;
    document.getElementById('mobileTimeoutModal').classList.remove('hidden');

    timeoutTimerInterval = setInterval(function() {
      timeoutRemainingSeconds--;
      document.getElementById('mobileTimeoutTimer').textContent = timeoutRemainingSeconds;
      if (timeoutRemainingSeconds <= 5) document.getElementById('mobileTimeoutTimer').style.color = '#fdcb6e';
      if (timeoutRemainingSeconds <= 3) document.getElementById('mobileTimeoutTimer').style.color = '#e17055';
      if (timeoutRemainingSeconds <= 0) {
        stopTimeoutTimer();
        document.getElementById('mobileTimeoutModal').classList.add('hidden');
        update_db(endTimeoutUpdate());
      }
    }, 1000);
  }

  function stopTimeoutTimer() {
    if (timeoutTimerInterval) { clearInterval(timeoutTimerInterval); timeoutTimerInterval = null; }
    timeoutRemainingSeconds = 0;
  }

  function hideTimeoutModal() {
    stopTimeoutTimer();
    document.getElementById('mobileTimeoutModal').classList.add('hidden');
  }

  /**
   * Завершение таймаута: снимаем флаг timeout_active и восстанавливаем
   * режим отображения (show), который был до начала таймаута.
   */
  function endTimeoutUpdate() {
    var prev = ensureNumber(mobileScoreboardData['prev_show']);
    if (!prev || prev === 6) prev = 1;
    return { timeout_active: false, show: prev, custom_label: mobileScoreboardData['custom_label'] };
  }

  // ===== GAME LOGIC =====

  var CLASSIC_POINTS_TO_WIN = 25;
  var CLASSIC_SETS_TO_WIN = 3;
  var CLASSIC_SETS_TO_WIN_TWO = 2;
  var CLASSIC_TIEBREAK_POINTS_TO_WIN = 15;
  var BEACH_SETS_TO_WIN = 2;
  var BEACH_MAX_SETS = 3;

  function isBeachMode() { return _localBeachMode; }

  function isCustomMode() { return _localCustomMode; }

  function syncCustomSettings() {
    if (!_localCustomMode) return;
    _localCustomSettings.count_wins = ensureNumber(document.getElementById('customSetsToWin').value) || 3;
    _localCustomSettings.score_wins = ensureNumber(document.getElementById('customPointsToWin').value) || 25;
    _localCustomSettings.score_tie = ensureNumber(document.getElementById('customTiebreakPoints').value) || 15;
    _localCustomSettings.balance = document.getElementById('customBalance').checked;
    _localCustomSettings.score_change = ensureNumber(document.getElementById('customSideSwitchPoints').value) || 7;
    var maxT = document.getElementById('customMaxTimeouts').value;
    _localCustomSettings.count_timeouts = maxT === '' ? 2 : ensureNumber(maxT);
  }

  function getCustomPointsToWin() {
    return _localCustomSettings.score_wins || CLASSIC_POINTS_TO_WIN;
  }

  function getCustomTiebreakPoints() {
    return _localCustomSettings.score_tie || 15;
  }

  function getCustomSetsToWin() {
    return _localCustomSettings.count_wins || CLASSIC_SETS_TO_WIN;
  }

  function getCustomBalance() {
    return _localCustomSettings.balance;
  }

  function getCustomSideSwitch() {
    return _localCustomSettings.score_change > 0;
  }

  function getCustomSideSwitchPoints() {
    return ensureNumber(_localCustomSettings.score_change);
  }

  function getCustomMaxTimeouts() {
    return _localCustomSettings.count_timeouts;
  }

  function getBeachSetNumber() {
    var setNumber = ensureNumber(mobileScoreboardData['beach_current_set']);
    if (!setNumber) setNumber = ensureNumber(mobileScoreboardData['current_period']);
    if (setNumber <= 0) setNumber = 1;
    if (setNumber > BEACH_MAX_SETS) setNumber = BEACH_MAX_SETS;
    return setNumber;
  }

  function getBeachTarget(setNumber) { return setNumber >= 3 ? 15 : 21; }
  function getBeachSwitchInterval(setNumber) { return setNumber >= 3 ? 5 : 7; }
  function formatScore(homeScore, awayScore) { return homeScore + ':' + awayScore; }

  function hasTeamWonSet(team, homeScore, awayScore, target) {
    var diff = Math.abs(homeScore - awayScore);
    if (team === 'home') return (homeScore >= target) && (diff >= 2);
    return (awayScore >= target) && (diff >= 2);
  }

  function cloneSetHistory() {
    var history = mobileScoreboardData['set_history'];
    if (!Array.isArray(history)) return [];
    return history.slice(0, 5);
  }

  function nextSetHistory(homeScore, awayScore) {
    var history = cloneSetHistory();
    history.push({ home: homeScore, away: awayScore });
    if (history.length > 5) history.shift();
    return history;
  }

  function flipSidesPayload(extra) {
    var currentSide = mobileScoreboardData['home_side'] || 'left';
    var newHomeSide = currentSide === 'left' ? 'right' : 'left';
    var payload = { home_side: newHomeSide, away_side: newHomeSide === 'left' ? 'right' : 'left' };
    if (extra) Object.assign(payload, extra);
    return payload;
  }

  function classicSetWon(teamScore, opponentScore) {
    var period = ensureNumber(mobileScoreboardData['current_period']);

    if (isCustomMode()) {
      syncCustomSettings();
      var setsToWin = getCustomSetsToWin();
      var isTiebreak = (period === setsToWin);
      var target = isTiebreak ? getCustomTiebreakPoints() : getCustomPointsToWin();
      if (getCustomBalance()) {
        return teamScore >= target && (teamScore - opponentScore) >= 2;
      }
      return teamScore >= target;
    }

    var twoWinsMode = _localTwoWinsMode;
    var target2;
    if (twoWinsMode) {
      target2 = (period === 3) ? CLASSIC_TIEBREAK_POINTS_TO_WIN : CLASSIC_POINTS_TO_WIN;
    } else {
      target2 = (period === 5) ? 15 : CLASSIC_POINTS_TO_WIN;
    }
    return teamScore >= target2 && (teamScore - opponentScore) >= 2;
  }

  function applySetWin(team, homeScore, awayScore, baseUpdate) {
    var isBeach = isBeachMode();

    if (isBeach) {
      var homeSets = ensureNumber(mobileScoreboardData['home_sets']);
      var awaySets = ensureNumber(mobileScoreboardData['away_sets']);
      if (team === 'home') homeSets++; else awaySets++;
      var matchFinished = homeSets >= BEACH_SETS_TO_WIN || awaySets >= BEACH_SETS_TO_WIN;
      var currentSet = getBeachSetNumber();
      var update = Object.assign({}, baseUpdate || {});
      update['home_sets'] = homeSets;
      update['away_sets'] = awaySets;
      if (!('beach_switch_message' in update)) update['beach_switch_message'] = '';

      if (matchFinished || currentSet >= BEACH_MAX_SETS) {
        update['beach_match_finished'] = true;
        update['home_score'] = homeScore;
        update['away_score'] = awayScore;
        update['current_period'] = currentSet;
        update['beach_current_set'] = currentSet;
      } else {
        update['home_score'] = homeScore;
        update['away_score'] = awayScore;
        update['next_beach_set'] = currentSet + 1;
        update['pending_new_set'] = true;
        update['home_timeouts'] = 0;
        update['away_timeouts'] = 0;
      }
      update['set_history'] = nextSetHistory(homeScore, awayScore);
      if (matchFinished && !matchWasAlreadyFinished) {
        showMatchFinishDialog(update, update['set_history'], homeSets, awaySets, 'beach');
      } else {
        showMobileSetFinishDialog(update); // Show dialog for set finish in beach mode
      }
    } else {
      var homeFouls = ensureNumber(mobileScoreboardData['home_fouls']);
      var awayFouls = ensureNumber(mobileScoreboardData['away_fouls']);
      if (team === 'home') homeFouls++; else awayFouls++;

      var setsToWin, matchFinished2, currentPeriod, maxPeriod, nextPeriod;

      if (isCustomMode()) {
        setsToWin = getCustomSetsToWin();
        matchFinished2 = homeFouls >= setsToWin || awayFouls >= setsToWin;
        currentPeriod = ensureNumber(mobileScoreboardData['current_period']) || 1;
        maxPeriod = ensureNumber(mobileScoreboardData['period_count']) || 9;
        nextPeriod = currentPeriod < maxPeriod ? currentPeriod + 1 : currentPeriod;
      } else {
        var twoWinsMode = _localTwoWinsMode;
        setsToWin = twoWinsMode ? CLASSIC_SETS_TO_WIN_TWO : CLASSIC_SETS_TO_WIN;
        matchFinished2 = homeFouls >= setsToWin || awayFouls >= setsToWin;
        currentPeriod = ensureNumber(mobileScoreboardData['current_period']) || 1;
        maxPeriod = ensureNumber(mobileScoreboardData['period_count']) || 5;
        nextPeriod = currentPeriod < maxPeriod ? currentPeriod + 1 : currentPeriod;
      }
      var update2 = Object.assign({}, baseUpdate, {
        home_fouls: homeFouls, away_fouls: awayFouls, current_period: currentPeriod, classic_match_finished: matchFinished2
      });
      if (!matchFinished2) {
        var classic_tiebreak_switch_done;
        if (isCustomMode()) {
          classic_tiebreak_switch_done = true;
        } else {
          var twoWinsMode = _localTwoWinsMode;
          var tiebreakSet = twoWinsMode ? 3 : 5;
          classic_tiebreak_switch_done = nextPeriod === tiebreakSet ? false : true;
        }
        var flip = flipSidesPayload({ classic_tiebreak_switch_done: classic_tiebreak_switch_done });
        update2['pending_home_side'] = flip.home_side;
        update2['pending_away_side'] = flip.away_side;
        update2['pending_classic_tiebreak_switch_done'] = flip.classic_tiebreak_switch_done;
        update2['next_period'] = nextPeriod;
        update2['pending_new_set'] = true;
        update2['home_timeouts'] = 0;
        update2['away_timeouts'] = 0;
      } else {
        update2['classic_tiebreak_switch_done'] = true;
      }
      update2['home_score'] = team === 'home' ? homeScore : awayScore;
      update2['away_score'] = team === 'home' ? awayScore : homeScore;
      update2['set_history'] = nextSetHistory(update2['home_score'], update2['away_score']);

      if (matchFinished2 && !matchWasAlreadyFinished) {
        showMatchFinishDialog(update2, update2['set_history'], homeFouls, awayFouls, 'classic');
      } else if (matchFinished2 && matchWasAlreadyFinished) {
        saveMatchResult(update2['set_history'], homeFouls, awayFouls);
        update_db(update2);
      } else {
        showMobileSetFinishDialog(update2); // Изменено: показываем диалог подтверждения сета
      }
    }
  }

  function handleBeachScore(team, delta) {
    if (mobileScoreboardData['beach_match_finished'] || mobileScoreboardData['classic_match_finished'] || pendingMatchFinish) return;
    var scoreKey = team + '_score';
    var otherKey = team === 'home' ? 'away_score' : 'home_score';
    var currentScore = ensureNumber(mobileScoreboardData[scoreKey]);
    var newScore = currentScore + delta;
    if (newScore < 0) return;
    var otherScore = ensureNumber(mobileScoreboardData[otherKey]);
    var update = {};
    update[scoreKey] = newScore;

    var setNumber = getBeachSetNumber();
    var target = getBeachTarget(setNumber);
    var interval = getBeachSwitchInterval(setNumber);
    var homeBefore = ensureNumber(mobileScoreboardData['home_score']);
    var awayBefore = ensureNumber(mobileScoreboardData['away_score']);
    var totalBefore = homeBefore + awayBefore;
    var totalAfter = totalBefore + delta;

    if (delta > 0 && Math.floor(totalAfter / interval) > Math.floor(totalBefore / interval)) {
      var homeAfter = team === 'home' ? newScore : otherScore;
      var awayAfter = team === 'home' ? otherScore : newScore;
      update['beach_switch_message'] = 'Смена площадок — ' + setNumber + ' сет, счёт ' + formatScore(homeAfter, awayAfter);
      mobileScoreboardData['beach_switch_message'] = update['beach_switch_message'];
      highlightSideSwitch(true);
    }

    var homeAfterScore = team === 'home' ? newScore : otherScore;
    var awayAfterScore = team === 'home' ? otherScore : newScore;
    if (delta > 0 && hasTeamWonSet(team, homeAfterScore, awayAfterScore, target)) {
      applySetWin(team, homeAfterScore, awayAfterScore, update);
    } else {
      update_db(update);
    }
  }

  function highlightSideSwitch(needed, message) {
    var btn = document.querySelector('.side-switch-btn');
    btn.classList.toggle('blinking', needed);
  }

  function handleClassicScore(team, delta) {
    if (mobileScoreboardData['classic_match_finished'] || pendingMatchFinish) return;
    var scoreKey = team + '_score';
    var otherKey = team === 'home' ? 'away_score' : 'home_score';
    var currentScore = ensureNumber(mobileScoreboardData[scoreKey]);
    var newScore = currentScore + delta;
    if (newScore < 0) return;
    var update = {};
    update[scoreKey] = newScore;
    var otherScore = ensureNumber(mobileScoreboardData[otherKey]);
    var homeAfter = team === 'home' ? newScore : ensureNumber(mobileScoreboardData['home_score']);
    var awayAfter = team === 'home' ? otherScore : newScore;

    var twoWinsMode = _localTwoWinsMode;
    var currentPeriod = ensureNumber(mobileScoreboardData['current_period']);

    var sideSwitchTriggered = false;

    if (isCustomMode()) {
      syncCustomSettings();
      if (getCustomSideSwitch()) {
        var homeBefore = (team === 'home') ? currentScore : otherScore;
        var awayBefore = (team === 'home') ? otherScore : currentScore;
        var totalBefore = homeBefore + awayBefore;
        var totalAfter = homeAfter + awayAfter;
        var interval = getCustomSideSwitchPoints();

        // Смена происходит, когда пересекается граница, кратная интервалу
        if (delta > 0 && interval > 0 && Math.floor(totalAfter / interval) > Math.floor(totalBefore / interval)) {
          update['classic_switch_needed'] = true;
          update['classic_switch_message'] = 'Смена площадок — счёт ' + formatScore(homeAfter, awayAfter);
          mobileScoreboardData['classic_switch_needed'] = true; // Обновляем локальное состояние для UI
          mobileScoreboardData['classic_switch_message'] = update['classic_switch_message'];
          sideSwitchTriggered = true;
        }
      }
    } else if (!isCustomMode()) {
      // Логика для стандартного режима (не трогаем)
      var tiebreakSet = twoWinsMode ? 3 : 5;
      if (!isBeachMode() && currentPeriod === tiebreakSet && Math.max(homeAfter, awayAfter) >= 8) {
        if (!mobileScoreboardData['classic_switch_shown']) {
          update['classic_switch_needed'] = true;
          update['classic_switch_message'] = 'Смена площадок — ' + tiebreakSet + '-й сет, счёт ' + formatScore(homeAfter, awayAfter);
          update['classic_switch_shown'] = true;
          mobileScoreboardData['classic_switch_needed'] = true;
          mobileScoreboardData['classic_switch_message'] = update['classic_switch_message'];
          sideSwitchTriggered = true;
        }
      } else if (mobileScoreboardData['classic_switch_needed']) {
        var DEL2 = DB.deleteField();
        update['classic_switch_needed'] = DEL2;
        update['classic_switch_message'] = DEL2;
        delete mobileScoreboardData['classic_switch_needed'];
        delete mobileScoreboardData['classic_switch_message'];
      }
    }

    if (sideSwitchTriggered) {
      highlightSideSwitch(true);
    }

    var unlimitedScore = _localUnlimitedScore;
    if (delta > 0 && !unlimitedScore && classicSetWon(newScore, otherScore)) {
      applySetWin(team, newScore, otherScore, update);
      return;
    }
    update_db(update);
  }

  // ===== NEW SET =====

  function performNewSetUpdate() {
    var update = { home_score: 0, away_score: 0, beach_switch_message: '', home_timeouts: 0, away_timeouts: 0 };
    if (isBeachMode()) {
      var nextSet = mobileScoreboardData['next_beach_set'];
      if (!nextSet) nextSet = ensureNumber(mobileScoreboardData['beach_current_set']) + 1;
      update['beach_current_set'] = nextSet;
      update['current_period'] = nextSet;
      update['next_beach_set'] = DB.deleteField();
      update['pending_new_set'] = DB.deleteField();
      update_db(update);
      return;
    }
    var nextPeriod = mobileScoreboardData['next_period'];
    if (!nextPeriod) nextPeriod = ensureNumber(mobileScoreboardData['current_period']) + 1;
    update['current_period'] = nextPeriod;
    if (mobileScoreboardData['pending_home_side'] != null) update['home_side'] = mobileScoreboardData['pending_home_side'];
    if (mobileScoreboardData['pending_away_side'] != null) update['away_side'] = mobileScoreboardData['pending_away_side'];
    if (mobileScoreboardData['pending_classic_tiebreak_switch_done'] != null) update['classic_tiebreak_switch_done'] = mobileScoreboardData['pending_classic_tiebreak_switch_done'];
    update['next_period'] = DB.deleteField();
    update['pending_home_side'] = DB.deleteField();
    update['pending_away_side'] = DB.deleteField();
    update['pending_classic_tiebreak_switch_done'] = DB.deleteField();
    update['pending_new_set'] = DB.deleteField();
    update_db(update);
  }

  // ===== EVENT HANDLERS =====

  function initEventHandlers() {
    // Login
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('loginPassword').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doLogin();
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', doLogout);

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // Game ID
    document.getElementById('generateGameId').addEventListener('click', function() {
      document.getElementById('mobileGameId').value = generateUUID();
    });

    document.getElementById('connectGameBtn').addEventListener('click', connectToGame);
    document.getElementById('refreshGamesBtn').addEventListener('click', loadGamesList);
    document.getElementById('mobileGameSelectYes').addEventListener('click', confirmGameSelect);
    document.getElementById('mobileGameSelectNo').addEventListener('click', cancelGameSelect);
    document.getElementById('mobileGameSelectDelete').addEventListener('click', function() {
      document.getElementById('mobileGameSelectModal').classList.add('hidden');
      document.getElementById('mobileDeleteConfirmModal').classList.remove('hidden');
    });
    document.getElementById('mobileDeleteConfirmYes').addEventListener('click', function() {
      document.getElementById('mobileDeleteConfirmModal').classList.add('hidden');
      if (!pendingGameSelect) return;
      var gid = pendingGameSelect;
      pendingGameSelect = null;
      DB.scoreboard.delete(gid).then(function() {
        loadGamesList();
      }).catch(function(err) {
        console.error('Delete failed:', err);
        alert('Ошибка удаления');
      });
    });
    document.getElementById('mobileDeleteConfirmNo').addEventListener('click', function() {
      document.getElementById('mobileDeleteConfirmModal').classList.add('hidden');
    });

    // Mode toggles
    document.getElementById('mobileBeachMode').addEventListener('change', function() {
      _localBeachMode = this.checked;
      if (_localBeachMode) { _localTwoWinsMode = false; _localCustomMode = false; }
      document.getElementById('mobileTwoWinsMode').checked = _localTwoWinsMode;
      document.getElementById('mobileCustomMode').checked = _localCustomMode;
      updateModeTogglesState();
      saveSettings(); // Вызываем новую функцию saveSettings
    });

    document.getElementById('mobileTwoWinsMode').addEventListener('change', function() {
      _localTwoWinsMode = this.checked;
      if (_localTwoWinsMode) { _localBeachMode = false; _localCustomMode = false; }
      document.getElementById('mobileBeachMode').checked = _localBeachMode;
      document.getElementById('mobileCustomMode').checked = _localCustomMode;
      updateModeTogglesState(); 
      saveSettings(); // Вызываем новую функцию saveSettings
    });

    document.getElementById('mobileInvertTablo').addEventListener('change', function() {
      _localInvertTablo = this.checked;
      saveSettings(); // Вызываем новую функцию saveSettings
    });

    document.getElementById('mobileUnlimitedScore').addEventListener('change', function() {
      _localUnlimitedScore = this.checked;
      saveSettings(); // Вызываем новую функцию saveSettings
    });

    // Custom mode toggle — local state only, load from DB if available
    document.getElementById('mobileCustomMode').addEventListener('change', function() {
      _localCustomMode = this.checked;
      if (_localCustomMode) {
        _localBeachMode = false; // Отключаем пляжный режим
        _localTwoWinsMode = false; // Отключаем режим до двух побед
        document.getElementById('mobileBeachMode').checked = false; // Обновляем UI
        document.getElementById('mobileTwoWinsMode').checked = false; // Обновляем UI
      }
      updateModeTogglesState();

      var customCard = document.getElementById('customSettingsCard');
      if (_localCustomMode) {
        customCard.style.display = '';
        if (_recordExists) {
          loadCustomSettingsFromData(mobileScoreboardData);
        } else {
          _localCustomSettings.count_wins = 3;
          _localCustomSettings.score_wins = 25;
          _localCustomSettings.score_tie = 15;
          _localCustomSettings.balance = false;
          _localCustomSettings.score_change = 7;
          _localCustomSettings.count_timeouts = 2;
          document.getElementById('customSetsToWin').value = 3;
          document.getElementById('customPointsToWin').value = 25;
          document.getElementById('customTiebreakPoints').value = 15;
          document.getElementById('customBalance').checked = false;
          document.getElementById('customSideSwitchPoints').value = 7;
          document.getElementById('customMaxTimeouts').value = 2;
        }
      } else {
        customCard.style.display = 'none';
        _customFieldsEditing = false;
      }
      saveSettings(); // Вызываем новую функцию saveSettings
    });

    function updateModeTogglesState() {
        document.getElementById('mobileTwoWinsMode').disabled = _localBeachMode || _localCustomMode;
        document.getElementById('mobileBeachMode').disabled = _localTwoWinsMode || _localCustomMode;
        document.getElementById('mobileUnlimitedScore').disabled = _localCustomMode;
        document.getElementById('mobileCustomMode').disabled = _localBeachMode || _localTwoWinsMode;
    }

    // ======================================================================
    // ШАБЛОН ОФОРМЛЕНИЯ
    // ======================================================================

    // При изменении шаблона — сразу сохраняем в БД
    document.getElementById('mobileTemplateSelect').addEventListener('change', function() {
      if (!_recordExists) return;
      saveSettings(); // Здесь _recordExists всегда true, поэтому вызовется update_db
    });

    // Save custom settings — save to DB (existing record only)
    document.getElementById('saveCustomSettings').addEventListener('click', function() {
      var payload = buildSavePayload();
      if (!mobileGameConnected) return;
      _customFieldsEditing = false;
      syncCustomSettings();
      if (!_recordExists) return; // Эта кнопка должна быть активна только при существующей записи
      _localSettingsDirty = false;
      var payload = buildSavePayload();
      // При применении кастомных настроек сбрасываем игру
      var resetPayload = {
        classic_match_finished: false,
        beach_match_finished: false,
        set_history: [],
        home_fouls: 0,
        away_fouls: 0,
        home_score: 0,
        away_score: 0,
        current_period: 1,
        classic_tiebreak_switch_done: true,
        home_timeouts: 0,
        away_timeouts: 0,
        pending_new_set: DB.deleteField(),
        next_period: DB.deleteField(),
        classic_switch_needed: DB.deleteField(),
        classic_switch_shown: DB.deleteField(),
        classic_switch_message: DB.deleteField()
      };
      update_db(Object.assign(payload, resetPayload));
    });

    // Track editing on custom form fields
    ['customSetsToWin', 'customPointsToWin', 'customTiebreakPoints', 'customSideSwitchPoints', 'customMaxTimeouts'].forEach(function(id) {
      document.getElementById(id).addEventListener('input', function() { _customFieldsEditing = true; });
    });
    document.getElementById('customBalance').addEventListener('change', function() { _customFieldsEditing = true; });

    // Teams save
    document.getElementById('saveTeamsBtn').addEventListener('click', function() {
      var update = {
        away_team: document.getElementById('mobileAwayTeam').value,
        away_color: document.getElementById('mobileAwayColor').value,
        home_team: document.getElementById('mobileHomeTeam').value,
        home_color: document.getElementById('mobileHomeColor').value,
        tournament_name: document.getElementById('mobileTournament').value || 'НВЛ',
        venue: document.getElementById('mobileVenue').value || ''
      };
      if (!_recordExists) update.show = 1;
      update_db(update);
      showControlContent();
    });

    // Color sync
    document.getElementById('mobileHomeColor').addEventListener('input', function() {
      document.getElementById('mobileHomeColorHex').value = this.value;
    });
    document.getElementById('mobileHomeColorHex').addEventListener('input', function() {
      if (/^#[0-9a-f]{6}$/i.test(this.value)) document.getElementById('mobileHomeColor').value = this.value;
    });
    document.getElementById('mobileAwayColor').addEventListener('input', function() {
      document.getElementById('mobileAwayColorHex').value = this.value;
    });
    document.getElementById('mobileAwayColorHex').addEventListener('input', function() {
      if (/^#[0-9a-f]{6}$/i.test(this.value)) document.getElementById('mobileAwayColor').value = this.value;
    });

    // Score buttons
    document.querySelectorAll('.score-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (pendingMatchFinish) return;
        var team = this.getAttribute('data-team');
        var delta = parseInt(this.getAttribute('data-delta'), 10);

        // Логика отката выигрыша сета (если есть pending new set и delta = -1)
        var pendingNewSet = !!mobileScoreboardData['pending_new_set'];
        if (delta < 0 && pendingNewSet) {
          var history = Array.isArray(mobileScoreboardData['set_history']) ? mobileScoreboardData['set_history'] : [];
          var last = history.length ? history[history.length - 1] : null;
          if (last) {
            var winner = (last.home > last.away) ? 'home' : (last.away > last.home ? 'away' : null);
            if (winner && team === winner) {
              var revertUpdate = {};
              if (isBeachMode()) {
                if (winner === 'home') {
                  revertUpdate['home_sets'] = Math.max(0, ensureNumber(mobileScoreboardData['home_sets']) - 1);
                  revertUpdate['home_score'] = Math.max(0, ensureNumber(mobileScoreboardData['home_score']) - 1);
                } else {
                  revertUpdate['away_sets'] = Math.max(0, ensureNumber(mobileScoreboardData['away_sets']) - 1);
                  revertUpdate['away_score'] = Math.max(0, ensureNumber(mobileScoreboardData['away_score']) - 1);
                }
                var newHist = cloneSetHistory(); newHist.pop();
                revertUpdate['set_history'] = newHist;
                revertUpdate['next_beach_set'] = null;
                revertUpdate['pending_new_set'] = null;
                revertUpdate['beach_match_finished'] = false;
                revertUpdate['home_timeouts'] = 0;
                revertUpdate['away_timeouts'] = 0;
              } else {
                if (winner === 'home') {
                  revertUpdate['home_fouls'] = Math.max(0, ensureNumber(mobileScoreboardData['home_fouls']) - 1);
                  revertUpdate['home_score'] = Math.max(0, ensureNumber(mobileScoreboardData['home_score']) - 1);
                } else {
                  revertUpdate['away_fouls'] = Math.max(0, ensureNumber(mobileScoreboardData['away_fouls']) - 1);
                  revertUpdate['away_score'] = Math.max(0, ensureNumber(mobileScoreboardData['away_score']) - 1);
                }
                var newHist2 = cloneSetHistory(); newHist2.pop();
                revertUpdate['set_history'] = newHist2;
                revertUpdate['next_period'] = null;
                revertUpdate['pending_home_side'] = null;
                revertUpdate['pending_away_side'] = null;
                revertUpdate['pending_classic_tiebreak_switch_done'] = null;
                revertUpdate['pending_new_set'] = null;
                revertUpdate['classic_match_finished'] = false;
                revertUpdate['home_timeouts'] = 0;
                revertUpdate['away_timeouts'] = 0;
              }
              update_db(revertUpdate);
              return;
            }
          }
        }

        if (isBeachMode()) {
          handleBeachScore(team, delta);
        } else {
          handleClassicScore(team, delta);
        }
      });
    });

    // Foul buttons
    document.querySelectorAll('.foul-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var team = this.getAttribute('data-team');
        var delta = parseInt(this.getAttribute('data-delta'), 10);
        var key = team + '_fouls';
        var newVal = ensureNumber(mobileScoreboardData[key]) + delta;
        if (delta > 0 || newVal >= 0) {
          var update = {};
          update[key] = newVal;
          update_db(update);
        }
      });
    });

    // Period buttons
    document.querySelectorAll('.period-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (pendingMatchFinish) return;
        var delta = parseInt(this.getAttribute('data-delta'), 10);
        var startOfSet = ensureNumber(mobileScoreboardData['home_score']) === 0 && ensureNumber(mobileScoreboardData['away_score']) === 0;

        if (startOfSet) {
          var currentPeriod = ensureNumber(mobileScoreboardData['current_period']);
          var newPeriod = currentPeriod + delta;
          var maxPeriod = ensureNumber(mobileScoreboardData['period_count']) || (isCustomMode() ? 9 : 5);
          var hs = ensureNumber(mobileScoreboardData['home_score']);
          var as = ensureNumber(mobileScoreboardData['away_score']);
          var hf = ensureNumber(mobileScoreboardData['home_fouls']);
          var af = ensureNumber(mobileScoreboardData['away_fouls']);
          if (hs > as) hf++;
          if (as > hs) af++;
          if (newPeriod > 0 && newPeriod <= maxPeriod) {
            update_db({ current_period: newPeriod, away_fouls: af, home_fouls: hf, home_score: 0, away_score: 0 });
          }
          return;
        }

        if (delta > 0) {
          var unlimitedScore = _localUnlimitedScore;
          var homeScore = ensureNumber(mobileScoreboardData['home_score']);
          var awayScore = ensureNumber(mobileScoreboardData['away_score']);
          var curPeriod = ensureNumber(mobileScoreboardData['current_period']);
          var target;
          if (isCustomMode()) {
            target = getCustomPointsToWin();
          } else {
            target = (curPeriod === 5) ? 15 : 25;
          }
          if (unlimitedScore && homeScore >= target && homeScore - awayScore >= 2) {
            applySetWin('home', homeScore, awayScore, {});
          } else if (unlimitedScore && awayScore >= target && awayScore - homeScore >= 2) {
            applySetWin('away', awayScore, homeScore, {});
          }
          performNewSetUpdate();
          return;
        }

        var currentPeriod2 = ensureNumber(mobileScoreboardData['current_period']);
        var newPeriod2 = currentPeriod2 + delta;
        var maxPeriod2 = ensureNumber(mobileScoreboardData['period_count']) || (isCustomMode() ? 9 : 5);
        var hs2 = ensureNumber(mobileScoreboardData['home_score']);
        var as2 = ensureNumber(mobileScoreboardData['away_score']);
        var hf2 = ensureNumber(mobileScoreboardData['home_fouls']);
        var af2 = ensureNumber(mobileScoreboardData['away_fouls']);
        if (hs2 > as2) hf2++;
        if (as2 > hs2) af2++;
        if (newPeriod2 > 0 && newPeriod2 <= maxPeriod2) {
          update_db({ current_period: newPeriod2, away_fouls: af2, home_fouls: hf2, home_score: 0, away_score: 0 });
        }
      });
    });

    // Timeout buttons
    document.querySelectorAll('.timeout-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (pendingMatchFinish) return;
        var team = this.getAttribute('data-team');
        var teamName = team === 'home' ? mobileScoreboardData['home_team'] : mobileScoreboardData['away_team'];
        var timeoutLabel = 'Таймаут ' + teamName;
        var currentShow = ensureNumber(mobileScoreboardData['show']);
        var beachMode = isBeachMode();
        if (isCustomMode()) syncCustomSettings();
        var maxTimeouts = isCustomMode() ? getCustomMaxTimeouts() : (beachMode ? 1 : 2);
        var timeoutKey = team + '_timeouts';
        var currentTimeouts = ensureNumber(mobileScoreboardData[timeoutKey]);

        if (mobileScoreboardData['timeout_active']) {
          var currentLabel = mobileScoreboardData['custom_label'] || '';
          var homeTeam = mobileScoreboardData['home_team'] || '';
          var awayTeam = mobileScoreboardData['away_team'] || '';
          var isHomeTimeout = currentLabel === 'Таймаут ' + homeTeam;
          var isAwayTimeout = currentLabel === 'Таймаут ' + awayTeam;

          if ((team === 'home' && isHomeTimeout) || (team === 'away' && isAwayTimeout)) {
            update_db(endTimeoutUpdate());
            hideTimeoutModal();
          }
          return;
        }

        if (currentTimeouts >= maxTimeouts) return;

        pendingTimeout = {
          team: team,
          teamName: teamName,
          timeoutLabel: timeoutLabel,
          timeoutKey: timeoutKey,
          currentTimeouts: currentTimeouts
        };
        document.getElementById('mobileTimeoutConfirmText').textContent = 'Начать таймаут (' + teamName + ')?';
        document.getElementById('mobileTimeoutConfirmModal').classList.remove('hidden');
      });
    });

    document.getElementById('mobileTimeoutConfirmYes').addEventListener('click', function() {
      document.getElementById('mobileTimeoutConfirmModal').classList.add('hidden');
      if (!pendingTimeout) return;
      var pt = pendingTimeout;
      pendingTimeout = null;
      // Запоминаем текущий режим отображения, чтобы восстановить его после таймаута
      var prevShow = ensureNumber(mobileScoreboardData['show']);
      if (!prevShow || prevShow === 6) prevShow = 1;
      var update = { show: 6, prev_show: prevShow, timeout_active: true, custom_label: pt.timeoutLabel };
      update[pt.timeoutKey] = pt.currentTimeouts + 1;
      update_db(update);
      showTimeoutModal(pt.teamName);
    });

    document.getElementById('mobileTimeoutConfirmNo').addEventListener('click', function() {
      document.getElementById('mobileTimeoutConfirmModal').classList.add('hidden');
      pendingTimeout = null;
    });

    document.getElementById('mobileTimeoutClose').addEventListener('click', function() {
      hideTimeoutModal();
      if (mobileScoreboardData['timeout_active']) {
        update_db(endTimeoutUpdate());
      }
    });

    // Side switch
    document.querySelector('.side-switch-btn').addEventListener('click', function() {
      var update = flipSidesPayload();
      var DEL = DB.deleteField();
      update['classic_switch_needed'] = DEL;
      update['classic_switch_message'] = DEL;
      update['beach_switch_message'] = DEL;
      update['lastEdited'] = DB.serverTimestamp();
      delete mobileScoreboardData['classic_switch_needed'];
      delete mobileScoreboardData['classic_switch_message'];
      delete mobileScoreboardData['beach_switch_message'];
      this.classList.remove('blinking');
      // Используем стандартную функцию update_db, которая работает для всех режимов
      update_db(update);
    });

    // New set
    document.querySelector('.new-set-btn').addEventListener('click', function() {
      var update = { home_score: 0, away_score: 0, beach_switch_message: '', home_timeouts: 0, away_timeouts: 0 };
      if (isBeachMode()) {
        var nextSet = mobileScoreboardData['next_beach_set'];
        if (!nextSet) nextSet = ensureNumber(mobileScoreboardData['beach_current_set']) + 1;
        update['beach_current_set'] = nextSet;
        update['current_period'] = nextSet;
        update['next_beach_set'] = null;
        update['pending_new_set'] = null;
        update_db(update);
        return;
      }
      var nextPeriod = mobileScoreboardData['next_period'];
      if (!nextPeriod) nextPeriod = ensureNumber(mobileScoreboardData['current_period']) + 1;
      update['current_period'] = nextPeriod;
      if (mobileScoreboardData['pending_home_side'] != null) update['home_side'] = mobileScoreboardData['pending_home_side'];
      if (mobileScoreboardData['pending_away_side'] != null) update['away_side'] = mobileScoreboardData['pending_away_side'];
      if (mobileScoreboardData['pending_classic_tiebreak_switch_done'] != null) update['classic_tiebreak_switch_done'] = mobileScoreboardData['pending_classic_tiebreak_switch_done'];
      update['next_period'] = null;
      update['pending_home_side'] = null;
      update['pending_away_side'] = null;
      update['pending_classic_tiebreak_switch_done'] = null;
      update['classic_switch_shown'] = null; // Сбрасываем флаг показа смены сторон для нового сета
      update['pending_new_set'] = null;
      update_db(update);
    });

    // Show buttons
    document.querySelectorAll('.show-select').forEach(function(btn) {
      btn.addEventListener('click', function() {
        update_db({ show: parseInt(this.getAttribute('data-val'), 10) });
      });
    });

    // Label
    document.querySelector('.label-btn').addEventListener('click', function() {
      update_db({ custom_label: document.getElementById('mCustomLabel').value });
    });

    // Reset
    document.querySelector('.reset-btn').addEventListener('click', function() {
      if (pendingMatchFinish) return;
      if (!confirm('Сбросить игру? Текущий счёт будет потерян.')) return;

      var beachEnabled = isBeachMode();
      var invertTablo = _localInvertTablo;
      var userInfo = getCurrentUserInfo();

      var resetData = {
        show: 1, timeout_active: false, prev_show: 1, home_score: 0, home_fouls: 0, away_score: 0, away_fouls: 0, current_period: 1,
        custom_label: "Таймаут",
        away_team: document.getElementById('mobileAwayTeam').value,
        away_color: document.getElementById('mobileAwayColor').value,
        home_team: document.getElementById('mobileHomeTeam').value,
        home_color: document.getElementById('mobileHomeColor').value,
        tournament_name: document.getElementById('mobileTournament').value,
        venue: document.getElementById('mobileVenue').value || '',
        home_sets: 0, away_sets: 0, home_timeouts: 0, away_timeouts: 0,
        beach_mode: beachEnabled, beach_current_set: 1, beach_switch_message: '',
        beach_match_finished: false, period_count: beachEnabled ? 3 : 5, set_history: [],
        classic_match_finished: false, home_side: 'left', away_side: 'right',
        classic_tiebreak_switch_done: true, invert_tablo: invertTablo,
        unlimited_score: false, two_wins_mode: false, custom_mode: _localCustomMode,
        matchmode: buildMatchmode(),
        pending_new_set: DB.deleteField(), next_period: DB.deleteField(),
        next_beach_set: DB.deleteField(), pending_home_side: DB.deleteField(),
        pending_away_side: DB.deleteField(), pending_classic_tiebreak_switch_done: DB.deleteField(),
        classic_switch_needed: DB.deleteField(), classic_switch_shown: DB.deleteField(),
        classic_switch_message: DB.deleteField(),
        lastEdited: DB.serverTimestamp(), username: userInfo.username || '', displayname: userInfo.displayname || ''
      };

      matchWasAlreadyFinished = false;
      update_db(resetData);
    });

    // Match finish modal
    document.getElementById('mobileMatchFinishYes').addEventListener('click', confirmMatchFinish);
    document.getElementById('mobileMatchFinishNo').addEventListener('click', cancelMatchFinish);
    
    // Set finish modal
    document.getElementById('mobileSetFinishYes').addEventListener('click', confirmMobileSetFinish);
    document.getElementById('mobileSetFinishNo').addEventListener('click', cancelMobileSetFinish);

    // Offline detection
    window.addEventListener('online', function() {
      document.getElementById('offlineBanner').classList.remove('visible');
    });
    window.addEventListener('offline', function() {
      document.getElementById('offlineBanner').classList.add('visible');
    });

    // Link copy buttons
    document.querySelectorAll('.link-copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var targetId = this.getAttribute('data-target');
        var link = document.getElementById(targetId);
        if (!link) return;
        var url = link.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function() {
            btn.textContent = '✅';
            setTimeout(function() { btn.textContent = '📋'; }, 1500);
          });
        } else {
          var textarea = document.createElement('textarea');
          textarea.value = url;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          btn.textContent = '✅';
          setTimeout(function() { btn.textContent = '📋'; }, 1500);
        }
      });
    });
  }

  // ===== THEME =====

  function initTheme() {
    var saved = localStorage.getItem('mobile_theme');
    if (saved === 'light') {
      document.body.classList.add('light-theme');
      document.getElementById('themeToggle').textContent = '☀️';
    }
  }

  function toggleTheme() {
    var isLight = document.body.classList.toggle('light-theme');
    document.getElementById('themeToggle').textContent = isLight ? '☀️' : '🌙';
    localStorage.setItem('mobile_theme', isLight ? 'light' : 'dark');
  }

  function initProviderBadge() {
    var badge = document.getElementById('dbProviderBadge');
    if (!badge) return;
    var provider = 'pocketbase';
    try { provider = DB_CONFIG.provider || 'pocketbase'; } catch (e) {}
    var labels = { pocketbase: 'PocketBase' };
    badge.textContent = labels[provider] || provider;
  }

  function initLogo() {
    var logoIds = ['loginLogo', 'headerLogo'];
    if (typeof loadLogo === 'function') {
      loadLogo(function(base64) {
        if (!base64) return;
        logoIds.forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.src = base64;
        });
      });
    }
  }

  // ===== TEMPLATE SELECT =====

  // Загружаем список шаблонов и заполняем select
  function loadMobileTemplateSelect() {
    if (!DB || !DB.templates || typeof DB.templates.list !== 'function') {
      console.warn('[Mobile] DB.templates not available, skipping template list load');
      return;
    }
    // Оборачиваем в try/catch, чтобы синхронная ошибка (например, отсутствие
    // коллекции templates в PocketBase) не прерывала загрузку данных игры
    var listPromise;
    try {
      listPromise = DB.templates.list();
    } catch (e) {
      console.error('[Mobile] Sync error loading template list:', e);
      document.getElementById('mobileTemplateSelect').value = '';
      return;
    }
    if (!listPromise || typeof listPromise.then !== 'function') {
      document.getElementById('mobileTemplateSelect').value = '';
      return;
    }
    listPromise.then(function(list) {
      var select = document.getElementById('mobileTemplateSelect');
      // Сохраняем текущее значение (из select или из загруженных данных игры)
      var currentVal = select.value || (mobileScoreboardData && mobileScoreboardData.template_id) || '';
      // Удаляем все option кроме первого (пустого)
      while (select.options.length > 1) {
        select.remove(1);
      }
      for (var i = 0; i < list.length; i++) {
        var opt = document.createElement('option');
        opt.value = list[i].id;
        opt.textContent = list[i].name;
        select.appendChild(opt);
      }
      // Восстанавливаем выбранное значение (всегда, даже если пусто — выбираем "Без шаблона")
      select.value = currentVal;
    }).catch(function(err) {
      console.error('[Mobile] Error loading template list:', err);
      // При ошибке загрузки сбрасываем на "Без шаблона"
      document.getElementById('mobileTemplateSelect').value = '';
    });
  }

  // ===== INIT =====

  function init() {
    initTheme();
    initProviderBadge();
    initLogo();
    initTabs();
    try {
      initEventHandlers();
    } catch (e) {
      // Не даём одному отсутствующему элементу оборвать инициализацию
      // (например, при рассинхронизации кэшированных mobile.js и mobile.html)
      console.error('[Mobile] initEventHandlers failed:', e);
    }
    initAuth();

    // Auto-fill game_id from URL
    var urlGameId = new URLSearchParams(window.location.search).get('game');
    if (urlGameId) {
      document.getElementById('mobileGameId').value = urlGameId;
    } else {
      document.getElementById('mobileGameId').value = generateUUID();
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function() {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
