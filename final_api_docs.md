# GenAff Unified API Gateway — Production API Documentation

> Source of truth: generated directly from backend implementation in `src/`, Prisma schema/migrations, and route wiring in `src/server.js`.
> Date: 2026-03-20

---

## 1) Base Information

## Base URLs

| Environment | Base URL | Source |
|---|---|---|
| Local development | `http://localhost:3000` | `src/server.js` default `PORT=3000` |
| Production (documented) | `https://genaff-api.shouriya.tech` | `README.md`, `test.sh` |
| Staging | Not defined in code/docs | — |

## API Surface Prefixes

| Area | Prefix |
|---|---|
| Health | `/health` |
| Auth | `/auth/*` |
| User API Keys | `/keys/*` |
| Wallet/Billing | `/wallet/*` |
| Unified model catalog + completions proxy | `/v1/*` |
| Admin | `/admin/*` |

## Authentication Mechanisms

1. **JWT Bearer token** for user/authenticated routes:
   - `/auth/me`
   - `/keys/*`
   - `/wallet/*`
   - `/admin/*` (plus admin-role check)
2. **Gateway API key** (`sk_genaff_...`) for model proxy:
   - `/v1/chat/completions`
3. **No auth required**:
   - `/health`
   - `/v1/models`
   - `/auth/register`, `/auth/login`, `/auth/verify-otp`, `/auth/verify-email`, `/auth/resend-verification`

## Required Headers

### JSON endpoints
- `Content-Type: application/json` (for requests with body)

### JWT-protected endpoints
- `Authorization: Bearer <JWT>`

### API-key protected endpoint
- `Authorization: Bearer sk_genaff_<48_hex_chars>`

### PDF download endpoints
- `Authorization: Bearer <JWT>`
- Response `Content-Type: application/pdf`

## Supported Content Types

- Request: `application/json`
- Response: primarily `application/json`
- Binary response: `application/pdf` on invoice/statement downloads

---

## 2) Authentication & Authorization

## Signup / Verification / Login Flow

### A. Signup
1. Client calls `POST /auth/register` with email/password.
2. Backend creates user + wallet and sends verification email containing:
   - One-click magic link token
   - 6-digit OTP
3. Account remains usable for login, but **API-key usage is blocked until `email_verified=true`**.

### B. Verify Email
Either:
- `POST /auth/verify-otp` with `{ email, otp }`, or
- `GET /auth/verify-email?token=<uuid>` from magic link.

Both mark user verified and return a JWT.

### C. Login
- `POST /auth/login` returns JWT + user profile.

### D. Token Refresh
- **Not implemented**. No refresh endpoint exists.

## JWT Details

- Signing algo/library: `jsonwebtoken`
- Secret: `JWT_SECRET`
- Expiry: `JWT_EXPIRES_IN` (default `7d`)
- Validation middleware: `authMiddleware`

### JWT payload shape
- Login token payload: `{ id, email, role }`
- Verification-token payload (`verify-otp` / `verify-email`): `{ id, email }`

> Note: `role` may be absent in tokens issued by verification endpoints. Admin access still works because admin middleware re-fetches role from DB.

## Authorization Rules

### User routes
- JWT required; user ID from token used for ownership checks.

### Admin routes
- JWT required **and** DB role must be `ADMIN`.

### Proxy route
- API key must:
  - exist (`key_hash` match)
  - be active
  - belong to user with `email_verified=true`
  - belong to user with `is_suspended=false`

---

## 3) Endpoint Documentation (All Endpoints)

## 3.1 Health

### GET `/health`

**Description**: Service health and runtime metadata.

**Auth**: None  
**Headers**: None required

#### Success Response (200)
**Schema**
```json
{
  "status": "ok",
  "service": "GenAff API Gateway",
  "timestamp": "string (ISO datetime)",
  "env": "string"
}
```

**Example**
```json
{
  "status": "ok",
  "service": "GenAff API Gateway",
  "timestamp": "2026-03-20T08:15:30.123Z",
  "env": "production"
}
```

---

## 3.2 Authentication Endpoints

### POST `/auth/register`

**Description**: Create account and send verification email (OTP + magic link).

**Headers**
- `Content-Type: application/json`

**Request Body Schema**
```json
{
  "email": "string, required, valid email format",
  "password": "string, required, min 8 chars, max 72 chars"
}
```

**Validation Rules**
- `email` required and regex-validated
- `password` length: `8..72`
- email lowercased + trimmed
- duplicate email => `409`

**Example Request**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"Secret@123"}'
```

#### Success Response (201)
```json
{
  "message": "Account created. Please check your email to verify your account.",
  "user_id": "uuid",
  "email": "user@example.com"
}
```

#### Error Responses
- `400` `{ "error": "Email and password are required" }`
- `400` `{ "error": "Invalid email address" }`
- `400` `{ "error": "Password must be at least 8 characters" }`
- `400` `{ "error": "Password must be 72 characters or fewer" }`
- `409` `{ "error": "Email already in use" }`
- `502` `{ "error": "Failed to send verification email. Please try again." }`
- `500` `{ "error": "Internal server error" }`

---

### POST `/auth/login`

**Description**: Login with email/password and receive JWT.

**Rate Limit**: `10 req/min per IP` (`authRateLimiter`)

**Headers**
- `Content-Type: application/json`

**Request Body Schema**
```json
{
  "email": "string, required",
  "password": "string, required"
}
```

**Example Request**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"Secret@123"}'
```

#### Success Response (200)
```json
{
  "message": "Login successful",
  "token": "<JWT>",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "created_at": "2026-03-20T08:00:00.000Z",
    "free_units": 10,
    "role": "USER"
  }
}
```

#### Error Responses
- `400` `{ "error": "Email and password are required" }`
- `401` `{ "error": "Invalid email or password" }`
- `429` `{ "error": "Too many login attempts, please try again later." }`
- `500` `{ "error": "Internal server error" }`

---

### GET `/auth/me`

**Description**: Return authenticated user profile + wallet balance.

**Headers**
- `Authorization: Bearer <JWT>`

**Example Request**
```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <JWT>"
```

#### Success Response (200)
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "created_at": "2026-03-20T08:00:00.000Z",
    "free_units": 10,
    "role": "USER",
    "wallet": {
      "balance_inr": "100.0000"
    }
  }
}
```

#### Error Responses
- `401` `{ "error": "Missing or malformed Authorization header" }`
- `401` `{ "error": "Token expired" }`
- `401` `{ "error": "Invalid token" }`
- `404` `{ "error": "User not found" }`
- `500` `{ "error": "Internal server error" }`

---

### POST `/auth/verify-otp`

**Description**: Verify email using OTP (cross-device flow).

**Rate Limit**: `5 req/15 min per IP` (`otpRateLimiter`)

**Headers**
- `Content-Type: application/json`

**Request Body Schema**
```json
{
  "email": "string, required",
  "otp": "string|number, required (compared as trimmed string)"
}
```

**Example Request**
```bash
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","otp":"047291"}'
```

#### Success Response (200)
```json
{
  "message": "Email verified successfully. Welcome to GenAff!",
  "token": "<JWT>",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "created_at": "2026-03-20T08:00:00.000Z",
    "free_units": 10
  }
}
```

#### Error Responses
- `400` `{ "error": "email and otp are required" }`
- `400` `{ "error": "Invalid verification code" }`
- `404` `{ "error": "No account found with that email" }`
- `404` `{ "error": "No active verification found. Please request a new code." }`
- `409` `{ "error": "Email is already verified" }`
- `410` `{ "error": "Verification code has expired. Please request a new one." }`
- `429` `{ "error": "Too many verification attempts. Please wait 15 minutes or request a new code." }`
- `500` `{ "error": "Internal server error" }`

---

### GET `/auth/verify-email`

**Description**: Verify email using magic-link token.

**Query Params**
| Name | Type | Required | Notes |
|---|---|---|---|
| `token` | string (UUID) | Yes | Magic link token |

**Example Request**
```bash
curl "http://localhost:3000/auth/verify-email?token=<uuid>"
```

#### Success Response (200)
```json
{
  "message": "Email verified successfully. Welcome to GenAff!",
  "token": "<JWT>",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "created_at": "2026-03-20T08:00:00.000Z",
    "free_units": 10
  }
}
```

#### Error Responses
- `400` `{ "error": "token query parameter is required" }`
- `404` `{ "error": "Invalid or expired verification link" }`
- `409` `{ "error": "This verification link has already been used" }`
- `409` `{ "error": "Email is already verified" }`
- `410` `{ "error": "Verification link has expired. Please request a new one." }`
- `500` `{ "error": "Internal server error" }`

---

### POST `/auth/resend-verification`

**Description**: Re-send verification email for unverified account.

**Rate Limit**: `3 req/10 min per IP` (`resendRateLimiter`)

**Headers**
- `Content-Type: application/json`

**Request Body Schema**
```json
{
  "email": "string, required"
}
```

**Example Request**
```bash
curl -X POST http://localhost:3000/auth/resend-verification \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

#### Success Response (200)
Returns 200 in both cases below (anti-user-enumeration):
- email missing from DB
- email already verified

Possible success payloads:
```json
{
  "message": "If that email exists and is unverified, a new code has been sent."
}
```
```json
{
  "message": "A new verification code has been sent to your email."
}
```

#### Error Responses
- `400` `{ "error": "email is required" }`
- `429` `{ "error": "Too many resend attempts. Please wait 10 minutes before trying again." }`
- `502` `{ "error": "Failed to send verification email. Please try again." }`
- `500` `{ "error": "Internal server error" }`

---

## 3.3 API Key Management

> All `/keys/*` endpoints require JWT bearer auth.

### GET `/keys`

**Description**: List active API keys (masked prefix only).

**Headers**
- `Authorization: Bearer <JWT>`

#### Success Response (200)
```json
{
  "keys": [
    {
      "id": "uuid",
      "key_prefix": "sk_genaff_abcd1234...",
      "created_at": "2026-03-20T08:00:00.000Z",
      "active": true
    }
  ]
}
```

#### Errors
- `401` token errors
- `500` internal

---

### POST `/keys`

**Description**: Create new API key (raw key shown once).

**Headers**
- `Authorization: Bearer <JWT>`

**Request Body**: none

#### Success Response (201)
```json
{
  "message": "API key created. Save this key – it will not be shown again.",
  "key": "sk_genaff_<48_hex_chars>",
  "record": {
    "id": "uuid",
    "key_prefix": "sk_genaff_abcd1234...",
    "created_at": "2026-03-20T08:00:00.000Z",
    "active": true
  }
}
```

#### Errors
- `401` token errors
- `500` internal

---

### DELETE `/keys/:id`

**Description**: Soft-revoke API key (sets `active=false`).

**Headers**
- `Authorization: Bearer <JWT>`

**Path Params**
| Name | Type | Required |
|---|---|---|
| `id` | string (UUID) | Yes |

#### Success Response (200)
```json
{ "message": "API key revoked successfully" }
```

#### Errors
- `401` token errors
- `404` `{ "error": "API key not found" }` (wrong key id or not owned by caller)
- `500` internal

---

## 3.4 Wallet, Top-up, Usage, Billing PDFs

> All `/wallet/*` endpoints require JWT bearer auth.

### GET `/wallet`

**Description**: Current wallet state.

#### Success Response (200)
```json
{
  "wallet": {
    "balance_inr": "250.5000",
    "updated_at": "2026-03-20T08:00:00.000Z"
  }
}
```

#### Errors
- `401` token errors
- `404` `{ "error": "Wallet not found" }`
- `500` internal

---

### POST `/wallet/topup/order`

**Description**: Create Razorpay order and internal pending top-up.

**Headers**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Request Body Schema**
```json
{
  "amount": "number|string, required, parsed via parseFloat, must be >= MIN_TOPUP_INR"
}
```

**Validation / Rules**
- `MIN_TOPUP_INR` env (default `10`)
- only one pending top-up per user; if exists returns `409`

**Example Request**
```bash
curl -X POST http://localhost:3000/wallet/topup/order \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"amount":100}'
```

#### Success Response (201)
```json
{
  "order_id": "order_RAZORPAY",
  "amount": 10000,
  "currency": "INR",
  "key_id": "rzp_live_xxx",
  "topup_id": "uuid"
}
```

#### Errors
- `400` `{ "error": "amount is required" }`
- `400` `{ "error": "Minimum top-up is ₹10" }` (message value depends on env)
- `409` `{ "error": "You have a pending top-up order. Complete or cancel it before creating a new one." }`
- `500` internal

---

### POST `/wallet/topup/verify`

**Description**: Verify Razorpay signature and credit wallet atomically.

**Headers**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Request Body Schema**
```json
{
  "razorpay_order_id": "string, required",
  "razorpay_payment_id": "string, required",
  "razorpay_signature": "string (hex), required"
}
```

**Example Request**
```bash
curl -X POST http://localhost:3000/wallet/topup/verify \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "razorpay_order_id":"order_xxx",
    "razorpay_payment_id":"pay_xxx",
    "razorpay_signature":"<hmac_sha256_hex>"
  }'
```

#### Success Response (200)
```json
{
  "message": "₹100 added to your wallet successfully",
  "topUp": {
    "id": "uuid",
    "user_id": "uuid",
    "amount": "100.00",
    "status": "completed",
    "razorpay_order_id": "order_xxx",
    "razorpay_payment_id": "pay_xxx",
    "created_at": "2026-03-20T08:00:00.000Z"
  },
  "new_balance_inr": 350.5
}
```

#### Errors
- `400` missing fields
- `400` invalid signature
- `404` no matching pending top-up for this user/order
- `500` internal

---

### POST `/wallet/topup/cancel`

**Description**: Cancel an existing pending top-up.

**Headers**
- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

**Request Body Schema**
```json
{ "topup_id": "string (UUID), required" }
```

#### Success Response (200)
```json
{
  "message": "Top-up order cancelled",
  "topUp": {
    "id": "uuid",
    "status": "cancelled"
  }
}
```

#### Errors
- `400` `{ "error": "topup_id is required" }`
- `404` `{ "error": "No pending top-up order found with that id" }`
- `500` internal

---

### GET `/wallet/history`

**Description**: Top-up history (latest 20 by default in service).

#### Success Response (200)
```json
{
  "history": [
    {
      "id": "uuid",
      "amount": "100.00",
      "status": "completed",
      "razorpay_order_id": "order_xxx",
      "razorpay_payment_id": "pay_xxx",
      "created_at": "2026-03-20T08:00:00.000Z"
    }
  ]
}
```

#### Errors
- `401` token errors
- `500` internal

---

### GET `/wallet/usage`

**Description**: Paginated API usage records for authenticated user.

**Query Params**
| Name | Type | Required | Default |
|---|---|---|---|
| `page` | integer | No | `1` |
| `limit` | integer | No | `20` |

**Example Request**
```bash
curl "http://localhost:3000/wallet/usage?page=1&limit=20" \
  -H "Authorization: Bearer <JWT>"
```

#### Success Response (200)
```json
{
  "records": [
    {
      "id": "uuid",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "tokens_used": 345,
      "cost_inr": "0.009790",
      "created_at": "2026-03-20T08:00:00.000Z",
      "api_key": { "key_prefix": "sk_genaff_abcd1234..." }
    }
  ],
  "total": 123,
  "page": 1,
  "limit": 20
}
```

#### Errors
- `401` token errors
- `500` internal

---

### GET `/wallet/stats`

**Description**: Aggregated usage totals.

#### Success Response (200)
```json
{
  "stats": {
    "total_requests": 120,
    "total_tokens": 456789,
    "total_spent_inr": 321.45
  }
}
```

#### Errors
- `401` token errors
- `500` internal

---

### GET `/wallet/invoice/:topupId/pdf`

**Description**: Download invoice PDF for a completed top-up.

**Headers**
- `Authorization: Bearer <JWT>`

**Path Params**
| Name | Type | Required |
|---|---|---|
| `topupId` | string (UUID) | Yes |

#### Success Response (200)
- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="genaff-invoice-<8chars>.pdf"`

#### Errors (JSON)
- `400` invoice only for completed top-up
- `404` top-up not found (or not owned by user)
- `401` token errors
- `500` internal

---

### GET `/wallet/statement/pdf`

**Description**: Download wallet statement PDF for date range.

**Headers**
- `Authorization: Bearer <JWT>`

**Query Params**
| Name | Type | Required | Default |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | No | last 30 days |
| `to` | `YYYY-MM-DD` | No | now |

#### Success Response (200)
- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="genaff-wallet-statement-<from>-to-<to>.pdf"`

#### Errors (JSON)
- `400` invalid date format
- `400` `"from" date must be before "to" date`
- `404` user not found
- `401` token errors
- `500` internal

---

## 3.5 Model Catalog + Chat Completions Proxy

### GET `/v1/models`

**Description**: List all supported models and pricing per 1k tokens in INR.

**Auth**: none

#### Success Response (200)
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "owned_by": "genaff",
      "price_per_1k_inr": 0.0284
    }
  ]
}
```

---

### POST `/v1/chat/completions`

**Description**: Unified AI chat endpoint (OpenAI/DeepSeek/Gemini/NVIDIA-backed aliases).

**Middleware order**
1. `proxyRateLimiter` (per API key)
2. `apiKeyMiddleware`
3. `chatCompletions` controller

**Headers**
- `Authorization: Bearer sk_genaff_<48_hex_chars>`
- `Content-Type: application/json`

**Rate Limit**
- `RATE_LIMIT_RPM` per minute per API key (default `20`)

**Request Body Schema**
```json
{
  "model": "string, required",
  "messages": [
    {
      "role": "string (user|assistant|system expected by providers)",
      "content": "string"
    }
  ],
  "max_tokens": "number, optional",
  "temperature": "number, optional"
}
```

**Validation/Rules**
- `model` must be non-empty string
- `messages` must be non-empty array
- user model restrictions checked (`user_model_restrictions`)
- provider inferred by model naming / alias map
- pre-check rejects if wallet<=0 and free_units<=0 (`402`)
- billing uses provider token usage and pricing map
- free units consumed before wallet deduction

**Example Request**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_genaff_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gemini-2.5-flash",
    "messages":[{"role":"user","content":"Hello"}],
    "max_tokens":200,
    "temperature":0.7
  }'
```

#### Success Response (200)
Response shape is provider-normalized to OpenAI-like structure for Gemini; OpenAI/DeepSeek/NVIDIA generally pass through OpenAI-compatible payloads.

Typical shape:
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 80,
    "total_tokens": 100
  }
}
```

#### Error Responses
- `400` `"model" is required`
- `400` `"messages" array is required`
- `400` unsupported model
- `401` missing/malformed auth header
- `401` invalid key format
- `401` invalid API key
- `402` insufficient balance/free units
- `403` API key disabled
- `403` email not verified
- `403` account suspended
- `403` model restricted for this account
- `429` rate limit exceeded
- `502` provider error (includes `detail`)
- `500` internal

---

## 3.6 Admin Endpoints

> All admin endpoints require:
> - `Authorization: Bearer <JWT>`
> - Valid token user exists
> - DB role is `ADMIN`

Non-admin response:
```json
{
  "error": "Forbidden. Admin access required.",
  "userEmail": "user@example.com"
}
```

### GET `/admin/dashboard`

**Description**: High-level metrics: revenue, user counts, top users/models, failed transactions.

#### Success Response (200)
```json
{
  "success": true,
  "data": {
    "revenue": {
      "all_time_inr": "50000.00",
      "last_30_days_inr": "12500.50"
    },
    "users": {
      "total_count": 150,
      "active_last_30_days": 45,
      "active_last_24_hours": 12
    },
    "top_users_by_spending": [
      {
        "user_id": "uuid",
        "email": "user@example.com",
        "total_spent_inr": "5000.00"
      }
    ],
    "top_models_by_usage": [
      {
        "model": "gpt-4o-mini",
        "usage_count": 450,
        "total_tokens": 1250000,
        "total_cost_inr": "2500.00"
      }
    ],
    "failed_transactions": {
      "last_30_days": 3,
      "all_time": 8
    }
  }
}
```

#### Errors
- `401`, `403`, `500` (`{ error, details }` pattern on admin controller errors)

---

### GET `/admin/users`

**Description**: Paginated user list.

**Query Params**
| Name | Type | Required | Default |
|---|---|---|---|
| `page` | integer | No | `1` |
| `limit` | integer | No | `50` |

#### Success Response (200)
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "role": "USER",
        "is_suspended": false,
        "created_at": "2026-03-20T08:00:00.000Z",
        "email_verified": true
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "totalCount": 150,
      "totalPages": 3
    }
  }
}
```

---

### GET `/admin/users/:userId`

**Description**: Detailed user profile + wallet + recent usage/topups + keys + restrictions.

**Path Params**
| Name | Type | Required |
|---|---|---|
| `userId` | string (UUID) | Yes |

#### Success Response (200)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "USER",
      "is_suspended": false,
      "email_verified": true,
      "created_at": "2026-03-20T08:00:00.000Z",
      "free_units": 10
    },
    "wallet": {
      "balance_inr": "1250.75",
      "last_updated": "2026-03-20T10:00:00.000Z"
    },
    "statistics": {
      "total_spent_inr": "450.25",
      "total_topup_inr": "1500.00",
      "total_api_calls": 234,
      "active_api_keys": 2
    },
    "recent_usages": [],
    "recent_topups": [],
    "api_keys": [],
    "restricted_models": []
  }
}
```

#### Errors
- `404` user not found
- `401`/`403` auth errors
- `500`

---

### PUT `/admin/users/:userId/status`

**Description**: Suspend/activate user and deactivate/reactivate all API keys.

**Path Params**
- `userId` (UUID)

**Request Body Schema**
```json
{ "suspend": "boolean, required" }
```

**Rules**
- admin cannot suspend own account

#### Success Response (200)
```json
{
  "success": true,
  "message": "User user@example.com has been suspended",
  "data": {
    "user_id": "uuid",
    "suspended": true
  }
}
```

#### Errors
- `400` invalid `suspend` type
- `400` self-suspend attempt
- `404` user not found
- `401`/`403`
- `500`

---

### DELETE `/admin/users/:userId`

**Description**: Permanently delete user account (cascade deletes related entities).

**Rules**
- admin cannot delete own account

#### Success Response (200)
```json
{
  "success": true,
  "message": "User user@example.com deleted successfully",
  "data": {
    "user_id": "uuid",
    "email": "user@example.com",
    "role": "USER"
  }
}
```

#### Errors
- `400` self-delete attempt
- `404` user not found
- `401`/`403`
- `500`

---

### PATCH `/admin/users/:userId/free-units`

**Description**: Add/set free units for a user.

**Request Body Schema**
```json
{
  "units": "integer >= 0, required",
  "mode": "string optional, one of 'add'|'set', default 'add'"
}
```

#### Success Response (200)
```json
{
  "success": true,
  "message": "Added 5 free units to user@example.com",
  "data": {
    "user_id": "uuid",
    "email": "user@example.com",
    "previous_free_units": 10,
    "current_free_units": 15,
    "mode": "add",
    "units": 5
  }
}
```

#### Errors
- `400` invalid units
- `400` invalid mode
- `404` user not found
- `401`/`403`
- `500`

---

### GET `/admin/users/:userId/model-restrictions`

**Description**: Get restricted model IDs for a user.

#### Success Response (200)
```json
{
  "success": true,
  "data": {
    "user_id": "uuid",
    "email": "user@example.com",
    "restricted_models": ["gpt-5", "gemini-2.5-pro"]
  }
}
```

#### Errors
- `404` user not found
- `401`/`403`
- `500`

---

### PUT `/admin/users/:userId/model-restrictions`

**Description**: Replace complete restriction list for user.

**Request Body Schema**
```json
{
  "restricted_models": "array<string>, optional default []"
}
```

**Validation Rules**
- must be array
- each item non-empty string
- every model must be in supported model catalog
- values normalized lowercase + deduplicated

#### Success Response (200)
```json
{
  "success": true,
  "message": "Updated restricted models for user@example.com",
  "data": {
    "user_id": "uuid",
    "email": "user@example.com",
    "restricted_models": ["gpt-5", "gemini-2.5-pro"]
  }
}
```

#### Errors
- `400` invalid array/items/unsupported model
- `404` user not found
- `401`/`403`
- `500`

---

### GET `/admin/models/analytics`

**Description**: Usage grouped by model+provider in date range.

**Query Params**
| Name | Type | Required | Default |
|---|---|---|---|
| `from` | date string parseable by JS `Date` | No | now - 30d |
| `to` | date string parseable by JS `Date` | No | now |

#### Success Response (200)
```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-02-20T00:00:00.000Z",
      "to": "2026-03-20T23:59:59.999Z"
    },
    "model_analytics": [
      {
        "model": "gpt-4o-mini",
        "provider": "openai",
        "usage_count": 450,
        "total_tokens": 1250000,
        "total_cost_inr": "2500.00"
      }
    ]
  }
}
```

---

### GET `/admin/revenue/breakdown`

**Description**: Usage revenue by model + top-up revenue + summary.

**Query Params**: `from`, `to` (same behavior as above)

#### Success Response (200)
```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-02-20T00:00:00.000Z",
      "to": "2026-03-20T23:59:59.999Z"
    },
    "revenue_by_model": [
      {
        "model": "gpt-4o-mini",
        "usage_count": 450,
        "revenue_inr": "2500.00"
      }
    ],
    "topup_revenue": {
      "total_inr": "15000.00",
      "transaction_count": {
        "id": 25
      }
    },
    "summary": {
      "usage_revenue_inr": "4460.00",
      "topup_revenue_inr": "15000.00",
      "total_revenue_inr": "19460.00"
    }
  }
}
```

> `transaction_count` currently returns Prisma `_count` object shape, not flattened int.

---

### GET `/admin/transactions`

**Description**: Combined top-up and usage transaction feed.

**Query Params**
| Name | Type | Required | Default |
|---|---|---|---|
| `page` | integer | No | `1` |
| `limit` | integer | No | `100` |
| `type` | string enum `topup|usage` | No | both |

#### Success Response (200)
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "uuid",
        "type": "TOPUP",
        "user_id": "uuid",
        "amount_inr": "500.00",
        "status": "completed",
        "created_at": "2026-03-20T08:00:00.000Z"
      },
      {
        "id": "uuid",
        "type": "USAGE",
        "user_id": "uuid",
        "model": "gpt-4o-mini",
        "amount_inr": "25.50",
        "tokens_used": 5000,
        "created_at": "2026-03-20T09:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "totalTransactions": 1250,
      "topupCount": 250,
      "usageCount": 1000
    }
  }
}
```

#### Errors
- `401`/`403`
- `500`

---

## 4) Error Handling

## Global Patterns

There is **no single strict global schema** across all handlers. Actual response shapes used:

1. Most endpoints:
```json
{ "error": "message" }
```

2. Some endpoints include extra fields:
```json
{ "error": "Provider error", "detail": "..." }
```
```json
{ "error": "Failed to fetch ...", "details": "..." }
```
```json
{ "error": "...", "message": "..." }
```

3. Admin success responses usually include:
```json
{ "success": true, "data": { ... } }
```

## Status Codes Used

| Code | Meaning in this API |
|---|---|
| `200` | Success |
| `201` | Resource created |
| `400` | Validation / malformed input |
| `401` | Missing/invalid/expired JWT or invalid API key format/key |
| `402` | Insufficient wallet + free units |
| `403` | Forbidden (non-admin, suspended account, disabled key, restricted model, unverified email) |
| `404` | Resource not found |
| `409` | Conflict (duplicate email, already verified, pending order exists) |
| `410` | Expired verification OTP/link |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Upstream provider/email gateway errors |

## Known Failure Scenarios

- Invalid JWT / token expiry
- API key revoked or malformed
- Email not verified for proxy usage
- Suspended user cannot proxy
- Model unsupported or restricted
- Wallet empty and no free units
- Razorpay signature mismatch
- Existing pending top-up prevents new order
- Provider timeout/failure (mapped to `502`)

---

## 5) Data Models

> Derived from `prisma/schema.prisma`.

## User

| Field | Type | Constraints / Default |
|---|---|---|
| `id` | string UUID | PK, default `uuid()` |
| `email` | string | unique, required |
| `password_hash` | string | required |
| `created_at` | datetime | default `now()` |
| `free_units` | int | default `10` |
| `email_verified` | bool | default `false` |
| `role` | enum `USER|ADMIN` | default `USER` |
| `is_suspended` | bool | default `false` |

Relations: `api_keys`, `wallet`, `usages`, `top_ups`, `pending_verifications`, `model_restrictions`

## PendingVerification

| Field | Type | Constraints / Default |
|---|---|---|
| `id` | string UUID | PK |
| `user_id` | string UUID | FK → users, cascade delete |
| `otp` | string | required (6-digit generated) |
| `token` | string UUID | unique |
| `expires_at` | datetime | required |
| `used` | bool | default `false` |
| `created_at` | datetime | default `now()` |

## ApiKey

| Field | Type | Constraints / Default |
|---|---|---|
| `id` | string UUID | PK |
| `key_hash` | string | unique SHA-256 of raw key |
| `key_prefix` | string | masked display prefix |
| `user_id` | string UUID | FK → users |
| `created_at` | datetime | default `now()` |
| `active` | bool | default `true` |

## Wallet

| Field | Type | Constraints / Default |
|---|---|---|
| `id` | string UUID | PK |
| `user_id` | string UUID | unique FK → users |
| `balance_inr` | decimal(10,4) | default `0` |
| `updated_at` | datetime | auto-updated |

## Usage

| Field | Type | Constraints / Default |
|---|---|---|
| `id` | string UUID | PK |
| `user_id` | string UUID | FK → users |
| `api_key_id` | string UUID | FK → api_keys |
| `provider` | string | e.g. `openai`, `deepseek`, `gemini`, `nvidia` |
| `model` | string | required |
| `tokens_used` | int | required |
| `cost_inr` | decimal(10,6) | required |
| `created_at` | datetime | default `now()` |

## TopUp

| Field | Type | Constraints / Default |
|---|---|---|
| `id` | string UUID | PK |
| `user_id` | string UUID | FK → users |
| `amount` | decimal(10,2) | required |
| `status` | string | default `pending` (`pending|completed|failed|cancelled` observed) |
| `razorpay_order_id` | string nullable | unique |
| `razorpay_payment_id` | string nullable | optional |
| `created_at` | datetime | default `now()` |

## UserModelRestriction

| Field | Type | Constraints / Default |
|---|---|---|
| `id` | string UUID | PK |
| `user_id` | string UUID | FK → users |
| `model` | string | required |
| `created_at` | datetime | default `now()` |

Constraints:
- unique composite (`user_id`, `model`)
- index on `user_id`

---

## 6) Core Flows

## 6.1 Authentication Flow

1. `POST /auth/register`
   - validates email/password
   - creates user (`email_verified=false`) + wallet
   - creates single active pending verification record
   - sends OTP + magic-link email
2. Verify via OTP or magic link
   - marks verification `used=true`
   - sets `user.email_verified=true`
   - returns JWT
3. `POST /auth/login`
   - validates credentials
   - returns JWT for session
4. Protected endpoints consume JWT via `authMiddleware`

## 6.2 Request Lifecycle Through API Gateway (`/v1/chat/completions`)

1. Rate limiter checks API key bucket (`RATE_LIMIT_RPM`/minute)
2. API key middleware validates key + loads user/wallet/restrictions
3. Controller validates request payload
4. Restriction check (`user_model_restrictions`)
5. Provider detection from model ID
6. Pre-check funds (`wallet balance` or `free_units`)
7. Forward request to provider adapter
8. Compute INR cost via pricing map (`USD_TO_INR=86` currently hardcoded)
9. Billing:
   - consume 1 `free_unit` first if available
   - else atomic SQL wallet deduction if sufficient balance
10. Async usage log
11. Return provider response

## 6.3 Service Routing Logic

Provider chosen by `detectProvider(model)`:
- `gpt-*` or `o*` ⇒ OpenAI adapter
- `deepseek*` ⇒ DeepSeek adapter
- `gemini*` ⇒ Gemini adapter
- exact alias in `NVIDIA_MODEL_MAP` ⇒ NVIDIA adapter
- otherwise unsupported model

Gemini adapter converts OpenAI-style messages to Gemini `contents`, then normalizes response back to OpenAI-like shape.

---

## 7) Edge Cases & System Constraints

## Rate Limiting

| Scope | Limit | Key |
|---|---|---|
| `/v1/chat/completions` | `RATE_LIMIT_RPM` per minute (default 20) | API key token from `Authorization` |
| `/auth/login` | 10/min | IP |
| `/auth/resend-verification` | 3/10min | IP |
| `/auth/verify-otp` | 5/15min | IP |

> Store is in-memory (`express-rate-limit` default). In multi-instance deployments limits are not globally shared.

## Pagination

- `/wallet/usage`: `{ records, total, page, limit }`
- `/admin/users`: `data.pagination { page, limit, totalCount, totalPages }`
- `/admin/transactions`: `data.pagination { page, limit, totalTransactions, topupCount, usageCount }`

## Filtering/Sorting

- `/admin/models/analytics` and `/admin/revenue/breakdown`: optional date range filtering (`from`, `to`)
- `/admin/transactions`: `type=topup|usage`, merged feed sorted by `created_at desc`

## Timeouts & Retries

- Upstream provider HTTP timeout: `120000ms`
- No automatic retry logic implemented for upstream calls

## Idempotency

- No explicit idempotency keys supported.
- Top-up order creation guarded by “single pending top-up per user” rule.

## Billing / Consistency Constraints

- Wallet deduction uses atomic SQL guard (`balance_inr >= cost`) to prevent overdraft.
- If deduction fails after provider success (race/concurrency), response can still be success and usage may remain effectively unbilled.

---

## 8) Frontend Integration Guide

## 8.1 Recommended Auth Handling

1. Register user
2. Prompt for OTP or process magic-link callback
3. Store JWT securely (prefer HTTP-only cookie if backend/frontend architecture allows; otherwise secure storage with XSS mitigations)
4. Use JWT for `/keys`, `/wallet`, `/admin`
5. Generate API key once and store securely client-side only as needed
6. Use API key for `/v1/chat/completions`

## 8.2 Request Construction Patterns

### JWT request (Axios)
```ts
import axios from 'axios';

const api = axios.create({ baseURL: 'https://genaff-api.shouriya.tech' });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('jwt');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const { data } = await api.get('/wallet');
```

### API-key request (fetch)
```ts
const apiKey = '<sk_genaff_...>';
const res = await fetch('https://genaff-api.shouriya.tech/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello' }]
  })
});

if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  throw new Error(err.error || `HTTP ${res.status}`);
}

const json = await res.json();
```

## 8.3 Client Error Strategy

- Handle auth classes separately:
  - `401`: re-auth/login
  - `403`: permission/account state issue
  - `402`: prompt top-up
  - `429`: backoff + retry later
- Parse optional fields (`message`, `detail`, `details`) in addition to `error`.
- For PDF endpoints, branch by `Content-Type`:
  - `application/pdf` => blob download
  - `application/json` => parse error payload

## 8.4 Top-up UX Sequence

1. `POST /wallet/topup/order`
2. Open Razorpay checkout using returned `order_id` + `key_id`
3. On payment callback, call `POST /wallet/topup/verify`
4. Refresh `/wallet` and `/wallet/history`

---

## 9) Unknowns / Assumptions (Explicit, No Guessing)

1. **Staging environment URL** is not defined anywhere.
2. **Token refresh flow** is not implemented (no refresh token endpoint or rotation).
3. **CORS allowed methods** in server are `GET,POST,DELETE,OPTIONS`; admin routes use `PUT` and `PATCH`. Code behavior depends on runtime CORS preflight handling with this mismatch.
4. **Admin docs drift**: `ADMIN_API.md` does not include all currently implemented admin endpoints (`DELETE /admin/users/:userId`, free-units, model-restrictions APIs).
5. **Admin credentials in docs/script differ** (`@gmail` vs `@gmail.com`) and are operationally inconsistent.
6. **“Active users” metric naming** in dashboard implies activity but is implemented using `users.created_at` window (new users), not usage/top-up activity.
7. **Provider/model availability** depends on external API keys and provider account state (quota/billing), not guaranteed by backend alone.
8. **Billing consistency edge**: successful provider response may still return 200 even if wallet deduction fails due to concurrent balance drain.
9. **Error schema standardization** is not uniform across all controllers; frontend should tolerate variant payloads.

---

## Appendix A — Model/Provider Notes

- Model catalog is generated from `MODEL_PRICING` in backend.
- Provider detection is string-based and may route new model IDs unexpectedly if naming conventions overlap.
- DeepSeek MAAS models are explicitly rejected in provider adapter with guidance.
- NVIDIA-backed aliases are intentionally abstracted; upstream provider identity not exposed in API response schema.

---

## Appendix B — Minimal OpenAPI-like Route Index

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | None |
| POST | `/auth/register` | None |
| POST | `/auth/login` | None |
| GET | `/auth/me` | JWT |
| POST | `/auth/verify-otp` | None |
| GET | `/auth/verify-email` | None |
| POST | `/auth/resend-verification` | None |
| GET | `/keys` | JWT |
| POST | `/keys` | JWT |
| DELETE | `/keys/:id` | JWT |
| GET | `/wallet` | JWT |
| POST | `/wallet/topup/order` | JWT |
| POST | `/wallet/topup/verify` | JWT |
| POST | `/wallet/topup/cancel` | JWT |
| GET | `/wallet/history` | JWT |
| GET | `/wallet/usage` | JWT |
| GET | `/wallet/stats` | JWT |
| GET | `/wallet/invoice/:topupId/pdf` | JWT |
| GET | `/wallet/statement/pdf` | JWT |
| GET | `/v1/models` | None |
| POST | `/v1/chat/completions` | API Key |
| GET | `/admin/dashboard` | JWT + ADMIN |
| GET | `/admin/users` | JWT + ADMIN |
| GET | `/admin/users/:userId` | JWT + ADMIN |
| PUT | `/admin/users/:userId/status` | JWT + ADMIN |
| DELETE | `/admin/users/:userId` | JWT + ADMIN |
| PATCH | `/admin/users/:userId/free-units` | JWT + ADMIN |
| GET | `/admin/users/:userId/model-restrictions` | JWT + ADMIN |
| PUT | `/admin/users/:userId/model-restrictions` | JWT + ADMIN |
| GET | `/admin/models/analytics` | JWT + ADMIN |
| GET | `/admin/revenue/breakdown` | JWT + ADMIN |
| GET | `/admin/transactions` | JWT + ADMIN |
