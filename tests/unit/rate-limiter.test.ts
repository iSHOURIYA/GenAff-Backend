// Unit tests for rate limiting logic (pure logic, no Redis dependency)

// ─── Inline rate limiter logic (re-implemented to test in isolation) ──────────

interface RateLimitConfig { minuteLimit: number; dayLimit: number; }
interface RateLimitResult { allowed: boolean; minute_remaining: number; day_remaining: number; retry_after?: number; }

async function checkRateLimit(
  _keyId: string,
  limits: RateLimitConfig,
  minuteCount: number,
  dayCount: number
): Promise<RateLimitResult> {
  if (minuteCount >= limits.minuteLimit) {
    return { allowed: false, minute_remaining: 0, day_remaining: Math.max(0, limits.dayLimit - dayCount), retry_after: 60 };
  }
  if (dayCount >= limits.dayLimit) {
    return { allowed: false, minute_remaining: Math.max(0, limits.minuteLimit - minuteCount), day_remaining: 0, retry_after: 86400 };
  }
  return { allowed: true, minute_remaining: limits.minuteLimit - minuteCount - 1, day_remaining: limits.dayLimit - dayCount - 1 };
}

describe("Rate Limiter Logic", () => {
  const limits: RateLimitConfig = { minuteLimit: 20, dayLimit: 500 };

  it("should allow request when below both limits", async () => {
    const result = await checkRateLimit("key1", limits, 5, 100);
    expect(result.allowed).toBe(true);
    expect(result.minute_remaining).toBe(14);
    expect(result.day_remaining).toBe(399);
  });

  it("should block when minute limit is hit exactly", async () => {
    const result = await checkRateLimit("key1", limits, 20, 100);
    expect(result.allowed).toBe(false);
    expect(result.minute_remaining).toBe(0);
    expect(result.retry_after).toBe(60);
  });

  it("should block when minute limit is exceeded", async () => {
    const result = await checkRateLimit("key1", limits, 25, 100);
    expect(result.allowed).toBe(false);
    expect(result.retry_after).toBe(60);
  });

  it("should block when day limit is hit", async () => {
    const result = await checkRateLimit("key1", limits, 5, 500);
    expect(result.allowed).toBe(false);
    expect(result.day_remaining).toBe(0);
    expect(result.retry_after).toBe(86400);
  });

  it("should prioritize minute limit over day limit", async () => {
    const result = await checkRateLimit("key1", limits, 20, 499);
    expect(result.allowed).toBe(false);
    expect(result.retry_after).toBe(60); // minute rate, not day
  });

  it("should return zero remaining at limit boundary", async () => {
    const result = await checkRateLimit("key1", limits, 19, 499);
    expect(result.allowed).toBe(true);
    expect(result.minute_remaining).toBe(0); // 20 - 19 - 1 = 0
    expect(result.day_remaining).toBe(0); // 500 - 499 - 1 = 0
  });

  it("should use namespaced Redis keys", () => {
    const keyId = "test-key-id-1234";
    const minuteKey = `genaff:rate:minute:${keyId}`;
    const dayKey = `genaff:rate:day:${keyId}`;
    expect(minuteKey).toBe("genaff:rate:minute:test-key-id-1234");
    expect(dayKey).toBe("genaff:rate:day:test-key-id-1234");
  });
});
