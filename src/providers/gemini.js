const axios = require('axios');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Convert OpenAI-style messages to Gemini's `contents` format.
 * Gemini roles: "user" | "model"
 * System messages are prepended as a user message.
 */
function convertMessagesToGemini(messages) {
  const contents = [];
  let systemText = '';

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Gemini doesn't have a system role – prepend to first user message
      systemText += msg.content + '\n';
      continue;
    }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    contents.push({
      role,
      parts: [{ text: msg.content }],
    });
  }

  // Prepend system prompt to the first user message if present
  if (systemText && contents.length > 0 && contents[0].role === 'user') {
    contents[0].parts[0].text = systemText + contents[0].parts[0].text;
  } else if (systemText) {
    contents.unshift({ role: 'user', parts: [{ text: systemText }] });
  }

  return contents;
}

/**
 * Wrap a Gemini response into an OpenAI-compatible response shape
 * so the rest of the codebase handles it uniformly.
 */
function normalizeGeminiResponse(geminiData, model) {
  const candidate = geminiData.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? '';

  return {
    id: `chatcmpl-gemini-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: candidate?.finishReason?.toLowerCase() ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: geminiData.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: geminiData.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: geminiData.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

/**
 * Forward a chat-completion request to Google Gemini.
 *
 * @param {object} params
 * @param {string} params.model     - e.g. "gemini-1.5-flash"
 * @param {Array}  params.messages  - OpenAI-style messages
 * @param {number} [params.max_tokens]
 * @param {number} [params.temperature]
 * @returns {Promise<{data: object, tokensUsed: number}>}
 */
async function callGemini({ model, messages, max_tokens, temperature }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const contents = convertMessagesToGemini(messages);

  const payload = { contents };

  if (max_tokens || temperature !== undefined) {
    payload.generationConfig = {};
    if (max_tokens) payload.generationConfig.maxOutputTokens = max_tokens;
    if (temperature !== undefined) payload.generationConfig.temperature = temperature;
  }

  const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`;

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120_000,
  });

  const normalized = normalizeGeminiResponse(response.data, model);
  const tokensUsed = normalized.usage.total_tokens;

  return {
    data: normalized,
    tokensUsed,
  };
}

module.exports = { callGemini };
