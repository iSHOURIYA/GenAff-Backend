# GenAff API Changelog

## Versioning Strategy

GenAff follows **Semantic Versioning** for the API:

| Change type | Version bump | Backward compatible? |
|-------------|-------------|----------------------|
| New endpoints or optional fields | MINOR (`1.1.0`) | ✅ Yes |
| New required fields or breaking schema changes | MAJOR (`2.0.0`) | ❌ No |
| Bug fixes, error message changes | PATCH (`1.0.1`) | ✅ Yes |

The API version is reflected in the `info.version` field of `openapi.yaml` and
communicated via the `X-API-Version` response header (planned).

### URL versioning
- Proxy endpoints use `/v1/` prefix and will increment to `/v2/` on breaking changes.
- Dashboard/admin endpoints (auth, keys, wallet) are unversioned currently. A `/v1/` prefix
  is recommended for future-proofing and will be added before a 2.0 release.

---

## Backward Compatibility Policy

1. **New optional request fields** — always safe; existing clients ignore them.
2. **New response fields** — always safe; clients should ignore unknown fields.
3. **Removing fields** — requires MAJOR version bump with 90-day deprecation notice.
4. **Changing field types** — requires MAJOR version bump.
5. **New enum values** — treated as MINOR; clients must handle unknown enums gracefully.
6. **Error code changes** — HTTP status codes are stable; error message text may change in PATCH.

---

## v1.0.0 — 2026-03-08 (Initial Release)

### Added
- `POST /auth/register` — user registration with free unit grant
- `POST /auth/login` — JWT authentication
- `GET /me` — current user profile with wallet balance
- `GET /keys` — list API keys
- `POST /keys` — create API key (argon2 hashed, one-time plaintext)
- `PATCH /keys/:id/disable` — disable key
- `DELETE /keys/:id` — delete key
- `POST /wallet/topup/initiate` — Razorpay / manual top-up initiation
- `GET /billing/usage` — user usage history with date filters
- `POST /v1/chat/completions` — OpenAI-compatible chat completions proxy
- `GET /v1/models` — list active models from database
- `POST /webhooks/payments` — Razorpay HMAC-verified webhook
- `GET /admin/providers` — list provider configs
- `POST /admin/providers` — upsert provider pricing/priority
- `GET /admin/users` — paginated user list
- `PATCH /admin/users/:id/credits` — adjust free units and wallet balance
- `GET /admin/usage` — platform-wide usage with filters and pagination
- `POST /admin/topup-mock` — dev-only manual top-up approval

### Security
- JWT RS256/HS256 via `@fastify/jwt`
- argon2id for all secret hashing (passwords + API keys)
- HMAC-SHA256 webhook signature verification with `crypto.timingSafeEqual`
- Atomic wallet deduction prevents double-spend via conditional SQL UPDATE
- Non-root Docker user (`genaff:nodejs`)

### Infrastructure
- Multi-stage Alpine Dockerfile with OpenSSL 3.x compatibility
- Redis sliding-window rate limiter (20/min, 500/day defaults)
- Hourly reconciliation cron job for stuck `reserved` billing records
- Prisma 5.x with PostgreSQL 16

---

## Upcoming / Planned

### v1.1.0 (planned)
- `GET /admin/users/:id` — get single user details
- `POST /auth/refresh` — JWT refresh without re-login
- `GET /billing/summary` — aggregated spend by model/provider
- Streaming support: `POST /v1/chat/completions` with `stream: true` (SSE)
- `X-API-Version` response header on all endpoints
- Rate limit configuration per user (override default 20/min via admin)

### v1.2.0 (planned)
- `POST /keys/:id/rotate` — rotate API key while preserving usage history
- Webhook delivery log (admin endpoint)
- Per-model pricing overrides in request body
- Usage alerts (email on low balance threshold)

### v2.0.0 (planned — breaking)
- Versioned URL prefix `/v1/` for all non-proxy endpoints
- Replace `balance_inr_cents` field name with `balance_paisa` for clarity
- Standardize all pagination responses to `{ data, total, page, limit, pages }`
