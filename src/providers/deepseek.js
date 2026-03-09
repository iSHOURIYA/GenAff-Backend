const axios = require('axios');

// DeepSeek uses an OpenAI-compatible API
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

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
