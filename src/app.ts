import Fastify, { FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyHelmet from "@fastify/helmet";
import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { config } from "./config/env";
import { logger } from "./lib/logger";

// Routes
import { authRoutes } from "./modules/auth/auth.routes";
import { keysRoutes } from "./modules/keys/keys.routes";
import { walletRoutes } from "./modules/wallet/wallet.routes";
import { proxyRoutes } from "./modules/proxy/proxy.routes";
import { adminRoutes } from "./modules/admin/admin.routes";
import { webhookRoutes } from "./modules/webhooks/webhook.routes";

// Augment Fastify types for JWT + authenticate decorator
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024, // 2 MB
  });

  // ─── Raw body for webhook signature verification ─────────────────────────────
  app.addContentTypeParser("application/json", { parseAs: "string" }, function (req, body, done) {
    (req as any).rawBody = body;
    try {
      done(null, JSON.parse(body as string));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // ─── Security ────────────────────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // disabled for Swagger UI
  });

  await app.register(fastifyCors, {
    origin: [config.FRONTEND_URL, "http://localhost:3001", "http://localhost:5173"],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  // ─── JWT ─────────────────────────────────────────────────────────────────────
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN as any },
  });

  // Authenticate decorator
  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: "Unauthorized", message: "Valid JWT required" });
    }
  });

  // ─── OpenAPI / Swagger ───────────────────────────────────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "GenAff API Gateway",
        description: "SaaS AI API Gateway — proxy OpenAI, DeepSeek, Gemini with built-in billing & rate limiting",
        version: "1.0.0",
        contact: { name: "GenAff Support", url: config.FRONTEND_URL },
      },
      servers: [
        { url: config.BACKEND_URL, description: "Production" },
        { url: "http://localhost:3000", description: "Local development" },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "JWT token obtained from /auth/login",
          },
          ApiKeyAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "API Key",
            description: "User API key (sk_...) created via /keys endpoint",
          },
        },
      },
      tags: [
        { name: "Auth", description: "Authentication & user management" },
        { name: "API Keys", description: "API key creation & management" },
        { name: "Wallet", description: "Wallet & top-up" },
        { name: "Billing", description: "Usage & billing history" },
        { name: "Proxy", description: "AI proxy endpoints" },
        { name: "Admin", description: "Admin-only management endpoints" },
        { name: "Webhooks", description: "Payment provider webhooks" },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
    staticCSP: false,
  });

  // ─── Request logging ─────────────────────────────────────────────────────────
  app.addHook("onRequest", async (request) => {
    logger.info({
      method: request.method,
      url: request.url,
      ip: request.ip,
      requestId: request.id,
    }, "incoming request");
  });

  app.addHook("onResponse", async (request, reply) => {
    logger.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    }, "request completed");
  });

  // ─── Routes ──────────────────────────────────────────────────────────────────
  await app.register(authRoutes);
  await app.register(keysRoutes);
  await app.register(walletRoutes);
  await app.register(proxyRoutes);
  await app.register(adminRoutes);
  await app.register(webhookRoutes);

  // Health check
  app.get("/health", {
    schema: {
      tags: ["Health"],
      summary: "Server health check",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            uptime: { type: "number" },
            timestamp: { type: "string" },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // 404 handler
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: "Route not found" });
  });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, url: request.url, method: request.method }, "Unhandled error");

    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    return reply.status(500).send({ error: "Internal server error" });
  });

  return app;
}
