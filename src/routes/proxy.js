const router = require('express').Router();
const { chatCompletions } = require('../controllers/proxyController');
const apiKeyMiddleware = require('../middleware/apiKeyMiddleware');
const { proxyRateLimiter } = require('../middleware/rateLimiter');
const { getModelCatalog } = require('../utils/pricing');

/**
 * GET /v1/models
 * Returns all supported models with INR pricing per 1,000 tokens.
 * No auth required. owned_by is always 'genaff' — source never disclosed.
 */
router.get('/models', (req, res) => {
  return res.json({ object: 'list', data: getModelCatalog() });
});

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
