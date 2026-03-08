import argon2 from "argon2";
import { randomBytes } from "crypto";

// ─── Isolated unit tests for API key hashing logic ───────────────────────────

function generateRawApiKey(): string {
  return "sk_" + randomBytes(20).toString("hex");
}

describe("API Key Hashing", () => {
  it("should generate a key with sk_ prefix", () => {
    const key = generateRawApiKey();
    expect(key).toMatch(/^sk_[a-f0-9]{40}$/);
  });

  it("should create a 43-character key (sk_ + 40 hex chars)", () => {
    const key = generateRawApiKey();
    expect(key).toHaveLength(43);
  });

  it("should store last 6 chars as preview", () => {
    const key = generateRawApiKey();
    const preview = key.slice(-6);
    expect(preview).toHaveLength(6);
    expect(key.endsWith(preview)).toBe(true);
  });

  it("should hash a key with argon2", async () => {
    const key = generateRawApiKey();
    const hash = await argon2.hash(key);
    expect(hash).toBeTruthy();
    expect(hash).not.toEqual(key);
    expect(hash.length).toBeGreaterThan(50);
  });

  it("should verify a key correctly against its hash", async () => {
    const key = generateRawApiKey();
    const hash = await argon2.hash(key);
    const valid = await argon2.verify(hash, key);
    expect(valid).toBe(true);
  });

  it("should reject a wrong key against a hash", async () => {
    const key = generateRawApiKey();
    const wrongKey = generateRawApiKey();
    const hash = await argon2.hash(key);
    const valid = await argon2.verify(hash, wrongKey);
    expect(valid).toBe(false);
  });

  it("should produce different hashes for the same key (argon2 randomness)", async () => {
    const key = generateRawApiKey();
    const hash1 = await argon2.hash(key);
    const hash2 = await argon2.hash(key);
    expect(hash1).not.toEqual(hash2);
    // But both should verify
    expect(await argon2.verify(hash1, key)).toBe(true);
    expect(await argon2.verify(hash2, key)).toBe(true);
  });

  it("should NOT contain sk_ prefix in preview", () => {
    // Preview is last 6 chars
    const key = "sk_" + "a".repeat(20) + "b".repeat(20);
    const preview = key.slice(-6);
    expect(preview).toBe("bbbbbb");
  });
});
