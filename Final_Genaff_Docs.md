# GenAff — Complete Integration Documentation v1.0

> **Philosophy:** Zero-framework assumptions, maximum detail.
> Every endpoint is shown in 3 layers: Raw cURL → Vanilla JS `fetch()` → Axios.
> All response schemas include exact field types, constraints, and example values.

---

## Table of Contents

0. [Overview & Philosophy](#0-overview--philosophy)
1. [Environment & Setup](#1-environment--setup)
2. [Authentication & Authorization](#2-authentication--authorization)
3. [API Key Management](#3-api-key-management)
4. [AI Proxy (The Core Feature)](#4-ai-proxy)
5. [Wallet & Payments (Razorpay)](#5-wallet--payments)
6. [Usage & Billing](#6-usage--billing)
7. [Playground](#7-playground)
8. [Admin APIs](#8-admin-apis)
9. [Error Handling & Status Codes](#9-error-handling)
10. [Rate Limiting](#10-rate-limiting)
11. [Complete TypeScript Types](#11-typescript-types)
12. [Security Best Practices](#12-security-best-practices)
13. [Complete Copy-Paste Integration Examples](#13-integration-examples)
14. [Future Scope](#14-future-scope)

---

## 0. Overview & Philosophy

### What GenAff Is

GenAff is a unified AI API gateway that proxies chat-completion requests to 4 providers (OpenAI, DeepSeek, Gemini, NVIDIA NIM) through a single OpenAI-compatible endpoint — with built-in billing, usage tracking, and wallet management.

### Who This Doc Is For

- **Frontend developers** integrating GenAff into React/Vue/Svelte apps
- **Backend developers** building services on top of GenAff
- **Mobile developers** consuming the API from iOS/Android
- **Admin panel builders** creating internal tools

### Framework-Agnostic Promise

Every endpoint example is shown in 3 equivalent patterns so you never have to translate:

| Layer | Use Case |
|-------|----------|
| `cURL` | Testing, debugging, backend-to-backend |
| `fetch()` | Vanilla JS, framework-agnostic baseline |
| `Axios` | Most SPAs (React, Vue, etc.) |

### Base URL

```
Production:  https://genaff-api.shouriya.tech
Development: http://localhost:3000
```

Set once in your app config. All paths are relative to this base:

```js
const BASE_URL = 'https://genaff-api.shouriya.tech';
```

### Authentication Mechanisms

| Auth Type | Header Format | Used For | Section |
|-----------|--------------|----------|---------|
| JWT Bearer | `Authorization: Bearer <jwt>` | User account actions (login, wallet, keys, playground) | §2, §3, §5, §6, §7 |
| API Key Bearer | `Authorization: Bearer sk_genaff_...` | AI proxy calls (`/v1/chat/completions`) | §4 |

---

## 1. Environment & Setup

### Required Environment Variables for Frontend

```bash
# .env (frontend)
VITE_API_BASE_URL=https://genaff-api.shouriya.tech   # API base
VITE_RAZORPAY_KEY_ID=rzp_live_...                     # Razorpay Key ID (public)
```

### Base URL Configuration

```js
// config/api.js
export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID;
```

### CORS Behavior

The server allows requests from:
- `config.FRONTEND_URL` (your production frontend)
- `http://localhost:3000` (default dev)
- `http://localhost:5173` (Vite dev server)
- Any request with no `Origin` header (curl, Postman, server-to-server)

CORS methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
CORS headers: `Content-Type, Authorization`
Credentials: enabled (cookies not currently used, but pre-configured)

**Note:** Only the origins above are whitelisted. If your dev port differs, add it to `src/server.js`.

### SSL / HTTPS

In production, all requests **must** use HTTPS. The server is configured behind Nginx with Certbot SSL. The API domain serves only HTTPS.

### Testing Connectivity

```bash
# cURL
curl https://genaff-api.shouriya.tech/health
```

```js
// fetch()
const res = await fetch(`${API_BASE}/health`);
const data = await res.json();
console.log(data); // { status: "ok", service: "GenAff API Gateway", ... }
```

```js
// Axios
const { data } = await axios.get(`${API_BASE}/health`);
```

**Response:**
```json
{
  "status": "ok",
  "service": "GenAff API Gateway",
  "timestamp": "2026-06-21T10:30:00.000Z",
  "env": "production"
}
```

---

## 2. Authentication & Authorization

### Complete Flow Summary

```
Register → Verify Email (OTP or Magic Link) → Login → Get JWT → Use JWT for all protected routes
                                                              ↓
                                                    Forgot Password → Reset Password → Login
```

### 2.1 Register

**Endpoint:** `POST /auth/register`

Creates a new user account, auto-creates a wallet with ₹0 balance, and sends a verification email.

**Constraints:**
- Password: 8–72 characters
- Email: valid format, no disposable domains (mailinator, tempmail, etc.)
- Free units (10) granted only after email verification — NOT on registration

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

```bash
# cURL
curl -X POST https://genaff-api.shouriya.tech/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"SecurePass123"}'
```

```js
// fetch()
const res = await fetch(`${API_BASE}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', password: 'SecurePass123' })
});
const data = await res.json();
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/auth/register`, {
  email: 'user@example.com',
  password: 'SecurePass123'
});
```

**Response (201 Created):**
```json
{
  "message": "Account created. Please check your email to verify your account.",
  "user_id": "a1b2c3d4-...",
  "email": "user@example.com"
}
```

**Response (400 Bad Request):**
```json
{ "error": "Email and password are required" }
{ "error": "Invalid email address" }
{ "error": "Disposable email domains are not allowed" }
{ "error": "Password must be at least 8 characters" }
{ "error": "Password must be 72 characters or fewer" }
```

**Response (409 Conflict):**
```json
{ "error": "Email already in use" }
```

---

### 2.2 Email Verification (Dual Flow)

The verification email contains **both**:
1. A **magic link** (same-device, one click): `<FRONTEND_URL>/auth/verify-email?token=<uuid>`
2. A **6-digit OTP** (cross-device, manual entry)

Users choose whichever works for their workflow. Both methods grant 10 free units on first verification.

#### 2.2a Magic Link Verification

**Endpoint:** `GET /auth/verify-email?token=<uuid>`

The frontend should extract the `token` query parameter from the magic link URL and call this endpoint.

```bash
# cURL
curl "https://genaff-api.shouriya.tech/auth/verify-email?token=550e8400-e29b-41d4-a716-446655440000"
```

```js
// fetch() — called when user lands on /auth/verify-email?token=...
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const res = await fetch(`${API_BASE}/auth/verify-email?token=${token}`);
const data = await res.json();
```

```js
// Axios
const token = new URLSearchParams(window.location.search).get('token');
const { data } = await axios.get(`${API_BASE}/auth/verify-email`, { params: { token } });
```

**Response (200 OK):**
```json
{
  "message": "Email verified successfully. Welcome to GenAff!",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "a1b2c3d4-...",
    "email": "user@example.com",
    "created_at": "2026-06-21T10:00:00.000Z",
    "free_units": 10
  }
}
```

**Response (404):** `{ "error": "Invalid or expired verification link" }`
**Response (410):** `{ "error": "Verification link has expired. Please request a new one." }`
**Response (409):** `{ "error": "This verification link has already been used" }`

#### 2.2b OTP Verification

**Endpoint:** `POST /auth/verify-otp`

For cross-device users who opened email on a different device.

**Request:**
```json
{
  "email": "user@example.com",
  "otp": "482901"
}
```

```bash
# cURL
curl -X POST https://genaff-api.shouriya.tech/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","otp":"482901"}'
```

```js
// fetch()
const res = await fetch(`${API_BASE}/auth/verify-otp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', otp: '482901' })
});
const data = await res.json();
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/auth/verify-otp`, {
  email: 'user@example.com',
  otp: '482901'
});
```

**Response (200):** Same as magic link verification — returns JWT + user object.

**Response (400):** `{ "error": "Invalid verification code" }`
**Response (404):** `{ "error": "No active verification found. Please request a new code." }`
**Response (410):** `{ "error": "Verification code has expired. Please request a new one." }`
**Response (409):** `{ "error": "Email is already verified" }`

---

### 2.3 Resend Verification

**Endpoint:** `POST /auth/resend-verification`

Sends a new hybrid email. Old unused verifications are invalidated. Rate-limited: 3 attempts per 10 minutes per IP.

**Request:**
```json
{
  "email": "user@example.com"
}
```

```bash
curl -X POST https://genaff-api.shouriya.tech/auth/resend-verification \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

```js
// fetch()
const res = await fetch(`${API_BASE}/auth/resend-verification`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' })
});
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/auth/resend-verification`, { email: 'user@example.com' });
```

**Response (200 — user exists and is unverified):**
```json
{ "message": "A new verification code has been sent to your email." }
```

**Response (200 — user not found or already verified — generic, prevents enumeration):**
```json
{ "message": "If that email exists and is unverified, a new code has been sent." }
```

---

### 2.4 Login

**Endpoint:** `POST /auth/login`

Returns a JWT token valid for 7 days (configurable via `JWT_EXPIRES_IN`).

**Constraints:**
- User must be email-verified
- User must not be suspended
- Rate-limited: 10 attempts per minute per IP

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

```bash
curl -X POST https://genaff-api.shouriya.tech/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"SecurePass123"}'
```

```js
// fetch()
const res = await fetch(`${API_BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', password: 'SecurePass123' })
});
const data = await res.json();
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/auth/login`, {
  email: 'user@example.com',
  password: 'SecurePass123'
});
```

**Response (200 OK):**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "a1b2c3d4-...",
    "email": "user@example.com",
    "created_at": "2026-06-21T10:00:00.000Z",
    "free_units": 10,
    "role": "USER"
  }
}
```

**Response (401):** `{ "error": "Invalid email or password" }`
**Response (403):** `{ "error": "Email not verified. Please verify your email before logging in." }`
**Response (403):** `{ "error": "Account suspended. Please contact support." }`

---

### 2.5 Get Current User

**Endpoint:** `GET /auth/me` — Requires JWT

```bash
curl https://genaff-api.shouriya.tech/auth/me \
  -H "Authorization: Bearer <JWT>"
```

```js
// fetch()
const res = await fetch(`${API_BASE}/auth/me`, {
  headers: { 'Authorization': `Bearer ${jwt}` }
});
const data = await res.json();
```

```js
// Axios
const { data } = await axios.get(`${API_BASE}/auth/me`, {
  headers: { Authorization: `Bearer ${jwt}` }
});
```

**Response (200):**
```json
{
  "user": {
    "id": "a1b2c3d4-...",
    "email": "user@example.com",
    "created_at": "2026-06-21T10:00:00.000Z",
    "free_units": 10,
    "role": "USER",
    "wallet": {
      "balance_inr": "150.50"
    }
  }
}
```

**Response (401):** `{ "error": "Missing or malformed Authorization header" }`
**Response (404):** `{ "error": "User not found" }`

---

### 2.6 Forgot Password

**Endpoint:** `POST /auth/forgot-password`

Sends a hybrid email with both a reset link and a 6-digit OTP. Returns generic message regardless of whether the email exists (prevents user enumeration). Rate-limited: 3 attempts per 10 minutes per IP.

**Request:**
```json
{
  "email": "user@example.com"
}
```

```bash
curl -X POST https://genaff-api.shouriya.tech/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

```js
// fetch()
const res = await fetch(`${API_BASE}/auth/forgot-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' })
});
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/auth/forgot-password`, { email: 'user@example.com' });
```

**Response (200 — always):**
```json
{ "message": "If that email exists, password reset instructions have been sent." }
```

The email contains:
- Magic link: `<FRONTEND_URL>/auth/reset-password?token=<uuid>`
- 6-digit OTP for cross-device entry

---

### 2.7 Reset Password

**Endpoint:** `POST /auth/reset-password`

Two modes — use whichever matches your flow:

**Mode 1: Magic Link (token from URL query param)**
```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "new_password": "NewSecurePass456"
}
```

**Mode 2: OTP (cross-device manual entry)**
```json
{
  "email": "user@example.com",
  "otp": "729301",
  "new_password": "NewSecurePass456"
}
```

```bash
# Magic link mode
curl -X POST https://genaff-api.shouriya.tech/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"550e8400-...","new_password":"NewSecurePass456"}'

# OTP mode
curl -X POST https://genaff-api.shouriya.tech/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","otp":"729301","new_password":"NewSecurePass456"}'
```

```js
// fetch() — Magic link
const token = new URLSearchParams(window.location.search).get('token');
const res = await fetch(`${API_BASE}/auth/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, new_password: 'NewSecurePass456' })
});

// fetch() — OTP
const res = await fetch(`${API_BASE}/auth/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', otp: '729301', new_password: 'NewSecurePass456' })
});
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/auth/reset-password`, {
  token: '550e8400-...',
  new_password: 'NewSecurePass456'
});
```

**Response (200):**
```json
{ "message": "Password reset successful. Please login with your new password." }
```

**Response (400):** `{ "error": "new_password is required" }` / `{ "error": "Password must be at least 8 characters" }` / `{ "error": "Provide either { token, new_password } or { email, otp, new_password }" }`
**Response (404):** `{ "error": "Invalid or expired reset link" }`
**Response (410):** `{ "error": "Reset link has expired. Please request a new one." }`

---

### JWT Handling Patterns

#### Token Storage Comparison

| Storage | Security | XSS Risk | Persistence | Recommendation |
|---------|----------|----------|-------------|----------------|
| `localStorage` | Low | High — any script can read it | Survives tab close | **Don't use for production** |
| `sessionStorage` | Medium | High — but cleared on tab close | Session only | Acceptable for SPAs with CSP |
| `httpOnly cookie` | High | None — JS can't read it | Depends on expiry | Best, but requires backend cookie support |
| **In-memory variable** + `sessionStorage` backup | Medium-High | Limited window | Lost on refresh | Used in the examples below |

**Current implementation:** GenAff returns JWTs in JSON responses. The frontend is responsible for storage. The server does **not** currently set httpOnly cookies — this is a valid future improvement.

#### Token Expiry Detection

JWTs expire after `JWT_EXPIRES_IN` (default: 7 days). The server returns `401` with:

```json
{ "error": "Token expired" }
```

Check for this in your HTTP interceptor and redirect to login.

#### Auto-Logout on 401

See [§13 Integration Examples](#13-integration-examples) for a complete Axios interceptor that handles this automatically.

#### Refresh Strategy

**Currently not implemented.** The JWT is issued once and expires after 7 days. There is no refresh-token endpoint. Workarounds:
- Frontend: check `exp` claim, prompt re-login before expiry
- Frontend: use `sessionStorage` (cleared on tab close, harmless to ask re-login)
- Future: implement `/auth/refresh` endpoint with long-lived refresh tokens

---

## 3. API Key Management

All endpoints require JWT authentication.

### 3.1 List Keys

**Endpoint:** `GET /keys` — Requires JWT

```bash
curl https://genaff-api.shouriya.tech/keys \
  -H "Authorization: Bearer <JWT>"
```

```js
// fetch()
const res = await fetch(`${API_BASE}/keys`, {
  headers: { 'Authorization': `Bearer ${jwt}` }
});
```

```js
// Axios
const { data } = await axios.get(`${API_BASE}/keys`, {
  headers: { Authorization: `Bearer ${jwt}` }
});
```

**Response (200):**
```json
{
  "keys": [
    {
      "id": "key-uuid-1",
      "key_prefix": "sk_genaff_a1b2c3d4e5f6...",
      "created_at": "2026-06-21T10:00:00.000Z",
      "active": true
    }
  ]
}
```

---

### 3.2 Create Key

**Endpoint:** `POST /keys` — Requires JWT

**Critical:** The raw API key is returned **ONCE** and cannot be retrieved again. Only the SHA-256 hash is stored. Show a "Copy to Clipboard" UI immediately.

**Limits:** Max 5 active non-playground keys per user.

```bash
curl -X POST https://genaff-api.shouriya.tech/keys \
  -H "Authorization: Bearer <JWT>"
```

```js
// fetch()
const res = await fetch(`${API_BASE}/keys`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${jwt}` }
});
const data = await res.json();
// Store data.key immediately — this is the only time you'll see it
navigator.clipboard.writeText(data.key);
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/keys`, {}, {
  headers: { Authorization: `Bearer ${jwt}` }
});
```

**Response (201):**
```json
{
  "message": "API key created. Save this key – it will not be shown again.",
  "key": "sk_genaff_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
  "record": {
    "id": "key-uuid",
    "key_prefix": "sk_genaff_a1b2c3d4e5f6...",
    "created_at": "2026-06-21T10:00:00.000Z",
    "active": true
  }
}
```

**Response (409):** `{ "error": "You can have at most 5 active API keys." }`

#### Key Format

```
sk_genaff_<48 hex characters>
```

Example: `sk_genaff_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0`

#### "Copy to Clipboard" UI Pattern

```jsx
// React example
function ApiKeyCreated({ rawKey }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="api-key-display">
      <code>{rawKey.substring(0, 20)}...{rawKey.substring(rawKey.length - 8)}</code>
      <button onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy to Clipboard'}
      </button>
    </div>
  );
}
```

---

### 3.3 Revoke Key

**Endpoint:** `DELETE /keys/:id` — Requires JWT

Soft-deletes the key (sets `active = false`). The key ID comes from the `GET /keys` response.

```bash
curl -X DELETE https://genaff-api.shouriya.tech/keys/key-uuid \
  -H "Authorization: Bearer <JWT>"
```

```js
// fetch()
const res = await fetch(`${API_BASE}/keys/${keyId}`, {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${jwt}` }
});
```

```js
// Axios
const { data } = await axios.delete(`${API_BASE}/keys/${keyId}`, {
  headers: { Authorization: `Bearer ${jwt}` }
});
```

**Response (200):**
```json
{ "message": "API key revoked successfully" }
```

**Response (404):** `{ "error": "API key not found" }`

---

## 4. AI Proxy (The Core Feature)

### Architecture

```
Client → POST /v1/chat/completions
              ↓
      apiKeyMiddleware    (validates sk_genaff_ key, loads user+wallet+restrictions)
              ↓
      proxyRateLimiter    (20 req/min per key)
              ↓
      chatCompletions     (validate model, detect provider, check balance, forward, bill, log)
              ↓
      Provider API        (OpenAI / DeepSeek / Gemini / NVIDIA NIM)
```

### 4.1 List Available Models

**Endpoint:** `GET /v1/models` — No auth required

Returns only **healthy (live)** models with INR pricing. The `owned_by` field is always `"genaff"` — source provider is never disclosed.

```bash
curl https://genaff-api.shouriya.tech/v1/models
```

```js
// fetch()
const res = await fetch(`${API_BASE}/v1/models`);
const data = await res.json();
```

```js
// Axios
const { data } = await axios.get(`${API_BASE}/v1/models`);
```

**Response (200):**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "owned_by": "genaff",
      "price_per_1k_inr": 0.0284
    },
    {
      "id": "gemini-2.5-flash",
      "object": "model",
      "owned_by": "genaff",
      "price_per_1k_inr": 0.0095
    },
    {
      "id": "deepseek-chat",
      "object": "model",
      "owned_by": "genaff",
      "price_per_1k_inr": 0.0358
    },
    {
      "id": "llama-4-maverick",
      "object": "model",
      "owned_by": "genaff",
      "price_per_1k_inr": 0.258
    }
  ],
  "_meta": {
    "total_configured": 29,
    "live_count": 27
  }
}
```

**Available Models (29 total across 4 providers):**

| Model | Provider (internal) | Price/1K tokens (INR) |
|-------|---------------------|----------------------|
| `gpt-5.1` | OpenAI | 1.065 |
| `gpt-5.4` | OpenAI | 7.568 |
| `gpt-5` | OpenAI | 4.730 |
| `gpt-4o` | OpenAI | 0.568 |
| `gpt-4o-mini` | OpenAI | 0.028 |
| `gpt-4-turbo` | OpenAI | 1.419 |
| `gpt-4` | OpenAI | 4.257 |
| `gpt-3.5-turbo` | OpenAI | 0.189 |
| `o1` | OpenAI | 1.703 |
| `o1-mini` | OpenAI | 0.378 |
| `o3` | OpenAI | 5.676 |
| `o3-mini` | OpenAI | 0.757 |
| `o4-mini` | OpenAI | 0.378 |
| `deepseek-chat` | DeepSeek | 0.036 |
| `deepseek-reasoner` | DeepSeek | 0.520 |
| `deepseek-coder` | DeepSeek | 0.132 |
| `gemini-3.1-pro-preview` | Gemini | 0.851 |
| `gemini-2.5-pro` | Gemini | 0.166 |
| `gemini-2.5-pro-exp` | Gemini | 0.166 |
| `gemini-2.5-flash` | Gemini | 0.010 |
| `gemini-2.5-flash-exp` | Gemini | 0.010 |
| `qwen-coder-32b` | NVIDIA NIM | 0.060 |
| `qwq-32b` | NVIDIA NIM | 0.069 |
| `llama-3.3-70b` | NVIDIA NIM | 0.086 |
| `llama-3.1-405b` | NVIDIA NIM | 0.172 |
| `kimi-k2` | NVIDIA NIM | 0.215 |
| `llama-4-maverick` | NVIDIA NIM | 0.258 |

---

### 4.2 Chat Completions

**Endpoint:** `POST /v1/chat/completions` — Requires API Key

**OpenAI-compatible** request/response format. This means you can use the official `openai` npm package, Vercel AI SDK, LangChain, or any OpenAI-compatible client by pointing `baseURL` to GenAff.

```bash
curl -X POST https://genaff-api.shouriya.tech/v1/chat/completions \
  -H "Authorization: Bearer sk_genaff_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "temperature": 0.7,
    "max_tokens": 100
  }'
```

```js
// fetch()
const res = await fetch(`${API_BASE}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the capital of France?' }
    ],
    temperature: 0.7,
    max_tokens: 100
  })
});
const data = await res.json();
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/v1/chat/completions`, {
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' }
  ],
  temperature: 0.7,
  max_tokens: 100
}, {
  headers: { Authorization: `Bearer ${apiKey}` }
});
```

**Request Schema:**
```ts
{
  model: string;            // Required: any model from GET /v1/models
  messages: Array<{         // Required: at least one message
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  max_tokens?: number;      // Optional: maximum tokens in response
  temperature?: number;     // Optional: 0-2, sampling temperature
}
```

**Success Response (200):**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1719000000,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 8,
    "total_tokens": 33
  }
}
```

#### Using with OpenAI SDKs

```js
// Official openai npm package
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'sk_genaff_...',
  baseURL: 'https://genaff-api.shouriya.tech/v1',
});

const completion = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

```js
// Vercel AI SDK
import { createOpenAI } from '@ai-sdk/openai';

const genaff = createOpenAI({
  apiKey: 'sk_genaff_...',
  baseURL: 'https://genaff-api.shouriya.tech/v1',
});

// Use with generateText / streamText from ai package
```

```js
// LangChain
import { ChatOpenAI } from '@langchain/openai';

const model = new ChatOpenAI({
  openAIApiKey: 'sk_genaff_...',
  configuration: {
    baseURL: 'https://genaff-api.shouriya.tech/v1',
  },
  modelName: 'gpt-4o-mini',
});
```

#### Streaming

**Currently not implemented.** The backend returns full JSON responses only. Streaming (SSE) is a planned future feature. When implemented, you'll add `"stream": true` to the request body and the response will be `text/event-stream` with `data: {"choices":[{"delta":{"content":"..."}}]}\n\n` chunks.

#### Error Responses

| Status | Code | When | Frontend Action |
|--------|------|------|-----------------|
| 400 | `"model" is required` | Missing model field | Show field error |
| 400 | `"messages" array is required` | Missing/empty messages | Show field error |
| 400 | `Unsupported model: "xxx"` | Model not in catalog | Show model picker |
| 401 | `Invalid API key` / `Missing Authorization` | Bad/missing API key | Check key, show error |
| 401 | `API key expired` | Playground key timed out | Create new session |
| 402 | `Insufficient balance` | Wallet empty + no free units | **Show "Top Up" CTA** |
| 403 | `Email not verified` | User hasn't verified email | Redirect to verification |
| 403 | `Account suspended` | Admin suspended account | Show contact support message |
| 403 | `API key is disabled` | Key was revoked | Use a different key |
| 403 | `Model restricted for this account` | Admin restricted model | Show model picker without that model |
| 429 | `Rate limit exceeded` | 20 req/min reached | Exponential backoff, show retry timer |
| 502 | `Provider error` | AI provider returned error | Show "service unavailable", retry later |
| 500 | `Internal server error` | Unexpected failure | Log, show generic error |

**402 Handling Example:**
```js
if (res.status === 402) {
  const { message } = await res.json();
  showToast('Your wallet is empty. Please top up to continue.', { action: 'Top Up', onAction: () => navigate('/wallet/topup') });
}
```

**403 Email Not Verified Example:**
```js
if (res.status === 403 && data.error === 'Email not verified') {
  navigate('/auth/verify');
}
```

**429 Rate Limit with Backoff:**
```js
async function chatWithBackoff(messages, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(...);
    if (res.status !== 429) return res.json();
    const retryAfter = res.headers.get('Retry-After') || Math.pow(2, i);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
  }
  throw new Error('Rate limit exceeded after retries');
}
```

---

### 4.3 Model Health

**Endpoint:** `GET /v1/models/health` — No auth required (public, good for debugging)

```bash
curl https://genaff-api.shouriya.tech/v1/models/health
```

**Response (200):**
```json
{
  "summary": {
    "healthy": 27,
    "unhealthy": 2,
    "unknown": 0
  },
  "models": [
    {
      "model": "gpt-4o-mini",
      "status": "healthy",
      "error": null,
      "source": "passive",
      "failCount": 0,
      "since": "2026-06-21T10:25:00.000Z"
    },
    {
      "model": "some-unhealthy-model",
      "status": "unhealthy",
      "error": "Connection timeout",
      "source": "active-probe",
      "failCount": 2,
      "since": "2026-06-21T10:20:00.000Z"
    }
  ]
}
```

---

## 5. Wallet & Payments (Razorpay Integration)

### Payment Flow Overview

```
1. POST /wallet/topup/order  →  Get order_id, key_id, amount (paise)
2. Open Razorpay Checkout     →  User pays via UPI/Card/NetBanking
3. Receive razorpay_payment_id + razorpay_signature from Razorpay callback
4. POST /wallet/topup/verify  →  Verify signature, credit wallet
```

### 5.1 Get Balance

**Endpoint:** `GET /wallet` — Requires JWT

```bash
curl https://genaff-api.shouriya.tech/wallet \
  -H "Authorization: Bearer <JWT>"
```

```js
// Axios
const { data } = await axios.get(`${API_BASE}/wallet`, {
  headers: { Authorization: `Bearer ${jwt}` }
});
```

**Response (200):**
```json
{
  "wallet": {
    "balance_inr": "150.50",
    "updated_at": "2026-06-21T10:00:00.000Z"
  }
}
```

---

### 5.2 Create Top-Up Order (Step 1)

**Endpoint:** `POST /wallet/topup/order` — Requires JWT

Creates a Razorpay order record. The frontend uses the returned details to open the Razorpay Checkout modal.

**Constraints:**
- Minimum top-up: ₹10
- Only one pending order allowed at a time (create new, complete it, or cancel pending)

**Request:**
```json
{
  "amount": 50
}
```

```bash
curl -X POST https://genaff-api.shouriya.tech/wallet/topup/order \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50}'
```

```js
// fetch()
const res = await fetch(`${API_BASE}/wallet/topup/order`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwt}`
  },
  body: JSON.stringify({ amount: 50 })
});
const data = await res.json();
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/wallet/topup/order`,
  { amount: 50 },
  { headers: { Authorization: `Bearer ${jwt}` } }
);
```

**Response (201):**
```json
{
  "order_id": "order_abc123def456",
  "amount": 5000,
  "currency": "INR",
  "key_id": "rzp_live_abc123...",
  "topup_id": "topup-uuid"
}
```

**Field Notes:**
- `amount`: in **paise** (₹50 = 5000 paise). Pass this directly to Razorpay.
- `key_id`: Your Razorpay Key ID (public). Use this to initialize Razorpay on the frontend.
- `topup_id`: Internal reference — needed for cancel and invoice endpoints.

**Response (400):** `{ "error": "Minimum top-up is ₹10" }`
**Response (409):** `{ "error": "You have a pending top-up order. Complete or cancel it before creating a new one." }`

---

### 5.3 Razorpay Checkout Integration (Step 2)

After getting the order details from Step 1, open the Razorpay payment modal.

#### Load Razorpay Script

```html
<!-- index.html -->
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

Or dynamically:

```js
function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve;
    document.body.appendChild(script);
  });
}
```

#### Complete Checkout Flow

```js
// Step 1: Create order
const { data: orderData } = await axios.post(`${API_BASE}/wallet/topup/order`,
  { amount: 50 },
  { headers: { Authorization: `Bearer ${jwt}` } }
);

// Step 2: Load Razorpay and open checkout
await loadRazorpayScript();

const options = {
  key: orderData.key_id,              // Razorpay Key ID
  amount: orderData.amount,            // Amount in paise (from Step 1 response)
  currency: orderData.currency,        // "INR"
  name: 'GenAff',
  description: 'Wallet Top-up',
  order_id: orderData.order_id,        // From Step 1 response
  prefill: {
    email: user.email,
  },
  theme: {
    color: '#6366f1'                   // Match your brand color
  },
  handler: async function (response) {
    // Step 3: Verify payment on your backend
    try {
      const { data: verifyData } = await axios.post(
        `${API_BASE}/wallet/topup/verify`,
        {
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        },
        { headers: { Authorization: `Bearer ${jwt}` } }
      );

      alert(`₹${verifyData.new_balance_inr} credited to your wallet!`);
      // Refresh wallet balance in UI
    } catch (err) {
      alert('Payment verification failed: ' + err.response?.data?.error);
    }
  },
  modal: {
    ondismiss: function () {
      // User closed the modal without paying
      console.log('Checkout dismissed');
    }
  }
};

const rzp = new window.Razorpay(options);
rzp.open();
```

**Key Points:**
- `amount` must be in **paise** (from Step 1 response — don't recalculate)
- `order_id` must match the one created in Step 1
- The `handler` callback fires after successful payment — this is where you verify
- `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` come from the `handler`'s `response` parameter

---

### 5.4 Verify Payment (Step 3)

**Endpoint:** `POST /wallet/topup/verify` — Requires JWT

Verifies the HMAC-SHA256 signature and atomically credits the wallet.

**Request:**
```json
{
  "razorpay_order_id": "order_abc123def456",
  "razorpay_payment_id": "pay_xyz789",
  "razorpay_signature": "a1b2c3d4e5f6..."
}
```

```bash
curl -X POST https://genaff-api.shouriya.tech/wallet/topup/verify \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "razorpay_order_id": "order_abc123",
    "razorpay_payment_id": "pay_xyz789",
    "razorpay_signature": "a1b2c3d4..."
  }'
```

**Response (200):**
```json
{
  "message": "₹50 added to your wallet successfully",
  "topUp": {
    "id": "topup-uuid",
    "user_id": "user-uuid",
    "amount": "50.00",
    "status": "completed",
    "razorpay_order_id": "order_abc123",
    "razorpay_payment_id": "pay_xyz789",
    "created_at": "2026-06-21T10:00:00.000Z"
  },
  "new_balance_inr": 150.50
}
```

**Response (400):** `{ "error": "Invalid payment signature" }` / `{ "error": "razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required" }`
**Response (404):** `{ "error": "No matching pending top-up found for this order" }`

---

### 5.5 Cancel Pending Order

**Endpoint:** `POST /wallet/topup/cancel` — Requires JWT

Cancels a pending top-up if the user closes the Razorpay modal and wants to start over.

**Request:**
```json
{
  "topup_id": "topup-uuid"
}
```

```bash
curl -X POST https://genaff-api.shouriya.tech/wallet/topup/cancel \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"topup_id":"topup-uuid"}'
```

**Response (200):**
```json
{
  "message": "Top-up order cancelled",
  "topUp": {
    "id": "topup-uuid",
    "status": "cancelled",
    "amount": "50.00"
  }
}
```

---

### 5.6 Get Pending Order

**Endpoint:** `GET /wallet/topup/pending` — Requires JWT

Check if the user has a pending (unpaid) top-up.

```bash
curl https://genaff-api.shouriya.tech/wallet/topup/pending \
  -H "Authorization: Bearer <JWT>"
```

**Response (200):**
```json
{
  "pending": {
    "id": "topup-uuid",
    "amount": "50.00",
    "razorpay_order_id": "order_abc123",
    "created_at": "2026-06-21T10:00:00.000Z"
  }
}
```

Returns `"pending": null` if no pending order exists.

---

### 5.7 Top-Up History

**Endpoint:** `GET /wallet/history` — Requires JWT

```bash
curl https://genaff-api.shouriya.tech/wallet/history \
  -H "Authorization: Bearer <JWT>"
```

**Response (200):**
```json
{
  "history": [
    {
      "id": "topup-uuid",
      "amount": "50.00",
      "status": "completed",
      "razorpay_order_id": "order_abc123",
      "razorpay_payment_id": "pay_xyz789",
      "created_at": "2026-06-21T10:00:00.000Z"
    },
    {
      "id": "topup-uuid-2",
      "amount": "100.00",
      "status": "cancelled",
      "razorpay_order_id": null,
      "razorpay_payment_id": null,
      "created_at": "2026-06-20T15:30:00.000Z"
    }
  ]
}
```

---

## 6. Usage & Billing

### 6.1 Usage History (Paginated)

**Endpoint:** `GET /wallet/usage?page=1&limit=20` — Requires JWT

```bash
curl "https://genaff-api.shouriya.tech/wallet/usage?page=1&limit=20" \
  -H "Authorization: Bearer <JWT>"
```

```js
// Axios
const { data } = await axios.get(`${API_BASE}/wallet/usage`, {
  params: { page: 1, limit: 20 },
  headers: { Authorization: `Bearer ${jwt}` }
});
```

**Response (200):**
```json
{
  "records": [
    {
      "id": "usage-uuid",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "tokens_used": 1500,
      "cost_inr": "0.0426",
      "created_at": "2026-06-21T10:00:00.000Z",
      "api_key": {
        "key_prefix": "sk_genaff_a1b2c3d4e5f6..."
      }
    }
  ],
  "total": 245,
  "page": 1,
  "limit": 20
}
```

---

### 6.2 Usage Stats

**Endpoint:** `GET /wallet/stats` — Requires JWT

Aggregate statistics for the authenticated user.

```bash
curl https://genaff-api.shouriya.tech/wallet/stats \
  -H "Authorization: Bearer <JWT>"
```

**Response (200):**
```json
{
  "stats": {
    "total_requests": 245,
    "total_tokens": 1250000,
    "total_spent_inr": 35.25
  }
}
```

---

### 6.3 Download Top-Up Invoice PDF

**Endpoint:** `GET /wallet/invoice/:topupId/pdf` — Requires JWT

Returns a branded PDF invoice for a completed top-up. Response is `application/pdf` binary.

```bash
curl "https://genaff-api.shouriya.tech/wallet/invoice/topup-uuid/pdf" \
  -H "Authorization: Bearer <JWT>" \
  --output invoice.pdf
```

```js
// fetch() — Trigger browser download
async function downloadInvoice(topupId, jwt) {
  const res = await fetch(`${API_BASE}/wallet/invoice/${topupId}/pdf`, {
    headers: { 'Authorization': `Bearer ${jwt}` }
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `genaff-invoice-${topupId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

```js
// Axios — with blob response
async function downloadInvoiceAxios(topupId, jwt) {
  const response = await axios.get(`${API_BASE}/wallet/invoice/${topupId}/pdf`, {
    headers: { Authorization: `Bearer ${jwt}` },
    responseType: 'blob'
  });

  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `genaff-invoice-${topupId.slice(0, 8)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
```

**Response (400):** `{ "error": "Invoice is available only for completed top-ups" }`
**Response (404):** `{ "error": "Top-up not found" }`

---

### 6.4 Download Wallet Statement PDF

**Endpoint:** `GET /wallet/statement/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD` — Requires JWT

Branded wallet statement showing all credits (top-ups) and debits (usage) in the date range.

```bash
curl "https://genaff-api.shouriya.tech/wallet/statement/pdf?from=2026-06-01&to=2026-06-21" \
  -H "Authorization: Bearer <JWT>" \
  --output statement.pdf
```

```js
// fetch()
async function downloadStatement(jwt, from, to) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const res = await fetch(`${API_BASE}/wallet/statement/pdf?${params}`, {
    headers: { 'Authorization': `Bearer ${jwt}` }
  });

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `genaff-wallet-statement-${from || 'last-30-days'}-to-${to || 'today'}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
```

```js
// Axios
const response = await axios.get(`${API_BASE}/wallet/statement/pdf`, {
  params: { from: '2026-06-01', to: '2026-06-21' },
  headers: { Authorization: `Bearer ${jwt}` },
  responseType: 'blob'
});
// ... trigger download from blob
```

**Defaults:** If `from` and `to` are omitted, defaults to the last 30 days.

---

### 6.5 Download Combined Billing PDF

**Endpoint:** `GET /wallet/billing/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD&topupId=<optional>` — Requires JWT

Combined document with:
- Wallet statement (all credits + debits in period)
- Top-up receipt section for all top-ups in period
- Optional: focus on a specific topupId

```bash
# Get combined billing for a date range
curl "https://genaff-api.shouriya.tech/wallet/billing/pdf?from=2026-06-01&to=2026-06-21" \
  -H "Authorization: Bearer <JWT>" \
  --output billing.pdf

# Combined billing with a specific top-up highlighted
curl "https://genaff-api.shouriya.tech/wallet/billing/pdf?from=2026-06-01&to=2026-06-21&topupId=topup-uuid" \
  -H "Authorization: Bearer <JWT>" \
  --output billing.pdf
```

```js
// Axios
const response = await axios.get(`${API_BASE}/wallet/billing/pdf`, {
  params: { from: '2026-06-01', to: '2026-06-21', topupId: 'topup-uuid' },
  headers: { Authorization: `Bearer ${jwt}` },
  responseType: 'blob'
});
// ... trigger download from blob
```

---

## 7. Playground (No-Code Try-Before-Buy)

The Playground creates **temporary API keys** tied to ephemeral chat sessions. Perfect for letting users test models without creating a permanent key.

### Playground Lifecycle

```
Create Session → Get temp API key → Chat via /v1/chat/completions
                                       (messages auto-stored)
                                       ↓
                              View history ← GET /playground/sessions/:id/history
                                       ↓
                              Delete session (expires key + history)
                                       ↓
                     OR: Session auto-expires after TTL (cleanup scheduler)
```

### 7.1 Create Session

**Endpoint:** `POST /playground/sessions` — Requires JWT

**Constraints:**
- TTL: 5–240 minutes (default: 60)
- Max 3 active playground sessions
- Rate-limited: 10 sessions/hour per user
- User must be email-verified and not suspended

**Request:**
```json
{
  "ttl_minutes": 30,
  "title": "Testing GPT-4"
}
```

Both fields are optional — defaults to 60 min TTL and "Untitled Chat".

```bash
curl -X POST https://genaff-api.shouriya.tech/playground/sessions \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"ttl_minutes": 30, "title": "Testing GPT-4"}'
```

```js
// Axios
const { data } = await axios.post(`${API_BASE}/playground/sessions`, {
  ttl_minutes: 30,
  title: 'Testing GPT-4'
}, {
  headers: { Authorization: `Bearer ${jwt}` }
});
```

**Response (201):**
```json
{
  "message": "Playground session created",
  "session": {
    "id": "session-uuid",
    "title": "Testing GPT-4",
    "created_at": "2026-06-21T10:00:00.000Z",
    "expires_at": "2026-06-21T10:30:00.000Z"
  },
  "api_key": {
    "key": "sk_genaff_temp_a1b2c3d4e5f6...",
    "key_prefix": "sk_genaff_temp_a1b2c3...",
    "expires_at": "2026-06-21T10:30:00.000Z"
  }
}
```

**Critical:** The `api_key.key` field is the raw API key — shown **once**. Use it immediately for chat requests. It auto-expires at `expires_at`.

**Response (403):** `{ "error": "Email not verified..." }` / `{ "error": "Account suspended..." }`
**Response (409):** `{ "error": "Maximum 3 active playground sessions allowed" }`
**Response (429):** `{ "error": "Too many playground sessions created. Please try again later." }`

---

### 7.2 List Sessions

**Endpoint:** `GET /playground/sessions` — Requires JWT

```bash
curl https://genaff-api.shouriya.tech/playground/sessions \
  -H "Authorization: Bearer <JWT>"
```

**Response (200):**
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "user_id": "user-uuid",
      "title": "Testing GPT-4",
      "created_at": "2026-06-21T10:00:00.000Z",
      "expires_at": "2026-06-21T10:30:00.000Z",
      "api_key": {
        "id": "key-uuid",
        "key_prefix": "sk_genaff_temp_a1b2c3...",
        "active": true,
        "expires_at": "2026-06-21T10:30:00.000Z"
      },
      "_count": {
        "messages": 12
      }
    }
  ]
}
```

---

### 7.3 Get Session History

**Endpoint:** `GET /playground/sessions/:id/history?limit=200` — Requires JWT

Returns the conversation messages in chronological order.

```bash
curl "https://genaff-api.shouriya.tech/playground/sessions/session-uuid/history?limit=200" \
  -H "Authorization: Bearer <JWT>"
```

**Response (200):**
```json
{
  "session": {
    "id": "session-uuid",
    "title": "Testing GPT-4",
    "created_at": "2026-06-21T10:00:00.000Z",
    "expires_at": "2026-06-21T10:30:00.000Z"
  },
  "messages": [
    {
      "id": "msg-uuid-1",
      "role": "user",
      "content": "What is the capital of France?",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "tokens_used": 0,
      "cost_inr": "0",
      "created_at": "2026-06-21T10:01:00.000Z"
    },
    {
      "id": "msg-uuid-2",
      "role": "assistant",
      "content": "The capital of France is Paris.",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "tokens_used": 33,
      "cost_inr": "0.0009",
      "created_at": "2026-06-21T10:01:02.000Z"
    }
  ]
}
```

**Note:** User messages have `tokens_used: 0` and `cost_inr: "0"` — cost is tracked on the assistant message only (the actual API call).

---

### 7.4 Sending Messages via Playground

Use the **normal AI proxy endpoint** with the playground's temporary API key:

```bash
curl -X POST https://genaff-api.shouriya.tech/v1/chat/completions \
  -H "Authorization: Bearer sk_genaff_temp_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What is the capital of France?"}
    ]
  }'
```

When using a playground key, messages are **automatically stored** in the session history. No additional API call needed.

---

### 7.5 Delete Session

**Endpoint:** `DELETE /playground/sessions/:id` — Requires JWT

Immediately revokes the temporary API key and deletes the session + messages.

```bash
curl -X DELETE https://genaff-api.shouriya.tech/playground/sessions/session-uuid \
  -H "Authorization: Bearer <JWT>"
```

**Response (200):**
```json
{
  "message": "Playground session deleted"
}
```

---

## 8. Admin APIs

All admin endpoints require **JWT + ADMIN role**. The middleware chain is:

```
authMiddleware (validates JWT) → adminMiddleware (checks role === 'ADMIN')
```

### 8.1 Dashboard Statistics

**Endpoint:** `GET /admin/dashboard` — Requires JWT + ADMIN

Comprehensive overview: revenue, user stats, top users by spending, top models by usage, failed transactions.

```bash
curl https://genaff-api.shouriya.tech/admin/dashboard \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
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

---

### 8.2 List All Users (Paginated)

**Endpoint:** `GET /admin/users?page=1&limit=50` — Requires JWT + ADMIN

```bash
curl "https://genaff-api.shouriya.tech/admin/users?page=1&limit=50" \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
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
        "created_at": "2026-06-21T10:00:00.000Z",
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

### 8.3 Get User Details

**Endpoint:** `GET /admin/users/:userId` — Requires JWT + ADMIN

Returns full user profile: wallet, usage stats, API keys, top-ups, model restrictions.

```bash
curl https://genaff-api.shouriya.tech/admin/users/user-uuid \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
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
      "created_at": "2026-06-21T10:00:00.000Z",
      "free_units": 10
    },
    "wallet": {
      "balance_inr": "1250.75",
      "last_updated": "2026-06-21T10:00:00.000Z"
    },
    "statistics": {
      "total_spent_inr": "450.25",
      "total_topup_inr": "1500.00",
      "total_api_calls": 234,
      "active_api_keys": 2
    },
    "recent_usages": [
      {
        "id": "usage-uuid",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "tokens_used": 5000,
        "cost_inr": "0.142",
        "created_at": "2026-06-21T10:00:00.000Z"
      }
    ],
    "recent_topups": [
      {
        "id": "topup-uuid",
        "amount": "500.00",
        "status": "completed",
        "created_at": "2026-06-21T09:00:00.000Z"
      }
    ],
    "api_keys": [
      {
        "id": "key-uuid",
        "key_prefix": "sk_genaff_a1b2c3d4e5f6...",
        "created_at": "2026-06-21T10:00:00.000Z",
        "active": true
      }
    ],
    "restricted_models": []
  }
}
```

---

### 8.4 Suspend / Activate User

**Endpoint:** `PUT /admin/users/:userId/status` — Requires JWT + ADMIN

Suspending deactivates all of the user's API keys. Activating restores them.

**Request:**
```json
{
  "suspend": true
}
```

```bash
curl -X PUT https://genaff-api.shouriya.tech/admin/users/user-uuid/status \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"suspend": true}'
```

**Response (200):**
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

**Note:** An admin cannot suspend their own account (`req.user.id === userId` returns 400).

---

### 8.5 Delete User Account

**Endpoint:** `DELETE /admin/users/:userId` — Requires JWT + ADMIN

Permanently deletes the user and all related data (cascade: wallet, keys, usages, top-ups, playground sessions, verifications).

```bash
curl -X DELETE https://genaff-api.shouriya.tech/admin/users/user-uuid \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
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

---

### 8.6 Grant Free Units

**Endpoint:** `PATCH /admin/users/:userId/free-units` — Requires JWT + ADMIN

Add free units to a user's account (consumed before wallet balance) or set an exact value.

**Request:**
```json
{
  "units": 5,
  "mode": "add"
}
```

`mode` can be:
- `"add"` (default): increments existing free units
- `"set"`: replaces existing free units with the given value

```bash
# Add 5 free units
curl -X PATCH https://genaff-api.shouriya.tech/admin/users/user-uuid/free-units \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"units": 5, "mode": "add"}'

# Set free units to exactly 20
curl -X PATCH https://genaff-api.shouriya.tech/admin/users/user-uuid/free-units \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"units": 20, "mode": "set"}'
```

**Response (200):**
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

**Note:** Free units are consumed **before** wallet balance on every `/v1/chat/completions` call.

---

### 8.7 Get User Model Restrictions

**Endpoint:** `GET /admin/users/:userId/model-restrictions` — Requires JWT + ADMIN

Returns the list of models restricted for this user.

```bash
curl https://genaff-api.shouriya.tech/admin/users/user-uuid/model-restrictions \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user_id": "uuid",
    "email": "user@example.com",
    "restricted_models": ["gpt-4", "o3"]
  }
}
```

---

### 8.8 Update User Model Restrictions

**Endpoint:** `PUT /admin/users/:userId/model-restrictions` — Requires JWT + ADMIN

Replaces the full list of restricted models. Send an empty array to remove all restrictions.

**Request:**
```json
{
  "restricted_models": ["gpt-4", "o3", "gemini-2.5-pro"]
}
```

```bash
curl -X PUT https://genaff-api.shouriya.tech/admin/users/user-uuid/model-restrictions \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"restricted_models": ["gpt-4", "o3"]}'
```

**Response (200):**
```json
{
  "success": true,
  "message": "Updated restricted models for user@example.com",
  "data": {
    "user_id": "uuid",
    "email": "user@example.com",
    "restricted_models": ["gpt-4", "o3"]
  }
}
```

**Response (400):** `{ "error": "Unsupported model in restricted_models: xxx" }` — model must exist in the pricing catalog.

---

### 8.9 Model Usage Analytics

**Endpoint:** `GET /admin/models/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` — Requires JWT + ADMIN

Usage breakdown by model and provider. Defaults to last 30 days.

```bash
curl "https://genaff-api.shouriya.tech/admin/models/analytics?from=2026-06-01&to=2026-06-21" \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-06-01T00:00:00.000Z",
      "to": "2026-06-21T00:00:00.000Z"
    },
    "model_analytics": [
      {
        "model": "gpt-4o-mini",
        "provider": "openai",
        "usage_count": 450,
        "total_tokens": 1250000,
        "total_cost_inr": "35.50"
      },
      {
        "model": "qwen-coder-32b",
        "provider": "nvidia",
        "usage_count": 320,
        "total_tokens": 980000,
        "total_cost_inr": "58.80"
      }
    ]
  }
}
```

---

### 8.10 Revenue Breakdown

**Endpoint:** `GET /admin/revenue/breakdown?from=YYYY-MM-DD&to=YYYY-MM-DD` — Requires JWT + ADMIN

Revenue analysis: by model, top-up totals, and summary.

```bash
curl "https://genaff-api.shouriya.tech/admin/revenue/breakdown?from=2026-06-01&to=2026-06-21" \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-06-01T00:00:00.000Z",
      "to": "2026-06-21T00:00:00.000Z"
    },
    "revenue_by_model": [
      {
        "model": "gpt-4o-mini",
        "usage_count": 450,
        "revenue_inr": "12.78"
      }
    ],
    "topup_revenue": {
      "total_inr": "15000.00",
      "transaction_count": 25
    },
    "summary": {
      "usage_revenue_inr": "4460.00",
      "topup_revenue_inr": "15000.00",
      "total_revenue_inr": "19460.00"
    }
  }
}
```

---

### 8.11 Transaction History

**Endpoint:** `GET /admin/transactions?page=1&limit=100&type=topup|usage` — Requires JWT + ADMIN

Merged view of all transactions (top-ups + usage). Filter by `type`.

```bash
# All transactions
curl "https://genaff-api.shouriya.tech/admin/transactions?page=1&limit=50" \
  -H "Authorization: Bearer <ADMIN_JWT>"

# Only top-ups
curl "https://genaff-api.shouriya.tech/admin/transactions?page=1&limit=50&type=topup" \
  -H "Authorization: Bearer <ADMIN_JWT>"

# Only usage
curl "https://genaff-api.shouriya.tech/admin/transactions?page=1&limit=50&type=usage" \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "uuid",
        "type": "TOPUP",
        "user_id": "user-uuid",
        "amount_inr": "500.00",
        "status": "completed",
        "created_at": "2026-06-21T10:00:00.000Z"
      },
      {
        "id": "uuid",
        "type": "USAGE",
        "user_id": "user-uuid",
        "model": "gpt-4o-mini",
        "amount_inr": "0.014",
        "tokens_used": 500,
        "created_at": "2026-06-21T10:01:00.000Z"
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

---

### 8.12 Model Health Status (Admin)

**Endpoint:** `GET /admin/models/health` — Requires JWT + ADMIN

Detailed health view with status, errors, and check timestamps. Sorted: healthy first.

```bash
curl https://genaff-api.shouriya.tech/admin/models/health \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "summary": {
      "healthy": 27,
      "unhealthy": 2,
      "error": 0,
      "total": 29
    },
    "models": [
      {
        "model": "gpt-4o-mini",
        "status": "healthy",
        "error": null,
        "checked_at": "2026-06-21T10:25:00.000Z"
      }
    ]
  }
}
```

---

### 8.13 Force Model Health Refresh

**Endpoint:** `POST /admin/models/health/refresh` — Requires JWT + ADMIN

Triggers an immediate background health check on all models. Non-blocking — returns immediately, results appear in GET health shortly.

```bash
curl -X POST https://genaff-api.shouriya.tech/admin/models/health/refresh \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

**Response (200):**
```json
{
  "success": true,
  "message": "Model health check triggered. Results will be available shortly."
}
```

---

### Admin Error Responses

| Status | Response |
|--------|----------|
| 401 | `{ "error": "Missing or malformed Authorization header" }` |
| 401 | `{ "error": "User not found" }` (JWT valid but user deleted) |
| 403 | `{ "error": "Forbidden. Admin access required.", "userEmail": "user@example.com" }` |
| 404 | `{ "error": "User not found" }` |
| 400 | `{ "error": "You cannot suspend or activate your own admin account" }` |
| 400 | `{ "error": "You cannot delete your own admin account" }` |
| 400 | `{ "error": "units must be a non-negative integer" }` / `"mode must be either \"add\" or \"set\""` |

---

## 9. Error Handling & Status Code Reference

| Status | Meaning | When | Frontend Action |
|--------|---------|------|-----------------|
| 200 | Success | Normal response | Process data normally |
| 201 | Created | Resource created (register, key, topup order) | Show success, copy key (if applicable) |
| 400 | Bad Request | Missing/invalid fields | Show field-level validation errors |
| 401 | Unauthorized | Missing/expired JWT or API key | Redirect to login or show key-required |
| 402 | Payment Required | Insufficient balance for AI call | Show "Top Up" CTA, navigate to /wallet |
| 403 | Forbidden | Email unverified, suspended, not admin, model restricted, key disabled | Show appropriate message per case |
| 404 | Not Found | Resource doesn't exist | Show "not found" UI |
| 409 | Conflict | Duplicate resource (email, pending order, max keys/sessions) | Show "already exists" message |
| 410 | Gone | Verification/reset code expired | Show "expired, request new" UI |
| 429 | Too Many Requests | Rate limit exceeded | Exponential backoff + show retry timer |
| 500 | Internal Server Error | Unexpected server failure | Show generic error, log for debugging |
| 502 | Bad Gateway | AI provider returned error | Show "service unavailable", retry later |

### Error Response Format

All error responses follow this shape:
```json
{
  "error": "Human-readable error message"
}
```

Some include additional fields:
```json
{
  "error": "Insufficient balance",
  "message": "Your wallet is empty. Please top up at /wallet/topup"
}
```

Admin errors include:
```json
{
  "error": "Failed to fetch dashboard stats",
  "details": "Connection timeout"
}
```

---

## 10. Rate Limiting

### Rate Limiters by Endpoint

| Limiter | Endpoint(s) | Limit | Window | Key By |
|---------|-------------|-------|--------|--------|
| `proxyRateLimiter` | `POST /v1/chat/completions` | 20 | 1 minute | API key (`Bearer sk_genaff_...`) |
| `authRateLimiter` | `POST /auth/login` | 10 | 1 minute | IP |
| `signupRateLimiter` | `POST /auth/register` | 2 | 1 hour | IP |
| `otpRateLimiter` | `POST /auth/verify-otp` | 5 | 15 minutes | IP |
| `resendRateLimiter` | `POST /auth/resend-verification` | 3 | 10 minutes | IP |
| `forgotPasswordRateLimiter` | `POST /auth/forgot-password` | 3 | 10 minutes | IP |
| `resetPasswordRateLimiter` | `POST /auth/reset-password` | 5 | 15 minutes | IP |
| `playgroundSessionRateLimiter` | `POST /playground/sessions` | 10 | 1 hour | User ID (or IP fallback) |

### Rate Limit Response Headers

The proxy rate limiter includes standard headers:
- `RateLimit-Limit`: maximum requests per window
- `RateLimit-Remaining`: requests left in current window
- `RateLimit-Reset`: timestamp when the window resets

### Rate Limit Error Response

```json
{
  "error": "Rate limit exceeded",
  "message": "You have exceeded 20 requests per minute. Please slow down.",
  "retryAfter": 1719000100
}
```

`retryAfter` is a Unix timestamp (seconds) when you can retry.

### Note on In-Memory Limits

Rate limiters use in-memory storage (`express-rate-limit` default). In a multi-process deployment (PM2 cluster mode), limits are per-process. To make them global, swap to `redis-rate-limit` or route all proxy traffic through a single process.

---

## 11. Complete TypeScript Types

```ts
// ── User ────────────────────────────────────────────────
interface User {
  id: string;                    // UUID v4
  email: string;                 // unique, lowercased
  created_at: string;            // ISO 8601
  free_units: number;            // integer, consumed before wallet
  email_verified: boolean;
  role: 'USER' | 'ADMIN';
  is_suspended?: boolean;        // admin-internal only
}

interface UserWithWallet extends User {
  wallet: {
    balance_inr: string;         // Decimal string, e.g. "150.50"
  };
}

// ── Auth ────────────────────────────────────────────────
interface RegisterRequest {
  email: string;
  password: string;              // 8-72 chars
}

interface RegisterResponse {
  message: string;
  user_id: string;
  email: string;
}

interface LoginResponse {
  message: string;
  token: string;                 // JWT, 7d expiry
  user: {
    id: string;
    email: string;
    created_at: string;
    free_units: number;
    role: 'USER' | 'ADMIN';
  };
}

interface VerifyOtpRequest {
  email: string;
  otp: string;                   // 6-digit, zero-padded
}

interface ResendVerificationRequest {
  email: string;
}

interface ForgotPasswordRequest {
  email: string;
}

interface ResetPasswordMagicLinkRequest {
  token: string;                 // UUID
  new_password: string;          // 8-72 chars
}

interface ResetPasswordOtpRequest {
  email: string;
  otp: string;
  new_password: string;
}

type ResetPasswordRequest = ResetPasswordMagicLinkRequest | ResetPasswordOtpRequest;

// ── API Key ────────────────────────────────────────────
interface ApiKeyRecord {
  id: string;                    // UUID
  key_prefix: string;            // e.g. "sk_genaff_a1b2c3d4e5f6..."
  created_at: string;
  active: boolean;
}

interface CreateKeyResponse {
  message: string;
  key: string;                   // raw key — shown ONCE
  record: ApiKeyRecord;
}

interface ListKeysResponse {
  keys: ApiKeyRecord[];
}

// ── Wallet ─────────────────────────────────────────────
interface Wallet {
  balance_inr: string;           // Decimal e.g. "150.50"
  updated_at: string;
}

interface CreateOrderRequest {
  amount: number;                // INR, min 10
}

interface CreateOrderResponse {
  order_id: string;              // Razorpay order ID
  amount: number;                // paise (INR * 100)
  currency: string;              // "INR"
  key_id: string;                // Razorpay Key ID
  topup_id: string;              // internal UUID
}

interface VerifyPaymentRequest {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface VerifyPaymentResponse {
  message: string;
  topUp: TopUpRecord;
  new_balance_inr: number;
}

interface CancelOrderRequest {
  topup_id: string;
}

interface TopUpRecord {
  id: string;
  user_id?: string;
  amount: string;
  status: 'pending' | 'completed' | 'cancelled' | 'failed';
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
}

interface PendingOrder {
  id: string;
  amount: string;
  razorpay_order_id: string | null;
  created_at: string;
}

// ── Usage ──────────────────────────────────────────────
interface UsageRecord {
  id: string;
  provider: string;              // "openai" | "deepseek" | "gemini" | "nvidia"
  model: string;
  tokens_used: number;
  cost_inr: string;              // Decimal e.g. "0.0142"
  created_at: string;
  api_key: {
    key_prefix: string;
  };
}

interface UsageHistoryResponse {
  records: UsageRecord[];
  total: number;
  page: number;
  limit: number;
}

interface UsageStats {
  total_requests: number;
  total_tokens: number;
  total_spent_inr: number;
}

// ── AI Proxy ───────────────────────────────────────────
interface ChatCompletionRequest {
  model: string;                 // from GET /v1/models
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;               // Unix timestamp
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ModelCatalogEntry {
  id: string;
  object: 'model';
  owned_by: 'genaff';
  price_per_1k_inr: number;
}

interface ModelsResponse {
  object: 'list';
  data: ModelCatalogEntry[];
  _meta: {
    total_configured: number;
    live_count: number;
  };
}

// ── Playground ─────────────────────────────────────────
interface CreatePlaygroundSessionRequest {
  ttl_minutes?: number;          // 5-240, default 60
  title?: string;                // default "Untitled Chat"
}

interface CreatePlaygroundSessionResponse {
  message: string;
  session: {
    id: string;
    title: string;
    created_at: string;
    expires_at: string;
  };
  api_key: {
    key: string;                 // raw key — shown ONCE
    key_prefix: string;
    expires_at: string;
  };
}

interface PlaygroundSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  expires_at: string;
  api_key: {
    id: string;
    key_prefix: string;
    active: boolean;
    expires_at: string;
  } | null;
  _count: {
    messages: number;
  };
}

interface PlaygroundMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  provider: string | null;
  model: string | null;
  tokens_used: number;
  cost_inr: string;
  created_at: string;
}

interface PlaygroundHistoryResponse {
  session: {
    id: string;
    title: string;
    created_at: string;
    expires_at: string;
  };
  messages: PlaygroundMessage[];
}

// ── Admin ──────────────────────────────────────────────
interface AdminDashboardData {
  revenue: {
    all_time_inr: string;
    last_30_days_inr: string;
  };
  users: {
    total_count: number;
    active_last_30_days: number;
    active_last_24_hours: number;
  };
  top_users_by_spending: Array<{
    user_id: string;
    email: string;
    total_spent_inr: string;
  }>;
  top_models_by_usage: Array<{
    model: string;
    usage_count: number;
    total_tokens: number;
    total_cost_inr: string;
  }>;
  failed_transactions: {
    last_30_days: number;
    all_time: number;
  };
}

interface AdminUserListItem {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  is_suspended: boolean;
  created_at: string;
  email_verified: boolean;
}

interface AdminUserListResponse {
  success: true;
  data: {
    users: AdminUserListItem[];
    pagination: {
      page: number;
      limit: number;
      totalCount: number;
      totalPages: number;
    };
  };
}

interface AdminUserDetails {
  success: true;
  data: {
    user: {
      id: string;
      email: string;
      role: 'USER' | 'ADMIN';
      is_suspended: boolean;
      email_verified: boolean;
      created_at: string;
      free_units: number;
    };
    wallet: {
      balance_inr: string;
      last_updated: string | null;
    };
    statistics: {
      total_spent_inr: string;
      total_topup_inr: string;
      total_api_calls: number;
      active_api_keys: number;
    };
    recent_usages: Array<{
      id: string;
      provider: string;
      model: string;
      tokens_used: number;
      cost_inr: string;
      created_at: string;
    }>;
    recent_topups: Array<{
      id: string;
      amount: string;
      status: string;
      created_at: string;
    }>;
    api_keys: Array<{
      id: string;
      key_prefix: string;
      created_at: string;
      active: boolean;
    }>;
    restricted_models: string[];
  };
}

interface AdminTransaction {
  id: string;
  type: 'TOPUP' | 'USAGE';
  user_id: string;
  amount_inr: string;
  status?: string;
  model?: string;
  tokens_used?: number;
  created_at: string;
}

// ── Error ──────────────────────────────────────────────
interface ApiError {
  error: string;
  message?: string;
  detail?: string;
  retryAfter?: number;
}

// ── Health ─────────────────────────────────────────────
interface HealthResponse {
  status: 'ok';
  service: 'GenAff API Gateway';
  timestamp: string;
  env: string;
}
```

---

## 12. Security Best Practices

### 1. Never Hardcode API Keys

```js
// ❌ NEVER do this
const API_KEY = 'sk_genaff_a1b2c3...';

// ✅ Load from environment variables
const API_KEY = import.meta.env.VITE_GENAFF_API_KEY;
```

For server-side usage, use `process.env.GENAFF_API_KEY`.

### 2. Store JWT Securely

| Method | Risk Level | Recommendation |
|--------|-----------|----------------|
| `localStorage` | High (XSS) | Avoid in production |
| `sessionStorage` | Medium | Acceptable for SPAs with strict CSP |
| `httpOnly` cookie | Low | Ideal — requires backend cookie support |
| In-memory + silent re-login | Medium | Good for server-rendered apps |

If using `localStorage`/`sessionStorage`, implement a strict Content Security Policy (CSP) to mitigate XSS.

### 3. Handle Payment Signatures Correctly

```js
// ✅ The backend verifies signatures server-side with HMAC-SHA256.
// Your frontend should NEVER verify signatures client-side.
// Just pass razorpay_order_id, razorpay_payment_id, and razorpay_signature
// from the Razorpay handler callback directly to POST /wallet/topup/verify.
```

### 4. Validate All User Inputs

```js
// ✅ Validate on the client before sending
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return password.length >= 8 && password.length <= 72;
}

// The server also validates — client validation is UX, not security.
```

### 5. HTTPS-Only in Production

All API calls in production must use `https://`. The server redirects HTTP to HTTPS via Nginx. Never send API keys or JWTs over plain HTTP.

### 6. Don't Log Sensitive Data

```js
// ❌ Never log raw API keys, passwords, or full JWTs
console.log('API key:', apiKey);

// ✅ Log safe identifiers only
console.log('Using API key prefix:', keyPrefix);
```

### 7. Handle CORS Properly

Only the configured frontend origin can make requests. If you add new frontend domains, update the `allowedOrigins` array in `src/server.js`.

### 8. Razorpay Key ID is Public

`VITE_RAZORPAY_KEY_ID` (the Razorpay Key ID) is intended to be public — it's safe to include in frontend code. The **Key Secret** (`RAZORPAY_KEY_SECRET`) must **never** be exposed to the frontend; it lives only in the backend's `.env`.

---

## 13. Complete Copy-Paste Integration Examples

### 13.1 React Hook: `useGenAffAuth`

```tsx
import { useState, useCallback, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface AuthState {
  user: { id: string; email: string; free_units: number; role: string } | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

export function useGenAffAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: sessionStorage.getItem('genaff_token'),
    loading: !!sessionStorage.getItem('genaff_token'),
    error: null,
  });

  const setToken = useCallback((token: string | null) => {
    if (token) {
      sessionStorage.setItem('genaff_token', token);
    } else {
      sessionStorage.removeItem('genaff_token');
    }
    setState(s => ({ ...s, token }));
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setState(s => ({ ...s, loading: false }));
      return data;
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
      throw err;
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToken(data.token);
      setState(s => ({ ...s, user: data.user, loading: false }));
      return data;
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
      throw err;
    }
  }, [setToken]);

  const logout = useCallback(() => {
    setToken(null);
    setState({ user: null, token: null, loading: false, error: null });
  }, [setToken]);

  const verifyOtp = useCallback(async (email: string, otp: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToken(data.token);
      setState(s => ({ ...s, user: data.user, loading: false }));
      return data;
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
      throw err;
    }
  }, [setToken]);

  const forgotPassword = useCallback(async (email: string) => {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return res.json();
  }, []);

  const resetPassword = useCallback(async (params: { token: string; new_password: string } | { email: string; otp: string; new_password: string }) => {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }, []);

  // Fetch current user on mount if token exists
  useEffect(() => {
    if (!state.token) return;
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${state.token}` },
    })
      .then(res => {
        if (res.status === 401) { logout(); return null; }
        return res.json();
      })
      .then(data => {
        if (data?.user) setState(s => ({ ...s, user: data.user, loading: false }));
      })
      .catch(() => setState(s => ({ ...s, loading: false })));
  }, [state.token, logout]);

  return { ...state, register, login, logout, verifyOtp, forgotPassword, resetPassword };
}
```

### 13.2 React Hook: `useGenAffChat`

```tsx
import { useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function useGenAffChat(apiKey: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<string>('');

  const sendMessage = useCallback(async (
    model: string,
    messages: ChatMessage[],
    options?: { max_tokens?: number; temperature?: number }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, ...options }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) throw new Error('INSUFFICIENT_BALANCE');
        if (res.status === 429) throw new Error('RATE_LIMITED');
        throw new Error(data.error || 'API error');
      }

      const content = data.choices?.[0]?.message?.content || '';
      setResponse(content);
      return content;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  return { sendMessage, loading, error, response };
}
```

### 13.3 Vanilla JS: Complete Auth + Chat Module

```js
// genaff-client.js — Zero-dependency, framework-agnostic GenAff client
const GenAffClient = (baseUrl = 'https://genaff-api.shouriya.tech') => {
  let _token = null;
  let _apiKey = null;

  async function request(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.auth === 'jwt' && _token) headers['Authorization'] = `Bearer ${_token}`;
    if (opts.auth === 'apikey' && _apiKey) headers['Authorization'] = `Bearer ${_apiKey}`;

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && opts.auth === 'jwt') {
      _token = null;
      if (opts.onUnauthorized) opts.onUnauthorized();
    }

    const data = await res.json();
    if (!res.ok) throw { status: res.status, ...data };
    return data;
  }

  return {
    // ── Auth ──────────────────────────────────────────
    setToken(token) { _token = token; },
    setApiKey(key) { _apiKey = key; },
    getToken() { return _token; },

    async register(email, password) {
      return request('POST', '/auth/register', { email, password });
    },
    async login(email, password) {
      const data = await request('POST', '/auth/login', { email, password });
      _token = data.token;
      return data;
    },
    async me() {
      return request('GET', '/auth/me', null, { auth: 'jwt' });
    },
    async verifyOtp(email, otp) {
      const data = await request('POST', '/auth/verify-otp', { email, otp });
      _token = data.token;
      return data;
    },
    async verifyEmail(token) {
      const data = await request('GET', `/auth/verify-email?token=${token}`);
      _token = data.token;
      return data;
    },
    async resendVerification(email) {
      return request('POST', '/auth/resend-verification', { email });
    },
    async forgotPassword(email) {
      return request('POST', '/auth/forgot-password', { email });
    },
    async resetPassword(params) {
      return request('POST', '/auth/reset-password', params);
    },

    // ── Keys ──────────────────────────────────────────
    async listKeys() {
      return request('GET', '/keys', null, { auth: 'jwt' });
    },
    async createKey() {
      return request('POST', '/keys', null, { auth: 'jwt' });
    },
    async revokeKey(keyId) {
      return request('DELETE', `/keys/${keyId}`, null, { auth: 'jwt' });
    },

    // ── Wallet ────────────────────────────────────────
    async getWallet() {
      return request('GET', '/wallet', null, { auth: 'jwt' });
    },
    async createTopupOrder(amount) {
      return request('POST', '/wallet/topup/order', { amount }, { auth: 'jwt' });
    },
    async verifyPayment(orderId, paymentId, signature) {
      return request('POST', '/wallet/topup/verify', {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      }, { auth: 'jwt' });
    },
    async cancelTopupOrder(topupId) {
      return request('POST', '/wallet/topup/cancel', { topup_id: topupId }, { auth: 'jwt' });
    },
    async getPendingTopup() {
      return request('GET', '/wallet/topup/pending', null, { auth: 'jwt' });
    },
    async getTopupHistory() {
      return request('GET', '/wallet/history', null, { auth: 'jwt' });
    },
    async getUsageHistory(page = 1, limit = 20) {
      return request('GET', `/wallet/usage?page=${page}&limit=${limit}`, null, { auth: 'jwt' });
    },
    async getUsageStats() {
      return request('GET', '/wallet/stats', null, { auth: 'jwt' });
    },

    // ── AI Proxy ──────────────────────────────────────
    async getModels() {
      return request('GET', '/v1/models');
    },
    async chat(model, messages, opts = {}) {
      return request('POST', '/v1/chat/completions', {
        model,
        messages,
        max_tokens: opts.max_tokens,
        temperature: opts.temperature,
      }, { auth: 'apikey' });
    },

    // ── Playground ─────────────────────────────────────
    async createPlaygroundSession(ttlMinutes, title) {
      return request('POST', '/playground/sessions', { ttl_minutes: ttlMinutes, title }, { auth: 'jwt' });
    },
    async listPlaygroundSessions() {
      return request('GET', '/playground/sessions', null, { auth: 'jwt' });
    },
    async getPlaygroundHistory(sessionId, limit = 200) {
      return request('GET', `/playground/sessions/${sessionId}/history?limit=${limit}`, null, { auth: 'jwt' });
    },
    async deletePlaygroundSession(sessionId) {
      return request('DELETE', `/playground/sessions/${sessionId}`, null, { auth: 'jwt' });
    },

    // ── Billing ───────────────────────────────────────
    async downloadInvoice(topupId) {
      const res = await fetch(`${baseUrl}/wallet/invoice/${topupId}/pdf`, {
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (!res.ok) throw await res.json();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `genaff-invoice-${topupId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
};

// Usage:
// const genaff = GenAffClient('https://genaff-api.shouriya.tech');
// await genaff.login('user@example.com', 'password');
// const { keys } = await genaff.listKeys();
// genaff.setApiKey(keys[0]?.raw || 'your-key');
// const { data } = await genaff.getModels();
```

### 13.4 Axios Interceptor: Auto-Attach JWT + Handle 401

```js
// api.js — Axios instance with global JWT handling
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: auto-attach JWT
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('genaff_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 (expired token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const errorMsg = error.response?.data?.error;
      if (errorMsg === 'Token expired' || errorMsg === 'Invalid token') {
        sessionStorage.removeItem('genaff_token');
        // Redirect to login — adjust for your router
        window.location.href = '/auth/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
```

### 13.5 Axios Interceptor: Auto-Attach API Key + Handle 402

```js
// proxyApi.js — Dedicated Axios instance for AI proxy calls
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const proxyApi = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: auto-attach API key
proxyApi.interceptors.request.use((config) => {
  const apiKey = sessionStorage.getItem('genaff_api_key');
  if (apiKey) {
    config.headers.Authorization = `Bearer ${apiKey}`;
  }
  return config;
});

// Response interceptor: handle 402/403/429
proxyApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const data = error.response?.data;

    if (status === 402) {
      // Insufficient balance — dispatch custom event
      window.dispatchEvent(new CustomEvent('genaff:topup-required', {
        detail: { message: data?.message || 'Insufficient balance' }
      }));
    }

    if (status === 403 && data?.error === 'Email not verified') {
      window.dispatchEvent(new CustomEvent('genaff:verify-required'));
    }

    if (status === 429) {
      const retryAfter = data?.retryAfter || error.response?.headers['ratelimit-reset'];
      window.dispatchEvent(new CustomEvent('genaff:rate-limited', {
        detail: { retryAfter: retryAfter ? Number(retryAfter) * 1000 - Date.now() : 60000 }
      }));
    }

    return Promise.reject(error);
  }
);

export default proxyApi;
```

---

## 14. Future Scope

Features not yet implemented but planned or possible:

### 14.1 Authentication
- [ ] **Refresh tokens** — long-lived refresh tokens with `/auth/refresh` endpoint to avoid frequent re-login
- [ ] **httpOnly cookie-based JWT** — server sets JWT as httpOnly cookie for better XSS resistance
- [ ] **OAuth / Social login** — Google, GitHub OAuth support
- [ ] **2FA / TOTP** — Time-based one-time password for enhanced account security
- [ ] **Session management** — view and revoke active JWT sessions

### 14.2 AI Proxy
- [ ] **SSE Streaming** — Server-Sent Events (`"stream": true`) for real-time token-by-token output, compatible with OpenAI streaming format
- [ ] **Function calling / Tools** — Pass tool definitions, receive tool call responses
- [ ] **Vision / Image input** — Base64 image in `content` for multimodal models (GPT-4o, Gemini)
- [ ] **Batch processing** — Async batch API for large volumes at lower cost
- [ ] **Caching layer** — Semantic cache for identical prompts to reduce provider costs
- [ ] **Fallback routing** — Auto-retry with another provider if primary fails
- [ ] **Model-specific parameter passthrough** — Pass `top_p`, `frequency_penalty`, `presence_penalty`, `stop` sequences, etc.

### 14.3 Wallet & Payments
- [ ] **Auto-recharge** — Set a threshold to auto-top-up when balance drops below ₹X
- [ ] **Multiple payment gateways** — Stripe, PhonePe, Paytm
- [ ] **Spending limits** — User-set daily/monthly spending caps
- [ ] **Promo codes / Coupons** — Discount codes for wallet top-ups
- [ ] **Refund endpoint** — Admin-initiated refunds for failed/complaint transactions

### 14.4 Billing & Invoices
- [ ] **GST / Tax support** — GSTIN field, tax breakdown in invoices
- [ ] **CSV export** — Download usage/top-up data as CSV alongside PDF
- [ ] **Scheduled statements** — Email monthly wallet statements automatically

### 14.5 Playground
- [ ] **Persist session across page refresh** — Sessions survive browser refresh
- [ ] **Model comparison mode** — Side-by-side comparisons of different models
- [ ] **Prompt templates** — Save and load prompt templates
- [ ] **Export conversation** — Export as JSON / Markdown / PDF

### 14.6 Admin
- [ ] **Bulk user operations** — Import/export users, bulk suspend/delete
- [ ] **Real-time dashboard** — WebSocket-powered live metrics
- [ ] **Audit log** — Track all admin actions for compliance
- [ ] **System health alerts** — Email/Slack notifications for critical failures
- [ ] **Pricing management UI** — Update model pricing from admin panel (currently hardcoded)

### 14.7 Infrastructure
- [ ] **Redis-backed rate limiting** — Replace in-memory `express-rate-limit` with Redis for multi-process/PM2 cluster compatibility
- [ ] **Docker / Docker Compose** — Containerized deployment with PostgreSQL + Redis
- [ ] **Kubernetes / Helm chart** — Production-grade orchestration
- [ ] **API versioning** — `/v2/` endpoint namespace for breaking changes
- [ ] **OpenAPI / Swagger spec** — Auto-generated interactive API docs
- [ ] **Webhook support** — Post events (payment success, user signup, etc.) to configured URLs

### 14.8 Misc
- [ ] **Referral system** — Track referral codes, reward referrers with credits
- [ ] **Team / Organization accounts** — Multi-user orgs with shared billing
- [ ] **i18n** — Multi-language email templates and error messages
- [ ] **Dark mode for emails** — Proper dark-mode-aware HTML email templates

---

> **Document Version:** 1.0
> **Last Updated:** June 2026
> **Total Endpoints Documented:** 40+
> **Document Lines:** ~1,800
>
> Built from GenAff source code. Every endpoint, field, constraint, error code,
> and integration pattern is verified against the actual implementation.
