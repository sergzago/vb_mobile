/**
 * Визуальный редактор шаблонов табло — мобильная версия (вкладка "Шаблоны")
 *
 * Адаптация js/templates_visual.js для работы внутри mobile.html:
 * - Без jQuery (mobile.html использует только vanilla JS)
 * - Не инициализируется сам — вызывается через TemplatesVisualMobile.init()
 *   из js/mobile.js при открытии вкладки "Шаблоны"
 * - Использует уже инициализированный глобальный объект DB
 */

window.TemplatesVisualMobile = (function() {
  'use strict';

  // ============================================================================
  // СОСТОЯНИЕ
  // ============================================================================

  /** ID текущего редактируемого шаблона (null = новый) */
  var currentTemplateId = null;

  /** Кэш данных текущего шаблона */
  var currentData = null;

  /** Список всех шаблонов из БД */
  var templateList = [];

  /** Выбранный блок (DOM элемент) */
  var selectedBlock = null;

  /** Флаг: инициализирован ли редактор */
  var initialized = false;

  /** Карта: data-style-property → { bg, text } */
  var PROPERTY_MAP = {
    logo_base64:           { bg: null,                    text: null },
    logo_bg:               { bg: 'logo_bg',               text: null },
    label_bg:              { bg: 'label_bg',              text: 'label_text' },
    label_text:            { bg: 'label_bg',              text: 'label_text' },
    set_history_bg:        { bg: 'set_history_bg',        text: 'set_history_text' },
    set_history_text:      { bg: 'set_history_bg',        text: 'set_history_text' },
    body_bg:               { bg: 'body_bg',               text: null },
    top_team_name_bg:      { bg: 'top_team_name_bg',      text: 'top_team_name_text' },
    top_primary_score_bg:  { bg: 'top_primary_score_bg',  text: 'top_primary_score_text' },
    top_primary_score_text:{ bg: 'top_primary_score_bg',  text: 'top_primary_score_text' },
    top_secondary_score_bg:{ bg: 'top_secondary_score_bg', text: 'top_secondary_score_text' },
    top_secondary_score_text:{ bg: 'top_secondary_score_bg',text: 'top_secondary_score_text' },
    top_period_bg:         { bg: 'top_period_bg',         text: 'top_period_text' },
    top_period_text:       { bg: 'top_period_bg',         text: 'top_period_text' },
    bottom_team_name_bg:   { bg: 'bottom_team_name_bg',   text: 'bottom_team_name_text' },
    bottom_team_name_text: { bg: 'bottom_team_name_bg',   text: 'bottom_team_name_text' },
    bottom_primary_score_bg:{ bg: 'bottom_primary_score_bg',text: 'bottom_primary_score_text' },
    bottom_primary_score_text:{ bg: 'bottom_primary_score_bg',text: 'bottom_primary_score_text' },
    bottom_secondary_score_bg:{ bg: 'bottom_secondary_score_bg',text: 'bottom_secondary_score_text' },
    bottom_secondary_score_text:{ bg: 'bottom_secondary_score_bg',text: 'bottom_secondary_score_text' },
    bottom_time_bg:        { bg: 'bottom_time_bg',        text: 'bottom_time_text' },
    bottom_time_text:      { bg: 'bottom_time_bg',        text: 'bottom_time_text' },
    setball_bg:            { bg: 'setball_bg',            text: 'setball_text' }, // Фон Сетбола
    setball_text:          { bg: 'setball_bg',            text: 'setball_text' }, // Текст Сетбола
    matchball_bg:          { bg: 'matchball_bg',          text: 'matchball_text' }, // Фон Матчбола
    matchball_text:        { bg: 'matchball_bg',          text: 'matchball_text' } // Текст Матчбола
  };

  // ============================================================================
  // ВСПОМОГАТЕЛЬНЫЕ
  // ============================================================================

  function $(id) {
    return document.getElementById(id);
  }

  function showNotification(message, type) {
    type = type || 'success';
    var n = $('notification');
    if (!n) return;
    n.textContent = message;
    n.className = 'notification ' + type + ' show';
    setTimeout(function() { n.className = 'notification ' + type; }, 3000);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
  }

  /**
   * Преобразует css-цвет вида rgb(r,g,b) / rgba(r,g,b,a) в hex-код #rrggbb.
   * Возвращает null, если преобразовать не удалось.
   */
  function rgbToHex(rgb) {
    if (!rgb || typeof rgb !== 'string') return null;
    var match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return null;
    function toHex(v) {
      var h = parseInt(v, 10).toString(16);
      return h.length === 1 ? '0' + h : h;
    }
    return '#' + toHex(match[1]) + toHex(match[2]) + toHex(match[3]);
  }


  function applyPreview(data) {
    if (!data) return;
    var root = document.documentElement;
    for (var key in data) {
      if (data.hasOwnProperty(key) && data[key] && key !== 'logo_base64') {
        root.style.setProperty('--' + key.replace(/_/g, '-'), data[key]);
      }
    }
    root.style.setProperty('--top-primary-score-text', data.top_primary_score_text || '#ffffff');
    root.style.setProperty('--top-secondary-score-text', data.top_secondary_score_text || '#ffffff');

    // Обновляем логотип в предпросмотре
    var logoImg = document.querySelector('#scoreboard-preview .logo-img');
    if (logoImg) {
      var logoSrc = 'logo_nvl.png'; // Дефолтный логотип
      var logoData = data.logo_base64;
      if (logoData) {
        if (logoData.startsWith('<img')) {
          // Для PocketBase (Rich Editor) извлекаем src из HTML
          var tempDiv = document.createElement('div');
          tempDiv.innerHTML = logoData;
          logoSrc = (tempDiv.querySelector('img') && tempDiv.querySelector('img').src) || logoSrc;
        } else if (logoData.startsWith('data:image')) {
          // Для PocketBase или нового файла (чистый base64)
          logoSrc = logoData;
        }
      }
      logoImg.src = logoSrc;
    }
  }

  /**
   * Масштабирует табло-превью так, чтобы все блоки помещались в контейнер.
   * Вычисляет коэффициент масштаба по соотношению ширины контейнера
   * к естественной ширине табло. Максимальный масштаб ограничен 1.3,
   * чтобы табло было крупнее на широких экранах.
   */
  function fitScoreboardToContainer() {
    var wrapper = $('scoreboardWrapper');
    var scoreboard = $('scoreboard-preview');
    if (!wrapper || !scoreboard) return;

    // Естественная ширина табло (без учёта transform)
    var naturalWidth = scoreboard.scrollWidth;
    if (!naturalWidth) return;

    // Доступная ширина контейнера (минус внутренние отступы)
    var availableWidth = wrapper.clientWidth - 24; // 12px padding слева и справа
    if (availableWidth <= 0) return;

    // Коэффициент масштаба: не больше 1.3 и не меньше 0.3
    var scale = Math.min(1.3, availableWidth / naturalWidth);
    scale = Math.max(0.3, scale);

    scoreboard.style.transform = 'scale(' + scale + ')';
  }

  function updateScoreboardColors(data) {
    if (!data) return;
    document.body.style.backgroundColor = data.body_bg || '#1a2b3c';

    // Обновляем фон и текст для каждого кликабельного блока
    document.querySelectorAll('.clickable-block[data-style-property]').forEach(function(block) {
      var prop = block.getAttribute('data-style-property');
      var mapping = PROPERTY_MAP[prop];
      if (!mapping) return;
      var bgColor = data[mapping.bg];
      var textColor = mapping.text ? data[mapping.text] : null;
      if (bgColor) block.style.backgroundColor = bgColor;
      if (textColor) block.style.color = textColor;
    });

    // Специальные области (фон)
    var teamNameBg = data.top_team_name_bg || '#1a2b3c';
    document.querySelectorAll('.teams-area').forEach(function(el) { el.style.backgroundColor = teamNameBg; });
    document.querySelectorAll('.team-colors-area').forEach(function(el) { el.style.backgroundColor = teamNameBg; });
    document.querySelectorAll('.scores-area').forEach(function(el) { el.style.backgroundColor = teamNameBg; });

    // Фон блока логотипа (задается кликом по краю блока логотипа)
    var logoBg = data.logo_bg || '#1a2b3c';
    document.querySelectorAll('.logo-area').forEach(function(el) { el.style.backgroundColor = logoBg; });

    // Цвет текста имени команды — применяем ко всем дочерним элементам
    var teamNameText = data.top_team_name_text || '#ffffff';
    document.querySelectorAll('.teams-area').forEach(function(el) {
      el.style.color = teamNameText;
      el.querySelectorAll('.team-row').forEach(function(r) { r.style.color = teamNameText; });
      el.querySelectorAll('.team-row .tn').forEach(function(t) { t.style.color = teamNameText; });
    });

    // Цвет текста в колонках счёта
    var secondaryText = data.top_secondary_score_text || '#ffffff';
    document.querySelectorAll('.score-column.total-score, .score-column.sets-score').forEach(function(el) {
      el.style.color = secondaryText;
      el.querySelectorAll('div').forEach(function(d) { d.style.color = secondaryText; });
    });

    var primaryText = data.top_primary_score_text || '#ffffff';
    document.querySelectorAll('.score-column.points-score').forEach(function(el) {
      el.style.color = primaryText;
      el.querySelectorAll('div').forEach(function(d) { d.style.color = primaryText; });
    });

    // Бейджи
    document.querySelectorAll('.badge-setball').forEach(function(el) {
      el.style.backgroundColor = data.setball_bg || '#5aa0c4';
      el.style.color = data.setball_text || '#ffffff';
    });
    document.querySelectorAll('.badge-matchball').forEach(function(el) {
      el.style.backgroundColor = data.matchball_bg || '#d65a98';
      el.style.color = data.matchball_text || '#ffffff';
    });

    // Название шаблона отображаем в цветах лейбла (label_bg / label_text)
    updateTemplateLabelColors();
  }

  /**
   * Окрашивает название шаблона (#templateLabel) в цвета лейбла табло.
   * Вызывается при загрузке шаблона и при каждом изменении цветов в редакторе.
   */
  function updateTemplateLabelColors() {
    var el = $('templateLabel');
    if (!el) return;
    el.style.backgroundColor = (currentData && currentData.label_bg) || '#5aa0c4';
    el.style.color = (currentData && currentData.label_text) || '#ffffff';
  }

  // ============================================================================
  // СПИСОК ШАБЛОНОВ
  // ============================================================================

  function renderTemplateList() {
    var listEl = $('templateList');
    if (!listEl) return;
    if (!templateList.length) {
      listEl.innerHTML = '<li style="color:#666;font-style:italic;cursor:default;">Нет сохранённых шаблонов</li>';
      return;
    }
    var html = '';
    for (var i = 0; i < templateList.length; i++) {
      var t = templateList[i];
      var active = (t.id === currentTemplateId) ? ' active' : '';
      // Название шаблона в списке сразу отображаем в цветах его лейбла
      var nameStyle = '';
      if (t.label_bg || t.label_text) {
        nameStyle = ' style="background-color:' + escapeHtml(t.label_bg || '#5aa0c4') + ';' +
                    'color:' + escapeHtml(t.label_text || '#ffffff') + ';"';
      }
      html += '<li class="' + active + '" data-id="' + escapeHtml(t.id) + '">';
      html += '<span' + nameStyle + '>' + escapeHtml(t.name) + '</span>';
      html += '<button class="delete-btn" data-id="' + escapeHtml(t.id) + '" title="Удалить">&times;</button>';
      html += '</li>';
    }
    listEl.innerHTML = html;
  }

  function loadTemplateList() {
    if (!DB || !DB.templates || typeof DB.templates.list !== 'function') {
      templateList = [];
      renderTemplateList();
      return Promise.resolve([]);
    }
    return DB.templates.list().then(function(list) {
      templateList = list || [];
      renderTemplateList();
      return templateList;
    }).catch(function(err) {
      console.error('[TemplatesVisualMobile] Error loading list:', err);
      templateList = [];
      renderTemplateList();
      return [];
    });
  }

  // ============================================================================
  // ЗАГРУЗКА / ВЫБОР ШАБЛОНА
  // ============================================================================

  function loadTemplate(templateId) {
    if (!templateId) {
      currentTemplateId = null;
      currentData = DB.templates.getDefaultTemplate();
      applyToEditor(currentData, '— новый шаблон —');
      renderTemplateList();
      return Promise.resolve();
    }

    return DB.templates.get(templateId).then(function(data) {
      currentTemplateId = templateId;
      currentData = data || DB.templates.getDefaultTemplate();
      var name = '';
      for (var i = 0; i < templateList.length; i++) {
        if (templateList[i].id === templateId) { name = templateList[i].name; break; }
      }
      applyToEditor(currentData, name || templateId);
      renderTemplateList();
    }).catch(function(err) {
      console.error('[TemplatesVisualMobile] Error loading:', templateId, err);
      showNotification('Ошибка загрузки шаблона', 'error');
    });
  }

  function applyToEditor(data, label) {
    currentData = JSON.parse(JSON.stringify(data));
    updateScoreboardColors(currentData);
    applyPreview(currentData);
    var labelEl = $('templateLabel');
    if (labelEl) labelEl.textContent = label || '— шаблон не выбран —';

    // Управляем видимостью кнопки удаления логотипа
    var btnDeleteLogo = $('btnDeleteLogo');
    if (btnDeleteLogo) {
      btnDeleteLogo.style.display = currentData.logo_base64 ? 'inline-block' : 'none';
    }

    closeColorPanel();
    // Пересчитываем масштаб после применения данных
    setTimeout(fitScoreboardToContainer, 0);
  }

  // ============================================================================
  // ПАНЕЛЬ ЦВЕТА
  // ============================================================================

  function openColorPanel(block) {
    var prop = block.getAttribute('data-style-property');

    // Специальная логика для логотипа
    if (prop === 'logo_base64') {
      $('logoUpload').click(); // Открываем диалог выбора файла
      return;
    }

    selectedBlock = block;
    var blockName = block.getAttribute('data-block-name') || prop;
    var mapping = PROPERTY_MAP[prop];
    if (!mapping) return;

    // Базовые цвета из данных шаблона. Если значение не задано (например, для
    // истории сетов до первого сохранения) — берём фактически отображаемый цвет
    // блока, чтобы панель соответствовала тому, что видно на табло.
    var computedBg = window.getComputedStyle(block).backgroundColor;
    var computedText = window.getComputedStyle(block).color;
    var bgColor = currentData[mapping.bg] || rgbToHex(computedBg) || '#ffffff';
    var textColor = mapping.text ? (currentData[mapping.text] || rgbToHex(computedText) || '#000000') : '#000000';

    $('panelTitle').textContent = blockName;
    $('panelColorPicker').value = bgColor;
    $('panelColorHex').value = bgColor;
    $('panelTextColorPicker').value = textColor;
    $('panelTextColorHex').value = textColor;

    var textRow = $('panelTextColorPicker').closest('.color-row');
    if (textRow) textRow.style.display = mapping.text ? '' : 'none';

    document.querySelectorAll('.clickable-block.selected').forEach(function(el) { el.classList.remove('selected'); });
    block.classList.add('selected');
    $('colorPanel').classList.add('open');
  }

  function closeColorPanel() {
    var panel = $('colorPanel');
    if (panel) panel.classList.remove('open');
    document.querySelectorAll('.clickable-block.selected').forEach(function(el) { el.classList.remove('selected'); });
    document.querySelectorAll('.logo-edge-zone.selected').forEach(function(el) { el.classList.remove('selected'); });
    selectedBlock = null;
  }

  function updateBlockColor(bgColor, textColor) {
    if (!selectedBlock || !currentData) return;
    var prop = selectedBlock.getAttribute('data-style-property');
    var mapping = PROPERTY_MAP[prop];
    if (!mapping) return;

    currentData[mapping.bg] = bgColor;
    if (mapping.text && textColor) {
      currentData[mapping.text] = textColor;
    }
    updateScoreboardColors(currentData);
    applyPreview(currentData);
  }

  // ============================================================================
  // СОХРАНЕНИЕ
  // ============================================================================

  function saveTemplate(templateId, name) {
    var btn = $('btnSave');
    if (btn) { btn.disabled = true; btn.textContent = '💾 Сохранение...'; }

    if (!templateId) {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
      showSaveDialog();
      return;
    }

    var dataToSave = JSON.parse(JSON.stringify(currentData));
    // Сохраняем отображаемое имя из поля name (если не передано явно),
    // чтобы не перезаписывать его транслитерированным templateId
    dataToSave.name = name || currentData.name || templateId;
    dataToSave.template_id = templateId; // Убеждаемся, что ID всегда присутствует

    DB.templates.update(templateId, dataToSave).then(function() {
      showNotification('Шаблон "' + (name || templateId) + '" сохранён', 'success');
      return loadTemplateList();
    }).catch(function(err) {
      showNotification('Ошибка сохранения: ' + (err.message || ''), 'error');
    }).then(function() {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
    });
  }

  function showSaveDialog() {
    $('saveDialogInput').value = '';
    $('saveDialog').classList.add('open');
    setTimeout(function() { $('saveDialogInput').focus(); }, 100);
  }

  function confirmSave() {
    var name = $('saveDialogInput').value.trim();
    if (!name) {
      showNotification('Введите название шаблона', 'error');
      return;
    }

    var id = generateTemplateId(name);

    for (var i = 0; i < templateList.length; i++) {
      if (templateList[i].id === id) {
        showNotification('Шаблон с таким именем уже существует', 'error');
        return;
      }
    }

    $('saveDialog').classList.remove('open');
    currentTemplateId = id;

    var dataToSave = JSON.parse(JSON.stringify(currentData));
    dataToSave.name = name;
    dataToSave.template_id = id;

    var btn = $('btnSave');
    if (btn) { btn.disabled = true; btn.textContent = '💾 Сохранение...'; }

    DB.templates.update(id, dataToSave).then(function() {
      showNotification('Шаблон "' + name + '" создан и сохранён', 'success');
      var labelEl = $('templateLabel');
      if (labelEl) labelEl.textContent = name;
      return loadTemplateList();
    }).catch(function(err) {
      showNotification('Ошибка сохранения: ' + (err.message || ''), 'error');
    }).then(function() {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить'; }
    });
  }

  // ============================================================================
  // УДАЛЕНИЕ
  // ============================================================================

  function confirmDelete(templateId) {
    var name = '';
    for (var i = 0; i < templateList.length; i++) {
      if (templateList[i].id === templateId) { name = templateList[i].name; break; }
    }
    $('deleteDialogText').textContent = 'Удалить шаблон "' + (name || templateId) + '"? Это действие нельзя отменить.';
    $('deleteDialog').classList.add('open');
    $('deleteDialog').setAttribute('data-delete-id', templateId);
  }

  function executeDelete() {
    var templateId = $('deleteDialog').getAttribute('data-delete-id');
    if (!templateId) return;
    $('deleteDialog').classList.remove('open');

    DB.templates.delete(templateId).then(function() {
      showNotification('Шаблон удалён', 'success');
      if (currentTemplateId === templateId) {
        currentTemplateId = null;
        currentData = DB.templates.getDefaultTemplate();
        applyToEditor(currentData, '— новый шаблон —');
      }
      return loadTemplateList();
    }).catch(function(err) {
      showNotification('Ошибка удаления: ' + (err.message || ''), 'error');
    });
  }

  // ============================================================================
  // ИНИЦИАЛИЗАЦИЯ
  // ============================================================================

  function initPage() {
    console.log('[TemplatesVisualMobile] Initializing');

    // Масштабируем табло под ширину контейнера
    fitScoreboardToContainer();
    window.addEventListener('resize', fitScoreboardToContainer);

    loadTemplateList().then(function() {
      if (templateList.length > 0) {
        return loadTemplate(templateList[0].id);
      } else {
        return loadTemplate(null);
      }
    });

    // КЛИК ПО ШАБЛОНУ В СПИСКЕ
    var listEl = $('templateList');
    if (listEl) {
      listEl.addEventListener('click', function(e) {
        var deleteBtn = e.target.closest('.delete-btn');
        if (deleteBtn) {
          e.stopPropagation();
          confirmDelete(deleteBtn.getAttribute('data-id'));
          return;
        }
        var li = e.target.closest('li');
        if (!li) return;
        var id = li.getAttribute('data-id');
        if (id && id !== currentTemplateId) {
          loadTemplate(id);
        }
      });
    }

    // НОВЫЙ ШАБЛОН
    var btnNew = $('btnNewTemplate');
    if (btnNew) {
      btnNew.addEventListener('click', function() { loadTemplate(null); });
    }

    // КЛИК ПО НАЗВАНИЮ ШАБЛОНА — выбор цвета лейбла (label_bg / label_text)
    var tplLabel = $('templateLabel');
    if (tplLabel) {
      tplLabel.addEventListener('click', function(e) {
        e.stopPropagation(); // не закрывать панель цвета обработчиком документа
        var labelBlock = document.querySelector('.top_label.clickable-block');
        if (labelBlock) openColorPanel(labelBlock);
      });
    }

    // КЛИК ПО БЛОКУ ТАБЛО
    document.querySelectorAll('.clickable-block').forEach(function(block) {
      block.addEventListener('click', function(e) {
        e.stopPropagation();
        openColorPanel(block);
      });
    });

    // КЛИК ПО КРАЯМ БЛОКА ЛОГОТИПА (выбор цвета фона логотипа)
    document.querySelectorAll('.logo-edge-zone').forEach(function(zone) {
      zone.addEventListener('click', function(e) {
        e.stopPropagation(); // не проваливаемся в родительский .logo-area (загрузка файла)
        openColorPanel(zone);
      });
    });

    // COLOR PICKER
    var bgPicker = $('panelColorPicker');
    var textPicker = $('panelTextColorPicker');
    var bgHex = $('panelColorHex');
    var textHex = $('panelTextColorHex');
    if (bgPicker) {
      bgPicker.addEventListener('input', function() {
        if (bgHex) bgHex.value = bgPicker.value;
        updateBlockColor(bgPicker.value, textPicker ? textPicker.value : null);
      });
    }
    if (textPicker) {
      textPicker.addEventListener('input', function() {
        if (textHex) textHex.value = textPicker.value;
        updateBlockColor(bgPicker ? bgPicker.value : null, textPicker.value);
      });
    }

    // Ручной ввод hex-кода цвета фона
    if (bgHex) {
      bgHex.addEventListener('input', function() {
        var value = bgHex.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(value)) {
          if (bgPicker) bgPicker.value = value;
          updateBlockColor(value, textPicker ? textPicker.value : null);
        }
      });
    }

    // Ручной ввод hex-кода цвета текста
    if (textHex) {
      textHex.addEventListener('input', function() {
        var value = textHex.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(value)) {
          if (textPicker) textPicker.value = value;
          updateBlockColor(bgPicker ? bgPicker.value : null, value);
        }
      });
    }

    // ЗАКРЫТИЕ ПАНЕЛИ
    var panelClose = $('panelClose');
    if (panelClose) panelClose.addEventListener('click', closeColorPanel);
    document.addEventListener('click', function(e) {
      var panel = $('colorPanel');
      if (panel && panel.classList.contains('open') &&
          !e.target.closest('#colorPanel') &&
          !e.target.closest('.clickable-block')) {
        closeColorPanel();
      }
    });

    // СОХРАНЕНИЕ
    var btnSave = $('btnSave');
    if (btnSave) btnSave.addEventListener('click', function() { saveTemplate(currentTemplateId); });

    // ДИАЛОГ СОХРАНЕНИЯ
    var saveConfirm = $('saveDialogConfirm');
    var saveCancel = $('saveDialogCancel');
    var saveInput = $('saveDialogInput');
    if (saveConfirm) saveConfirm.addEventListener('click', confirmSave);
    if (saveCancel) saveCancel.addEventListener('click', function() { $('saveDialog').classList.remove('open'); });
    if (saveInput) {
      saveInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') confirmSave();
        if (e.key === 'Escape') $('saveDialog').classList.remove('open');
      });
    }

    // ДИАЛОГ УДАЛЕНИЯ
    var delConfirm = $('deleteDialogConfirm');
    var delCancel = $('deleteDialogCancel');
    if (delConfirm) delConfirm.addEventListener('click', executeDelete);
    if (delCancel) delCancel.addEventListener('click', function() { $('deleteDialog').classList.remove('open'); });

    // СБРОС
    var btnReset = $('btnReset');
    if (btnReset) {
      btnReset.addEventListener('click', function() {
        if (!confirm('Сбросить шаблон к стандартным цветам?')) return;
        currentData = DB.templates.getDefaultTemplate();
        updateScoreboardColors(currentData);
        applyPreview(currentData);
        closeColorPanel();
        showNotification('Шаблон сброшен. Нажмите "Сохранить" для применения.', 'success');
      });
    }

    // ОБРАБОТЧИК ЗАГРУЗКИ ЛОГОТИПА
    var logoUpload = $('logoUpload');
    if (logoUpload) {
      logoUpload.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function(event) {
          var base64String = event.target.result;
          currentData.logo_base64 = base64String;
          applyPreview(currentData);
          
          var btnDeleteLogo = $('btnDeleteLogo');
          if (btnDeleteLogo) {
            btnDeleteLogo.style.display = 'inline-block';
          }
          showNotification('Логотип обновлён. Нажмите "Сохранить".', 'success');
        };
        reader.onerror = function() {
          showNotification('Ошибка чтения файла', 'error');
        };
        reader.readAsDataURL(file);
      });
    }

    // ОБРАБОТЧИК УДАЛЕНИЯ ЛОГОТИПА
    var btnDeleteLogo = $('btnDeleteLogo');
    if (btnDeleteLogo) {
      btnDeleteLogo.addEventListener('click', function() {
        if (!confirm('Удалить собственный логотип из этого шаблона?')) return;
        currentData.logo_base64 = null;
        applyPreview(currentData);
        btnDeleteLogo.style.display = 'none';
        showNotification('Логотип удалён. Нажмите "Сохранить".', 'success');
      });
    }
  }

  // ============================================================================
  // ПУБЛИЧНЫЙ API
  // ============================================================================

  return {
    /**
     * Инициализировать редактор (вызывается при открытии вкладки "Шаблоны").
     * Безопасно вызывать несколько раз — повторная инициализация игнорируется.
     */
    init: function() {
      if (initialized) return;
      initialized = true;
      initPage();
    },

    /**
     * Перезагрузить список шаблонов (например, после сохранения в другом окне).
     */
    refresh: function() {
      return loadTemplateList();
    }
  };
})();