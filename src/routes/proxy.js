const router = require('express').Router();
const { chatCompletions } = require('../controllers/proxyController');
const apiKeyMiddleware = require('../middleware/apiKeyMiddleware');
const { proxyRateLimiter } = require('../middleware/rateLimiter');

/**
 * POST /v1/chat/completions
 *
 * Middleware stack (in order):
 *   1. proxyRateLimiter  – 20 req/min per API key (429 if exceeded)
 *   2. apiKeyMiddleware  – validate sk_genaff_... key, attach user
 *   3. chatCompletions   – forward to AI provider, log usage, deduct balance
 */
router.post(
  '/chat/completions',
  proxyRateLimiter,
  apiKeyMiddleware,
  chatCompletions
);

module.exports = router;
