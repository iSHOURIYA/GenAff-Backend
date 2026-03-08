import { PrismaClient, ProviderName } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Admin User ─────────────────────────────────────────────────────────────
  const adminPassword = process.env.ADMIN_SEED_PASSWORD ?? "Admin@123456";
  const adminEmail = process.env.ADMIN_SEED_EMAIL ?? "admin@genaff.local";

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const password_hash = await argon2.hash(adminPassword);
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        password_hash,
        role: "admin",
        free_units_remaining: 0,
        wallet: { create: { balance_inr_cents: 0 } },
      },
    });
    console.log(`✅ Admin user created: ${admin.email}`);
  } else {
    console.log(`ℹ️  Admin user already exists: ${adminEmail}`);
  }

  // ─── Provider Configs ────────────────────────────────────────────────────────
  const providers: { provider: ProviderName; pricing_per_token_usd: string; base_request_cost_usd: string; priority: number }[] = [
    { provider: ProviderName.openai, pricing_per_token_usd: "0.000002", base_request_cost_usd: "0.0001", priority: 1 },
    { provider: ProviderName.deepseek, pricing_per_token_usd: "0.0000014", base_request_cost_usd: "0.00005", priority: 0 },
    { provider: ProviderName.gemini, pricing_per_token_usd: "0.00000075", base_request_cost_usd: "0.00003", priority: 2 },
  ];

  for (const pc of providers) {
    await prisma.providerConfig.upsert({
      where: { provider: pc.provider },
      update: { pricing_per_token_usd: pc.pricing_per_token_usd, base_request_cost_usd: pc.base_request_cost_usd, priority: pc.priority },
      create: {
        provider: pc.provider,
        enabled: true,
        pricing_per_token_usd: pc.pricing_per_token_usd,
        base_request_cost_usd: pc.base_request_cost_usd,
        priority: pc.priority,
      },
    });
    console.log(`✅ ProviderConfig upserted: ${pc.provider}`);
  }

  // ─── Model Mappings ──────────────────────────────────────────────────────────
  const models: { provider: ProviderName; provider_model_name: string; display_name: string }[] = [
    // OpenAI
    { provider: ProviderName.openai, provider_model_name: "gpt-4o", display_name: "GPT-4o" },
    { provider: ProviderName.openai, provider_model_name: "gpt-4o-mini", display_name: "GPT-4o Mini" },
    { provider: ProviderName.openai, provider_model_name: "gpt-3.5-turbo", display_name: "GPT-3.5 Turbo" },
    // DeepSeek
    { provider: ProviderName.deepseek, provider_model_name: "deepseek-chat", display_name: "DeepSeek Chat" },
    { provider: ProviderName.deepseek, provider_model_name: "deepseek-coder", display_name: "DeepSeek Coder" },
    // Gemini
    { provider: ProviderName.gemini, provider_model_name: "gemini-1.5-pro", display_name: "Gemini 1.5 Pro" },
    { provider: ProviderName.gemini, provider_model_name: "gemini-1.5-flash", display_name: "Gemini 1.5 Flash" },
  ];

  for (const mm of models) {
    await prisma.modelMapping.upsert({
      where: { provider_provider_model_name: { provider: mm.provider, provider_model_name: mm.provider_model_name } },
      update: {},
      create: { ...mm, active: true },
    });
    console.log(`✅ ModelMapping upserted: ${mm.provider}/${mm.provider_model_name}`);
  }

  console.log("✅ Seeding complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
