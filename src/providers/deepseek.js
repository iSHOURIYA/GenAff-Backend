const axios = require('axios');

// DeepSeek uses an OpenAI-compatible API
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * NOTE on MAAS models (deepseek-r1-0528-maas, deepseek-v3.2-maas, etc.):
 * These are hosted on Google Vertex AI and require Google Cloud service-account
 * auth — they CANNOT be called with a plain DEEPSEEK_API_KEY.
 * If you want Vertex AI MAAS support, add a separate provider file.
 * For now, calling a *-maas model will return a 502 with a clear error.
 */
const MAAS_MODELS = ['deepseek-r1-0528-maas', 'deepseek-v3.2-maas', 'deepseek-v3.1-maas'];

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
  if (MAAS_MODELS.includes(model)) {
    const err = new Error(
      `Model "${model}" is a Vertex AI MAAS model and requires Google Cloud credentials, ` +
      'not a DeepSeek API key. Use "deepseek-chat" or "deepseek-reasoner" for the direct API.'
    );
    err.status = 400;
    throw err;
  }

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
