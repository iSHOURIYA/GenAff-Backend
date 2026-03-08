import { CronJob } from "cron";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

/**
 * Hourly job: reconcile pending/reserved usage records.
 * Marks any "reserved" usage older than 10 minutes as failed
 * and refunds the reserved amount.
 */
async function reconcileUsage() {
  logger.info("Running usage reconciliation job");
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  try {
    const staleReserved = await prisma.usage.findMany({
      where: { status: "reserved", createdAt: { lt: tenMinutesAgo } },
      select: { id: true, userId: true, cost_inr_cents: true },
    });

    for (const record of staleReserved) {
      await prisma.$transaction(async (tx) => {
        await tx.usage.update({
          where: { id: record.id },
          data: { status: "failed" },
        });

        if (record.cost_inr_cents > 0) {
          await tx.wallet.update({
            where: { userId: record.userId },
            data: { balance_inr_cents: { increment: record.cost_inr_cents } },
          });
        }
      });

      logger.info({ usageId: record.id, userId: record.userId, refund: record.cost_inr_cents }, "Refunded stale reserved usage");
    }

    // Also reconcile pending top-up transactions older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const expiredTopUps = await prisma.topUpTransaction.updateMany({
      where: { status: "pending", createdAt: { lt: oneHourAgo } },
      data: { status: "failed" },
    });

    if (expiredTopUps.count > 0) {
      logger.info({ count: expiredTopUps.count }, "Expired pending top-up transactions");
    }

    logger.info({ staleRecords: staleReserved.length }, "Usage reconciliation complete");
  } catch (err) {
    logger.error({ err }, "Usage reconciliation error");
  }
}

export function startBackgroundJobs() {
  // Run every hour at minute 0
  const reconcileJob = new CronJob("0 * * * *", reconcileUsage, null, true, "UTC");
  reconcileJob.start();
  logger.info("Background jobs started (hourly reconciliation)");

  return {
    stop() {
      reconcileJob.stop();
      logger.info("Background jobs stopped");
    },
  };
}
