import argon2 from "argon2";
import { randomBytes } from "crypto";
import { prisma } from "../../lib/prisma";

function generateRawApiKey(): string {
  // sk_ prefix + 40 random hex chars
  return "sk_" + randomBytes(20).toString("hex");
}

export class ApiKeyService {
  async listKeys(userId: string) {
    return prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        plain_key_preview: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createKey(userId: string, name: string) {
    const rawKey = generateRawApiKey();
    const key_hash = await argon2.hash(rawKey);
    const plain_key_preview = rawKey.slice(-6);

    const apiKey = await prisma.apiKey.create({
      data: {
        userId,
        name,
        key_hash,
        plain_key_preview,
        active: true,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      plain_key_preview: apiKey.plain_key_preview,
      active: apiKey.active,
      createdAt: apiKey.createdAt,
      // Return plaintext only on creation — never stored
      key: rawKey,
    };
  }

  async disableKey(userId: string, keyId: string) {
    const key = await prisma.apiKey.findFirst({ where: { id: keyId, userId } });
    if (!key) throw new Error("KEY_NOT_FOUND");

    return prisma.apiKey.update({
      where: { id: keyId },
      data: { active: false },
      select: { id: true, name: true, active: true },
    });
  }

  async deleteKey(userId: string, keyId: string) {
    const key = await prisma.apiKey.findFirst({ where: { id: keyId, userId } });
    if (!key) throw new Error("KEY_NOT_FOUND");

    await prisma.apiKey.delete({ where: { id: keyId } });
  }

  /**
   * Validate raw API key by comparing against all active hashes for candidate keys.
   * We look up by a fast index — since we can't query by hash directly (argon2 is not deterministic),
   * we retrieve all keys for the user and verify one by one.
   * In production, consider storing a secondary hmac-sha256 digest as a fast lookup index.
   */
  async validateApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
    // Prefix check for quick rejection
    if (!rawKey.startsWith("sk_")) return null;

    const preview = rawKey.slice(-6);

    // Narrow candidate set using preview + active flag
    const candidates = await prisma.apiKey.findMany({
      where: { plain_key_preview: preview, active: true },
      select: { id: true, key_hash: true, userId: true },
    });

    for (const candidate of candidates) {
      const valid = await argon2.verify(candidate.key_hash, rawKey);
      if (valid) {
        return { userId: candidate.userId, keyId: candidate.id };
      }
    }

    return null;
  }
}

export const apiKeyService = new ApiKeyService();
