const { createDbAdapter, VOLLEYBALL_COLLECTION, MATCHES_COLLECTION, GAME_CONSTANTS } = require('./dbAdapter');

// Константы из ctl.js
const BEACH_SETS_TO_WIN = GAME_CONSTANTS.BEACH_SETS_TO_WIN;
const BEACH_MAX_SETS = GAME_CONSTANTS.BEACH_MAX_SETS;
const CLASSIC_POINTS_TO_WIN = GAME_CONSTANTS.CLASSIC_POINTS_TO_WIN;
const CLASSIC_SETS_TO_WIN = GAME_CONSTANTS.CLASSIC_SETS_TO_WIN;
const CLASSIC_SETS_TO_WIN_TWO = GAME_CONSTANTS.CLASSIC_SETS_TO_WIN_TWO;
const CLASSIC_MAX_SETS_TWO = GAME_CONSTANTS.CLASSIC_MAX_SETS_TWO;
const CLASSIC_TIEBREAK_POINTS_TO_WIN = GAME_CONSTANTS.CLASSIC_TIEBREAK_POINTS_TO_WIN;
const MAX_CLASSIC_SETS = GAME_CONSTANTS.CLASSIC_MAX_SETS;

/**
 * Проверка доступности БД
 */
function checkDb(dbAdapter) {
  if (!dbAdapter) {
    const error = new Error('Database not initialized. Configure DB_PROVIDER in .env');
    error.code = 'DB_NOT_CONFIGURED';
    throw error;
  }
}

/**
 * Сервис для работы с табло
 */
class ScoreboardService {
  constructor(dbConfig) {
    this.db = createDbAdapter(dbConfig);
  }

  /**
   * Получить состояние табло
   */
  async getScoreboard(gameId) {
    checkDb(this.db);
    return this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
  }

  /**
   * Создать новую игру
   */
  async createScoreboard(gameId, data = {}) {
    checkDb(this.db);

    const existing = await this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
    if (existing) {
      throw new Error(`Scoreboard with id "${gameId}" already exists`);
    }

    const beachEnabled = !!data.beach_mode;
    const twoWinsMode = !!data.two_wins_mode;

    const scoreboard = {
      id: gameId,
      home_team: data.home_team || 'Team1',
      away_team: data.away_team || 'Team2',
      home_color: data.home_color || '#ff0000',
      away_color: data.away_color || '#00ff00',
      tournament_name: data.tournament_name || '-',
      venue: data.venue || '',
      home_score: 0,
      away_score: 0,
      home_sets: 0,
      away_sets: 0,
      home_fouls: 0,
      away_fouls: 0,
      current_period: 1,
      beach_mode: beachEnabled,
      beach_current_set: 1,
      period_count: beachEnabled ? 3 : (twoWinsMode ? 3 : 5),
      show: 0,
      custom_label: data.custom_label || 'Табло',
      home_side: 'left',
      away_side: 'right',
      beach_switch_message: '',
      beach_match_finished: false,
      classic_match_finished: false,
      classic_tiebreak_switch_done: true,
      two_wins_mode: twoWinsMode,
      invert_tablo: !!data.invert_tablo,
      unlimited_score: !!data.unlimited_score,
      set_history: [],
      created: this.db.serverTimestamp(),
      lastEdited: this.db.serverTimestamp(),
    };

    return this.db.setDoc(VOLLEYBALL_COLLECTION, gameId, scoreboard);
  }

  /**
   * Обновить произвольные поля табло
   */
  async updateScoreboard(gameId, data) {
    checkDb(this.db);
    const existing = await this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
    if (!existing) throw new Error('Scoreboard not found');

    const { lastEdited, ...updateData } = data;
    updateData.lastEdited = this.db.serverTimestamp();
    return this.db.updateDoc(VOLLEYBALL_COLLECTION, gameId, updateData);
  }

  /**
   * Изменить счёт (основная логика из ctl.js)
   */
  async updateScore(gameId, team, delta) {
    const data = await this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
    if (!data) throw new Error('Scoreboard not found');

    const beachMode = !!data.beach_mode;
    if (beachMode) {
      return this._handleBeachScore(gameId, data, team, delta);
    } else {
      return this._handleClassicScore(gameId, data, team, delta);
    }
  }

  /**
   * Обработка изменения счёта в пляжном волейболе
   */
  async _handleBeachScore(gameId, data, team, delta) {
    if (data.beach_match_finished) {
      return { message: 'Match finished', data: data };
    }

    const scoreKey = `${team}_score`;
    const otherKey = team === 'home' ? 'away_score' : 'home_score';
    const currentScore = this._ensureNumber(data[scoreKey]);
    const newScore = currentScore + delta;

    if (newScore < 0) {
      throw new Error('Score cannot be negative');
    }

    const otherScore = this._ensureNumber(data[otherKey]);
    const update = { [scoreKey]: newScore };

    const setNumber = this._getBeachSetNumber(data);
    const target = this._getBeachTarget(setNumber);
    const interval = this._getBeachSwitchInterval(setNumber);

    const homeBefore = this._ensureNumber(data.home_score);
    const awayBefore = this._ensureNumber(data.away_score);
    const totalBefore = homeBefore + awayBefore;
    const totalAfter = totalBefore + delta;

    // Смена площадок
    if (delta > 0 && Math.floor(totalAfter / interval) > Math.floor(totalBefore / interval)) {
      const homeAfter = team === 'home' ? newScore : otherScore;
      const awayAfter = team === 'home' ? otherScore : newScore;
      update.beach_switch_message = `Смена площадок — ${setNumber} сет, счёт ${homeAfter}:${awayAfter}`;
    }

    const homeAfterScore = team === 'home' ? newScore : otherScore;
    const awayAfterScore = team === 'home' ? otherScore : newScore;

    // Победа в сете
    if (delta > 0 && this._hasTeamWonSet(team, homeAfterScore, awayAfterScore, target)) {
      return this._applyBeachSetWin(gameId, data, team, homeAfterScore, awayAfterScore, update);
    }

    update.lastEdited = this.db.serverTimestamp();
    return this.db.updateDoc(VOLLEYBALL_COLLECTION, gameId, update);
  }

  /**
   * Обработка изменения счёта в классическом волейболе
   */
  async _handleClassicScore(gameId, data, team, delta) {
    if (data.classic_match_finished) {
      return { message: 'Match finished', data: data };
    }

    const scoreKey = `${team}_score`;
    const otherKey = team === 'home' ? 'away_score' : 'home_score';
    const currentScore = this._ensureNumber(data[scoreKey]);
    const newScore = currentScore + delta;

    if (newScore < 0) {
      throw new Error('Score cannot be negative');
    }

    const update = { [scoreKey]: newScore };
    const otherScore = this._ensureNumber(data[otherKey]);
    const homeAfter = team === 'home' ? newScore : this._ensureNumber(data.home_score);
    const awayAfter = team === 'home' ? otherScore : newScore;

    // Смена сторон в тай-брейке при 8 очках
    if (this._shouldClassicMidSwitch(homeAfter, awayAfter, data)) {
      if (!data.classic_switch_shown) {
        const twoWinsMode = !!data.two_wins_mode;
        const tiebreakSet = twoWinsMode ? 3 : 5;
        update.classic_switch_needed = true;
        update.classic_switch_message = `Смена площадок — ${tiebreakSet}-й сет, счёт ${homeAfter}:${awayAfter}`;
        update.classic_switch_shown = true;
      }
    } else {
      if (data.classic_switch_needed) {
        update.classic_switch_needed = this.db.deleteField();
        update.classic_switch_message = this.db.deleteField();
      }
    }

    // Проверка победы в сете (если не безлимитный счёт)
    const unlimitedScore = !!data.unlimited_score;
    if (delta > 0 && !unlimitedScore && this._classicSetWon(newScore, otherScore, data)) {
      return this._applyClassicSetWin(gameId, data, team, newScore, otherScore, update);
    }

    update.lastEdited = this.db.serverTimestamp();
    return this.db.updateDoc(VOLLEYBALL_COLLECTION, gameId, update);
  }

  /**
   * Новый сет
   */
  async newSet(gameId) {
    const data = await this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
    if (!data) throw new Error('Scoreboard not found');

    const update = {
      home_score: 0,
      away_score: 0,
      beach_switch_message: '',
    };

    if (data.beach_mode) {
      let nextSet = data.next_beach_set || this._ensureNumber(data.beach_current_set) + 1;
      update.beach_current_set = nextSet;
      update.current_period = nextSet;
      update.next_beach_set = this.db.deleteField();
      update.pending_new_set = this.db.deleteField();
    } else {
      let nextPeriod = data.next_period || this._ensureNumber(data.current_period) + 1;
      update.current_period = nextPeriod;

      if (data.pending_home_side !== undefined && data.pending_home_side !== null) {
        update.home_side = data.pending_home_side;
      }
      if (data.pending_away_side !== undefined && data.pending_away_side !== null) {
        update.away_side = data.pending_away_side;
      }
      if (data.pending_classic_tiebreak_switch_done !== undefined && data.pending_classic_tiebreak_switch_done !== null) {
        update.classic_tiebreak_switch_done = data.pending_classic_tiebreak_switch_done;
      }

      update.next_period = this.db.deleteField();
      update.pending_home_side = this.db.deleteField();
      update.pending_away_side = this.db.deleteField();
      update.pending_classic_tiebreak_switch_done = this.db.deleteField();
      update.pending_new_set = this.db.deleteField();
    }

    update.lastEdited = this.db.serverTimestamp();
    return this.db.updateDoc(VOLLEYBALL_COLLECTION, gameId, update);
  }

  /**
   * Смена сторон
   */
  async swapSides(gameId) {
    const data = await this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
    if (!data) throw new Error('Scoreboard not found');

    const currentHomeSide = data.home_side || 'left';
    const newHomeSide = currentHomeSide === 'left' ? 'right' : 'left';

    const update = {
      home_side: newHomeSide,
      away_side: newHomeSide === 'left' ? 'right' : 'left',
      classic_switch_needed: this.db.deleteField(),
      classic_switch_message: this.db.deleteField(),
      beach_switch_message: this.db.deleteField(),
      lastEdited: this.db.serverTimestamp(),
    };

    return this.db.updateDoc(VOLLEYBALL_COLLECTION, gameId, update);
  }

  /**
   * Изменить период
   */
  async updatePeriod(gameId, delta) {
    const data = await this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
    if (!data) throw new Error('Scoreboard not found');

    if (data.beach_mode) {
      return { message: 'Period control disabled in beach mode', data: data };
    }

    const currentPeriod = this._ensureNumber(data.current_period);
    const maxPeriod = this._ensureNumber(data.period_count) || 5;
    const newPeriod = currentPeriod + delta;

    if (newPeriod < 1 || newPeriod > maxPeriod) {
      throw new Error(`Period must be between 1 and ${maxPeriod}`);
    }

    // Подсчёт сетов при смене периода
    let homeFouls = this._ensureNumber(data.home_fouls);
    let awayFouls = this._ensureNumber(data.away_fouls);
    const homeScore = this._ensureNumber(data.home_score);
    const awayScore = this._ensureNumber(data.away_score);

    if (homeScore > awayScore) homeFouls++;
    if (awayScore > homeScore) awayFouls++;

    const update = {
      current_period: newPeriod,
      home_fouls: homeFouls,
      away_fouls: awayFouls,
      home_score: 0,
      away_score: 0,
      lastEdited: this.db.serverTimestamp(),
    };

    return this.db.updateDoc(VOLLEYBALL_COLLECTION, gameId, update);
  }

  /**
   * Обновить отображение
   */
  async updateDisplay(gameId, showValue) {
    checkDb(this.db);
    const validValues = [0, 1, 2, 4, 6, 14];
    if (!validValues.includes(showValue)) {
      throw new Error(`Invalid show value. Must be one of: ${validValues.join(', ')}`);
    }
    return this.updateScoreboard(gameId, { show: showValue });
  }

  /**
   * Обновить метку
   */
  async updateLabel(gameId, label) {
    checkDb(this.db);
    return this.updateScoreboard(gameId, { custom_label: label });
  }

  /**
   * Обновить команды и зал
   */
  async updateTeams(gameId, teamsData) {
    const update = {
      home_team: teamsData.home_team,
      home_color: teamsData.home_color,
      away_team: teamsData.away_team,
      away_color: teamsData.away_color,
      tournament_name: teamsData.tournament_name || '-',
    };
    if (teamsData.venue !== undefined) {
      update.venue = teamsData.venue;
    }
    return this.updateScoreboard(gameId, update);
  }

  /**
   * Обновить настройки
   */
  async updateSettings(gameId, settings) {
    const allowedSettings = ['invert_tablo', 'unlimited_score', 'two_wins_mode'];
    const update = {};

    for (const key of allowedSettings) {
      if (settings[key] !== undefined) {
        update[key] = !!settings[key];
      }
    }

    if (settings.two_wins_mode === true) {
      update.beach_mode = false;
      update.two_wins_mode = true;
      update.period_count = 3;
    }
    if (settings.two_wins_mode === false) {
      update.two_wins_mode = false;
      update.period_count = 5;
    }

    return this.updateScoreboard(gameId, update);
  }

  /**
   * Переключить режим (пляжный/классический)
   */
  async toggleMode(gameId, beachMode) {
    const update = {
      beach_mode: !!beachMode,
      beach_match_finished: false,
      set_history: [],
      classic_match_finished: false,
      classic_tiebreak_switch_done: true,
    };

    if (beachMode) {
      Object.assign(update, {
        home_sets: 0, away_sets: 0, home_score: 0, away_score: 0,
        beach_current_set: 1, current_period: 1, beach_switch_message: '',
        period_count: 3, two_wins_mode: false,
      });
    } else {
      Object.assign(update, {
        beach_switch_message: '', home_sets: 0, away_sets: 0,
        beach_current_set: 1, period_count: 5, home_score: 0, away_score: 0,
        two_wins_mode: false,
      });
    }

    return this.updateScoreboard(gameId, update);
  }

  /**
   * Сбросить табло
   */
  async reset(gameId, keepSettings = true) {
    const data = await this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
    if (!data) throw new Error('Scoreboard not found');

    const beachEnabled = !!data.beach_mode;
    const twoWinsMode = !!data.two_wins_mode;
    const invertTablo = !!data.invert_tablo;

    const resetData = {
      show: 1, timeout_active: false, prev_show: 1, home_score: 0, home_fouls: 0, away_score: 0, away_fouls: 0,
      current_period: 1, custom_label: 'Табло',
      away_team: keepSettings ? data.away_team : 'Team2',
      away_color: keepSettings ? data.away_color : '#00ff00',
      home_team: keepSettings ? data.home_team : 'Team1',
      home_color: keepSettings ? data.home_color : '#ff0000',
      tournament_name: keepSettings ? data.tournament_name : '-',
      venue: keepSettings ? data.venue : '',
      home_sets: 0, away_sets: 0,
      home_timeouts: 0, away_timeouts: 0,
      beach_mode: beachEnabled, beach_current_set: 1, beach_switch_message: '',
      beach_match_finished: false,
      period_count: beachEnabled ? 3 : (twoWinsMode ? 3 : 5),
      set_history: [], classic_match_finished: false,
      home_side: 'left', away_side: 'right',
      classic_tiebreak_switch_done: true,
      two_wins_mode: twoWinsMode, invert_tablo: invertTablo,
      unlimited_score: false,
      lastEdited: this.db.serverTimestamp(),
    };

    return this.db.setDoc(VOLLEYBALL_COLLECTION, gameId, resetData, { merge: true });
  }

  /**
   * Сохранить результат матча
   */
  async saveMatchResult(gameId, overrideData) {
    const data = await this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
    if (!data) throw new Error('Scoreboard not found');

    const isBeach = !!data.beach_mode;
    let overallHome, overallAway;

    if (overrideData?.overallHome !== undefined && overrideData?.overallAway !== undefined) {
      overallHome = overrideData.overallHome;
      overallAway = overrideData.overallAway;
    } else {
      overallHome = isBeach
        ? this._ensureNumber(data.home_sets)
        : this._ensureNumber(data.home_fouls);
      overallAway = isBeach
        ? this._ensureNumber(data.away_sets)
        : this._ensureNumber(data.away_fouls);
    }

    const matchData = {
      date_time: this.db.serverTimestamp(),
      home_team: data.home_team,
      away_team: data.away_team,
      tournament_name: data.tournament_name || '-',
      overall_score: `${overallHome}:${overallAway}`,
      sets_score: overrideData?.setHistory || data.set_history || [],
      game_type: isBeach ? 'beach' : 'classic',
      two_wins_mode: !!data.two_wins_mode,
      game_id: gameId,
    };

    return this.db.addDoc(MATCHES_COLLECTION, matchData);
  }

  // === Вспомогательные методы ===

  _ensureNumber(value) {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  _getBeachSetNumber(data) {
    let setNumber = this._ensureNumber(data.beach_current_set);
    if (!setNumber) setNumber = this._ensureNumber(data.current_period);
    if (setNumber <= 0) setNumber = 1;
    if (setNumber > BEACH_MAX_SETS) setNumber = BEACH_MAX_SETS;
    return setNumber;
  }

  _getBeachTarget(setNumber) {
    return setNumber >= 3 ? 15 : 21;
  }

  _getBeachSwitchInterval(setNumber) {
    return setNumber >= 3 ? 5 : 7;
  }

  _hasTeamWonSet(team, homeScore, awayScore, target) {
    const diff = Math.abs(homeScore - awayScore);
    if (team === 'home') return homeScore >= target && diff >= 2;
    return awayScore >= target && diff >= 2;
  }

  _shouldClassicMidSwitch(homeAfter, awayAfter, data) {
    const twoWinsMode = !!data.two_wins_mode;
    const period = this._ensureNumber(data.current_period);
    const tiebreakSet = twoWinsMode ? 3 : 5;
    if (period !== tiebreakSet) return false;
    return Math.max(homeAfter, awayAfter) >= 8;
  }

  _classicSetWon(teamScore, opponentScore, data) {
    const period = this._ensureNumber(data.current_period);
    const twoWinsMode = !!data.two_wins_mode;
    let target;

    if (twoWinsMode) {
      target = period === 3 ? CLASSIC_TIEBREAK_POINTS_TO_WIN : CLASSIC_POINTS_TO_WIN;
    } else {
      target = period === 5 ? CLASSIC_TIEBREAK_POINTS_TO_WIN : CLASSIC_POINTS_TO_WIN;
    }

    if (teamScore < target) return false;
    return (teamScore - opponentScore) >= 2;
  }

  async _applyBeachSetWin(gameId, data, team, homeScore, awayScore, baseUpdate) {
    let homeSets = this._ensureNumber(data.home_sets);
    let awaySets = this._ensureNumber(data.away_sets);

    if (team === 'home') homeSets++;
    else awaySets++;

    const matchFinished = homeSets >= BEACH_SETS_TO_WIN || awaySets >= BEACH_SETS_TO_WIN;
    const currentSet = this._getBeachSetNumber(data);

    const update = {
      ...baseUpdate,
      home_sets: homeSets, away_sets: awaySets,
      beach_switch_message: baseUpdate.beach_switch_message || '',
    };

    if (matchFinished || currentSet >= BEACH_MAX_SETS) {
      update.beach_match_finished = true;
      update.home_score = homeScore; update.away_score = awayScore;
      update.current_period = currentSet; update.beach_current_set = currentSet;
    } else {
      update.home_score = homeScore; update.away_score = awayScore;
      update.next_beach_set = currentSet + 1;
      update.pending_new_set = true;
    }

    // История сетов
    const history = Array.isArray(data.set_history) ? data.set_history.slice(0, MAX_CLASSIC_SETS) : [];
    history.push({ home: homeScore, away: awayScore });
    if (history.length > MAX_CLASSIC_SETS) history.shift();
    update.set_history = history;
    update.lastEdited = this.db.serverTimestamp();

    await this.db.updateDoc(VOLLEYBALL_COLLECTION, gameId, update);

    if (matchFinished) {
      await this.saveMatchResult(gameId, { setHistory: history, overallHome: homeSets, overallAway: awaySets });
    }

    return this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
  }

  async _applyClassicSetWin(gameId, data, team, teamScore, opponentScore, baseUpdate) {
    let homeFouls = this._ensureNumber(data.home_fouls);
    let awayFouls = this._ensureNumber(data.away_fouls);

    if (team === 'home') homeFouls++;
    else awayFouls++;

    const currentPeriod = this._ensureNumber(data.current_period) || 1;
    const maxPeriod = this._ensureNumber(data.period_count) || 5;
    const twoWinsMode = !!data.two_wins_mode;
    const setsToWin = twoWinsMode ? CLASSIC_SETS_TO_WIN_TWO : CLASSIC_SETS_TO_WIN;
    const matchFinished = homeFouls >= setsToWin || awayFouls >= setsToWin;
    const nextPeriod = currentPeriod < maxPeriod ? currentPeriod + 1 : currentPeriod;
    const homeFinal = team === 'home' ? teamScore : opponentScore;
    const awayFinal = team === 'home' ? opponentScore : teamScore;

    const update = {
      ...baseUpdate,
      home_fouls: homeFouls, away_fouls: awayFouls,
      current_period: currentPeriod, classic_match_finished: matchFinished,
      home_score: homeFinal, away_score: awayFinal,
    };

    if (!matchFinished) {
      const currentHomeSide = data.home_side || 'left';
      const newHomeSide = currentHomeSide === 'left' ? 'right' : 'left';
      const tiebreakSet = twoWinsMode ? 3 : 5;

      update.pending_home_side = newHomeSide;
      update.pending_away_side = newHomeSide === 'left' ? 'right' : 'left';
      update.pending_classic_tiebreak_switch_done = nextPeriod === tiebreakSet ? false : true;
      update.next_period = nextPeriod;
      update.pending_new_set = true;
    } else {
      update.classic_tiebreak_switch_done = true;
    }

    // История сетов
    const history = Array.isArray(data.set_history) ? data.set_history.slice(0, MAX_CLASSIC_SETS) : [];
    history.push({ home: homeFinal, away: awayFinal });
    if (history.length > MAX_CLASSIC_SETS) history.shift();
    update.set_history = history;
    update.lastEdited = this.db.serverTimestamp();

    await this.db.updateDoc(VOLLEYBALL_COLLECTION, gameId, update);

    if (matchFinished) {
      await this.saveMatchResult(gameId, { setHistory: history, overallHome: homeFouls, overallAway: awayFouls });
    }

    return this.db.getDoc(VOLLEYBALL_COLLECTION, gameId);
  }
}

module.exports = { ScoreboardService };
