// GenAff SDK Examples — Node.js (axios)
// Install: npm install axios
//
// All monetary amounts in paisa (100 paisa = ₹1)

import axios from 'axios';

const BASE_URL = 'https://genaff-api.shauryacodes.xyz';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Authenticate — get JWT
// ─────────────────────────────────────────────────────────────────────────────
async function login(email, password) {
  const res = await axios.post(`${BASE_URL}/auth/login`, { email, password });
  return res.data.access_token; // "eyJhbGci..."
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Generate an API key (requires JWT)
// ─────────────────────────────────────────────────────────────────────────────
async function generateApiKey(jwt, name = 'my-app-key') {
  const res = await axios.post(
    `${BASE_URL}/keys`,
    { name },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );

  const { id, key, plain_key_preview } = res.data;
  console.log(`Key created: ${plain_key_preview} (ID: ${id})`);
  console.log(`SAVE THIS — plaintext shown only once: ${key}`);
  return key; // "sk_a1b2c3d4e5f6..."
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Make a proxied chat request (uses API key, not JWT)
// ─────────────────────────────────────────────────────────────────────────────
async function chatCompletion(apiKey, messages, options = {}) {
  const res = await axios.post(
    `${BASE_URL}/v1/chat/completions`,
    {
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 500,
      preferred_provider: options.provider, // optional: "openai" | "deepseek" | "gemini"
    },
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  // Rate limit info
  console.log('Minute remaining:', res.headers['x-ratelimit-minute-remaining']);
  console.log('Day remaining:', res.headers['x-ratelimit-day-remaining']);

  return res.data.choices[0].message.content;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Handle 402 Payment Required — auto top-up flow
// ─────────────────────────────────────────────────────────────────────────────
async function chatWithAutoTopUp(jwt, apiKey, messages) {
  try {
    return await chatCompletion(apiKey, messages);
  } catch (err) {
    if (err.response?.status === 402) {
      const { required_inr_paisa, current_balance_inr_paisa } = err.response.data;
      console.log(`Wallet low: ${current_balance_inr_paisa}p available, ${required_inr_paisa}p needed`);

      // Top up with 10× the required amount, minimum ₹50
      const topUpAmount = Math.max(required_inr_paisa * 10, 5000);
      const topUp = await initiateTopUp(jwt, topUpAmount, 'manual');
      console.log(`Top-up initiated: ₹${topUpAmount / 100} (tx: ${topUp.transaction_id})`);

      // In production: wait for webhook. In dev: use admin mock approve:
      await mockApproveTopUp(jwt, topUp.transaction_id);
      console.log('Top-up approved. Retrying request...');

      // Retry
      return await chatCompletion(apiKey, messages);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Initiate a top-up
// ─────────────────────────────────────────────────────────────────────────────
async function initiateTopUp(jwt, amountPaisa, method = 'razorpay') {
  const res = await axios.post(
    `${BASE_URL}/wallet/topup/initiate`,
    { amount_inr_paisa: amountPaisa, method },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  return res.data;
  // { transaction_id, razorpay_order_id, amount_inr_paisa, currency, status }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. [DEV ONLY] Mock-approve a pending top-up
// ─────────────────────────────────────────────────────────────────────────────
async function mockApproveTopUp(adminJwt, transactionId) {
  const res = await axios.post(
    `${BASE_URL}/admin/topup-mock`,
    { transaction_id: transactionId },
    { headers: { Authorization: `Bearer ${adminJwt}` } }
  );
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Get usage history
// ─────────────────────────────────────────────────────────────────────────────
async function getUsage(jwt, from, to) {
  const params = {};
  if (from) params.from = from; // "2026-01-01"
  if (to) params.to = to;       // "2026-01-31"

  const res = await axios.get(`${BASE_URL}/billing/usage`, {
    headers: { Authorization: `Bearer ${jwt}` },
    params,
  });

  return res.data; // array of usage records
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const jwt = await login('user@example.com', 'securepass123');
  const apiKey = await generateApiKey(jwt, 'demo-key');

  const reply = await chatWithAutoTopUp(jwt, apiKey, [
    { role: 'user', content: 'What is the capital of France?' }
  ]);
  console.log('AI reply:', reply);

  const usage = await getUsage(jwt, '2026-01-01');
  console.log(`Total records: ${usage.length}`);
}

main().catch(console.error);
