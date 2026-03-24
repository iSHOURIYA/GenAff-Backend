const { callOpenAI } = require('../providers/openai');
const { callDeepSeek } = require('../providers/deepseek');
const { callGemini } = require('../providers/gemini');
const { callNvidia } = require('../providers/nvidia');
const { MODEL_PRICING, detectProvider } = require('../utils/pricing');

/**
 * Model Health Check Service
 *
 * Periodically tests each model with a minimal prompt to verify it's operational.
 * Caches results for efficiency.
 */

// Cache structure: { modelName: { status: 'healthy'|'unhealthy'|'error', error?: string, timestamp } }
let healthCache = {};

// Configuration
const HEALTH_CHECK_TIMEOUT = 30_000; // 30 seconds per model
const CACHE_TTL_MS = 5 * 60 * 1000; // Cache health checks for 5 minutes
const MINIMAL_PROMPT = 'Hello';

// Provider handlers for health checks
const PROVIDER_HANDLERS = {
  openai: callOpenAI,
  deepseek: callDeepSeek,
  gemini: callGemini,
  nvidia: callNvidia,
};

/**
 * Perform a health check on a single model.
 * Returns only if the model successfully responds within timeout.
 *
 * @param {string} model - model name
 * @returns {Promise<{status: string, error?: string, tokensUsed?: number}>}
 */
async function checkModelHealth(model) {
  try {
    const provider = detectProvider(model);

    if (!provider) {
      return { status: 'error', error: 'Unknown provider' };
    }

    const providerFn = PROVIDER_HANDLERS[provider];
    if (!providerFn) {
      return { status: 'error', error: `Provider "${provider}" not available` };
    }

    // Call with minimal prompt
    const response = await Promise.race([
      providerFn({
        model,
        messages: [{ role: 'user', content: MINIMAL_PROMPT }],
        max_tokens: 10, // Minimal response
        temperature: 0,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT)
      ),
    ]);

    return { status: 'healthy', tokensUsed: response.tokensUsed || 0 };
  } catch (err) {
    return {
      status: 'unhealthy',
      error: err.message || 'Unknown error',
    };
  }
}

/**
 * Get health status for all models (from cache if available).
 * Triggers async refresh if cache expired.
 *
 * @returns {Promise<Map<string, {status, error?, timestamp}>>}
 */
async function getHealthStatus() {
  const now = Date.now();
  const isCacheValid = Object.values(healthCache).every(
    (entry) => now - entry.timestamp < CACHE_TTL_MS
  );

  // If cache is not valid, refresh in background (non-blocking)
  if (!isCacheValid) {
    refreshHealthCheckAsync().catch((err) => console.error('[modelHealthCheck] Refresh error:', err));
  }

  return healthCache;
}

/**
 * Refresh health checks for all models (async, non-blocking).
 * This runs in the background without awaiting.
 */
async function refreshHealthCheckAsync() {
  const models = Object.keys(MODEL_PRICING);
  console.log(`[modelHealthCheck] Starting health checks for ${models.length} models...`);

  for (const model of models) {
    try {
      const result = await checkModelHealth(model);
      healthCache[model] = {
        ...result,
        timestamp: Date.now(),
      };

      if (result.status === 'healthy') {
        console.log(`[modelHealthCheck] ${model} ✓`);
      } else {
        console.warn(`[modelHealthCheck] ${model} ✗ – ${result.error}`);
      }
    } catch (err) {
      console.error(`[modelHealthCheck] ${model} exception:`, err.message);
      healthCache[model] = {
        status: 'error',
        error: err.message,
        timestamp: Date.now(),
      };
    }
  }

  console.log('[modelHealthCheck] Health checks complete');
}

/**
 * Return list of currently healthy models.
 * Falls back to all models if cache not yet populated or all failed.
 *
 * @returns {Promise<string[]>}
 */
async function getLiveModels() {
  const health = await getHealthStatus();
  const healthyModels = Object.entries(health)
    .filter(([_, result]) => result.status === 'healthy')
    .map(([model]) => model);

  // Fallback: if no models are healthy (cache empty or all failed), return all as fallback
  if (healthyModels.length === 0) {
    console.warn('[modelHealthCheck] No healthy models found; returning all models');
    return Object.keys(MODEL_PRICING);
  }

  return healthyModels;
}

/**
 * Begin periodic health checks.
 * Called once at server startup.
 */
function startHealthCheckSchedule() {
  // Initial check immediately
  refreshHealthCheckAsync();

  // Refresh every 5 minutes
  setInterval(
    () => {
      refreshHealthCheckAsync().catch((err) =>
        console.error('[modelHealthCheck] Scheduled refresh error:', err)
      );
    },
    CACHE_TTL_MS
  );

  console.log('[modelHealthCheck] Scheduled health checks started (every 5 minutes)');
}

/**
 * Force an immediate health check (useful for testing).
 */
async function forceHealthCheck() {
  return refreshHealthCheckAsync();
}

module.exports = {
  getHealthStatus,
  getLiveModels,
  startHealthCheckSchedule,
  forceHealthCheck,
};
