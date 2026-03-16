const axios = require('axios');

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Internal mapping: clean user-facing alias → NVIDIA NIM internal model ID.
 * This mapping is NEVER exposed to users — the source provider is not disclosed.
 *
 * Chosen models: best open-weight models across reasoning, coding, and chat tiers.
 */
const NVIDIA_MODEL_MAP = {
  // ── Meta Llama 4 (flagship multimodal MoE) ───────────────────────────
  'llama-4-maverick':    'meta/llama-4-maverick-17b-128e-instruct',  // 128 experts, vision+text
  'llama-4-scout':       'meta/llama-4-scout-17b-16e-instruct',      // faster, 16 expert variant

  // ── Meta Llama 3.x (proven workhorse family) ─────────────────────────
  'llama-3.3-70b':       'meta/llama-3.3-70b-instruct',              // best open 70B
  'llama-3.1-405b':      'meta/llama-3.1-405b-instruct',             // largest Llama 3.1

  // ── Nemotron (NVIDIA's flagship open model) ──────────────────────────
  'nemotron-ultra-253b': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',  // NVIDIA's best, 253B

  // ── Reasoning models ─────────────────────────────────────────────────
  'qwq-32b':             'qwen/qwq-32b',                             // Qwen reasoning, DeepSeek-R1 class

  // ── Code models ──────────────────────────────────────────────────────
  'qwen-coder-32b':      'qwen/qwen2.5-coder-32b-instruct',          // top open code model

  // ── Chat / instruction models ─────────────────────────────────────────
  'mistral-large-2':     'mistralai/mistral-large-2-instruct',       // Mistral's strongest
  'phi-4-mini':          'microsoft/phi-4-mini-instruct',            // ultra-fast budget model
  'kimi-k2':             'moonshotai/kimi-k2-instruct',              // Moonshot strong MoE
};

/**
 * Forward a chat-completion request to the cloud inference backend.
 *
 * @param {object} params
 * @param {string} params.model        - clean user-facing alias (e.g. "llama-4-maverick")
 * @param {Array}  params.messages
 * @param {number} [params.max_tokens]
 * @param {number} [params.temperature]
 * @returns {Promise<{data: object, tokensUsed: number}>}
 */
async function callNvidia({ model, messages, max_tokens, temperature }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not configured');

  const internalModel = NVIDIA_MODEL_MAP[model];
  if (!internalModel) throw new Error(`Unknown model alias: "${model}"`);

  const payload = { model: internalModel, messages };
  if (max_tokens) payload.max_tokens = max_tokens;
  if (temperature !== undefined) payload.temperature = temperature;

  const response = await axios.post(NVIDIA_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 120_000,
  });

  const tokensUsed =
    response.data?.usage?.total_tokens ??
    (response.data?.usage?.prompt_tokens ?? 0) +
      (response.data?.usage?.completion_tokens ?? 0);

  return {
    data: response.data,
    tokensUsed,
  };
}

module.exports = { callNvidia, NVIDIA_MODEL_MAP };
