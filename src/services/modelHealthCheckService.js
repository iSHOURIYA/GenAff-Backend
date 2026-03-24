const { callOpenAI } = require('../providers/openai');
const { callDeepSeek } = require('../providers/deepseek');
const { callGemini } = require('../providers/gemini');
const { callNvidia } = require('../providers/nvidia');
const { MODEL_PRICING, detectProvider } = require('../utils/pricing');

/**
 * Model Health Check Service (low-cost strategy)
 *
 * Strategy:
 * 1) Active probes: only provider canaries + a small sampled set.
 * 2) Passive signals: real user traffic updates health state.
 * 3) Backoff: unhealthy models are rechecked less frequently.
 * 4) Single-flight refresh lock: prevents overlapping probe storms.
 */

let healthCache = {};
let refreshInProgress = false;
let lastRefreshStartedAt = 0;

const HEALTH_CHECK_TIMEOUT = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '12000', 10);
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || String(30 * 60 * 1000), 10);
const HEALTH_CHECK_STALE_AFTER_MS = parseInt(process.env.HEALTH_CHECK_STALE_AFTER_MS || String(2 * HEALTH_CHECK_INTERVAL_MS), 10);
const HEALTH_CHECK_MIN_GAP_MS = parseInt(process.env.HEALTH_CHECK_MIN_GAP_MS || '60000', 10);
const HEALTH_CHECK_BASE_BACKOFF_MS = parseInt(process.env.HEALTH_CHECK_BASE_BACKOFF_MS || String(15 * 60 * 1000), 10);
const HEALTH_CHECK_MAX_BACKOFF_MS = parseInt(process.env.HEALTH_CHECK_MAX_BACKOFF_MS || String(4 * 60 * 60 * 1000), 10);
const HEALTH_CHECK_MAX_PROBES_PER_CYCLE = parseInt(process.env.HEALTH_CHECK_MAX_PROBES_PER_CYCLE || '6', 10);
const MINIMAL_PROMPT = process.env.HEALTH_CHECK_PROMPT || 'ping';

const PROVIDER_HANDLERS = {
  openai: callOpenAI,
  deepseek: callDeepSeek,
  gemini: callGemini,
  nvidia: callNvidia,
};

function getAllModels() {
  return Object.keys(MODEL_PRICING);
}

function getModelsByProvider() {
  const grouped = {
    openai: [],
    deepseek: [],
    gemini: [],
    nvidia: [],
  };

  for (const model of getAllModels()) {
    const provider = detectProvider(model);
    if (provider && grouped[provider]) {
      grouped[provider].push(model);
    }
  }

  return grouped;
}

function getProviderCanaryModels() {
  const grouped = getModelsByProvider();
  return Object.values(grouped)
    .map((models) => models[0])
    .filter(Boolean);
}

function initCache() {
  const now = Date.now();
  for (const model of getAllModels()) {
    if (!healthCache[model]) {
      healthCache[model] = {
        status: 'unknown',
        error: null,
        timestamp: 0,
        source: 'init',
        failCount: 0,
        nextCheckAt: now,
      };
    }
  }
}

function updateModelState(model, patch) {
  const existing = healthCache[model] || {
    status: 'unknown',
    error: null,
    timestamp: 0,
    source: 'init',
    failCount: 0,
    nextCheckAt: 0,
  };

  healthCache[model] = {
    ...existing,
    ...patch,
  };
}

function computeBackoffMs(failCount) {
  const step = Math.max(0, failCount - 1);
  return Math.min(HEALTH_CHECK_BASE_BACKOFF_MS * Math.pow(2, step), HEALTH_CHECK_MAX_BACKOFF_MS);
}

async function checkModelHealth(model) {
  try {
    const provider = detectProvider(model);

    if (!provider) {
      return { status: 'unhealthy', error: 'Unknown provider' };
    }

    const providerFn = PROVIDER_HANDLERS[provider];
    if (!providerFn) {
      return { status: 'unhealthy', error: `Provider "${provider}" not available` };
    }

    await Promise.race([
      providerFn({
        model,
        messages: [{ role: 'user', content: MINIMAL_PROMPT }],
        max_tokens: 4,
        temperature: 0,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT)),
    ]);

    return { status: 'healthy', error: null };
  } catch (err) {
    return {
      status: 'unhealthy',
      error: err.message || 'Unknown error',
    };
  }
}

async function getHealthStatus() {
  initCache();

  const now = Date.now();
  const isCacheFresh = Object.values(healthCache).every(
    (entry) => entry.timestamp > 0 && now - entry.timestamp < HEALTH_CHECK_STALE_AFTER_MS
  );

  if (!isCacheFresh) {
    refreshHealthCheckAsync().catch((err) => console.error('[modelHealthCheck] Refresh error:', err));
  }

  return healthCache;
}

async function refreshHealthCheckAsync() {
  initCache();

  const now = Date.now();
  if (refreshInProgress) {
    return;
  }

  if (now - lastRefreshStartedAt < HEALTH_CHECK_MIN_GAP_MS) {
    return;
  }

  refreshInProgress = true;
  lastRefreshStartedAt = now;

  try {
    const canaryModels = getProviderCanaryModels();
    const additionalModels = getAllModels()
      .filter((m) => !canaryModels.includes(m))
      .filter((m) => now >= (healthCache[m]?.nextCheckAt || 0))
      .sort((a, b) => (healthCache[a]?.timestamp || 0) - (healthCache[b]?.timestamp || 0));

    const sampledCount = Math.max(0, HEALTH_CHECK_MAX_PROBES_PER_CYCLE - canaryModels.length);
    const probeTargets = [...canaryModels, ...additionalModels.slice(0, sampledCount)];

    console.log(`[modelHealthCheck] Active probing ${probeTargets.length} models (canary + sampled)`);

    const providerCanaryResults = {};

    for (const model of probeTargets) {
      const provider = detectProvider(model);
      if (!provider) continue;

      const result = await checkModelHealth(model);

      if (result.status === 'healthy') {
        updateModelState(model, {
          status: 'healthy',
          error: null,
          timestamp: Date.now(),
          source: 'active-probe',
          failCount: 0,
          nextCheckAt: Date.now() + HEALTH_CHECK_INTERVAL_MS,
        });
      } else {
        const failCount = (healthCache[model]?.failCount || 0) + 1;
        updateModelState(model, {
          status: 'unhealthy',
          error: result.error || 'Unknown error',
          timestamp: Date.now(),
          source: 'active-probe',
          failCount,
          nextCheckAt: Date.now() + computeBackoffMs(failCount),
        });
      }

      if (canaryModels.includes(model)) {
        providerCanaryResults[provider] = result.status;
      }
    }

    // If a provider canary is healthy, mark sibling models healthy by inheritance
    // unless that model is currently under failure backoff.
    const grouped = getModelsByProvider();
    for (const [provider, models] of Object.entries(grouped)) {
      if (providerCanaryResults[provider] !== 'healthy') continue;

      for (const model of models) {
        if (canaryModels.includes(model)) continue;

        const entry = healthCache[model];
        if (entry?.status === 'unhealthy' && Date.now() < (entry.nextCheckAt || 0)) {
          continue;
        }

        updateModelState(model, {
          status: 'healthy',
          error: null,
          timestamp: Date.now(),
          source: 'provider-canary',
          failCount: 0,
          nextCheckAt: Date.now() + HEALTH_CHECK_INTERVAL_MS,
        });
      }
    }
  } finally {
    refreshInProgress = false;
  }
}

async function getLiveModels() {
  initCache();

  const health = await getHealthStatus();
  const healthyModels = Object.entries(health)
    .filter(([_, result]) => result.status === 'healthy')
    .map(([model]) => model);

  if (healthyModels.length === 0) {
    console.warn('[modelHealthCheck] No healthy models found; returning all models');
    return getAllModels();
  }

  return healthyModels;
}

function startHealthCheckSchedule() {
  refreshHealthCheckAsync();

  setInterval(() => {
    refreshHealthCheckAsync().catch((err) =>
      console.error('[modelHealthCheck] Scheduled refresh error:', err)
    );
  }, HEALTH_CHECK_INTERVAL_MS);

  console.log(`[modelHealthCheck] Scheduled health checks started (every ${Math.round(HEALTH_CHECK_INTERVAL_MS / 60000)} minutes)`);
}

async function forceHealthCheck() {
  return refreshHealthCheckAsync();
}

function recordModelSuccess(model) {
  if (!model || !MODEL_PRICING[model]) return;
  initCache();

  updateModelState(model, {
    status: 'healthy',
    error: null,
    timestamp: Date.now(),
    source: 'passive',
    failCount: 0,
    nextCheckAt: Date.now() + HEALTH_CHECK_INTERVAL_MS,
  });
}

function recordModelFailure(model, errorMessage) {
  if (!model || !MODEL_PRICING[model]) return;
  initCache();

  const failCount = (healthCache[model]?.failCount || 0) + 1;
  updateModelState(model, {
    status: 'unhealthy',
    error: errorMessage || 'Provider request failed',
    timestamp: Date.now(),
    source: 'passive',
    failCount,
    nextCheckAt: Date.now() + computeBackoffMs(failCount),
  });
}

module.exports = {
  getHealthStatus,
  getLiveModels,
  startHealthCheckSchedule,
  forceHealthCheck,
  recordModelSuccess,
  recordModelFailure,
};
