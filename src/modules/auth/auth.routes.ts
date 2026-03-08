import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { authService } from "./auth.service";
import { logger } from "../../lib/logger";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/register
  fastify.post(
    "/auth/register",
    {
      schema: {
        tags: ["Auth"],
        summary: "Register a new user",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              email: { type: "string" },
              role: { type: "string" },
              free_units_remaining: { type: "number" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = registerSchema.parse(request.body);

      try {
        const user = await authService.register(body);
        logger.info({ userId: user.id }, "New user registered");
        return reply.status(201).send({ ...user, message: "Registration successful" });
      } catch (err: any) {
        if (err.message === "EMAIL_TAKEN") {
          return reply.status(409).send({ error: "Email already registered" });
        }
        logger.error({ err }, "Registration error");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  // POST /auth/login
  fastify.post(
    "/auth/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Login and receive JWT",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              access_token: { type: "string" },
              token_type: { type: "string" },
              expires_in: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = loginSchema.parse(request.body);

      try {
        const user = await authService.login(body);
        const token = fastify.jwt.sign(
          { sub: user.id, email: user.email, role: user.role },
          { expiresIn: (fastify as any).config?.JWT_EXPIRES_IN ?? "7d" }
        );
        logger.info({ userId: user.id }, "User logged in");
        return reply.send({ access_token: token, token_type: "Bearer", expires_in: "7d" });
      } catch (err: any) {
        if (err.message === "INVALID_CREDENTIALS") {
          return reply.status(401).send({ error: "Invalid email or password" });
        }
        logger.error({ err }, "Login error");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  // GET /me — requires auth
  fastify.get(
    "/me",
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ["Auth"],
        summary: "Get current user profile",
        security: [{ BearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              email: { type: "string" },
              role: { type: "string" },
              free_units_remaining: { type: "number" },
              createdAt: { type: "string" },
              wallet: {
                type: "object",
                properties: {
                  balance_inr_cents: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      try {
        const profile = await authService.getProfile(userId);
        return reply.send(profile);
      } catch (err: any) {
        if (err.message === "USER_NOT_FOUND") {
          return reply.status(404).send({ error: "User not found" });
        }
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );
}
