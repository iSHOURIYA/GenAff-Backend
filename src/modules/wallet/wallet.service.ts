import { prisma } from "../../lib/prisma";
import { config } from "../../config/env";
import { logger } from "../../lib/logger";

const MIN_TOPUP_PAISA = 1000; // ₹10

export interface InitiateTopUpInput {
  userId: string;
  amount_inr_paisa: number;
  method: "razorpay" | "manual";
}

export class WalletService {
  /**
   * Get wallet balance for user.
   */
  async getBalance(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error("WALLET_NOT_FOUND");
    return wallet;
  }

  /**
   * Create a pending top-up transaction and return payment initiation details.
   */
  async initiateTopUp(input: InitiateTopUpInput) {
    if (input.amount_inr_paisa < MIN_TOPUP_PAISA) {
      throw new Error("MIN_TOPUP");
    }

    const tx = await prisma.topUpTransaction.create({
      data: {
        userId: input.userId,
        amount_inr_cents: input.amount_inr_paisa,
        provider: input.method,
        status: "pending",
      },
    });

    if (input.method === "manual") {
      // Dev-only: return transaction id for manual approval
      return {
        transaction_id: tx.id,
        status: "pending",
        message: "Manual top-up created. Use /admin/topup-mock to approve.",
        amount_inr: input.amount_inr_paisa / 100,
      };
    }

    // Razorpay: create an order
    const razorpay = await getRazorpayInstance();
    try {
      const order = await razorpay.orders.create({
        amount: input.amount_inr_paisa,
        currency: "INR",
        receipt: tx.id,
        notes: { userId: input.userId, txId: tx.id },
      });

      // Update transaction with provider order id
      await prisma.topUpTransaction.update({
        where: { id: tx.id },
        data: { provider_tx_id: order.id },
      });

      return {
        transaction_id: tx.id,
        provider_order_id: order.id,
        amount_inr: input.amount_inr_paisa / 100,
        key_id: config.RAZORPAY_KEY_ID,
        status: "pending",
      };
    } catch (err) {
      logger.error({ err }, "Razorpay order creation failed");
      await prisma.topUpTransaction.update({ where: { id: tx.id }, data: { status: "failed" } });
      throw new Error("PAYMENT_INIT_FAILED");
    }
  }

  /**
   * Complete a top-up and credit the wallet (atomic).
   */
  async completeTopUp(txId: string, providerTxId?: string) {
    return prisma.$transaction(async (tx) => {
      const topUp = await tx.topUpTransaction.findUnique({ where: { id: txId } });
      if (!topUp) throw new Error("TX_NOT_FOUND");
      if (topUp.status === "completed") return topUp; // idempotent

      const updated = await tx.topUpTransaction.update({
        where: { id: txId },
        data: { status: "completed", provider_tx_id: providerTxId ?? topUp.provider_tx_id },
      });

      await tx.wallet.update({
        where: { userId: topUp.userId },
        data: { balance_inr_cents: { increment: topUp.amount_inr_cents } },
      });

      logger.info({ txId, userId: topUp.userId, amount: topUp.amount_inr_cents }, "Wallet credited");
      return updated;
    });
  }

  /**
   * Atomically deduct cost from wallet using conditional SQL update.
   * Only deducts if balance >= cost_inr_cents — prevents going negative.
   */
  async deductCost(userId: string, cost_inr_cents: number): Promise<void> {
    if (cost_inr_cents <= 0) return;

    // Atomic: UPDATE wallets SET balance = balance - cost WHERE userId = ? AND balance >= cost
    const result = await prisma.$executeRaw`
      UPDATE wallets
      SET balance_inr_cents = balance_inr_cents - ${cost_inr_cents},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
        AND balance_inr_cents >= ${cost_inr_cents}
    `;

    if (result === 0) {
      throw new Error("INSUFFICIENT_BALANCE");
    }
  }

  /**
   * Refund a cost (e.g. when provider request fails).
   */
  async refundCost(userId: string, cost_inr_cents: number): Promise<void> {
    if (cost_inr_cents <= 0) return;
    await prisma.wallet.update({
      where: { userId },
      data: { balance_inr_cents: { increment: cost_inr_cents } },
    });
  }

  async getUsageHistory(userId: string, from?: string, to?: string) {
    const where: any = { userId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + "T23:59:59Z");
    }

    return prisma.usage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        provider: true,
        model: true,
        tokens_used: true,
        cost_inr_cents: true,
        status: true,
        createdAt: true,
      },
      take: 200,
    });
  }
}

export const walletService = new WalletService();

// Lazy Razorpay instance
async function getRazorpayInstance() {
  const Razorpay = (await import("razorpay")).default;
  return new Razorpay({
    key_id: config.RAZORPAY_KEY_ID!,
    key_secret: config.RAZORPAY_KEY_SECRET!,
  });
}
