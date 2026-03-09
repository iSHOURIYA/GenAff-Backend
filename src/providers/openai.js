const axios = require('axios');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Forward a chat-completion request to OpenAI.
 *
 * @param {object} params
 * @param {string} params.model        - e.g. "gpt-4o"
 * @param {Array}  params.messages     - chat messages array
 * @param {number} [params.max_tokens] - optional
 * @param {number} [params.temperature]
 * @returns {Promise<{data: object, tokensUsed: number}>}
 */
async function callOpenAI({ model, messages, max_tokens, temperature }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const payload = { model, messages };
  if (max_tokens) payload.max_tokens = max_tokens;
  if (temperature !== undefined) payload.temperature = temperature;

  const response = await axios.post(OPENAI_API_URL, payload, {
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

module.exports = { callOpenAI };
