# GenAff – Billing Math Reference

## Units

| Unit | Symbol | Equals |
|------|--------|--------|
| 1 rupee | ₹1 | 100 paisa |
| 1 paisa | 1p | ₹0.01 |
| 1 USD | $1 | `EXCHANGE_RATE_USD_TO_INR` INR (default: `83.50`) |

All monetary values stored in the database are in **paisa (integer)**.
All amounts in API responses are in **paisa** unless noted.

---

## Cost Formula

```
cost_usd   = base_request_cost_usd + (pricing_per_token_usd × tokens)
cost_inr   = cost_usd × EXCHANGE_RATE_USD_TO_INR
cost_paisa = ceil(cost_inr × 100)
```

Implementation (`provider.service.ts`):
```typescript
estimateCost(pricingPerTokenUsd, baseRequestCostUsd, estimatedTokens) {
  const costUsd = baseRequestCostUsd + pricingPerTokenUsd * estimatedTokens;
  const costInr = costUsd * config.EXCHANGE_RATE_USD_TO_INR;
  return Math.ceil(costInr * 100); // paisa, ceiling rounded
}
```

---

## Worked Examples

### Example 1 — 200 tokens, OpenAI pricing

```
Provider:              OpenAI
pricing_per_token_usd: $0.00001   (0.000010000 per token)
base_request_cost_usd: $0.0005    (0.0005000000 fixed)
tokens:                200
exchange_rate:         83.50 INR/USD

Step 1 — USD cost:
  cost_usd = 0.0005 + (0.00001 × 200)
           = 0.0005 + 0.002
           = $0.0025

Step 2 — INR cost:
  cost_inr = 0.0025 × 83.50
           = 0.20875 INR

Step 3 — Paisa (ceiling):
  cost_paisa = ceil(0.20875 × 100)
             = ceil(20.875)
             = 21 paisa

Deduction:
  wallet_before = 5000 paisa (₹50.00)
  deducted      =   21 paisa
  wallet_after  = 4979 paisa (₹49.79)
```

---

### Example 2 — 1,000 tokens, DeepSeek pricing

```
Provider:              DeepSeek
pricing_per_token_usd: $0.000002
base_request_cost_usd: $0.0001
tokens:                1,000
exchange_rate:         83.50

cost_usd   = 0.0001 + (0.000002 × 1000) = 0.0001 + 0.002 = $0.0021
cost_inr   = 0.0021 × 83.50              = 0.17535 INR
cost_paisa = ceil(17.535)                = 18 paisa
```

---

### Example 3 — 50 tokens, Gemini (cheapest)

```
Provider:              Gemini
pricing_per_token_usd: $0.000001
base_request_cost_usd: $0.00005
tokens:                50

cost_usd   = 0.00005 + (0.000001 × 50) = 0.00005 + 0.00005 = $0.0001
cost_inr   = 0.0001 × 83.50            = 0.00835 INR
cost_paisa = ceil(0.835)               = 1 paisa (minimum)
```

---

## Free Units

New users receive `FREE_UNITS_ON_REGISTER` free units (default: `10`).

When `FREE_UNIT_MODE=request` (default):
- Each request consumes **1 free unit** regardless of token count.
- No wallet deduction occurs.

When `FREE_UNIT_MODE=token`:
- Each request consumes `estimated_tokens` free units.
- Free units act as a token budget.

If the provider call **fails**, the free unit is restored atomically.

---

## Billing Lifecycle per Request

```
1. Check free_units_remaining > 0
   ├─ YES → decrement free unit, skip wallet check
   └─ NO  → continue to wallet check

2. Estimate cost (formula above)

3. Check wallet.balance_inr_cents >= estimated_cost_paisa
   ├─ NO  → return 402 Payment Required
   └─ YES → continue

4. Deduct estimated_cost_paisa from wallet (atomic SQL)
   status = "reserved"

5. Call AI provider

6. Provider returns actual token count
   actual_cost_paisa = formula(actual_tokens)

7. Settle difference:
   diff = reserved - actual
   ├─ diff > 0 → refund(diff) to wallet
   ├─ diff < 0 → try deductCost(-diff) [best-effort, ignored on failure]
   └─ diff = 0 → no-op

8. Update usage record: status = "completed", tokens_used = actual, cost = actual
```

---

## 402 Payment Required Response

```json
{
  "error": "Insufficient wallet balance",
  "message": "Your wallet has ₹5.00 but this request costs approximately ₹0.21. Please top up your wallet.",
  "required_inr_paisa": 21,
  "current_balance_inr_paisa": 500
}
```

**Auto top-up flow (suggested client-side pattern):**

```
if (response.status === 402) {
  const needed = response.body.required_inr_paisa;
  const topUpAmount = Math.max(needed * 10, 1000); // min ₹10 buffer
  await initiateTopUp(topUpAmount);
  // Wait for webhook / use manual flow
  // Retry original request
}
```

---

## Provider Selection Logic

```
1. If preferred_provider is set and enabled → use it
2. Otherwise, sort enabled providers by:
   (base_request_cost_usd + pricing_per_token_usd × 1000)
3. Pick cheapest; use priority as tiebreaker
4. On provider failure, try next in chain (fallback)
5. If all fail → 502 All providers failed
```

---

## Reconciliation Job

A background cron job runs every hour and:
- Finds usage records stuck in `"reserved"` status for > 10 minutes
- Refunds the reserved amount to the user's wallet
- Marks the record as `"failed"`

This prevents funds from being permanently locked if the server crashes mid-request.
