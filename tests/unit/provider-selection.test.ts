// Unit tests for provider selection and fallback logic

interface ProviderConfig {
  provider: string;
  enabled: boolean;
  pricing_per_token_usd: number;
  base_request_cost_usd: number;
  priority: number;
}

// ─── Isolated provider selection logic ──────────────────────────────────────

function selectProvider(providers: ProviderConfig[], preferred?: string): ProviderConfig | null {
  const enabled = providers.filter((p) => p.enabled);
  if (!enabled.length) return null;

  if (preferred) {
    const found = enabled.find((p) => p.provider === preferred);
    if (found) return found;
  }

  // Sort by cheapest (base + 1000 tokens * per_token)
  const sorted = [...enabled].sort((a, b) => {
    const costA = a.base_request_cost_usd + a.pricing_per_token_usd * 1000;
    const costB = b.base_request_cost_usd + b.pricing_per_token_usd * 1000;
    return costA - costB;
  });

  return sorted[0] ?? null;
}

function buildFallbackOrder(providers: ProviderConfig[], preferred?: string): ProviderConfig[] {
  const enabled = providers.filter((p) => p.enabled);
  let ordered = [...enabled].sort((a, b) => a.priority - b.priority);

  if (preferred) {
    const idx = ordered.findIndex((p) => p.provider === preferred);
    if (idx > 0) {
      const [pref] = ordered.splice(idx, 1);
      ordered = [pref, ...ordered];
    }
  }

  return ordered;
}

const testProviders: ProviderConfig[] = [
  { provider: "openai",   enabled: true,  pricing_per_token_usd: 0.000002,   base_request_cost_usd: 0.0001,  priority: 1 },
  { provider: "deepseek", enabled: true,  pricing_per_token_usd: 0.0000014,  base_request_cost_usd: 0.00005, priority: 0 },
  { provider: "gemini",   enabled: true,  pricing_per_token_usd: 0.00000075, base_request_cost_usd: 0.00003, priority: 2 },
];

describe("Provider Selection", () => {
  it("should select cheapest provider when no preference given", () => {
    const selected = selectProvider(testProviders);
    expect(selected?.provider).toBe("gemini"); // gemini is cheapest
  });

  it("should select preferred provider when available", () => {
    const selected = selectProvider(testProviders, "openai");
    expect(selected?.provider).toBe("openai");
  });

  it("should fallback to cheapest when preferred is not available", () => {
    const noOpenAI = testProviders.map((p) => p.provider === "openai" ? { ...p, enabled: false } : p);
    const selected = selectProvider(noOpenAI, "openai");
    expect(selected?.provider).toBe("gemini");
  });

  it("should return null when all providers disabled", () => {
    const allDisabled = testProviders.map((p) => ({ ...p, enabled: false }));
    const selected = selectProvider(allDisabled);
    expect(selected).toBeNull();
  });

  it("should only select enabled providers", () => {
    const mixed = testProviders.map((p) =>
      p.provider === "gemini" ? { ...p, enabled: false } : p
    );
    const selected = selectProvider(mixed);
    expect(selected?.provider).toBe("deepseek"); // next cheapest after gemini
  });
});

describe("Provider Fallback Order", () => {
  it("should order by priority ascending when no preference", () => {
    const order = buildFallbackOrder(testProviders);
    expect(order.map((p) => p.provider)).toEqual(["deepseek", "openai", "gemini"]); // priority 0,1,2
  });

  it("should place preferred provider first", () => {
    const order = buildFallbackOrder(testProviders, "openai");
    expect(order[0].provider).toBe("openai");
    expect(order.length).toBe(3);
  });

  it("should include all enabled providers in fallback list", () => {
    const order = buildFallbackOrder(testProviders, "gemini");
    expect(order).toHaveLength(3);
    expect(order[0].provider).toBe("gemini");
  });

  it("should exclude disabled providers from fallback list", () => {
    const withDisabled = testProviders.map((p) =>
      p.provider === "openai" ? { ...p, enabled: false } : p
    );
    const order = buildFallbackOrder(withDisabled, "deepseek");
    expect(order).toHaveLength(2);
    expect(order.every((p) => p.enabled)).toBe(true);
  });

  it("should simulate fallback on provider error", async () => {
    const callOrder: string[] = [];
    const errors: Record<string, boolean> = { deepseek: true, openai: true };

    const order = buildFallbackOrder(testProviders);
    let result: string | null = null;

    for (const provider of order) {
      const willFail = errors[provider.provider] ?? false;
      callOrder.push(provider.provider);
      if (!willFail) {
        result = provider.provider;
        break;
      }
    }

    expect(callOrder).toEqual(["deepseek", "openai", "gemini"]);
    expect(result).toBe("gemini");
  });
});
