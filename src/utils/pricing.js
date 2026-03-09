/**
 * Pricing utility for GenAff AI Gateway
 *
 * Prices are defined in USD per 1,000 tokens (blended input+output estimate).
 * Converted to INR using a fixed exchange rate.
 *
 * Update USD_TO_INR periodically or replace with a live fetch if needed.
 */

const USD_TO_INR = 84; // 1 USD = ₹84 (update as needed)

/**
 * Model pricing map
 * Key  : model name (as sent by user)
 * Value: USD per 1,000 tokens (blended avg of input/output)
 *
 * References (as of early 2025):
 *   OpenAI  https://openai.com/pricing
 *   DeepSeek https://platform.deepseek.com/api-docs/pricing
 *   Gemini  https://ai.google.dev/pricing
 */
const MODEL_PRICING = {
  // ── OpenAI ─────────────────────────────────────────
  'gpt-4o':              0.006,   // $5 input + $15 output blended /1M ≈ $6/1K blended
  'gpt-4o-mini':         0.0003,  // very cheap
  'gpt-4-turbo':         0.015,
  'gpt-4':               0.045,
  'gpt-3.5-turbo':       0.002,

  // ── DeepSeek ───────────────────────────────────────
  'deepseek-chat':       0.0014,  // $0.14/1M tokens
  'deepseek-coder':      0.0014,
  'deepseek-reasoner':   0.0055,  // deepseek-r1

  // ── Gemini ─────────────────────────────────────────
  'gemini-1.5-flash':    0.000075, // $0.075/1M tokens
  'gemini-1.5-flash-8b': 0.0000375,
  'gemini-1.5-pro':      0.00175,
  'gemini-2.0-flash':    0.0001,
  'gemini-2.0-flash-lite': 0.000075,
  'gemini-2.5-pro':      0.00175,
};

/**
 * Fallback pricing for unknown models (conservative estimate)
 */
const FALLBACK_USD_PER_1K = 0.01;

/**
 * Calculate cost in INR for a given number of tokens
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
 * Detect which provider handles the given model
 * @param {string} model
 * @returns {'openai'|'deepseek'|'gemini'|null}
 */
function detectProvider(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
  if (m.startsWith('deepseek')) return 'deepseek';
  if (m.startsWith('gemini')) return 'gemini';
  return null;
}

module.exports = { calculateCostInr, detectProvider, MODEL_PRICING };
