const router = require('express').Router();
const { chatCompletions } = require('../controllers/proxyController');
const apiKeyMiddleware = require('../middleware/apiKeyMiddleware');
const { proxyRateLimiter } = require('../middleware/rateLimiter');
const { listSupportedModels } = require('../utils/pricing');

/**
 * GET /v1/models
 * Public endpoint – returns all supported model strings.
 * No auth required (mirrors OpenAI’s /v1/models behaviour).
 */
router.get('/models', (req, res) => {
  const models = listSupportedModels().map((id) => ({
    id,
    object: 'model',
    owned_by: id.startsWith('gpt') || /^o\d/.test(id)
      ? 'openai'
      : id.startsWith('deepseek')
      ? 'deepseek'
      : 'google',
  }));
  return res.json({ object: 'list', data: models });
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
