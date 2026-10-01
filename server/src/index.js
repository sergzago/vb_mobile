require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { initializeDb } = require('./config/db');
const { errorHandler } = require('./middleware/validators');

// Создание Express приложения
const app = express();
const PORT = process.env.PORT || 3000;

// Глобальный обработчик ошибок БД (до инициализации)
app.use((err, req, res, next) => {
  console.error('Pre-init error:', err);
  res.status(503).json({ error: 'Service Unavailable', message: 'Server initializing' });
});

module.exports = app;

// Инициализация БД и запуск сервера
async function startServer() {
  let dbConfig = null;
  
  try {
    dbConfig = await initializeDb();
  } catch (err) {
    console.error('⚠️ Database initialization failed:', err.message);
    console.log('⚠️ Server running in degraded mode (no database)');
  }
  
  const scoreboardRouter = require('./routes/scoreboard');
  const matchesRouter = require('./routes/matches');
  const authRouter = require('./routes/auth');
  
  // Сохраняем инстансы в app.locals для доступа в маршрутах.
  // app.locals.db — весь объект конфигурации { provider, db, admin, client, degraded },
  // именно его ожидают routes/services (createDbAdapter, ScoreboardService).
  app.locals.db = dbConfig;
  app.locals.dbProvider = dbConfig ? dbConfig.provider : 'unknown';
  app.locals.dbClient = dbConfig ? dbConfig.client : null;
  
  // Middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS || '*',
  }));
  app.use(express.json());
  
  // Health check endpoint
  // Регистрируется ДО блока /api-маршрутов, чтобы /api/health отвечал и в
  // degraded-режиме (там ниже идёт app.use('/api', 503-fallback)).
  // /api/health — алиас /health: внешний nginx проксирует /myvb/api/* → /api/*,
  // поэтому через reverse proxy доступен только путь под /api/ (нужен для
  // Swagger UI «Try it out»). /health сохранён — на него ссылается
  // docker healthcheck.
  const healthHandler = (req, res) => {
    res.json({
      status: dbConfig ? 'ok' : 'degraded',
      provider: app.locals.dbProvider,
      timestamp: new Date().toISOString(),
    });
  };
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // Маршруты (только если БД подключена)
  if (dbConfig) {
    app.use('/api/auth', authRouter);
    app.use('/api/scoreboard', scoreboardRouter);
    app.use('/api/matches', matchesRouter);
  } else {
    // Fallback: возвращаем 503 для всех API запросов
    app.use('/api', (req, res) => {
      res.status(503).json({ error: 'Service Unavailable', message: 'Database not connected' });
    });
  }
  
  // Логгирование запросов (dev mode)
  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path} [${app.locals.dbProvider}]`);
      next();
    });
  }
  
  // Swagger UI (включается переменной ENABLE_SWAGGER=true)
  const enableSwagger = process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV !== 'production';
  if (enableSwagger) {
    const swaggerUi = require('swagger-ui-express');
    const yaml = require('js-yaml');
    const fs = require('fs');
    const swaggerDocument = yaml.load(fs.readFileSync('./swagger.yaml', 'utf8'));
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    console.log(`📖 Swagger UI: http://localhost:${PORT}/api-docs`);
  }
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.path} not found`,
    });
  });
  
  // Global error handler
  app.use(errorHandler);
  
  // Запуск сервера
  app.listen(PORT, () => {
    console.log(`🏐 Volleyball Scoreboard API server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📋 API endpoints:`);
    console.log(`   GET    /api/scoreboard/:game_id`);
    console.log(`   PATCH  /api/scoreboard/:game_id`);
    console.log(`   POST   /api/scoreboard/:game_id/score`);
    console.log(`   POST   /api/scoreboard/:game_id/new-set`);
    console.log(`   POST   /api/scoreboard/:game_id/swap-sides`);
    console.log(`   POST   /api/scoreboard/:game_id/period`);
    console.log(`   POST   /api/scoreboard/:game_id/display`);
    console.log(`   POST   /api/scoreboard/:game_id/label`);
    console.log(`   PUT    /api/scoreboard/:game_id/teams`);
    console.log(`   PATCH  /api/scoreboard/:game_id/settings`);
    console.log(`   POST   /api/scoreboard/:game_id/mode`);
    console.log(`   POST   /api/scoreboard/:game_id/reset`);
    console.log(`   POST   /api/matches`);
    console.log(`   GET    /api/matches`);
    console.log(`   auth   /api/auth/login`);
    console.log(`   auth   /api/auth/me`);
    
    if (!dbConfig) {
      console.log('⚠️ Running in degraded mode - database not available');
    }
  });
}

startServer().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
