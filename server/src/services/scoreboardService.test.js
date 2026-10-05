/**
 * Тесты произвольного (custom) варианта игры и регрессии классического режима.
 *
 * БД подменяется фейковым PocketBase-клиентом: ScoreboardService общается
 * только через client.collection(...).getOne/update/create/getFullList.
 */
const { ScoreboardService } = require('./scoreboardService');

function createFakeClient() {
  const store = { volleyball: {}, matches: {} };
  let idSeq = 1;

  const notFound = () => {
    const err = new Error('Not found');
    err.status = 404;
    return err;
  };

  return {
    store,
    collection(name) {
      const rows = (store[name] = store[name] || {});
      return {
        async getOne(id) {
          if (!Object.prototype.hasOwnProperty.call(rows, id)) throw notFound();
          return { ...rows[id] };
        },
        async update(id, data) {
          if (!Object.prototype.hasOwnProperty.call(rows, id)) throw notFound();
          for (const [key, value] of Object.entries(data)) {
            if (value === null) delete rows[id][key]; // PocketBase: null удаляет поле
            else rows[id][key] = value;
          }
          return { ...rows[id] };
        },
        async create(data) {
          const id = data.id || `rec${idSeq++}`;
          rows[id] = { ...data };
          return { ...rows[id] };
        },
        async getFullList() {
          return Object.values(rows).map((row) => ({ ...row }));
        },
      };
    },
  };
}

function createService() {
  const client = createFakeClient();
  return { service: new ScoreboardService({ provider: 'fake', client }), client };
}

async function scoreTimes(service, gameId, team, times) {
  for (let i = 0; i < times; i++) {
    await service.updateScore(gameId, team, 1);
  }
}

describe('Создание игры через API', () => {
  test('классический вариант — как раньше (period_count 5, без custom полей)', async () => {
    const { service } = createService();
    await service.createScoreboard('classic', {});

    const doc = await service.getScoreboard('classic');
    expect(doc.period_count).toBe(5);
    expect(doc.custom_mode).toBe(false);
    expect(doc.matchmode).toBe('00000');
    expect(doc.count_wins).toBeUndefined();
  });

  test('произвольный вариант: period_count 9, дефолты настроек', async () => {
    const { service } = createService();
    await service.createScoreboard('custom', { custom_mode: true });

    const doc = await service.getScoreboard('custom');
    expect(doc.custom_mode).toBe(true);
    expect(doc.matchmode).toBe('00001');
    expect(doc.period_count).toBe(9);
    expect(doc.beach_mode).toBe(false);
    expect(doc.two_wins_mode).toBe(false);
    expect(doc.count_wins).toBe(3);
    expect(doc.score_wins).toBe(25);
    expect(doc.score_tie).toBe(15);
    expect(doc.balance).toBe(false);
    expect(doc.score_change).toBe(7);
    expect(doc.count_timeouts).toBe(2);
  });

  test('произвольный вариант: нулевой score_change (смена сторон отключена) сохраняется', async () => {
    const { service } = createService();
    await service.createScoreboard('custom0', {
      custom_mode: true,
      score_change: 0,
      count_wins: 1,
      score_wins: 15,
      count_timeouts: 0,
    });

    const doc = await service.getScoreboard('custom0');
    expect(doc.score_change).toBe(0);
    expect(doc.count_wins).toBe(1);
    expect(doc.score_wins).toBe(15);
    expect(doc.count_timeouts).toBe(0);
  });

  test('произвольный вариант включается и через matchmode (5-й бит)', async () => {
    const { service } = createService();
    await service.createScoreboard('customMM', { matchmode: '00001' });

    const doc = await service.getScoreboard('customMM');
    expect(doc.custom_mode).toBe(true);
    expect(doc.period_count).toBe(9);
  });

  test('пляжный режим имеет приоритет над произвольным', async () => {
    const { service } = createService();
    await service.createScoreboard('mix', { beach_mode: true, custom_mode: true });

    const doc = await service.getScoreboard('mix');
    expect(doc.beach_mode).toBe(true);
    expect(doc.custom_mode).toBe(false);
    expect(doc.period_count).toBe(3);
  });
});


describe('PATCH /settings — настройки произвольного варианта', () => {
  test('включение custom_mode: взаимное исключение, matchmode и period_count', async () => {
    const { service } = createService();
    await service.createScoreboard('s1', { two_wins_mode: true });

    await service.updateSettings('s1', { custom_mode: true });
    const doc = await service.getScoreboard('s1');

    expect(doc.custom_mode).toBe(true);
    expect(doc.two_wins_mode).toBe(false);
    expect(doc.beach_mode).toBe(false);
    expect(doc.matchmode).toBe('00001');
    expect(doc.period_count).toBe(9);
  });

  test('нулевой score_change не заменяется на дефолтный 7', async () => {
    const { service } = createService();
    await service.createScoreboard('s2', { custom_mode: true });

    await service.updateSettings('s2', { score_change: 0 });
    expect((await service.getScoreboard('s2')).score_change).toBe(0);

    // Повторное обновление не «съедает» ноль
    await service.updateSettings('s2', { count_wins: 1 });
    const doc = await service.getScoreboard('s2');
    expect(doc.score_change).toBe(0);
    expect(doc.count_wins).toBe(1);
  });

  test('отключение custom_mode возвращает period_count 5', async () => {
    const { service } = createService();
    await service.createScoreboard('s3', { custom_mode: true });

    await service.updateSettings('s3', { custom_mode: false });
    const doc = await service.getScoreboard('s3');

    expect(doc.custom_mode).toBe(false);
    expect(doc.matchmode).toBe('00000');
    expect(doc.period_count).toBe(5);
  });

  test('невалидные значения отклоняются с 400-сообщением', async () => {
    const { service } = createService();
    await service.createScoreboard('s4', { custom_mode: true });

    await expect(service.updateSettings('s4', { count_wins: 0 }))
      .rejects.toThrow('Invalid custom setting: count_wins must be >= 1');
    await expect(service.updateSettings('s4', { score_change: 'abc' }))
      .rejects.toThrow('Invalid custom setting: score_change must be an integer');
    await expect(service.updateSettings('s4', { score_change: -1 }))
      .rejects.toThrow('Invalid custom setting: score_change must be >= 0');
  });
});

describe('PATCH произвольных полей (updateScoreboard)', () => {
  test('custom_mode выключает пляжный режим и пересчитывает period_count/matchmode', async () => {
    const { service } = createService();
    await service.createScoreboard('p1', { beach_mode: true });

    await service.updateScoreboard('p1', { custom_mode: true });
    const doc = await service.getScoreboard('p1');

    expect(doc.beach_mode).toBe(false);
    expect(doc.custom_mode).toBe(true);
    expect(doc.matchmode).toBe('00001');
    expect(doc.period_count).toBe(9);
  });

  test('не-мode поля не трогают matchmode', async () => {
    const { service } = createService();
    await service.createScoreboard('p2', {});

    await service.updateScoreboard('p2', { home_team: 'Спарта', show: 1 });
    const doc = await service.getScoreboard('p2');

    expect(doc.home_team).toBe('Спарта');
    expect(doc.matchmode).toBe('00000');
    expect(doc.period_count).toBe(5);
  });
});


describe('Игровая логика произвольного варианта', () => {
  test('сет выигрывается по score_wins без баланса (разница не нужна)', async () => {
    const { service } = createService();
    await service.createScoreboard('g1', {
      custom_mode: true, count_wins: 1, score_wins: 15, balance: false,
    });

    await scoreTimes(service, 'g1', 'home', 15);
    const doc = await service.getScoreboard('g1');

    expect(doc.home_score).toBe(15);
    expect(doc.home_fouls).toBe(1);
    expect(doc.classic_match_finished).toBe(true);
    expect(doc.set_history).toEqual([{ home: 15, away: 0 }]);
  });

  test('с балансом победа только с разницей 2 очка', async () => {
    const { service } = createService();
    await service.createScoreboard('g2', {
      custom_mode: true, count_wins: 3, score_wins: 15, balance: true,
    });

    await scoreTimes(service, 'g2', 'home', 14); // 14:0 — ещё не сет
    await scoreTimes(service, 'g2', 'away', 14); // 14:14
    await scoreTimes(service, 'g2', 'home', 1);  // 15:14 — разница 1, сет не окончен

    let doc = await service.getScoreboard('g2');
    expect(doc.home_fouls).toBe(0);
    expect(doc.classic_match_finished).toBe(false);

    await scoreTimes(service, 'g2', 'away', 3); // 15:17 — разница 2, сет за away
    doc = await service.getScoreboard('g2');
    expect(doc.away_fouls).toBe(1);
    expect(doc.home_fouls).toBe(0);
  });

  test('матч до 1 победы (count_wins=1) завершается по score_wins', async () => {
    const { service } = createService();
    await service.createScoreboard('g2b', {
      custom_mode: true, count_wins: 1, score_wins: 15, balance: false,
    });

    await scoreTimes(service, 'g2b', 'away', 15);
    const doc = await service.getScoreboard('g2b');

    expect(doc.away_fouls).toBe(1);
    expect(doc.classic_match_finished).toBe(true);
  });

  test('сет с номером = count_wins играется до score_tie, остальные до score_wins', async () => {
    const { service } = createService();
    await service.createScoreboard('g3', {
      custom_mode: true, count_wins: 2, score_wins: 25, score_tie: 15, balance: false,
    });

    // 1-й сет: до score_wins (25)
    await scoreTimes(service, 'g3', 'home', 25);
    let doc = await service.getScoreboard('g3');
    expect(doc.home_fouls).toBe(1);
    expect(doc.pending_new_set).toBe(true);
    expect(doc.next_period).toBe(2);

    await service.newSet('g3');
    doc = await service.getScoreboard('g3');
    expect(doc.current_period).toBe(2);
    expect(doc.home_score).toBe(0);

    // 2-й сет (= count_wins): до score_tie (15); счёт в матче 1:1 — матч продолжается
    await scoreTimes(service, 'g3', 'away', 15);
    doc = await service.getScoreboard('g3');
    expect(doc.away_fouls).toBe(1);
    expect(doc.classic_match_finished).toBe(false);

    await service.newSet('g3');
    // 3-й сет (не решающий по правилу period === count_wins): снова до score_wins
    await scoreTimes(service, 'g3', 'home', 15);
    doc = await service.getScoreboard('g3');
    expect(doc.home_fouls).toBe(1); // 15 недостаточно для сета до 25

    await scoreTimes(service, 'g3', 'home', 10); // 25
    doc = await service.getScoreboard('g3');
    expect(doc.home_fouls).toBe(2);
    expect(doc.classic_match_finished).toBe(true);
  });

  test('смена сторон каждые N очков', async () => {
    const { service } = createService();
    await service.createScoreboard('g4', { custom_mode: true, score_change: 5 });

    await scoreTimes(service, 'g4', 'home', 4);
    let doc = await service.getScoreboard('g4');
    expect(doc.classic_switch_needed).toBeFalsy();

    await scoreTimes(service, 'g4', 'home', 1); // сумма 5 — пересечение порога
    doc = await service.getScoreboard('g4');
    expect(doc.classic_switch_needed).toBe(true);
    expect(doc.classic_switch_message).toBe('Смена площадок — счёт 5:0');
  });

  test('score_change = 0 — смена сторон отключена', async () => {
    const { service } = createService();
    await service.createScoreboard('g5', { custom_mode: true, score_change: 0 });

    await scoreTimes(service, 'g5', 'home', 10);
    const doc = await service.getScoreboard('g5');
    expect(doc.classic_switch_needed).toBeFalsy();
    expect(doc.classic_switch_message).toBeFalsy();
  });

  test('классическая смена сторон в тай-брейке при 8 очках не срабатывает', async () => {
    const { service } = createService();
    await service.createScoreboard('g6', { custom_mode: true, score_change: 0 });

    await scoreTimes(service, 'g6', 'home', 8);
    await scoreTimes(service, 'g6', 'away', 8);
    const doc = await service.getScoreboard('g6');
    expect(doc.classic_switch_needed).toBeFalsy();
  });
});


describe('Режимы и сброс', () => {
  test('toggleMode(custom_mode: true) включает произвольный вариант без сброса счёта', async () => {
    const { service } = createService();
    await service.createScoreboard('m1', {});
    await scoreTimes(service, 'm1', 'home', 3);

    await service.toggleMode('m1', { custom_mode: true });
    const doc = await service.getScoreboard('m1');

    expect(doc.custom_mode).toBe(true);
    expect(doc.matchmode).toBe('00001');
    expect(doc.period_count).toBe(9);
    expect(doc.home_score).toBe(3);
  });

  test('toggleMode(beach_mode: true) выключает произвольный вариант', async () => {
    const { service } = createService();
    await service.createScoreboard('m2', { custom_mode: true });

    await service.toggleMode('m2', { beach_mode: true });
    const doc = await service.getScoreboard('m2');

    expect(doc.beach_mode).toBe(true);
    expect(doc.custom_mode).toBe(false);
    expect(doc.matchmode).toBe('10000');
    expect(doc.period_count).toBe(3);
  });

  test('toggleMode сохраняет старое поведение для beach_mode: false', async () => {
    const { service } = createService();
    await service.createScoreboard('m3', { beach_mode: true });

    await service.toggleMode('m3', { beach_mode: false });
    const doc = await service.getScoreboard('m3');

    expect(doc.beach_mode).toBe(false);
    expect(doc.period_count).toBe(5);
    expect(doc.set_history).toEqual([]);
    expect(doc.home_score).toBe(0);
  });

  test('reset сохраняет произвольные настройки, включая нулевой score_change', async () => {
    const { service } = createService();
    await service.createScoreboard('r1', {
      custom_mode: true, score_change: 0, count_wins: 1, score_wins: 21,
    });
    await scoreTimes(service, 'r1', 'home', 5);

    await service.reset('r1', true);
    const doc = await service.getScoreboard('r1');

    expect(doc.home_score).toBe(0);
    expect(doc.custom_mode).toBe(true);
    expect(doc.matchmode).toBe('00001');
    expect(doc.period_count).toBe(9);
    expect(doc.score_change).toBe(0);
    expect(doc.count_wins).toBe(1);
    expect(doc.score_wins).toBe(21);
  });
});

describe('Регресс: классический режим не изменился', () => {
  test('победа в сете по 25 очкам с разницей 2', async () => {
    const { service } = createService();
    await service.createScoreboard('c1', {});

    await scoreTimes(service, 'c1', 'home', 25);
    await scoreTimes(service, 'c1', 'away', 23);

    const doc = await service.getScoreboard('c1');
    expect(doc.home_fouls).toBe(1);
    expect(doc.pending_new_set).toBe(true);
    expect(doc.period_count).toBe(5);
  });

  test('режим до двух побед: period_count 3, матч до 2 побед', async () => {
    const { service } = createService();
    await service.createScoreboard('c2', { two_wins_mode: true });
    expect((await service.getScoreboard('c2')).period_count).toBe(3);

    await scoreTimes(service, 'c2', 'home', 25);
    await service.newSet('c2');
    await scoreTimes(service, 'c2', 'home', 25);

    const doc = await service.getScoreboard('c2');
    expect(doc.home_fouls).toBe(2);
    expect(doc.classic_match_finished).toBe(true);
  });

  test('5-й сет классики — до 15 очков', async () => {
    const { service } = createService();
    await service.createScoreboard('c3', {});

    await service.updateScoreboard('c3', { current_period: 5, home_fouls: 2, away_fouls: 2 });
    await scoreTimes(service, 'c3', 'home', 15);

    const doc = await service.getScoreboard('c3');
    expect(doc.home_fouls).toBe(3);
    expect(doc.classic_match_finished).toBe(true);
  });
});

