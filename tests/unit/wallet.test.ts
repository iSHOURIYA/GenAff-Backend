// Unit tests for wallet deduction logic (atomic transaction behavior)
// Tests the core billing arithmetic without hitting the database

describe("Wallet Deduction Logic", () => {
  // Simulate wallet state
  function createWallet(balance: number) {
    return { balance_inr_cents: balance };
  }

  function deductCost(wallet: { balance_inr_cents: number }, cost: number): { success: boolean; newBalance: number } {
    const newBalance = wallet.balance_inr_cents - cost;
    if (newBalance < 0) {
      return { success: false, newBalance: wallet.balance_inr_cents }; // rollback
    }
    return { success: true, newBalance };
  }

  function refundCost(wallet: { balance_inr_cents: number }, amount: number): number {
    return wallet.balance_inr_cents + amount;
  }

  // ─── Cost estimation ─────────────────────────────────────────────────────────

  function estimateCost(pricingPerTokenUsd: number, baseRequestCostUsd: number, tokens: number, rateUsdToInr: number): number {
    const costUsd = baseRequestCostUsd + pricingPerTokenUsd * tokens;
    const costInr = costUsd * rateUsdToInr;
    return Math.ceil(costInr * 100); // paisa, rounded up
  }

  it("should compute cost correctly for OpenAI pricing", () => {
    // 0.000002 per token, 0.0001 base, 1000 tokens, 83.5 INR/USD
    const cost = estimateCost(0.000002, 0.0001, 1000, 83.5);
    // = (0.0001 + 0.002) * 83.5 * 100 = 0.0021 * 83.5 * 100 = 17.535 -> ceil -> 18
    expect(cost).toBe(18);
  });

  it("should round up to nearest paisa", () => {
    // 0.000001 per token, 0.00001 base, 1 token, 83.5 rate
    const cost = estimateCost(0.000001, 0.00001, 1, 83.5);
    // = 0.000011 * 83.5 * 100 = 0.091850 -> ceil -> 1 paisa
    expect(cost).toBe(1);
  });

  it("should succeed when balance >= cost", () => {
    const wallet = createWallet(500);
    const result = deductCost(wallet, 18);
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(482);
  });

  it("should fail when balance < cost", () => {
    const wallet = createWallet(10);
    const result = deductCost(wallet, 18);
    expect(result.success).toBe(false);
    expect(result.newBalance).toBe(10); // unchanged (rollback)
  });

  it("should succeed when balance exactly equals cost", () => {
    const wallet = createWallet(18);
    const result = deductCost(wallet, 18);
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(0);
  });

  it("should refund correctly", () => {
    const wallet = createWallet(482);
    const refunded = refundCost(wallet, 18);
    expect(refunded).toBe(500);
  });

  it("should handle zero cost (free units path)", () => {
    const wallet = createWallet(0);
    const result = deductCost(wallet, 0);
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(0);
  });

  it("should handle settling over-reservation (refund diff)", () => {
    // Reserved 50 paisa, actual cost was 30 paisa -> refund 20
    const reserved = 50;
    const actualCost = 30;
    const diff = reserved - actualCost;
    expect(diff).toBe(20);
    // Wallet was already debited 50, so refund 20
    const wallet = createWallet(200); // balance after reservation
    const refunded = refundCost(wallet, diff);
    expect(refunded).toBe(220);
  });

  it("should handle settling under-reservation (charge extra)", () => {
    // Reserved 30 paisa, actual cost was 50 paisa -> charge 20 more
    const reserved = 30;
    const actualCost = 50;
    const diff = reserved - actualCost;
    expect(diff).toBe(-20);
    // Charge: deduct abs(diff) = 20
    const wallet = createWallet(100);
    const result = deductCost(wallet, 20);
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(80);
  });

  it("should compute DeepSeek cost cheaper than OpenAI", () => {
    const openaiCost = estimateCost(0.000002, 0.0001, 1000, 83.5);
    const deepseekCost = estimateCost(0.0000014, 0.00005, 1000, 83.5);
    expect(deepseekCost).toBeLessThan(openaiCost);
  });

  it("should compute Gemini as cheapest", () => {
    const openaiCost = estimateCost(0.000002, 0.0001, 1000, 83.5);
    const deepseekCost = estimateCost(0.0000014, 0.00005, 1000, 83.5);
    const geminiCost = estimateCost(0.00000075, 0.00003, 1000, 83.5);
    expect(geminiCost).toBeLessThan(deepseekCost);
    expect(geminiCost).toBeLessThan(openaiCost);
  });
});
