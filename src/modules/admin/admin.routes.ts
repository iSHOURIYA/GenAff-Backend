import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { walletService } from "../wallet/wallet.service";
import { logger } from "../../lib/logger";
import { ProviderName } from "@prisma/client";

function requireAdmin(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const user = request.user as any;
  if (user?.role !== "admin") {
    reply.status(403).send({ error: "Admin access required" });
    return;
  }
  done();
}

const upsertProviderSchema = z.object({
  provider: z.enum(["openai", "deepseek", "gemini"]),
  enabled: z.boolean().optional(),
  pricing_per_token_usd: z.number().optional(),
  base_request_cost_usd: z.number().optional(),
  priority: z.number().int().optional(),
});

const adjustCreditsSchema = z.object({
  free_units_delta: z.number().int().optional(),
  wallet_inr_paisa_delta: z.number().int().optional(),
});

const mockTopUpSchema = z.object({
  transaction_id: z.string().uuid(),
});

export async function adminRoutes(fastify: FastifyInstance) {
  const auth = { onRequest: [fastify.authenticate, requireAdmin] };

  // GET /admin/providers
  fastify.get(
    "/admin/providers",
    {
      ...auth,
      schema: {
        tags: ["Admin"],
        summary: "List provider configurations",
        security: [{ BearerAuth: [] }],
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const providers = await prisma.providerConfig.findMany({ orderBy: { priority: "asc" } });
      return reply.send(providers);
    }
  );

  // POST /admin/providers — upsert provider config
  fastify.post(
    "/admin/providers",
    {
      ...auth,
      schema: {
        tags: ["Admin"],
        summary: "Create or update provider configuration",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["provider"],
          properties: {
            provider: { type: "string", enum: ["openai", "deepseek", "gemini"] },
            enabled: { type: "boolean" },
            pricing_per_token_usd: { type: "number" },
            base_request_cost_usd: { type: "number" },
            priority: { type: "integer" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = upsertProviderSchema.parse(request.body);
      const result = await prisma.providerConfig.upsert({
        where: { provider: body.provider as ProviderName },
        update: {
          ...(body.enabled !== undefined && { enabled: body.enabled }),
          ...(body.pricing_per_token_usd !== undefined && { pricing_per_token_usd: body.pricing_per_token_usd }),
          ...(body.base_request_cost_usd !== undefined && { base_request_cost_usd: body.base_request_cost_usd }),
          ...(body.priority !== undefined && { priority: body.priority }),
        },
        create: {
          provider: body.provider as ProviderName,
          enabled: body.enabled ?? true,
          pricing_per_token_usd: body.pricing_per_token_usd ?? 0.000002,
          base_request_cost_usd: body.base_request_cost_usd ?? 0.0001,
          priority: body.priority ?? 0,
        },
      });
      return reply.send(result);
    }
  );

  // PATCH /admin/users/:id/credits
  fastify.patch(
    "/admin/users/:id/credits",
    {
      ...auth,
      schema: {
        tags: ["Admin"],
        summary: "Adjust user wallet balance or free units",
        security: [{ BearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: {
          type: "object",
          properties: {
            free_units_delta: { type: "integer", description: "Positive to add, negative to subtract" },
            wallet_inr_paisa_delta: { type: "integer", description: "Amount in paisa to add (positive) or deduct (negative)" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = adjustCreditsSchema.parse(request.body);
      const userId = (request.params as any).id;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.status(404).send({ error: "User not found" });

      if (body.free_units_delta !== undefined) {
        await prisma.user.update({
          where: { id: userId },
          data: { free_units_remaining: { increment: body.free_units_delta } },
        });
      }

      if (body.wallet_inr_paisa_delta !== undefined) {
        if (body.wallet_inr_paisa_delta > 0) {
          await prisma.wallet.update({
            where: { userId },
            data: { balance_inr_cents: { increment: body.wallet_inr_paisa_delta } },
          });
        } else if (body.wallet_inr_paisa_delta < 0) {
          await walletService.deductCost(userId, Math.abs(body.wallet_inr_paisa_delta));
        }
      }

      const updated = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, free_units_remaining: true, wallet: { select: { balance_inr_cents: true } } },
      });

      logger.info({ adminAction: "credits_adjusted", userId, delta: body }, "Credits adjusted");
      return reply.send(updated);
    }
  );

  // GET /admin/usage — all usage records
  fastify.get(
    "/admin/usage",
    {
      ...auth,
      schema: {
        tags: ["Admin"],
        summary: "Get all usage records",
        security: [{ BearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            userId: { type: "string" },
            provider: { type: "string" },
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 50 },
          },
        },
      },
    },
    async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      const { from, to, userId, provider, page = 1, limit = 50 } = request.query as any;
      const where: any = {};
      if (userId) where.userId = userId;
      if (provider) where.provider = provider;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to + "T23:59:59Z");
      }

      const skip = (page - 1) * limit;
      const [records, total] = await Promise.all([
        prisma.usage.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true, userId: true, provider: true, model: true,
            tokens_used: true, cost_inr_cents: true, status: true, createdAt: true,
          },
        }),
        prisma.usage.count({ where }),
      ]);

      return reply.send({ data: records, total, page, limit, pages: Math.ceil(total / limit) });
    }
  );

  // POST /admin/topup-mock — dev-only manual top-up approval
  fastify.post(
    "/admin/topup-mock",
    {
      ...auth,
      schema: {
        tags: ["Admin"],
        summary: "[DEV] Approve a manual/pending top-up transaction",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["transaction_id"],
          properties: { transaction_id: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { transaction_id } = mockTopUpSchema.parse(request.body);

      try {
        const result = await walletService.completeTopUp(transaction_id);
        logger.info({ transaction_id }, "Mock top-up approved");
        return reply.send(result);
      } catch (err: any) {
        if (err.message === "TX_NOT_FOUND") {
          return reply.status(404).send({ error: "Transaction not found" });
        }
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // GET /admin/users — list all users
  fastify.get(
    "/admin/users",
    {
      ...auth,
      schema: {
        tags: ["Admin"],
        summary: "List all users",
        security: [{ BearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 50 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { page = 1, limit = 50 } = request.query as any;
      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true, email: true, role: true, free_units_remaining: true, createdAt: true,
            wallet: { select: { balance_inr_cents: true } },
          },
        }),
        prisma.user.count(),
      ]);
      return reply.send({ data: users, total, page, limit });
    }
  );
}
