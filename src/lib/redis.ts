import Redis from "ioredis";
import { config } from "../config/env";

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    redisInstance.on("connect", () => {
      console.log("[Redis] Connected");
    });

    redisInstance.on("error", (err) => {
      console.error("[Redis] Error:", err.message);
    });
  }
  return redisInstance;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
