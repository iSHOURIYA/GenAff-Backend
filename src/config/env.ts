import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).default("3000"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // URLs
  FRONTEND_URL: z.string().url().default("https://genaff.shauryacodes.xyz"),
  BACKEND_URL: z.string().url().default("https://genaff-api.shauryacodes.xyz"),

  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Provider API Keys
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Billing
  EXCHANGE_RATE_USD_TO_INR: z.string().transform(Number).default("83.5"),
  DEFAULT_FREE_UNITS: z.string().transform(Number).default("100"),
  FREE_UNIT_MODE: z.enum(["request", "token"]).default("request"),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:", result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config = parseEnv();
export type Config = typeof config;
