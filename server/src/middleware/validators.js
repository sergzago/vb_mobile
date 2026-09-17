/**
 * Middleware для обработки ошибок
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  const msg = err.message || '';

  if (err.code === 'DB_NOT_CONFIGURED' || msg.includes('not configured')) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'PocketBase not configured. Check .env / credentials.js',
    });
  }

  if (msg === 'Scoreboard not found') {
    return res.status(404).json({
      error: 'Not Found',
      message: err.message,
    });
  }

  if (msg === 'Score cannot be negative') {
    return res.status(400).json({
      error: 'Bad Request',
      message: err.message,
    });
  }

  if (msg.startsWith('Period must be between') || 
      msg.startsWith('Invalid show value')) {
    return res.status(400).json({
      error: 'Bad Request',
      message: err.message,
    });
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
}

/**
 * Middleware для валидации game_id
 */
function validateGameId(req, res, next) {
  const { game_id } = req.params;
  
  if (!game_id || game_id.trim() === '') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'game_id is required',
    });
  }

  next();
}

/**
 * Middleware для валидации команды (home/away)
 */
function validateTeam(req, res, next) {
  const { team } = req.body;
  
  if (!team || (team !== 'home' && team !== 'away')) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'team must be "home" or "away"',
    });
  }

  next();
}

/**
 * Middleware для валидации delta (±1)
 */
function validateDelta(req, res, next) {
  const { delta } = req.body;
  
  if (delta !== 1 && delta !== -1) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'delta must be 1 or -1',
    });
  }

  next();
}

/**
 * Middleware для валидации периода
 */
function validatePeriodDelta(req, res, next) {
  const { delta } = req.body;
  
  if (delta !== 1 && delta !== -1) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'delta must be 1 or -1',
    });
  }

  next();
}

/**
 * Middleware для валидации режима
 */
function validateMode(req, res, next) {
  const { beach_mode } = req.body;
  
  if (typeof beach_mode !== 'boolean') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'beach_mode must be a boolean',
    });
  }

  next();
}

module.exports = {
  errorHandler,
  validateGameId,
  validateTeam,
  validateDelta,
  validatePeriodDelta,
  validateMode,
};
