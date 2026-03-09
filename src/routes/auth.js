const router = require('express').Router();
const { register, login, me } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { authRateLimiter } = require('../middleware/rateLimiter');

// POST /auth/register
router.post('/register', register);

// POST /auth/login  (rate-limited to prevent brute-force)
router.post('/login', authRateLimiter, login);

// GET /auth/me  (requires JWT)
router.get('/me', authMiddleware, me);

module.exports = router;
