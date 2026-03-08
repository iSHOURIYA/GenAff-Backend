import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import { walletService } from "../wallet/wallet.service";
import { prisma } from "../../lib/prisma";
import { config } from "../../config/env";
import { logger } from "../../lib/logger";

function verifyRazorpaySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

export async function webhookRoutes(fastify: FastifyInstance) {
  // POST /webhooks/payments — Razorpay payment webhook
  fastify.post(
    "/webhooks/payments",
    {
      schema: {
        tags: ["Webhooks"],
        summary: "Payment provider webhook (Razorpay)",
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = request.headers["x-razorpay-signature"] as string;
      const rawBody = (request as any).rawBody as string;
      const webhookSecret = config.RAZORPAY_WEBHOOK_SECRET;

      // Signature verification (skip in dev if secret not configured)
      if (webhookSecret && signature) {
        try {
          const valid = verifyRazorpaySignature(rawBody, signature, webhookSecret);
          if (!valid) {
            logger.warn("Razorpay webhook signature invalid");
            return reply.status(400).send({ error: "Invalid signature" });
          }
        } catch (err) {
          logger.error({ err }, "Webhook signature verification error");
          return reply.status(400).send({ error: "Signature verification failed" });
        }
      }

      const payload = request.body as any;
      const event = payload?.event;

      logger.info({ event }, "Razorpay webhook received");

      if (event === "payment.captured" || event === "order.paid") {
        try {
          const payment = payload?.payload?.payment?.entity ?? payload?.payload?.order?.entity;
          const receipt = payment?.receipt ?? payload?.payload?.order?.entity?.receipt;
          const razorpayPaymentId = payment?.id;

          if (!receipt) {
            logger.warn({ event }, "Webhook missing receipt");
            return reply.status(200).send({ received: true }); // ack even on parse failure
          }

          // receipt = our TopUpTransaction.id
          const tx = await prisma.topUpTransaction.findUnique({ where: { id: receipt } });
          if (!tx) {
            logger.warn({ receipt }, "Transaction not found for webhook receipt");
            return reply.status(200).send({ received: true });
          }

          if (tx.status !== "completed") {
            await walletService.completeTopUp(tx.id, razorpayPaymentId);
          }

          return reply.status(200).send({ received: true });
        } catch (err: any) {
          logger.error({ err, event }, "Webhook processing error");
          return reply.status(500).send({ error: "Webhook processing failed" });
        }
      }

      // Acknowledge unhandled events
      return reply.status(200).send({ received: true, event });
    }
  );
}
