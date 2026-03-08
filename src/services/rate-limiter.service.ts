import { getRedis } from "../lib/redis";

// Sliding window rate limiter using Redis sorted sets
export interface RateLimitConfig {
  minuteLimit: number;
  dayLimit: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  minuteLimit: 20,
  dayLimit: 500,
};

const MINUTE_TTL = 60;        // seconds
const DAY_TTL = 86400;        // seconds

export interface RateLimitResult {
  allowed: boolean;
  minute_remaining: number;
  day_remaining: number;
  retry_after?: number;
}

export class RateLimiterService {
  private redis = getRedis();

  async checkAndIncrement(keyId: string, limits: RateLimitConfig = DEFAULT_RATE_LIMIT): Promise<RateLimitResult> {
    const now = Date.now();
    const minuteKey = `genaff:rate:minute:${keyId}`;
    const dayKey = `genaff:rate:day:${keyId}`;

    // Use Redis pipeline for atomic multi-command execution
    const pipeline = this.redis.pipeline();

    // Sliding window: remove old entries
    pipeline.zremrangebyscore(minuteKey, 0, now - MINUTE_TTL * 1000);
    pipeline.zremrangebyscore(dayKey, 0, now - DAY_TTL * 1000);

    // Count current entries
    pipeline.zcard(minuteKey);
    pipeline.zcard(dayKey);

    const results = await pipeline.exec();
    if (!results) {
      // Redis failure: allow request but log
      return { allowed: true, minute_remaining: limits.minuteLimit, day_remaining: limits.dayLimit };
    }

    const minuteCount = results[2]?.[1] as number ?? 0;
    const dayCount = results[3]?.[1] as number ?? 0;

    if (minuteCount >= limits.minuteLimit) {
      return {
        allowed: false,
        minute_remaining: 0,
        day_remaining: Math.max(0, limits.dayLimit - dayCount),
        retry_after: MINUTE_TTL,
      };
    }

    if (dayCount >= limits.dayLimit) {
      return {
        allowed: false,
        minute_remaining: Math.max(0, limits.minuteLimit - minuteCount),
        day_remaining: 0,
        retry_after: DAY_TTL,
      };
    }

    // Add current request timestamp
    const addPipeline = this.redis.pipeline();
    const member = `${now}-${Math.random()}`;
    addPipeline.zadd(minuteKey, now, member);
    addPipeline.expire(minuteKey, MINUTE_TTL * 2);
    addPipeline.zadd(dayKey, now, member);
    addPipeline.expire(dayKey, DAY_TTL * 2);
    await addPipeline.exec();

    return {
      allowed: true,
      minute_remaining: limits.minuteLimit - minuteCount - 1,
      day_remaining: limits.dayLimit - dayCount - 1,
    };
  }

  async resetLimits(keyId: string): Promise<void> {
    const minuteKey = `genaff:rate:minute:${keyId}`;
    const dayKey = `genaff:rate:day:${keyId}`;
    await this.redis.del(minuteKey, dayKey);
  }
}

export const rateLimiter = new RateLimiterService();
