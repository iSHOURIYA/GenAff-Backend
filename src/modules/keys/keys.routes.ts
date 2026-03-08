import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { apiKeyService } from "./keys.service";
import { logger } from "../../lib/logger";

const createKeySchema = z.object({
  name: z.string().min(1).max(64),
});

export async function keysRoutes(fastify: FastifyInstance) {
  const auth = { onRequest: [fastify.authenticate] };

  // GET /keys
  fastify.get(
    "/keys",
    {
      ...auth,
      schema: {
        tags: ["API Keys"],
        summary: "List API keys",
        security: [{ BearerAuth: [] }],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                plain_key_preview: { type: "string" },
                active: { type: "boolean" },
                createdAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const keys = await apiKeyService.listKeys(userId);
      return reply.send(keys);
    }
  );

  // POST /keys
  fastify.post(
    "/keys",
    {
      ...auth,
      schema: {
        tags: ["API Keys"],
        summary: "Create new API key (plaintext shown only once)",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1, maxLength: 64 } },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              key: { type: "string", description: "Plaintext API key — shown only once!" },
              plain_key_preview: { type: "string" },
              active: { type: "boolean" },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const { name } = createKeySchema.parse(request.body);
      const key = await apiKeyService.createKey(userId, name);
      logger.info({ userId, keyId: key.id }, "API key created");
      return reply.status(201).send(key);
    }
  );

  // PATCH /keys/:id/disable
  fastify.patch(
    "/keys/:id/disable",
    {
      ...auth,
      schema: {
        tags: ["API Keys"],
        summary: "Disable an API key",
        security: [{ BearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      try {
        const key = await apiKeyService.disableKey(userId, request.params.id);
        return reply.send(key);
      } catch (err: any) {
        if (err.message === "KEY_NOT_FOUND") return reply.status(404).send({ error: "Key not found" });
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  // DELETE /keys/:id
  fastify.delete(
    "/keys/:id",
    {
      ...auth,
      schema: {
        tags: ["API Keys"],
        summary: "Delete an API key",
        security: [{ BearerAuth: [] }],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      try {
        await apiKeyService.deleteKey(userId, request.params.id);
        return reply.status(204).send();
      } catch (err: any) {
        if (err.message === "KEY_NOT_FOUND") return reply.status(404).send({ error: "Key not found" });
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );
}
