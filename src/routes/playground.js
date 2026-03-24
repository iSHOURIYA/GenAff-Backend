const router = require('express').Router();
const authMiddleware = require('../middleware/authMiddleware');
const { playgroundSessionRateLimiter } = require('../middleware/rateLimiter');
const {
  createSession,
  listSessions,
  getHistory,
  deleteSession,
} = require('../controllers/playgroundController');

// All playground endpoints require JWT auth.
router.use(authMiddleware);

// Create session + ephemeral key.
router.post('/sessions', playgroundSessionRateLimiter, createSession);

// List user's sessions.
router.get('/sessions', listSessions);

// Get conversation history for a session.
router.get('/sessions/:id/history', getHistory);

// End session (revoke key + remove history).
router.delete('/sessions/:id', deleteSession);

module.exports = router;
