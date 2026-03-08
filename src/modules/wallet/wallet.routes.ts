import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { walletService } from "./wallet.service";
import { logger } from "../../lib/logger";

const initiateTopUpSchema = z.object({
  amount_inr_paisa: z.number().int().min(1000, "Minimum top-up is ₹10 (1000 paisa)"),
  method: z.enum(["razorpay", "manual"]).default("razorpay"),
});

export async function walletRoutes(fastify: FastifyInstance) {
  const auth = { onRequest: [fastify.authenticate] };

  // POST /wallet/topup/initiate
  fastify.post(
    "/wallet/topup/initiate",
    {
      ...auth,
      schema: {
        tags: ["Wallet"],
        summary: "Initiate a wallet top-up",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["amount_inr_paisa"],
          properties: {
            amount_inr_paisa: { type: "integer", minimum: 1000, description: "Amount in paisa (₹10 = 1000)" },
            method: { type: "string", enum: ["razorpay", "manual"], default: "razorpay" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      try {
        const body = initiateTopUpSchema.parse(request.body);
        const result = await walletService.initiateTopUp({ userId, ...body });
        return reply.status(201).send(result);
      } catch (err: any) {
        if (err.message === "MIN_TOPUP") {
          return reply.status(400).send({ error: "Minimum top-up is ₹10" });
        }
        if (err.message === "PAYMENT_INIT_FAILED") {
          return reply.status(502).send({ error: "Payment initiation failed. Try again." });
        }
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: err.errors[0]?.message });
        }
        logger.error({ err }, "Top-up initiation error");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /billing/usage
  fastify.get(
    "/billing/usage",
    {
      ...auth,
      schema: {
        tags: ["Billing"],
        summary: "Get usage history",
        security: [{ BearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", format: "date", description: "YYYY-MM-DD" },
            to: { type: "string", format: "date", description: "YYYY-MM-DD" },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { from?: string; to?: string } }>, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const { from, to } = request.query;
      const records = await walletService.getUsageHistory(userId, from, to);
      return reply.send(records);
    }
  );
}
