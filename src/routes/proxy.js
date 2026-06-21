const router = require('express').Router();
const { chatCompletions } = require('../controllers/proxyController');
const apiKeyMiddleware = require('../middleware/apiKeyMiddleware');
const { proxyRateLimiter } = require('../middleware/rateLimiter');
const { getLiveModelCatalog, refreshLiveModels } = require('../services/providerModelService');
const { getHealthStatus } = require('../services/modelHealthCheckService');

/**
 * GET /v1/models
 * Returns dynamically discovered live models from all providers,
 * intersected with our pricing catalog.
 *
 * No auth required. owned_by is always 'genaff'.
 */
router.get('/models', async (req, res) => {
  try {
    const catalog = await getLiveModelCatalog();

    return res.json({
      object: 'list',
      data: catalog,
      _meta: {
        total_live: catalog.length,
      },
    });
  } catch (err) {
    console.error('[proxy.models] Error fetching live models:', err);
    return res.status(500).json({ error: 'Failed to fetch model catalog' });
  }
});

/**
 * POST /v1/chat/completions
 */
router.post(
  '/chat/completions',
  proxyRateLimiter,
  apiKeyMiddleware,
  chatCompletions
);

/**
 * GET /v1/models/health
 * Admin/testing endpoint. Returns passive health check cache.
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
