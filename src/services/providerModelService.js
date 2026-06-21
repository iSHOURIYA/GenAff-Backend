const axios = require('axios');

/**
 * Provider Model Discovery Service
 *
 * Dynamically fetches available models from each provider's API,
 * caches results for 1 hour, and provides intersection with our pricing map.
 *
 * This eliminates the need to manually maintain a MODEL_PRICING map
 * that goes stale when providers rename, retire, or add models.
 */

// ── Cache ────────────────────────────────────────────────────────────
let cache = {
  models: null,
  timestamp: 0,
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Admin override — bypasses provider discovery entirely
const OVERRIDE = (process.env.LIVE_MODELS_OVERRIDE || '').split(',').map((m) => m.trim()).filter(Boolean);

// ── Provider Discovery Functions ─────────────────────────────────────

async function fetchOpenAIModels() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  try {
    const { data } = await axios.get('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });

    // Filter chat/completion models only
    return (data.data || [])
      .filter((m) => m.id?.startsWith('gpt-') || /^o\d/.test(m.id))
      .map((m) => m.id);
  } catch (err) {
    console.error('[providerModelService] OpenAI discovery failed:', err.message);
    return [];
  }
}

async function fetchDeepSeekModels() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return [];

  try {
    const { data } = await axios.get('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });

    return (data.data || []).map((m) => m.id);
  } catch (err) {
    console.error('[providerModelService] DeepSeek discovery failed:', err.message);
    return [];
  }
}

async function fetchGeminiModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  try {
    const { data } = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { timeout: 10000 }
    );

    return (data.models || [])
      .map((m) => m.name?.replace('models/', ''))
      .filter(Boolean);
  } catch (err) {
    console.error('[providerModelService] Gemini discovery failed:', err.message);
    return [];
  }
}

async function fetchNvidiaModels() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return [];

  try {
    const { data } = await axios.get('https://integrate.api.nvidia.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });

    // Map internal IDs back to our user-friendly aliases
    const internalIds = new Set((data.data || []).map((m) => m.id));
    const { NVIDIA_MODEL_MAP } = require('./nvidia');

    return Object.entries(NVIDIA_MODEL_MAP)
      .filter(([, internalId]) => internalIds.has(internalId))
      .map(([alias]) => alias);
  } catch (err) {
    console.error('[providerModelService] NVIDIA discovery failed:', err.message);
    return [];
  }
}

// ── Pricing (unchanged, but we intersect with it) ────────────────────

const { MODEL_PRICING, calculateCostInr } = require('../utils/pricing');

// ── Core Discovery ───────────────────────────────────────────────────

async function discoverLiveModels(force = false) {
  const now = Date.now();

  if (!force && cache.models && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.models;
  }

  // Admin override: bypass discovery entirely
  if (OVERRIDE.length > 0) {
    const overrideMap = new Map();
    for (const modelId of OVERRIDE) {
      if (MODEL_PRICING[modelId]) {
        overrideMap.set(modelId, {
          id: modelId,
          object: 'model',
          owned_by: 'genaff',
          price_per_1k_inr: parseFloat((MODEL_PRICING[modelId] * 86).toFixed(4)),
        });
      }
    }
    console.log(`[providerModelService] Using LIVE_MODELS_OVERRIDE: ${OVERRIDE.length} models`);
    cache = { models: overrideMap, timestamp: now };
    return overrideMap;
  }

  console.log('[providerModelService] Discovering live models from providers...');

  const [openaiModels, deepseekModels, geminiModels, nvidiaModels] = await Promise.allSettled([
    fetchOpenAIModels(),
    fetchDeepSeekModels(),
    fetchGeminiModels(),
    fetchNvidiaModels(),
  ]);

  const allLiveIds = [
    ...(openaiModels.status === 'fulfilled' ? openaiModels.value : []),
    ...(deepseekModels.status === 'fulfilled' ? deepseekModels.value : []),
    ...(geminiModels.status === 'fulfilled' ? geminiModels.value : []),
    ...(nvidiaModels.status === 'fulfilled' ? nvidiaModels.value : []),
  ];

  // Intersection: live provider models × our pricing catalog
  const intersection = new Map();
  for (const modelId of allLiveIds) {
    if (MODEL_PRICING[modelId]) {
      intersection.set(modelId, {
        id: modelId,
        object: 'model',
        owned_by: 'genaff',
        price_per_1k_inr: parseFloat((MODEL_PRICING[modelId] * 86).toFixed(4)),
      });
    }
  }

  cache = {
    models: intersection,
    timestamp: now,
  };

  console.log(
    `[providerModelService] Found ${intersection.size} live models ` +
      `(OpenAI: ${openaiModels.value?.length ?? 0}, ` +
      `DeepSeek: ${deepseekModels.value?.length ?? 0}, ` +
      `Gemini: ${geminiModels.value?.length ?? 0}, ` +
      `NVIDIA: ${nvidiaModels.value?.length ?? 0})`
  );

  return intersection;
}

/**
 * Return live models as an array (for /v1/models)
 */
async function getLiveModelCatalog() {
  const models = await discoverLiveModels();
  return Array.from(models.values());
}

/**
 * Check if a specific model is currently live.
 */
async function isModelLive(modelId) {
  const models = await discoverLiveModels();
  return models.has(modelId);
}

/**
 * Force a refresh of the cache.
 */
async function refreshLiveModels() {
  return discoverLiveModels(true);
}

/**
 * Get raw provider lists (for debugging/admin)
 */
async function getProviderModelLists() {
  const [openai, deepseek, gemini, nvidia] = await Promise.allSettled([
    fetchOpenAIModels(),
    fetchDeepSeekModels(),
    fetchGeminiModels(),
    fetchNvidiaModels(),
  ]);

  return {
    openai: openai.status === 'fulfilled' ? openai.value : { error: openai.reason?.message },
    deepseek: deepseek.status === 'fulfilled' ? deepseek.value : { error: deepseek.reason?.message },
    gemini: gemini.status === 'fulfilled' ? gemini.value : { error: gemini.reason?.message },
    nvidia: nvidia.status === 'fulfilled' ? nvidia.value : { error: nvidia.reason?.message },
  };
}

module.exports = {
  getLiveModelCatalog,
  isModelLive,
  refreshLiveModels,
  getProviderModelLists,
};
