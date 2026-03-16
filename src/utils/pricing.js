/**
 * Pricing utility for GenAff AI Gateway
 *
 * Prices are defined in USD per 1,000 tokens.
 * Blended ratio used: 30% input tokens / 70% output tokens (realistic for chat).
 * GenAff markup: +10% over provider cost.
 * Formula: ((0.3 × input_per_1K) + (0.7 × output_per_1K)) × 1.10
 *
 * Last updated: March 2026
 * Update USD_TO_INR periodically or replace with a live fetch if needed.
 */

const USD_TO_INR = 86; // 1 USD = ₹86 (updated March 2026)

/**
 * Model pricing map
 * Key  : exact model string sent by user
 * Value: USD per 1,000 tokens (blended 30/70 input/output + 10% GenAff markup)
 *
 * References:
 *   OpenAI   https://openai.com/pricing
 *   DeepSeek https://platform.deepseek.com/api-docs/pricing
 *   Gemini   https://ai.google.dev/pricing
 */
const MODEL_PRICING = {
  // ── OpenAI ────────────────────────────────────────────────────────────
  // provider: gpt-5.1 $2.50 in / $15.00 out per 1M → blended $0.01125 + 10%
  'gpt-5.1':        0.01238,
  // provider: gpt-5.4 $0.08 blended (existing) + 10%
  'gpt-5.4':        0.08800,
  // provider: gpt-5 $0.05 blended (existing) + 10%
  'gpt-5':          0.05500,
  // provider: gpt-4o $0.006 blended + 10%
  'gpt-4o':         0.00660,
  // provider: gpt-4o-mini $0.0003 blended + 10%
  'gpt-4o-mini':    0.00033,
  // provider: gpt-4-turbo $0.015 blended + 10%
  'gpt-4-turbo':    0.01650,
  // provider: gpt-4 $0.045 blended + 10%
  'gpt-4':          0.04950,
  // provider: gpt-3.5-turbo $0.002 blended + 10%
  'gpt-3.5-turbo':  0.00220,
  // o-series reasoning models
  'o1':             0.01980,
  'o1-mini':        0.00440,
  'o3':             0.06600,
  'o3-mini':        0.00880,
  'o4-mini':        0.00440,

  // ── DeepSeek (direct API – https://api.deepseek.com) ──────────────────
  // provider: deepseek-chat V3.2 $0.28 in / $0.42 out per 1M → blended $0.000378 + 10%
  'deepseek-chat':      0.000416,
  // provider: deepseek-reasoner $0.0055 blended + 10%
  'deepseek-reasoner':  0.00605,
  // provider: deepseek-coder $0.0014 blended + 10%
  'deepseek-coder':     0.00154,
  // MAAS variants (Vertex AI hosted – requires Google Cloud auth,
  // NOT the standard DEEPSEEK_API_KEY. Priced same as direct for billing.)
  'deepseek-r1-0528-maas':  0.00605,
  'deepseek-v3.2-maas':     0.000416,
  'deepseek-v3.1-maas':     0.00154,

  // ── Gemini 2.5+ only (older models removed – no longer relevant) ───────
  // provider: gemini-3.1-pro-preview $2.00 in / $12.00 out per 1M → blended $0.009 + 10%
  'gemini-3.1-pro-preview': 0.00990,
  // provider: gemini-2.5-pro $0.00175 blended + 10%
  'gemini-2.5-pro':         0.001925,
  'gemini-2.5-pro-exp':     0.001925,
  // provider: gemini-2.5-flash $0.0001 blended + 10%
  'gemini-2.5-flash':       0.000110,
  'gemini-2.5-flash-exp':   0.000110,
};

/**
 * Fallback pricing for unknown/new models (conservative estimate + 10% markup).
 * Charged at a safe rate so we never lose money on unrecognised models.
 */
const FALLBACK_USD_PER_1K = 0.022;

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
