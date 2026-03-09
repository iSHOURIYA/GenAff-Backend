const { callOpenAI } = require('../providers/openai');
const { callDeepSeek } = require('../providers/deepseek');
const { callGemini } = require('../providers/gemini');
const { calculateCostInr, detectProvider } = require('../utils/pricing');
const { deductBalance } = require('../services/walletService');
const { logUsage } = require('../services/usageService');

const PROVIDER_HANDLERS = {
  openai: callOpenAI,
  deepseek: callDeepSeek,
  gemini: callGemini,
};

/**
 * POST /v1/chat/completions
 *
 * Main AI proxy endpoint. The user authenticates with their GenAff API key.
 * This middleware chain runs BEFORE this controller:
 *   1. apiKeyMiddleware  – validates key, attaches req.apiKey and req.apiKeyUser
 *   2. proxyRateLimiter  – 20 req/min per key
 *
 * Flow:
 *   1. Validate request body
 *   2. Detect provider from model name
 *   3. Check wallet balance (or free_units for new users)
 *   4. Forward request to provider
 *   5. Calculate cost
 *   6. Deduct from wallet
 *   7. Log usage
 *   8. Return response
 */
async function chatCompletions(req, res) {
  const user = req.apiKeyUser;
  const apiKey = req.apiKey;

  try {
    const { model, messages, max_tokens, temperature } = req.body;

    // ── Validate request ─────────────────────────────────────────
    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: '"model" is required' });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: '"messages" array is required' });
    }

    // ── Detect provider ──────────────────────────────────────────
    const provider = detectProvider(model);
    if (!provider) {
      return res.status(400).json({
        error: `Unsupported model: "${model}". Use a gpt-*, deepseek-*, or gemini-* model.`,
      });
    }

    const providerFn = PROVIDER_HANDLERS[provider];
    if (!providerFn) {
      return res.status(400).json({ error: `Provider "${provider}" is not configured` });
    }

    // ── Check balance ────────────────────────────────────────────
    const walletBalance = parseFloat(user.wallet?.balance_inr ?? 0);
    const freeUnits = user.free_units ?? 0;

    if (walletBalance <= 0 && freeUnits <= 0) {
      return res.status(402).json({
        error: 'Insufficient balance',
        message: 'Your wallet is empty. Please top up at /wallet/topup',
      });
    }

    // ── Call provider ─────────────────────────────────────────────
    let providerResponse;
    try {
      providerResponse = await providerFn({ model, messages, max_tokens, temperature });
    } catch (providerErr) {
      console.error(`[proxyController] Provider "${provider}" error:`, providerErr.message);

      // Surface provider error message if available
      const detail =
        providerErr?.response?.data?.error?.message ||
        providerErr?.response?.data?.message ||
        providerErr.message;

      return res.status(502).json({
        error: 'Provider error',
        detail,
      });
    }

    const { data: responseData, tokensUsed } = providerResponse;

    // ── Calculate cost ────────────────────────────────────────────
    const costInr = calculateCostInr(model, tokensUsed);

    // ── Deduct balance ────────────────────────────────────────────
    if (costInr > 0) {
      if (walletBalance >= costInr) {
        // Deduct from wallet
        try {
          await deductBalance(user.id, costInr);
        } catch (deductErr) {
          console.error('[proxyController] Failed to deduct balance:', deductErr.message);
          // Non-fatal: still return the response; log the issue
        }
      } else if (freeUnits > 0) {
        // Use a free unit
        const prisma = require('../services/prismaClient');
        await prisma.user.update({
          where: { id: user.id },
          data: { free_units: { decrement: 1 } },
        }).catch(() => {});
      }
      // If balance is 0 but cost is negligible (< 0.000001) still allow
    }

    // ── Log usage ─────────────────────────────────────────────────
    logUsage({
      userId: user.id,
      apiKeyId: apiKey.id,
      provider,
      model,
      tokensUsed,
      costInr,
    }).catch((err) => console.error('[proxyController] logUsage error:', err.message));

    // ── Return response ───────────────────────────────────────────
    return res.status(200).json(responseData);
  } catch (err) {
    console.error('[proxyController.chatCompletions] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { chatCompletions };
