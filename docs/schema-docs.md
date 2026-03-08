# GenAff – Database Schema Reference

## Prisma Models

All models use PostgreSQL with UUID primary keys. Prisma client is generated with `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` for Alpine Docker compatibility.

---

### `users` table — `model User`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | Auto-generated |
| `email` | `varchar` UNIQUE | Used for login |
| `password_hash` | `text` | argon2id hash |
| `role` | `enum(user, admin)` | Default: `user` |
| `free_units_remaining` | `int` | Default: `0`; set by `FREE_UNITS_ON_REGISTER` |
| `createdAt` | `timestamptz` | Auto |
| `updatedAt` | `timestamptz` | Auto |

Relations: `apiKeys[]`, `wallet?`, `topUps[]`, `usageRecords[]`

---

### `api_keys` table — `model ApiKey`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `key_hash` | `text` UNIQUE | argon2id hash of `sk_<random>` |
| `plain_key_preview` | `varchar(6)` | Last 6 chars only (for display) |
| `name` | `varchar(64)` | User-defined label |
| `active` | `boolean` | Default: `true` |
| `userId` | `uuid` FK → `users.id` | Cascade delete |
| `createdAt` | `timestamptz` | |

Key format: `sk_<32 random hex chars>` — 34 chars total.

---

### `wallets` table — `model Wallet`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `balance_inr_cents` | `int` | Balance in **paisa** (1 paisa = ₹0.01). Default: `0` |
| `userId` | `uuid` UNIQUE FK | One wallet per user |
| `createdAt` / `updatedAt` | `timestamptz` | |

> **Unit note:** the column name says `cents` but stores Indian **paisa** (1/100 of INR). `5000` = ₹50.00.

---

### `top_up_transactions` table — `model TopUpTransaction`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | Also used as Razorpay `receipt` |
| `amount_inr_cents` | `int` | Top-up amount in paisa |
| `provider` | `varchar` | `"razorpay"` or `"manual"` |
| `provider_tx_id` | `varchar?` | Razorpay `pay_*` ID after capture |
| `status` | `enum(pending,completed,failed)` | Updated by webhook |
| `userId` | `uuid` FK | Cascade delete |
| `createdAt` / `updatedAt` | `timestamptz` | |

---

### `usage_records` table — `model Usage`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `provider` | `enum(openai,deepseek,gemini)` | Actual provider used |
| `model` | `varchar` | Provider model name |
| `request_payload` | `jsonb` | Full request body |
| `response_payload` | `jsonb?` | Provider response or `{"error": "..."}` on failure |
| `tokens_used` | `int` | Actual tokens (from provider response) |
| `cost_inr_cents` | `int` | Final settled cost in paisa |
| `status` | `varchar` | `pending` → `reserved` → `completed` / `failed` |
| `userId` | `uuid` FK | |
| `apiKeyId` | `uuid` FK → `api_keys.id` | |
| `createdAt` | `timestamptz` | Indexed with `userId` |

---

### `provider_configs` table — `model ProviderConfig`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `provider` | `enum` UNIQUE | One config per provider |
| `enabled` | `boolean` | Routes skip disabled providers |
| `pricing_per_token_usd` | `Decimal(20,10)` | Cost per token in USD |
| `base_request_cost_usd` | `Decimal(20,10)` | Fixed cost per request in USD |
| `priority` | `int` | Lower = selected first |

---

### `model_mappings` table — `model ModelMapping`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `provider` | `enum` | |
| `provider_model_name` | `varchar` | e.g. `"gpt-4o-mini"` |
| `display_name` | `varchar` | Human-readable name |
| `active` | `boolean` | Only active models in `/v1/models` |
| `pricing_override_usd` | `Decimal?` | Overrides provider-level pricing for this model |

Unique constraint: `(provider, provider_model_name)`

---

## Enums

```sql
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE "ProviderName" AS ENUM ('openai', 'deepseek', 'gemini');
```

---

## Example Queries

### 1. Create an API key and show the one-time plaintext

```typescript
import crypto from 'crypto';
import argon2 from 'argon2';
import { prisma } from './lib/prisma';

async function createApiKey(userId: string, name: string) {
  // Generate raw key
  const rawKey = `sk_${crypto.randomBytes(16).toString('hex')}`; // 34 chars
  const preview = rawKey.slice(-6);                               // last 6

  // Hash with argon2id (stored in DB)
  const keyHash = await argon2.hash(rawKey, { type: argon2.argon2id });

  const apiKey = await prisma.apiKey.create({
    data: { userId, name, key_hash: keyHash, plain_key_preview: preview },
  });

  // Return plaintext ONLY here — never stored in DB
  return { ...apiKey, key: rawKey };
}
```

---

### 2. Look up a user by API key (hash verification)

```typescript
import argon2 from 'argon2';
import { prisma } from './lib/prisma';

async function validateApiKey(rawKey: string) {
  // Fetch all active keys (no lookup by hash — argon2 is not reversible)
  // In production, add a fast-path lookup via a deterministic prefix if needed
  const keys = await prisma.apiKey.findMany({
    where: { active: true },
    select: { id: true, userId: true, key_hash: true },
  });

  for (const key of keys) {
    const valid = await argon2.verify(key.key_hash, rawKey);
    if (valid) return { keyId: key.id, userId: key.userId };
  }
  return null;
}
```

> **Performance note:** For large key counts, consider storing a fast-path SHA-256 prefix
> (first 8 chars of SHA-256 of raw key) in a separate indexed column to narrow candidates.

---

### 3. Atomically reserve wallet funds and commit charge

```typescript
import { prisma } from './lib/prisma';

/** Deduct cost atomically — returns rows-affected count */
async function deductCost(userId: string, costPaisa: number): Promise<void> {
  // Uses raw SQL UPDATE ... WHERE balance >= cost
  // This is atomic in PostgreSQL: no separate SELECT needed
  const result = await prisma.$executeRaw`
    UPDATE wallets
    SET    balance_inr_cents = balance_inr_cents - ${costPaisa}
    WHERE  "userId" = ${userId}
      AND  balance_inr_cents >= ${costPaisa}
  `;

  if (result === 0) {
    throw new Error('INSUFFICIENT_BALANCE');
  }
}

/** Settle a request: reserve → call provider → refund difference */
async function settleRequest(userId: string, reservedPaisa: number, actualPaisa: number) {
  const diff = reservedPaisa - actualPaisa;

  if (diff > 0) {
    // Refund over-reservation
    await prisma.wallet.update({
      where: { userId },
      data: { balance_inr_cents: { increment: diff } },
    });
  } else if (diff < 0) {
    // Charge shortfall (best-effort)
    await deductCost(userId, -diff).catch(() => {});
  }
}

/** Complete a top-up transaction and credit wallet (in a transaction) */
async function completeTopUp(transactionId: string, providerTxId?: string) {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.topUpTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) throw new Error('TX_NOT_FOUND');
    if (transaction.status === 'completed') return transaction; // idempotent

    await tx.topUpTransaction.update({
      where: { id: transactionId },
      data: { status: 'completed', provider_tx_id: providerTxId ?? null },
    });

    await tx.wallet.update({
      where: { userId: transaction.userId },
      data: { balance_inr_cents: { increment: transaction.amount_inr_cents } },
    });

    return transaction;
  });
}
```
