# GenAff API Documentation

This folder contains the complete API documentation package for the GenAff SaaS API Gateway.

## File Structure

```
docs/
├── openapi.yaml              ← Full OpenAPI 3.1 spec (machine-readable + human-readable)
├── README.md                 ← This file
├── billing-math.md           ← Cost formula, worked examples, billing lifecycle
├── schema-docs.md            ← Prisma model docs + example DB queries
├── changelog.md              ← Version history and backward-compat policy
└── examples/
    ├── node-axios.js         ← Node.js SDK examples (axios)
    ├── python-requests.py    ← Python SDK examples (requests)
    ├── curl-examples.sh      ← Curl reference for every endpoint
    └── webhook-handler.js    ← Razorpay webhook verification + handling
```

---

## Serve Swagger UI Locally

### Option A — Via npm script (from `/backend`)

Add this to `backend/package.json` scripts:

```json
"docs:serve": "npx @redocly/cli preview-docs docs/openapi.yaml --port 8080"
```

Or to use the classic Swagger UI:

```json
"docs:serve": "npx swagger-ui-watcher docs/openapi.yaml"
```

Then run:

```bash
cd backend
npm run docs:serve
# Open http://localhost:8080
```

### Option B — One-liner (no install)

```bash
# Requires Docker
docker run -p 8080:8080 \
  -e SWAGGER_JSON=/spec/openapi.yaml \
  -v $(pwd)/docs:/spec \
  swaggerapi/swagger-ui

# Open http://localhost:8080
```

### Option C — Redocly (nicer UI)

```bash
npx @redocly/cli preview-docs docs/openapi.yaml
```

### Option D — The running API itself

The GenAff backend serves Swagger UI at:

```
https://genaff-api.shauryacodes.xyz/docs
```

This is auto-generated from the route JSON schemas by `@fastify/swagger` + `@fastify/swagger-ui`.

---

## Validate the OpenAPI Spec

```bash
# Install once
npm install -g @redocly/cli

# Validate
redocly lint docs/openapi.yaml

# Or with openapi-generator
npx @openapitools/openapi-generator-cli validate -i docs/openapi.yaml
```

---

## Generate Client SDKs

### TypeScript client (openapi-typescript)

```bash
# Install
npm install -D openapi-typescript

# Generate types
npx openapi-typescript docs/openapi.yaml -o src/types/api.d.ts

# Use with openapi-fetch
npm install openapi-fetch
```

```typescript
import createClient from 'openapi-fetch';
import type { paths } from './types/api';

const client = createClient<paths>({
  baseUrl: 'https://genaff-api.shauryacodes.xyz',
});

const { data, error } = await client.POST('/auth/login', {
  body: { email: 'user@example.com', password: 'pass' },
});
```

---

### Full client (openapi-generator-cli)

```bash
# Install Java (needed by openapi-generator)
# or use Docker:

# TypeScript Axios client
docker run --rm \
  -v $(pwd)/docs:/spec \
  -v $(pwd)/generated:/out \
  openapitools/openapi-generator-cli generate \
  -i /spec/openapi.yaml \
  -g typescript-axios \
  -o /out/typescript-axios-client

# Python client
docker run --rm \
  -v $(pwd)/docs:/spec \
  -v $(pwd)/generated:/out \
  openapitools/openapi-generator-cli generate \
  -i /spec/openapi.yaml \
  -g python \
  -o /out/python-client

# Go client
docker run --rm \
  -v $(pwd)/docs:/spec \
  -v $(pwd)/generated:/out \
  openapitools/openapi-generator-cli generate \
  -i /spec/openapi.yaml \
  -g go \
  -o /out/go-client
```

Available generators: https://openapi-generator.tech/docs/generators

---

## Frontend Integration

The frontend at `genaff.shauryacodes.xyz` can import the OpenAPI spec to:

1. **Auto-generate typed API calls** using `openapi-typescript` + `openapi-fetch`
2. **Display endpoints** in a dashboard (Swagger UI embed or custom component)
3. **Show billing estimates** using the formulas in [billing-math.md](./billing-math.md)

### Recommended approach for Next.js frontend

```bash
# In the frontend project
npm install openapi-typescript openapi-fetch

# Copy or symlink the spec
cp backend/docs/openapi.yaml frontend/src/api/openapi.yaml

# Generate types (add to package.json scripts)
npx openapi-typescript src/api/openapi.yaml -o src/api/types.d.ts
```

---

## Security Notes

| Concern | Implementation |
|---------|---------------|
| API key storage | argon2id hash only — plaintext never persisted |
| JWT signing | HS256, `JWT_SECRET` from env, 7d expiry |
| Webhook verification | HMAC-SHA256 over raw body, `timingSafeEqual` |
| Wallet deduction | Atomic conditional SQL `UPDATE ... WHERE balance >= cost` |
| Rate limiting | Redis sorted sets, sliding window, per-key |
| HTTPS | Let's Encrypt via certbot, auto-renews |

---

## Environment Variables Reference

Required `.env` variables (see `.env.example`):

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | — |
| `JWT_EXPIRES_IN` | JWT TTL | `7d` |
| `RAZORPAY_KEY_ID` | Razorpay API key ID | `rzp_live_...` |
| `RAZORPAY_KEY_SECRET` | Razorpay API key secret | — |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook HMAC secret | — |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `DEEPSEEK_API_KEY` | DeepSeek API key | — |
| `GEMINI_API_KEY` | Google Gemini API key | — |
| `EXCHANGE_RATE_USD_TO_INR` | USD→INR rate | `83.50` |
| `FREE_UNITS_ON_REGISTER` | Free units for new users | `10` |
| `FREE_UNIT_MODE` | `request` or `token` | `request` |
| `NODE_ENV` | Environment | `production` |
| `PORT` | HTTP port | `3000` |
