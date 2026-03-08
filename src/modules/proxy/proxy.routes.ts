import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { apiKeyService } from "../keys/keys.service";
import { walletService } from "../wallet/wallet.service";
import { providerService } from "../../services/provider.service";
import { rateLimiter, DEFAULT_RATE_LIMIT } from "../../services/rate-limiter.service";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { config } from "../../config/env";
import { ProviderName } from "@prisma/client";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const chatCompletionBodySchema = z.object({
  model: z.string().optional(),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  preferred_provider: z.enum(["openai", "deepseek", "gemini"]).optional(),
});

async function extractBearerKey(request: FastifyRequest): Promise<string | null> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export async function proxyRoutes(fastify: FastifyInstance) {
  // POST /v1/chat/completions
  fastify.post(
    "/v1/chat/completions",
    {
      schema: {
        tags: ["Proxy"],
        summary: "Chat completions (proxied to AI providers)",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["messages"],
          properties: {
            model: { type: "string" },
            messages: {
              type: "array",
              items: {
                type: "object",
                required: ["role", "content"],
                properties: {
                  role: { type: "string", enum: ["system", "user", "assistant"] },
                  content: { type: "string" },
                },
              },
            },
            temperature: { type: "number" },
            max_tokens: { type: "integer" },
            preferred_provider: { type: "string", enum: ["openai", "deepseek", "gemini"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawKey = await extractBearerKey(request);
      if (!rawKey) {
        return reply.status(401).send({ error: "Missing API key. Use Authorization: Bearer sk_..." });
      }

      // 1. Validate API key
      const keyInfo = await apiKeyService.validateApiKey(rawKey);
      if (!keyInfo) {
        return reply.status(401).send({ error: "Invalid or inactive API key" });
      }

      const { userId, keyId } = keyInfo;

      // 2. Rate limiting
      const rl = await rateLimiter.checkAndIncrement(keyId, DEFAULT_RATE_LIMIT);
      reply.header("X-RateLimit-Minute-Remaining", rl.minute_remaining);
      reply.header("X-RateLimit-Day-Remaining", rl.day_remaining);

      if (!rl.allowed) {
        reply.header("Retry-After", rl.retry_after ?? 60);
        return reply.status(429).send({
          error: "Rate limit exceeded",
          retry_after: rl.retry_after,
        });
      }

      // 3. Parse body
      let body: z.infer<typeof chatCompletionBodySchema>;
      try {
        body = chatCompletionBodySchema.parse(request.body);
      } catch (err: any) {
        return reply.status(400).send({ error: "Invalid request body", details: err.errors });
      }

      // 4. Determine cost
      let usageId: string | null = null;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, free_units_remaining: true, wallet: { select: { balance_inr_cents: true } } },
      });

      if (!user) return reply.status(401).send({ error: "User not found" });

      const providerConfig = await providerService.selectProvider(body.preferred_provider);
      const estimatedTokens = providerService.estimateTokenCount(body);
      const estimatedCostPaisa = providerService.estimateCost(
        Number(providerConfig.pricing_per_token_usd),
        Number(providerConfig.base_request_cost_usd),
        estimatedTokens
      );

      let chargedFromFreeUnits = false;
      let reservedCostPaisa = 0;

      if (user.free_units_remaining > 0) {
        // Allocate free unit
        chargedFromFreeUnits = true;
        const decrement = config.FREE_UNIT_MODE === "request" ? 1 : estimatedTokens;
        await prisma.user.update({
          where: { id: userId },
          data: { free_units_remaining: { decrement: Math.min(decrement, user.free_units_remaining) } },
        });
      } else {
        // Check wallet balance
        const balance = user.wallet?.balance_inr_cents ?? 0;
        if (balance < estimatedCostPaisa) {
          return reply.status(402).send({
            error: "Insufficient wallet balance",
            message: `Your wallet has ₹${(balance / 100).toFixed(2)} but this request costs approximately ₹${(estimatedCostPaisa / 100).toFixed(2)}. Please top up your wallet.`,
            required_inr_paisa: estimatedCostPaisa,
            current_balance_inr_paisa: balance,
          });
        }

        // Reserve the estimated cost
        try {
          await walletService.deductCost(userId, estimatedCostPaisa);
          reservedCostPaisa = estimatedCostPaisa;
        } catch (err: any) {
          if (err.message === "INSUFFICIENT_BALANCE") {
            return reply.status(402).send({ error: "Insufficient wallet balance" });
          }
          throw err;
        }
      }

      // 5. Create pending usage record
      const usageRecord = await prisma.usage.create({
        data: {
          userId,
          apiKeyId: keyId,
          provider: providerConfig.provider,
          model: body.model ?? "auto",
          request_payload: body as any,
          response_payload: Prisma.JsonNull,
          tokens_used: 0,
          cost_inr_cents: 0,
          status: "reserved",
        },
      });
      usageId = usageRecord.id;

      // 6. Call provider
      try {
        const { response, provider, tokens_used } = await providerService.callWithFallback(
          body,
          body.preferred_provider
        );

        // Compute actual cost
        let actualCostPaisa = 0;
        if (!chargedFromFreeUnits) {
          const actualProviderConfig = await prisma.providerConfig.findUnique({ where: { provider: provider as ProviderName } });
          if (actualProviderConfig) {
            actualCostPaisa = providerService.estimateCost(
              Number(actualProviderConfig.pricing_per_token_usd),
              Number(actualProviderConfig.base_request_cost_usd),
              tokens_used
            );
            // Settle difference: refund over-reservation or charge shortfall
            const diff = reservedCostPaisa - actualCostPaisa;
            if (diff > 0) {
              await walletService.refundCost(userId, diff);
            } else if (diff < 0) {
              // Charge additional (try; if fails, accept our loss)
              try {
                await walletService.deductCost(userId, -diff);
              } catch {
                actualCostPaisa = reservedCostPaisa;
              }
            }
          } else {
            actualCostPaisa = reservedCostPaisa;
          }
        }

        // 7. Update usage record
        await prisma.usage.update({
          where: { id: usageId },
          data: {
            provider: provider as ProviderName,
            model: response.model,
            response_payload: response as any,
            tokens_used,
            cost_inr_cents: actualCostPaisa,
            status: "completed",
          },
        });

        // Strip internal metadata and return
        const { _provider, ...cleanResponse } = response as any;
        logger.info({ userId, keyId, provider, tokens_used, cost: actualCostPaisa }, "Proxy request completed");
        return reply.send(cleanResponse);
      } catch (err: any) {
        // Refund on failure
        if (!chargedFromFreeUnits && reservedCostPaisa > 0) {
          await walletService.refundCost(userId, reservedCostPaisa).catch(() => {});
        }

        // Restore free unit if it was consumed but provider failed
        if (chargedFromFreeUnits) {
          const restoreAmount = config.FREE_UNIT_MODE === "request" ? 1 : 1;
          await prisma.user.update({
            where: { id: userId },
            data: { free_units_remaining: { increment: restoreAmount } },
          }).catch(() => {});
        }

        if (usageId) {
          await prisma.usage.update({
            where: { id: usageId },
            data: { status: "failed", response_payload: { error: err.message } as any },
          }).catch(() => {});
        }

        if (err.message === "NO_PROVIDERS") {
          return reply.status(503).send({ error: "No AI providers are currently available" });
        }
        if (err.message === "ALL_PROVIDERS_FAILED") {
          return reply.status(502).send({ error: "All AI providers failed. Please try again." });
        }

        logger.error({ err, userId, keyId }, "Provider request failed");
        return reply.status(502).send({ error: "Provider request failed", message: err.message });
      }
    }
  );

  // GET /v1/models — list available models
  fastify.get(
    "/v1/models",
    {
      schema: {
        tags: ["Proxy"],
        summary: "List available models",
        response: {
          200: {
            type: "object",
            properties: {
              object: { type: "string" },
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    object: { type: "string" },
                    provider: { type: "string" },
                    display_name: { type: "string" },
                    pricing_per_token_usd: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const models = await prisma.modelMapping.findMany({
        where: { active: true },

      });

      const providerConfigs = await prisma.providerConfig.findMany({ where: { enabled: true } });
      const pricingMap = Object.fromEntries(providerConfigs.map((pc) => [pc.provider, pc]));

      const data = models.map((m) => {
        const pc = pricingMap[m.provider];
        return {
          id: `${m.provider}/${m.provider_model_name}`,
          object: "model",
          provider: m.provider,
          display_name: m.display_name,
          pricing_per_token_usd: (m.pricing_override_usd ?? pc?.pricing_per_token_usd ?? "0").toString(),
        };
      });

      return reply.send({ object: "list", data });
    }
  );
}
