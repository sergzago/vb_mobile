var scoreboard_data={};
var _unsubscribe = null;

var currentTemplateId = null;
var _unsubscribeTemplate = null;

// Дефолтные данные (если документ ещё не создан)
var DEFAULT_SCOREBOARD_DATA = {
  "show": 1,
  "away_color": "#000000",
  "away_fouls": '-',
  "away_score": '-',
  "away_team": "--------",
  "current_period": '0',
  "home_color": "#000000",
  "home_fouls": '-',
  "home_score": '-',
  "home_team": "--------",
  "home_sets": 0,
  "away_sets": 0,
  "beach_mode": false,
  "beach_switch_message": "",
  "beach_current_set": 1,
  "set_history": [],
  "classic_match_finished": false,
  "home_side": "left",
  "away_side": "right",
  "classic_tiebreak_switch_done": true,
  "invert_tablo": false,
  "template_id": ""
};

/**
 * Определяет тип бейджа для команды
 * @param {string} team - 'home' или 'away'
 * @param {object} data - данные табло
 * @returns {string|null} - 'matchball', 'setball' или null
 */
function getMatchBadgeType(team, data) {
  var homeScore = parseInt(data.home_score, 10);
  var awayScore = parseInt(data.away_score, 10);
  var beachMode = data.beach_mode || false;
  var twoWinsMode = data.two_wins_mode || false; // "До 2 побед"

  // Если счет не числовой (между сетами) - бейдж не нужен
  if (isNaN(homeScore) || isNaN(awayScore)) {
    return null;
  }

  // Проверяем, завершен ли текущий сет
  if (data.classic_match_finished) {
    return null;
  }

  // Подсчитываем сеты из истории (это надежнее чем home_sets/away_sets)
  var setHistory = data.set_history || [];
  var homeSets = 0;
  var awaySets = 0;

  for (var i = 0; i < setHistory.length; i++) {
    var entry = setHistory[i] || {};
    var h = parseInt(entry.home, 10);
    var a = parseInt(entry.away, 10);
    if (!isNaN(h) && !isNaN(a)) {
      if (h > a) {
        homeSets++;
      } else if (a > h) {
        awaySets++;
      }
    }
  }

  // Определяем очки для победы в сете и количество сетов для победы в матче
  var pointsToWin;
  var setsToWinMatch;

  if (beachMode) {
    // Пляжный волейбол: до 21 очка, до 2 сетов
    setsToWinMatch = 2;
    // 3-й сет (тай-брейк) - до 15
    if (setHistory.length === 2) {
      pointsToWin = GAME_CONSTANTS.CLASSIC_TIEBREAK_POINTS_TO_WIN || 15;
    } else {
      pointsToWin = 21;
    }
  } else {
    // Классический волейбол
    // Проверяем режим "До 2 побед"
    if (twoWinsMode) {
      setsToWinMatch = 2; // До 2 побед в сетах
    } else {
      setsToWinMatch = 3; // Классический - до 3 сетов
    }

    // Проверяем, это тай-брейк?
    // Для "До 2 побед" тай-брейк - это 3-й сет, для классики - 5-й
    var isTiebreak = twoWinsMode ? (setHistory.length === 2) : (setHistory.length === 4);

    if (isTiebreak) {
      pointsToWin = GAME_CONSTANTS.CLASSIC_TIEBREAK_POINTS_TO_WIN || 15;
    } else {
      pointsToWin = GAME_CONSTANTS.CLASSIC_POINTS_TO_WIN || 25;
    }
  }

  // Проверяем сетбол - команда близка к победе в сете
  var teamScore = team === 'home' ? homeScore : awayScore;
  var opponentScore = team === 'home' ? awayScore : homeScore;
  var teamSets = team === 'home' ? homeSets : awaySets;

  // Определяем, вступило ли в силу правило "2 очка" (deuces)
  var inDeuces = (homeScore >= pointsToWin - 1 && awayScore >= pointsToWin - 1);

  // Проверяем, завершен ли сет
  var setFinished = false;
  if (inDeuces) {
    // После 24:24 (классика) / 20:20 (пляжка) / 14:14 (тай-брейк):
    // сет завершен когда разница >= 2 очка
    if (Math.abs(homeScore - awayScore) >= 2) {
      setFinished = true;
    }
  } else {
    // В обычных сетах: сет завершен когда одна команда набрала >= pointsToWin
    if (homeScore >= pointsToWin || awayScore >= pointsToWin) {
      setFinished = true;
    }
  }

  if (setFinished) {
    return null;
  }

  var isSetball = false;
  var isMatchball = false;

  // Сетбол: команда может выиграть сет следующим очком
  // После deuces - сетбол постоянно для лидирующей команды
  if (inDeuces) {
    // После 24:24 / 20:20 / 14:14 - сетбол у лидирующей
    if (teamScore > opponentScore) {
      isSetball = true;
    }
  } else {
    // Обычная ситуация: сетбол при pointsToWin - 1
    if (teamScore >= pointsToWin - 1 && teamScore > opponentScore) {
      isSetball = true;
    }
  }

  // Матчбол: команда может выиграть МАТЧ следующим выигранным сетом
  if (isSetball && (teamSets + 1) >= setsToWinMatch) {
    isMatchball = true;
  }

  console.log('getMatchBadgeType: team=', team, 'homeSets=', homeSets, 'awaySets=', awaySets, 'teamSets=', teamSets, 'isSetball=', isSetball, 'isMatchball=', isMatchball);

  if (isMatchball) {
    return 'matchball';
  } else if (isSetball) {
    return 'setball';
  }

  return null;
}

/**
 * Применяет цвета из данных шаблона к CSS переменным
 * @param {object | null} data - данные шаблона или null для сброса
 */
function applyTemplate(data) {
  var templateData = data || {};
  var root = document.documentElement;

  // Функция-помощник для установки CSS переменной
  function setCssVar(varName, value) {
    if (value) {
      root.style.setProperty(varName, value);
    } else {
      root.style.removeProperty(varName); // Сброс к дефолту из CSS
    }
  }

  // Устанавливаем логотип
  var logoData = templateData.logo_base64;
  var finalLogoSrc = 'logo_nvl.png'; // Конечный запасной вариант

  if (logoData) { // Если есть какие-либо данные логотипа
    if (logoData.startsWith('<img')) { // Данные из PocketBase (Rich Editor)
      var tempDiv = $('<div>').html(logoData);
      var extractedSrc = tempDiv.find('img').attr('src');
      if (extractedSrc) {
        finalLogoSrc = extractedSrc;
      }
    } else if (logoData.startsWith('data:image')) { // Данные из PocketBase или свежезагруженный base64
      finalLogoSrc = logoData;
    }
  }
  // Устанавливаем полученный или дефолтный логотип
  $('.logo-img').attr('src', finalLogoSrc);

    // Фон блока логотипа (если задан в шаблоне; иначе CSS-фолбэк — фон зон команд)
  setCssVar('--logo-bg', templateData.logo_bg);

  // Цвета лейбла custom_label (.top_label)
  setCssVar('--label-bg', templateData.label_bg);
  setCssVar('--label-text', templateData.label_text);

  // Устанавливаем цвета из шаблона
  setCssVar('--body-bg', templateData.body_bg);
  setCssVar('--top-team-name-bg', templateData.top_team_name_bg);
  setCssVar('--top-team-name-text', templateData.top_team_name_text);
  setCssVar('--top-secondary-score-bg', templateData.top_secondary_score_bg);
  setCssVar('--top-secondary-score-text', templateData.top_secondary_score_text);
  setCssVar('--top-primary-score-bg', templateData.top_primary_score_bg);
  setCssVar('--top-primary-score-text', templateData.top_primary_score_text);
  setCssVar('--top-period-bg', templateData.top_period_bg);
  setCssVar('--top-period-text', templateData.top_period_text);

  // Нижнее табло всегда использует те же цвета, что и верхнее (в соответствии с шаблоном).
  // Поля bottom_* в данных шаблона игнорируются, т.к. редактор редактирует только верхние цвета,
  // а bottom_* могут содержать устаревшие значения по умолчанию.
  setCssVar('--bottom-team-name-bg', templateData.top_team_name_bg);
  setCssVar('--bottom-team-name-text', templateData.top_team_name_text);
  setCssVar('--bottom-secondary-score-bg', templateData.top_secondary_score_bg);
  setCssVar('--bottom-secondary-score-text', templateData.top_secondary_score_text);
  setCssVar('--bottom-primary-score-bg', templateData.top_primary_score_bg);
  setCssVar('--bottom-primary-score-text', templateData.top_primary_score_text);
  setCssVar('--bottom-time-bg', templateData.top_period_bg);
  setCssVar('--bottom-time-text', templateData.top_period_text);

  // Цвета для бейджей сетбола/матчбола
  setCssVar('--setball-bg', templateData.setball_bg);
  setCssVar('--setball-text', templateData.setball_text);
  setCssVar('--matchball-bg', templateData.matchball_bg);
  setCssVar('--matchball-text', templateData.matchball_text);

  // Блок истории сетов под табло и блоки счёта по сетам на нижнем табло
  setCssVar('--set-history-bg', templateData.set_history_bg);
  setCssVar('--set-history-text', templateData.set_history_text);
}

var _lastSbPayload = null; // сериализованные данные последнего обработанного события

// Подписка на изменения через DB интерфейс (вызывается после DB.init)
function startScoreboardSubscription(game_id) {
  console.log('sb/ctl: startScoreboardSubscription called, game_id:', game_id);
  DB.scoreboard.subscribe(
  game_id,
  function(data){
    console.log('sb/ctl: scoreboard data received, show:', data ? data.show : 'null');
    if (!data) {
      scoreboard_data = DEFAULT_SCOREBOARD_DATA;
    } else {
      // Ранний выход: дублирующие события (realtime + страховочный опрос)
      // не должны перезапускать jQuery-анимации и перерисовку истории сетов
      var serialized = null;
      try { serialized = JSON.stringify(data); } catch (e) { serialized = null; }
      if (serialized && serialized === _lastSbPayload) {
        scoreboard_data = data;
        return;
      }
      if (serialized) _lastSbPayload = serialized;
      scoreboard_data = data;
    }
    var pdata = scoreboard_data;

    // --- Логика шаблонов ---
    // Шаблон теперь выбирается через поле template_id в данных игры.
    // Если template_id пустой или не указан — используем дефолтные цвета (applyTemplate(null))
    var newTemplateId = scoreboard_data.template_id || '';
    if (newTemplateId !== currentTemplateId) {
      if (_unsubscribeTemplate) {
        _unsubscribeTemplate();
        _unsubscribeTemplate = null;
      }
      currentTemplateId = newTemplateId;
      if (newTemplateId) {
        _unsubscribeTemplate = DB.templates.subscribe(
          currentTemplateId,
          function(templateData) {
            console.log('Applying template:', currentTemplateId, templateData);
            applyTemplate(templateData);
          },
          function(error) {
            console.error('Error listening to template:', error);
            applyTemplate(null);
          }
        );
      } else {
        // Нет шаблона — сбрасываем на стандартные цвета CSS
        console.log('No template selected, using default CSS colors');
        applyTemplate(null);
      }
    }
    // --- Конец логики шаблонов ---

    if(pdata['show'] != scoreboard_data['show']){
      if(scoreboard_data.show & 2){
        $(".big-table").animate({"left":80},1000)
        if(scoreboard_data.show & 8){
          $(".big-table div.time").css("opacity",0);
          $(".big-table div.team div.bottom").css("opacity",0);
        }else{
          $(".big-table div.time").css("opacity",1);
          $(".big-table div.team div.bottom").css("opacity",1);
        }
      }else{
        $(".big-table").animate({"left":-800},1000)
      }

      if(scoreboard_data.show & 1){
        $("table#top").removeClass('top-hidden').animate({"margin-top":0},1000)
      }else{
        $("table#top").addClass('top-hidden').css({"margin-top":-80})
      }

      if(scoreboard_data.show & 4){
        $("div.top_label").animate({"left":50,'opacity':1},1000)
      }else{
        $("div.top_label").animate({"left":-500,"opacity":0},1000,
        "linear", function(X){})
      }
    }
    if(scoreboard_data.show & 4 && pdata.show & 4 &&
      scoreboard_data['custom_label'] != pdata['custom_label']){
      console.log("rehide");
      $("div.top_label").animate({"opacity":0},500,
        "swing", function(X){
          $('.top_label').html(scoreboard_data['custom_label']);
          $("div.top_label").animate({"opacity":1},500);
        })
    }else{
      $('.top_label').html(scoreboard_data['custom_label'])
    }
    $('.away_team').html(scoreboard_data['away_team'])
    $('.away_score').html(scoreboard_data['away_score'])
    var beachMode = !!scoreboard_data['beach_mode'];
    var homeSets = scoreboard_data['home_sets'] || 0;
    var awaySets = scoreboard_data['away_sets'] || 0;
    $('.away_fouls').html(beachMode ? awaySets : scoreboard_data['away_fouls'])
    $(".away_color").css("background-color",scoreboard_data['away_color'])
    $('.home_team').html(scoreboard_data['home_team'])
    $('.home_score').html(scoreboard_data['home_score'])
    $('.home_fouls').html(beachMode ? homeSets : scoreboard_data['home_fouls'])
    $(".home_color").css("background-color",scoreboard_data['home_color'])

    // Обновляем общий счет по сетам на табло
    $('.away_sets').html(awaySets);
    $('.home_sets').html(homeSets);
    var currentPeriod = scoreboard_data['current_period'] || 1;
    $('.timeval').html(currentPeriod)
    var showTop = !!(scoreboard_data.show & 1);
    var showBottom = !!(scoreboard_data.show & 2);
    renderSetHistory(scoreboard_data['set_history'], showTop, showBottom);
    // Обновляем историю сетов для scoreboard1.html
    updateScoreboard1History(scoreboard_data['set_history']);
    // Обновляем отображение для scoreboard1.html (top_label, show/hide табло)
    if (typeof updateScoreboard1Display === 'function') {
      updateScoreboard1Display();
    }
    // Обновляем блоки счета по сетам для sb.html
    if (typeof updateBottomSetsDisplay === 'function') {
      updateBottomSetsDisplay(scoreboard_data['set_history']);
    }
    // Обновляем бейджи сетбола/матчбола для sb.html
    if (typeof updateMatchBadges === 'function') {
      updateMatchBadges(scoreboard_data);
    }
    // Обновляем порядок на табло (функция сама проверит наличие элементов)
    updateTabloSides();
  });
}

/**
 * Обновляет бейджи сетбола/матчбола на табло
 * @param {object} data - данные табло
 */
function updateMatchBadges(data) {
  var homeBadgeType = getMatchBadgeType('home', data);
  var awayBadgeType = getMatchBadgeType('away', data);

  // Обновляем только верхнее табло
  var $homeBadge = $('.scoreboard-container .home-match-badge');
  var $awayBadge = $('.scoreboard-container .away-match-badge');
  var $badgesArea = $('.scoreboard-container .match-badges-area');
  
  // Сначала обновляем бейджи
  updateSingleBadge($homeBadge, homeBadgeType);
  updateSingleBadge($awayBadge, awayBadgeType);
  
  // Показываем/скрываем область бейджей
  var hasAnyBadge = (homeBadgeType !== null || awayBadgeType !== null);
  if (hasAnyBadge) {
    $badgesArea.show();
  } else {
    $badgesArea.hide();
  }
}

/**
 * Обновляет один бейдж
 * @param {jQuery} $badge - элемент бейджа
 * @param {string|null} badgeType - тип бейджа
 */
function updateSingleBadge($badge, badgeType) {
  if (badgeType === null) {
    $badge.hide().removeClass('badge-setball badge-matchball').text('');
  } else {
    $badge.removeClass('badge-setball badge-matchball');

    if (badgeType === 'matchball') {
      $badge.addClass('badge-matchball').text('МАТЧБОЛ');
    } else if (badgeType === 'setball') {
      $badge.addClass('badge-setball').text('СЕТБОЛ');
    }

    $badge.show();
  }
}

function renderSetHistory(history, showTop, showBottom){
  var items=Array.isArray(history)?history:[];
  
  // История для scoreboard.html (верхняя панель) - всегда стандартный порядок
  var topText='';
  if(items.length>0){
    var parts=[];
    for(var i=0;i<items.length;i++){
      var entry=items[i]||{};
      var home=(entry.home!=null)?entry.home:'-';
      var away=(entry.away!=null)?entry.away:'-';
      // Всегда домашняя команда слева, гостевая справа
      parts.push(home+':'+away);
    }
    topText=parts.join(' ');
  }
  
  // История для tablo.html (нижняя панель) - с учетом invert_tablo
  var bottomText='';
  if(items.length>0){
    var parts=[];
    for(var i=0;i<items.length;i++){
      var entry=items[i]||{};
      var home=(entry.home!=null)?entry.home:'-';
      var away=(entry.away!=null)?entry.away:'-';

      // Проверяем текущее расположение команд для правильного отображения истории
      var homeSide = scoreboard_data['home_side'] || 'left';
      var invertTablo = !!scoreboard_data['invert_tablo'];
      // XOR: home слева если (home физически слева) XOR (инверсия включена)
      var homeIsLeft = (homeSide === 'left') !== invertTablo;
      if(homeIsLeft){
        // Домашняя команда слева, гостевая справа - стандартный порядок
        parts.push(home+':'+away);
      } else {
        // Домашняя команда справа, гостевая слева - меняем порядок в истории
        parts.push(away+':'+home);
      }
    }
    bottomText=parts.join(' ');
  }
  
  var hasTopHistory = topText.length>0;
  var hasBottomHistory = bottomText.length>0;
  updateHistoryElement('#set-history-top', showTop && hasTopHistory, topText);
  // set-history-bottom обновляется всегда (используется в tablo.html), видимость управляется через CSS/JS в tablo.html
  updateHistoryElement('#set-history-bottom', hasBottomHistory, bottomText);

  // Обновляем общий счет по сетам на табло на основе set_history
  updateGeneralScoreFromHistory(history);
}

// Функция для подсчета сетов из истории и обновления общего счета
function updateGeneralScoreFromHistory(history){
  var items=Array.isArray(history)?history:[];
  var homeSets = 0;
  var awaySets = 0;
  
  // Подсчитываем выигранные сеты каждой командой
  for(var i=0;i<items.length;i++){
    var entry=items[i]||{};
    var homeScore = parseInt(entry.home, 10);
    var awayScore = parseInt(entry.away, 10);
    
    // Проверяем, что это числовые значения
    if(!isNaN(homeScore) && !isNaN(awayScore)){
      if(homeScore > awayScore){
        homeSets++;
      } else if(awayScore > homeScore){
        awaySets++;
      }
    }
  }
  
  // Обновляем отображение на табло в зависимости от текущего расположения команд
  var homeSide = scoreboard_data['home_side'] || 'left';
  var invertTablo = !!scoreboard_data['invert_tablo'];
  
  // XOR: home слева если (home физически слева) XOR (инверсия включена)
  var homeIsLeft = (homeSide === 'left') !== invertTablo;
  if(homeIsLeft){
    // Домашняя команда слева, гостевая справа
    $('.home_sets').html(homeSets);
    $('.away_sets').html(awaySets);
  } else {
    // Домашняя команда справа, гостевая слева
    // Меняем местами значения, чтобы счет соответствовал расположению команд
    $('.home_sets').html(awaySets);
    $('.away_sets').html(homeSets);
  }
}

function updateHistoryElement(selector, shouldShow, text){
  var el=$(selector);
  if(!el.length)
    return;
  if(!shouldShow){
    el.css('display','none').text('');
    return;
  }
  var displayValue = el.hasClass('set-history-top') ? 'inline-block' : 'block';
  el.css('display', displayValue).text(text);
}

// Обновление истории сетов для scoreboard1.html
function updateScoreboard1History(history){
  var items=Array.isArray(history)?history:[];
  var text='';
  if(items.length>0){
    var parts=[];
    for(var i=0;i<items.length;i++){
      var entry=items[i]||{};
      var home=(entry.home!=null)?entry.home:'-';
      var away=(entry.away!=null)?entry.away:'-';

      // Всегда сперва домашняя команда, затем гостевая
      parts.push(home+':'+away);
    }
    text=parts.join('   ');
  }
  var el=$('#set-history-scoreboard1');
  if(el.length){
    if(text.length > 0){
      el.text(text);
      // Не показываем здесь - управление видимостью в updateScoreboard1Display
    }else{
      el.text('').hide();
    }
  }

  // Вызываем функцию обновления истории сетов в столбик
  if (typeof updateScoreboard1HistoryColumn === 'function') {
    updateScoreboard1HistoryColumn(history);
  }

  // Вызываем функцию обновления отображения для scoreboard1.html
  if (typeof updateScoreboard1Display === 'function') {
    updateScoreboard1Display();
  }
}

function updateTabloSides(){
  var scoreContainer=$('.tablo-score');
  if(!scoreContainer.length)
    return;
  var homeSide=scoreboard_data['home_side'] || 'left';
  var invertTablo = !!scoreboard_data['invert_tablo'];
  // На табло порядок такой же, как на физическом табло (если не инвертировано)
  // Если home физически слева, на табло home слева (order 1), away справа (order 3)
  // При инвертировании порядок противоположный
  var baseHomeOrder = homeSide==='left' ? 1 : 3;
  var baseAwayOrder = homeSide==='left' ? 3 : 1;
  var homeOrder = invertTablo ? baseAwayOrder : baseHomeOrder;
  var awayOrder = invertTablo ? baseHomeOrder : baseAwayOrder;
  var separatorOrder = 2;
  scoreContainer.find('.home_score').css('order', homeOrder);
  scoreContainer.find('.away_score').css('order', awayOrder);
  var sep = scoreContainer.find('.score-separator');
  if(sep.length){
    sep.css('order', separatorOrder);
  }else{
    // Если класс не найден, ищем по тексту
    scoreContainer.children().each(function(){
      if($(this).text().trim() === ':'){
        $(this).css('order', separatorOrder);
      }
    });
  }
  var teamContainer=$('.tablo-teams');
  if(teamContainer.length){
    var leftTeam = teamContainer.find('.tablo-left-team');
    var rightTeam = teamContainer.find('.tablo-right-team');
    if(leftTeam.length && rightTeam.length){
      // homeIsLeft = true, если домашняя команда должна быть слева на табло.
      // Логика: если home физически слева И тablo не инвертировано — home слева.
      //         если home физически справа И tablo инвертировано — тоже home слева.
      // Это XOR: (homeSide==='left') XOR invertTablo
      var homeIsLeft = (homeSide === 'left') !== invertTablo;
      if(homeIsLeft){
        // Домашняя команда слева, гостевая справа
        leftTeam.html(scoreboard_data['home_team'] || '');
        rightTeam.html(scoreboard_data['away_team'] || '');
      } else {
        // Домашняя команда справа, гостевая слева
        leftTeam.html(scoreboard_data['away_team'] || '');
        rightTeam.html(scoreboard_data['home_team'] || '');
      }
    }
  }
  
  
  // Обновляем отображение общего счета и истории сетов в соответствии с текущим расположением
  updateGeneralScoreFromHistory(scoreboard_data['set_history']);

  // При смене сторон обновляем историю сетов, чтобы она соответствовала текущему расположению команд
  var showTop = !!(scoreboard_data.show & 1);
  var showBottom = !!(scoreboard_data.show & 2);
  renderSetHistory(scoreboard_data['set_history'], showTop, showBottom);
}

// Инициализация DB при загрузке
$(document).ready(function() {
  DB.init().then(function() {
    // Получаем game_id из URL и передаем в подписку
    var game_id = getParameterByName('game');
    // Сбрасываем стили при первой загрузке
    applyTemplate(null);
    startScoreboardSubscription(game_id || 'test1');
  }).catch(function(err) {
    console.error('DB initialization failed:', err);
  });
});
