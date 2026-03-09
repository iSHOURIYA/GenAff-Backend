/**
 * Pricing utility for GenAff AI Gateway
 *
 * Prices are defined in USD per 1,000 tokens (blended input+output estimate).
 * Converted to INR using a fixed exchange rate.
 *
 * Last updated: March 2026
 * Update USD_TO_INR periodically or replace with a live fetch if needed.
 */

const USD_TO_INR = 84; // 1 USD = ₹84 (update as needed)

/**
 * Model pricing map
 * Key  : exact model string sent by user
 * Value: USD per 1,000 tokens (blended avg of input+output)
 *
 * References:
 *   OpenAI   https://openai.com/pricing
 *   DeepSeek https://platform.deepseek.com/api-docs/pricing
 *   Gemini   https://ai.google.dev/pricing
 */
const MODEL_PRICING = {
  // ── OpenAI (March 2026) ────────────────────────────────────────────────
  'gpt-5.4':        0.08,    // top-tier, professional tasks
  'gpt-5':          0.05,    // advanced reasoning + instructions
  'gpt-4o':         0.006,   // multimodal general-purpose
  'gpt-4o-mini':    0.0003,
  'gpt-4-turbo':    0.015,
  'gpt-4':          0.045,
  'gpt-3.5-turbo':  0.002,
  // o-series reasoning models
  'o1':             0.018,
  'o1-mini':        0.004,
  'o3':             0.06,
  'o3-mini':        0.008,
  'o4-mini':        0.004,

  // ── DeepSeek (direct API – https://api.deepseek.com) ──────────────────
  'deepseek-chat':      0.0014,   // DeepSeek V3, flagship chat
  'deepseek-reasoner':  0.0055,   // DeepSeek R1
  'deepseek-coder':     0.0014,
  // MAAS variants (Vertex AI hosted – requires Google Cloud auth,
  // NOT the standard DEEPSEEK_API_KEY. Priced same as direct for billing.)
  'deepseek-r1-0528-maas':  0.0055,
  'deepseek-v3.2-maas':     0.0014,
  'deepseek-v3.1-maas':     0.0014,

  // ── Gemini (March 2026) ────────────────────────────────────────────────
  // 1.5 series – deprecated Feb 2025, kept for billing fallback only
  'gemini-1.5-flash':       0.000075,
  'gemini-1.5-flash-8b':    0.0000375,
  'gemini-1.5-pro':         0.00175,
  // 2.0 series – stable recommended
  'gemini-2.0-flash':       0.0001,
  'gemini-2.0-flash-exp':   0.0001,   // experimental channel of 2.0 flash
  'gemini-2.0-flash-lite':  0.000075,
  'gemini-2.0-pro-exp':     0.00175,  // experimental pro
  // 2.5 series – latest
  'gemini-2.5-flash':       0.0001,
  'gemini-2.5-flash-exp':   0.0001,
  'gemini-2.5-pro':         0.00175,
  'gemini-2.5-pro-exp':     0.00175,
};

/**
 * Fallback pricing for unknown/new models (conservative estimate).
 * Charged at a safe rate so we never lose money on unrecognised models.
 */
const FALLBACK_USD_PER_1K = 0.02;

/**
 * Calculate cost in INR for a given number of tokens.
 * @param {string} model  - model name
 * @param {number} tokens - total tokens used (prompt + completion)
 * @returns {number} cost in INR (rounded to 6 decimal places)
 */
function calculateCostInr(model, tokens) {
  const priceUsdPer1K = MODEL_PRICING[model] ?? FALLBACK_USD_PER_1K;
  const costUsd = (tokens / 1000) * priceUsdPer1K;
  const costInr = costUsd * USD_TO_INR;
  return parseFloat(costInr.toFixed(6));
}

/**
 * Detect which provider handles a given model string.
 * @param {string} model
 * @returns {'openai'|'deepseek'|'gemini'|null}
 */
function detectProvider(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  // OpenAI: gpt-*, o1, o1-mini, o3, o3-mini, o4-mini ...
  if (m.startsWith('gpt-') || /^o\d/.test(m)) return 'openai';
  // DeepSeek: direct API and MAAS variants
  if (m.startsWith('deepseek')) return 'deepseek';
  // Gemini: all variants including -exp suffixes
  if (m.startsWith('gemini')) return 'gemini';
  return null;
}

/**
 * Return a list of all supported model strings (for documentation / validation).
 * @returns {string[]}
 */
function listSupportedModels() {
  return Object.keys(MODEL_PRICING);
}

module.exports = { calculateCostInr, detectProvider, listSupportedModels, MODEL_PRICING };
