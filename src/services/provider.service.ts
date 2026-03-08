import { config } from "../config/env";
import { prisma } from "../lib/prisma";
import { ProviderName } from "@prisma/client";
import { logger } from "../lib/logger";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  preferred_provider?: "openai" | "deepseek" | "gemini";
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  _provider: string; // internal metadata (stripped before sending to user)
}

export class ProviderService {
  /**
   * Get sorted list of enabled providers by priority (ascending).
   */
  async getEnabledProviders() {
    return prisma.providerConfig.findMany({
      where: { enabled: true },
      orderBy: { priority: "asc" },
    });
  }

  /**
   * Select provider: user preference → cheapest available → priority order.
   */
  async selectProvider(preferred?: string) {
    const providers = await this.getEnabledProviders();
    if (!providers.length) throw new Error("NO_PROVIDERS");

    if (preferred) {
      const found = providers.find((p: { provider: string }) => p.provider === preferred);
      if (found) return found;
    }

    // Sort by cheapest first (base + per_token)
    const sorted = [...providers].sort((a, b) => {
      const costA = Number(a.base_request_cost_usd) + Number(a.pricing_per_token_usd) * 1000;
      const costB = Number(b.base_request_cost_usd) + Number(b.pricing_per_token_usd) * 1000;
      return costA - costB;
    });

    return sorted[0];
  }

  /**
   * Estimate cost in INR paisa before making request.
   */
  estimateCost(
    pricingPerTokenUsd: number,
    baseRequestCostUsd: number,
    estimatedTokens: number
  ): number {
    const costUsd = baseRequestCostUsd + pricingPerTokenUsd * estimatedTokens;
    const costInr = costUsd * config.EXCHANGE_RATE_USD_TO_INR;
    // Round UP to nearest paisa
    return Math.ceil(costInr * 100);
  }

  /**
   * Call OpenAI chat completions.
   */
  async callOpenAI(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { default: axios } = await import("axios");
    const apiKey = config.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");

    const model = req.model ?? "gpt-4o-mini";

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    return { ...response.data, _provider: "openai" };
  }

  /**
   * Call DeepSeek chat completions (OpenAI-compatible API).
   */
  async callDeepSeek(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { default: axios } = await import("axios");
    const apiKey = config.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_NOT_CONFIGURED");

    const model = req.model ?? "deepseek-chat";

    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    return { ...response.data, _provider: "deepseek" };
  }

  /**
   * Call Gemini via REST API (mapped to OpenAI-compatible response shape).
   */
  async callGemini(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { default: axios } = await import("axios");
    const apiKey = config.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_NOT_CONFIGURED");

    const model = req.model ?? "gemini-1.5-flash";

    // Convert messages to Gemini format
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const systemInstruction = req.messages.find((m) => m.role === "system")?.content;

    const requestBody: any = { contents };
    if (systemInstruction) {
      requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (req.max_tokens) {
      requestBody.generationConfig = { maxOutputTokens: req.max_tokens };
    }
    if (req.temperature !== undefined) {
      requestBody.generationConfig = { ...(requestBody.generationConfig ?? {}), temperature: req.temperature };
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      requestBody,
      { headers: { "Content-Type": "application/json" }, timeout: 60000 }
    );

    const candidate = response.data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text ?? "";
    const usage = response.data.usageMetadata;

    // Map to OpenAI-like shape
    return {
      id: `gemini-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: candidate?.finishReason?.toLowerCase() ?? "stop",
        },
      ],
      usage: usage
        ? {
            prompt_tokens: usage.promptTokenCount ?? 0,
            completion_tokens: usage.candidatesTokenCount ?? 0,
            total_tokens: usage.totalTokenCount ?? 0,
          }
        : undefined,
      _provider: "gemini",
    };
  }

  /**
   * Route request to the correct provider.
   */
  async callProvider(provider: ProviderName, req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    switch (provider) {
      case ProviderName.openai:
        return this.callOpenAI(req);
      case ProviderName.deepseek:
        return this.callDeepSeek(req);
      case ProviderName.gemini:
        return this.callGemini(req);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Call with automatic fallback to next provider on error.
   */
  async callWithFallback(
    req: ChatCompletionRequest,
    preferred?: string
  ): Promise<{ response: ChatCompletionResponse; provider: string; tokens_used: number }> {
    const providers = await this.getEnabledProviders();
    if (!providers.length) throw new Error("NO_PROVIDERS");

    // Build ordered list: preferred first, then sorted by priority
    let ordered = [...providers];
    if (preferred) {
      const idx = ordered.findIndex((p) => p.provider === preferred);
      if (idx > 0) {
        const [pref] = ordered.splice(idx, 1);
        ordered = [pref, ...ordered];
      }
    }

    let lastError: Error | null = null;

    for (const pConfig of ordered) {
      try {
        logger.info({ provider: pConfig.provider }, "Calling provider");
        const response = await this.callProvider(pConfig.provider, req);
        const tokens_used = response.usage?.total_tokens ?? this.estimateTokenCount(req);
        return { response, provider: pConfig.provider, tokens_used };
      } catch (err: any) {
        logger.warn({ err: err.message, provider: pConfig.provider }, "Provider call failed, trying fallback");
        lastError = err;
      }
    }

    throw lastError ?? new Error("ALL_PROVIDERS_FAILED");
  }

  /**
   * Rough heuristic: ~4 chars per token for English.
   */
  estimateTokenCount(req: ChatCompletionRequest): number {
    const text = req.messages.map((m) => m.content).join(" ");
    return Math.ceil(text.length / 4) + 100; // +100 for completion estimate
  }
}

export const providerService = new ProviderService();
