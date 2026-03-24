const router = require('express').Router();
const { chatCompletions } = require('../controllers/proxyController');
const apiKeyMiddleware = require('../middleware/apiKeyMiddleware');
const { proxyRateLimiter } = require('../middleware/rateLimiter');
const { getModelCatalog } = require('../utils/pricing');
const { getLiveModels, getHealthStatus } = require('../services/modelHealthCheckService');

/**
 * GET /v1/models
 * Returns only healthy (live) models with INR pricing per 1,000 tokens.
 * No auth required. owned_by is always 'genaff' — source never disclosed.
 *
 * Models use low-cost health strategy (provider canaries + passive traffic signals).
 * Falls back to all models if no healthy data is available.
 */
router.get('/models', async (req, res) => {
  try {
    const liveModels = await getLiveModels();
    const catalog = getModelCatalog().filter((model) => liveModels.includes(model.id));

    return res.json({
      object: 'list',
      data: catalog,
      _meta: {
        total_configured: getModelCatalog().length,
        live_count: catalog.length,
      },
    });
  } catch (err) {
    console.error('[proxy.models] Error fetching live models:', err);
    // Fallback to all models if health check fails
    return res.json({ object: 'list', data: getModelCatalog() });
  }
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

/**
 * GET /v1/models/health (admin/testing endpoint)
 * Returns detailed health status of all models.
 * Useful for debugging provider issues.
 */
router.get('/models/health', async (req, res) => {
  try {
    const health = await getHealthStatus();
    const summary = {
      healthy: Object.values(health).filter((h) => h.status === 'healthy').length,
      unhealthy: Object.values(health).filter((h) => h.status === 'unhealthy').length,
      unknown: Object.values(health).filter((h) => h.status === 'unknown').length,
    };

    return res.json({
      summary,
      models: Object.entries(health).map(([model, status]) => ({
        model,
        ...status,
        since: new Date(status.timestamp).toISOString(),
      })),
    });
  } catch (err) {
    console.error('[proxy.models.health] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch health status' });
  }
});

module.exports = router;
