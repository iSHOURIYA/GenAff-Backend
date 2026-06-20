const axios = require('axios');

// DeepSeek uses an OpenAI-compatible API
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * NOTE on MAAS models (deepseek-r1-0528-maas, deepseek-v3.2-maas, etc.):
 * These are hosted on Google Vertex AI and require Google Cloud service-account
 * auth — they CANNOT be called with a plain DEEPSEEK_API_KEY.
 * MAAS models have been removed from the pricing map to prevent confusion.
 * If you want Vertex AI MAAS support, add a separate provider file.
 */

/**
 * Forward a chat-completion request to DeepSeek.
 *
 * @param {object} params
 * @param {string} params.model        - e.g. "deepseek-chat", "deepseek-reasoner"
 * @param {Array}  params.messages
 * @param {number} [params.max_tokens]
 * @param {number} [params.temperature]
 * @returns {Promise<{data: object, tokensUsed: number}>}
 */
async function callDeepSeek({ model, messages, max_tokens, temperature }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured');

  const payload = { model, messages };
  if (max_tokens) payload.max_tokens = max_tokens;
  if (temperature !== undefined) payload.temperature = temperature;

  const response = await axios.post(DEEPSEEK_API_URL, payload, {
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

module.exports = { callDeepSeek };
