import { buildApp } from "./app";
import { config } from "./config/env";
import { prisma } from "./lib/prisma";
import { getRedis, closeRedis } from "./lib/redis";
import { logger } from "./lib/logger";
import { startBackgroundJobs } from "./jobs/reconcile.job";

async function main() {
  // ─── Verify DB & Redis connectivity ─────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("✅ Database connected");
  } catch (err) {
    logger.fatal({ err }, "❌ Failed to connect to database");
    process.exit(1);
  }

  try {
    const redis = getRedis();
    await redis.ping();
    logger.info("✅ Redis connected");
  } catch (err) {
    logger.fatal({ err }, "❌ Failed to connect to Redis");
    process.exit(1);
  }

  const app = await buildApp();

  // ─── Background jobs ─────────────────────────────────────────────────────────
  const jobs = startBackgroundJobs();

  // ─── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    jobs.stop();
    await app.close();
    await prisma.$disconnect();
    await closeRedis();
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled rejection");
    process.exit(1);
  });

  // ─── Start server ─────────────────────────────────────────────────────────────
  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    logger.info(`🚀 GenAff API Gateway running on port ${config.PORT}`);
    logger.info(`📚 OpenAPI docs available at http://localhost:${config.PORT}/docs`);
  } catch (err) {
    logger.fatal({ err }, "Failed to start server");
    process.exit(1);
  }
}

main();
