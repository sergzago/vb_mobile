/**
 * Скрипт для создания необходимых коллекций в PocketBase
 * 
 * Использование:
 *   node server/scripts/create-collections.js
 * 
 * Или с переменными окружения (изнутри контейнера сервера обычно уже заданы):
 *   POCKETBASE_URL=http://pocketbase:8090 \
 *   POCKETBASE_ADMIN_EMAIL=admin@example.com \
 *   POCKETBASE_ADMIN_PASSWORD=yourpassword \
 *   node server/scripts/create-collections.js
 */

// Конфигурация из переменных окружения или значения по умолчанию.
// localhost:8090 — порт контейнера PB, опубликованный только на 127.0.0.1
// (см. docker-compose.pb.yml); в docker-сети используйте http://pocketbase:8090.
const CONFIG = {
  url: process.env.POCKETBASE_URL || 'http://localhost:8090',
  adminEmail: process.env.POCKETBASE_ADMIN_EMAIL || 'supervisor@volleyball.local',
  adminPassword: process.env.POCKETBASE_ADMIN_PASSWORD || 'Mer1in00'
};

// Определения схем коллекций
const COLLECTIONS = {
  volleyball: {
    name: 'volleyball',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: '',
    updateRule: '',
    deleteRule: 'role = "admin"',
    schema: [
      { name: 'id', type: 'text', required: false, unique: true },
      { name: 'home_team', type: 'text', required: false },
      { name: 'away_team', type: 'text', required: false },
      { name: 'home_score', type: 'number', required: false },
      { name: 'away_score', type: 'number', required: false },
      { name: 'home_sets', type: 'number', required: false },
      { name: 'away_sets', type: 'number', required: false },
      { name: 'current_set', type: 'number', required: false },
      { name: 'home_sets_history', type: 'json', required: false },
      { name: 'away_sets_history', type: 'json', required: false },
      { name: 'serving_team', type: 'text', required: false },
      { name: 'status', type: 'select', required: false, maxSelect: 1, values: ['not_started', 'in_progress', 'finished', 'paused'] },
      { name: 'match_type', type: 'select', required: false, maxSelect: 1, values: ['classic', 'beach'] },
      { name: 'lastEdited', type: 'date', required: false },
      { name: 'created', type: 'date', required: false }
    ]
  },
  matches: {
    name: 'matches',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: 'role = "admin"',
    schema: [
      { name: 'game_id', type: 'text', required: false },
      { name: 'date_time', type: 'date', required: false },
      { name: 'home_team', type: 'text', required: false },
      { name: 'away_team', type: 'text', required: false },
      { name: 'home_score', type: 'number', required: false },
      { name: 'away_score', type: 'number', required: false },
      { name: 'home_sets', type: 'number', required: false },
      { name: 'away_sets', type: 'number', required: false },
      { name: 'match_type', type: 'select', required: false, maxSelect: 1, values: ['classic', 'beach'] },
      { name: 'is_deleted', type: 'bool', required: false },
      { name: 'deleted_at', type: 'date', required: false },
      { name: 'notes', type: 'text', required: false }
    ]
  },
  auth_log: {
    name: 'auth_log',
    type: 'base',
    listRule: 'role = "admin"',
    viewRule: 'role = "admin"',
    createRule: '',
    updateRule: 'role = "admin"',
    deleteRule: 'role = "admin"',
    schema: [
      { name: 'username', type: 'text', required: false },
      { name: 'event', type: 'text', required: false },
      { name: 'timestamp', type: 'date', required: false },
      { name: 'ip_address', type: 'text', required: false },
      { name: 'user_agent', type: 'text', required: false },
      { name: 'details', type: 'json', required: false }
    ]
  },
  scoreusers: {
    name: 'scoreusers',
    type: 'auth',
    listRule: 'id = @request.auth.id',
    viewRule: 'id = @request.auth.id',
    createRule: '',
    updateRule: 'id = @request.auth.id',
    deleteRule: null,
    schema: [
      { name: 'username', type: 'text', required: true, unique: true, min: 3, max: 50 },
      { name: 'name', type: 'text', required: false, max: 100 },
      { name: 'role', type: 'select', required: false, maxSelect: 1, values: ['admin', 'user', 'moderator'] },
      { name: 'avatar', type: 'file', required: false, maxSelect: 1, mimeTypes: ['image/jpeg', 'image/png', 'image/gif'], thumbs: ['100x100'] }
    ],
    options: {
      allowEmailAuth: true,
      allowOAuth2Auth: true,
      allowUsernameAuth: true,
      exceptEmailDomains: null,
      manageRule: null,
      minPasswordLength: 8,
      onlyEmailDomains: null,
      onlyVerified: false,
      requireEmail: false
    }
  }
};

async function createCollections() {
  console.log('=== Создание коллекций в PocketBase ===\n');
  console.log('URL:', CONFIG.url);
  console.log('');

  // Динамический импорт PocketBase (ESM модуль)
  const { default: PocketBase } = await import('pocketbase');
  const pb = new PocketBase(CONFIG.url);

  try {
    // Авторизация как администратор
    console.log('1. Авторизация как администратор...');
    await pb.admins.authWithPassword(CONFIG.adminEmail, CONFIG.adminPassword);
    console.log('   ✓ Успешно\n');

    // Получение списка существующих коллекций
    console.log('2. Проверка существующих коллекций...');
    const existingCollections = await pb.collections.getList();
    const existingNames = existingCollections.map(c => c.name);
    console.log('   Найдено коллекций:', existingNames.join(', '));
    console.log('');

    // Создание отсутствующих коллекций
    console.log('3. Создание отсутствующих коллекций...');
    let createdCount = 0;
    let skippedCount = 0;

    for (const [key, collectionDef] of Object.entries(COLLECTIONS)) {
      if (existingNames.includes(collectionDef.name)) {
        console.log(`   ⊘ ${collectionDef.name} — уже существует`);
        skippedCount++;
        continue;
      }

      try {
        console.log(`   → Создание ${collectionDef.name}...`);
        var payload = {
          name: collectionDef.name,
          type: collectionDef.type,
          listRule: collectionDef.listRule,
          viewRule: collectionDef.viewRule,
          createRule: collectionDef.createRule,
          updateRule: collectionDef.updateRule,
          deleteRule: collectionDef.deleteRule,
          schema: collectionDef.schema
        };
        // Для auth коллекций добавляем options
        if (collectionDef.type === 'auth' && collectionDef.options) {
          payload.options = collectionDef.options;
        }
        await pb.collections.create(payload);
        console.log(`   ✓ ${collectionDef.name} создана`);
        createdCount++;
      } catch (err) {
        console.error(`   ✗ Ошибка при создании ${collectionDef.name}:`, err.message);
      }
    }

    console.log('');
    console.log('=== Результат ===');
    console.log('Создано:', createdCount);
    console.log('Пропущено (уже существуют):', skippedCount);
    console.log('');

    if (createdCount > 0) {
      console.log('✓ Коллекции успешно созданы!');
      console.log('');
      console.log('Теперь вы можете использовать приложение.');
    } else {
      console.log('Все коллекции уже существуют. Создание не требуется.');
    }

  } catch (err) {
    console.error('\n✗ Ошибка:', err.message);
    console.error('');
    console.error('Возможные причины:');
    console.error('  1. Неверный URL PocketBase');
    console.error('  2. Неверные учётные данные администратора');
    console.error('  3. PocketBase сервер не запущен');
    console.error('');
    console.error('Проверьте конфигурацию и попробуйте снова.');
    process.exit(1);
  }
}

// Запуск
createCollections();
