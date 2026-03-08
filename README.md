# GenAff — SaaS AI API Gateway

A production-ready backend that proxies OpenAI, DeepSeek, and Gemini behind your own API keys, with per-user billing in INR, wallet top-ups (Razorpay), rate limiting, and a full admin panel.

| Service | URL |
|---------|-----|
| Frontend | https://genaff.shauryacodes.xyz |
| API | https://genaff-api.shauryacodes.xyz |
| Swagger Docs | https://genaff-api.shauryacodes.xyz/docs |

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Environment Variables](#environment-variables)
3. [Local Development with Docker Compose](#local-development-with-docker-compose)
4. [Prisma Migrations & Seed](#prisma-migrations--seed)
5. [Running Tests](#running-tests)
6. [API Reference](#api-reference)
7. [Deploying to VPS (GitHub → SSH → Docker)](#deploying-to-vps-github--ssh--docker)
8. [Nginx Reverse Proxy Configuration](#nginx-reverse-proxy-configuration)
9. [DNS and Firewall Setup](#dns-and-firewall-setup)
10. [Razorpay Integration](#razorpay-integration)
11. [Request Flow Diagram](#request-flow-diagram)

---

## Architecture Overview

```
Client
  │
  ├── POST /auth/* ──────► Auth Module ──────► PostgreSQL (users, bcrypt passwords)
  ├── POST /keys/* ──────► Keys Module ──────► PostgreSQL (argon2-hashed api keys)
  ├── POST /wallet/* ────► Wallet Module ────► PostgreSQL (wallets, top-ups)
  │                              │
  │                         Razorpay webhook ──► /webhooks/payments
  │
  └── POST /v1/chat/* ───► Proxy Module
           │
           ├── 1. Validate API key (argon2)
           ├── 2. Rate limit (Redis sliding window)
           ├── 3. Deduct free units OR wallet (atomic)
           ├── 4. Select provider (cheapest / preferred / fallback)
           ├── 5. Call OpenAI / DeepSeek / Gemini API
           ├── 6. Record usage (PostgreSQL)
           └── 7. Return response (provider keys NEVER exposed)
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection (default: `redis://localhost:6379`) |
| `JWT_SECRET` | ✅ | Min 32 chars random secret for JWT signing |
| `JWT_EXPIRES_IN` | ✅ | JWT TTL (e.g. `7d`, `24h`) |
| `OPENAI_API_KEY` | ⚠️ | Required if using OpenAI provider |
| `DEEPSEEK_API_KEY` | ⚠️ | Required if using DeepSeek provider |
| `GEMINI_API_KEY` | ⚠️ | Required if using Gemini provider |
| `RAZORPAY_KEY_ID` | ⚠️ | Razorpay key ID (required for live payments) |
| `RAZORPAY_KEY_SECRET` | ⚠️ | Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | ⚠️ | Razorpay webhook HMAC secret |
| `EXCHANGE_RATE_USD_TO_INR` | ✅ | USD → INR rate (e.g. `83.5`) |
| `DEFAULT_FREE_UNITS` | ✅ | Free units given on signup (e.g. `100`) |
| `FREE_UNIT_MODE` | ✅ | `request` (1 unit/req) or `token` (1 unit/token) |
| `FRONTEND_URL` | ✅ | Allowed CORS origin |
| `BACKEND_URL` | ✅ | Backend public URL (shown in Swagger) |
| `PORT` | ✅ | Server port (default: `3000`) |
| `LOG_LEVEL` | ✅ | `info`, `debug`, `error`, etc. |

---

## Local Development with Docker Compose

### Prerequisites
- Docker ≥ 24
- Docker Compose ≥ 2.20
- Node.js ≥ 18 (for running outside Docker)

### Start all services

```bash
cd backend

# 1. Copy environment file
cp .env.example .env
# Edit .env with your API keys and secrets

# 2. Build and start all services (app + postgres + redis + adminer)
docker compose up --build -d

# 3. Watch logs
docker compose logs -f app
```

The backend is now running at **http://localhost:3000**  
Swagger docs: **http://localhost:3000/docs**  
Adminer (DB GUI): **http://localhost:8080**

### Stopping services

```bash
docker compose down          # stop containers
docker compose down -v       # stop + delete volumes (destructive!)
```

### Running without Docker (dev mode)

```bash
# 1. Start only infrastructure
docker compose up postgres redis -d

# 2. Install deps
cd backend && npm install

# 3. Generate Prisma client & migrate
npx prisma generate
npx prisma migrate dev --name init

# 4. Seed database
npx ts-node prisma/seed.ts

# 5. Run dev server with hot reload
npm run dev
```

---

## Prisma Migrations & Seed

### Create a new migration (dev)

```bash
npx prisma migrate dev --name <migration_name>
```

### Apply migrations (production)

```bash
npx prisma migrate deploy
```

### Seed the database

```bash
npx ts-node prisma/seed.ts
```

This creates:
- Admin user (`admin@genaff.local` / `Admin@123456` — **change in production!**)
- `ProviderConfig` rows for OpenAI, DeepSeek, Gemini
- `ModelMapping` rows for all supported models

### View the database with Prisma Studio

```bash
npx prisma studio
```

---

## Running Tests

```bash
# Unit tests (no DB/Redis required)
npm test

# Watch mode
npm run test:watch

# With coverage
npm test -- --coverage
```

Tests cover:
- API key generation & argon2 hashing
- Rate limiter sliding window logic (Redis mocked)
- Wallet deduction atomic logic & cost estimation
- Provider selection & fallback ordering

---

## API Reference

Full interactive docs at `/docs` (Swagger UI).

### Authentication

All dashboard endpoints use `Authorization: Bearer <JWT>`.  
Proxy endpoints (`/v1/*`) use `Authorization: Bearer sk_<USER_API_KEY>`.

### Quick Reference

#### Auth

```
POST /auth/register    { email, password }      → { id, email, role, ... }
POST /auth/login       { email, password }      → { access_token, ... }
GET  /me                                        → user profile + wallet
```

#### API Keys

```
GET    /keys                    → list key metadata
POST   /keys   { name }         → create key (plaintext shown ONCE)
PATCH  /keys/:id/disable        → disable key
DELETE /keys/:id                → delete key
```

#### Wallet & Billing

```
POST /wallet/topup/initiate  { amount_inr_paisa, method }  → payment link / mock id
GET  /billing/usage?from=YYYY-MM-DD&to=YYYY-MM-DD          → usage history
```

#### Proxy (API Keys, NOT JWT)

```
POST /v1/chat/completions  { messages, model?, preferred_provider? }  → AI response
GET  /v1/models                                                        → available models
```

#### Admin (admin JWT required)

```
GET    /admin/providers                        → list provider configs
POST   /admin/providers     { provider, ... }  → upsert provider config
PATCH  /admin/users/:id/credits { free_units_delta, wallet_inr_paisa_delta }
GET    /admin/usage                            → all usage records
GET    /admin/users                            → all users
POST   /admin/topup-mock  { transaction_id }   → [DEV] approve top-up
```

#### Webhooks

```
POST /webhooks/payments    → Razorpay payment webhook
```

---

## Deploying to VPS (GitHub → SSH → Docker)

### 1. Push code to GitHub

```bash
# On your local machine
git init
git remote add origin https://github.com/<your-username>/genaff.git
git add .
git commit -m "initial commit"
git push -u origin main
```

### 2. Prepare your VPS

Requirements: Ubuntu 22.04+, Docker, Docker Compose, Git, Nginx

```bash
# SSH into your VPS
ssh root@<your-vps-ip>

# Install Docker (if not already installed)
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Install Nginx & Certbot
apt-get install -y nginx certbot python3-certbot-nginx

# Create app directory
mkdir -p /opt/genaff
```

### 3. Clone repository on VPS

```bash
cd /opt/genaff
git clone https://github.com/<your-username>/genaff.git .
```

### 4. Configure environment

```bash
cd /opt/genaff/backend
cp .env.example .env
nano .env  # Fill in all production values
```

**Critical production values to change:**
- `JWT_SECRET` — generate with: `openssl rand -hex 64`
- `POSTGRES_PASSWORD` — strong unique password
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — live keys
- `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `GEMINI_API_KEY`
- `EXCHANGE_RATE_USD_TO_INR` — current rate

### 5. Start with Docker Compose

```bash
cd /opt/genaff/backend

# Production: no exposed DB/Redis ports
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Verify
docker compose ps
docker compose logs app --tail=50
```

### 6. Pull updates (future deployments)

```bash
cd /opt/genaff
git pull origin main
cd backend
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build app
```

### 7. Systemd service (auto-restart on reboot)

```bash
cat > /etc/systemd/system/genaff.service << 'EOF'
[Unit]
Description=GenAff Backend
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/genaff/backend
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable genaff
systemctl start genaff
```

---

## Nginx Reverse Proxy Configuration

### Install SSL certificates

```bash
# Replace <your-email> with your email
certbot --nginx -d genaff-api.shauryacodes.xyz --email <your-email> --agree-tos --non-interactive
```

### Nginx config for API

```nginx
# /etc/nginx/sites-available/genaff-api
server {
    listen 80;
    server_name genaff-api.shauryacodes.xyz;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name genaff-api.shauryacodes.xyz;

    ssl_certificate     /etc/letsencrypt/live/genaff-api.shauryacodes.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/genaff-api.shauryacodes.xyz/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache   shared:MozSSL:10m;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=63072000" always;

    # Proxy to Docker container
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_buffering    off;         # Important for SSE/streaming
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 4m;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/genaff-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## DNS and Firewall Setup

### DNS Records (set in your domain registrar / Cloudflare)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `genaff-api` | `<your-vps-ip>` | 300 |
| A | `genaff` | `<your-frontend-server-ip>` | 300 |

If using Cloudflare: set proxy status to **DNS only** (grey cloud) for the API subdomain to avoid Cloudflare intercepting WebSocket/SSE connections.

### UFW Firewall Rules

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# Do NOT open 3000, 5432, 6379 to the internet
ufw enable
ufw status
```

---

## Razorpay Integration

### Webhook setup (Razorpay Dashboard)

1. Go to Razorpay Dashboard → Settings → Webhooks
2. Add webhook URL: `https://genaff-api.shauryacodes.xyz/webhooks/payments`
3. Select events: `payment.captured`, `order.paid`
4. Copy the webhook secret → set as `RAZORPAY_WEBHOOK_SECRET` in `.env`

### Test top-ups (development)

```bash
# 1. Initiate a manual top-up (returns transaction_id)
curl -X POST http://localhost:3000/wallet/topup/initiate \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"amount_inr_paisa": 5000, "method": "manual"}'

# 2. Approve the top-up via admin endpoint
curl -X POST http://localhost:3000/admin/topup-mock \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"transaction_id": "<transaction_id_from_step_1>"}'
```

---

## Request Flow Diagram

```
Client
  │
  POST /v1/chat/completions
  Authorization: Bearer sk_xxx
  │
  ├─ [1] Extract & validate API key (argon2 verify) ─► REJECT 401 if invalid
  │
  ├─ [2] Check rate limits (Redis) ──────────────────► REJECT 429 if exceeded
  │   genaff:rate:minute:<keyId>  (TTL: 60s)
  │   genaff:rate:day:<keyId>     (TTL: 86400s)
  │
  ├─ [3] Check free units
  │   ├─ free_units > 0 ──► decrement free_units (no wallet charge)
  │   └─ free_units = 0 ──► estimate cost_inr_paisa
  │                         wallet.balance >= cost? ── NO ──► 402 Payment Required
  │                                                 └─ YES ──► deduct (atomic tx)
  │
  ├─ [4] Create Usage record (status: "reserved")
  │
  ├─ [5] Select provider (preferred → cheapest → priority order)
  │
  ├─ [6] Call AI provider API ─► FAIL → try next provider (fallback)
  │
  ├─ [7] Settle cost (compare actual vs estimate, refund/charge diff)
  │
  ├─ [8] Update Usage record (status: "completed", actual tokens + cost)
  │
  └─ [9] Return AI response to client (provider metadata stripped)
```

---

## File Structure

```
GenAff/
├── .github/
│   └── workflows/
│       └── ci.yml                    # GitHub Actions CI
└── backend/
    ├── prisma/
    │   ├── schema.prisma             # Prisma schema (all models)
    │   └── seed.ts                   # DB seed (admin user + provider configs)
    ├── src/
    │   ├── config/
    │   │   └── env.ts                # Zod-validated env config
    │   ├── lib/
    │   │   ├── prisma.ts             # Prisma client singleton
    │   │   ├── redis.ts              # Redis client singleton
    │   │   └── logger.ts             # Pino logger
    │   ├── modules/
    │   │   ├── auth/
    │   │   │   ├── auth.service.ts   # Register / login / profile
    │   │   │   └── auth.routes.ts    # POST /auth/register, /auth/login, GET /me
    │   │   ├── keys/
    │   │   │   ├── keys.service.ts   # Key gen, hashing, validation
    │   │   │   └── keys.routes.ts    # GET/POST/PATCH/DELETE /keys
    │   │   ├── wallet/
    │   │   │   ├── wallet.service.ts # Top-up, deduct, refund
    │   │   │   └── wallet.routes.ts  # /wallet/topup/initiate, /billing/usage
    │   │   ├── proxy/
    │   │   │   └── proxy.routes.ts   # POST /v1/chat/completions, GET /v1/models
    │   │   ├── admin/
    │   │   │   └── admin.routes.ts   # /admin/* endpoints
    │   │   └── webhooks/
    │   │       └── webhook.routes.ts # POST /webhooks/payments
    │   ├── services/
    │   │   ├── provider.service.ts   # OpenAI / DeepSeek / Gemini callers
    │   │   └── rate-limiter.service.ts # Redis sliding window rate limiter
    │   ├── jobs/
    │   │   └── reconcile.job.ts      # Hourly usage reconciliation cron
    │   ├── app.ts                    # Fastify app builder (plugins + routes)
    │   └── index.ts                  # Entry point
    ├── tests/
    │   ├── setup.ts                  # Jest env setup
    │   └── unit/
    │       ├── api-key.test.ts       # Key generation & hashing tests
    │       ├── rate-limiter.test.ts  # Rate limit logic tests (Redis mocked)
    │       ├── wallet.test.ts        # Wallet deduction & cost math tests
    │       └── provider-selection.test.ts # Provider routing tests
    ├── Dockerfile                    # Multi-stage production Docker build
    ├── docker-compose.yml            # Local dev: app + postgres + redis + adminer
    ├── docker-compose.prod.yml       # Production overrides
    ├── .env.example                  # All env var names with descriptions
    ├── jest.config.json              # Jest configuration
    ├── tsconfig.json                 # TypeScript configuration
    └── package.json                  # Dependencies & scripts
```

---

## Security Notes

- Provider API keys are **only** in server environment variables. Never returned to clients.
- User API keys are stored **hashed** (argon2). Plaintext shown once at creation.
- JWT uses HS256 with a minimum 32-char secret.
- Helmet + CORS configured for frontend domain only.
- PostgreSQL and Redis ports are **not** exposed to the internet in production.
- Razorpay webhooks verified with HMAC-SHA256 signature.
- Admin endpoints protected by JWT role check (`role === "admin"`).

---

## Troubleshooting

### App can't connect to database
```bash
docker compose logs postgres  # Check if postgres is healthy
docker compose exec app sh -c "npx prisma migrate status"
```

### Redis connection refused
```bash
docker compose logs redis
docker compose exec redis redis-cli ping  # Should return PONG
```

### Reset all data (destructive!)
```bash
docker compose down -v
docker compose up -d
```

### View Prisma query logs
Set `LOG_LEVEL=debug` and `NODE_ENV=development` in `.env`.

---

*GenAff Backend — Node.js 20 + Fastify + PostgreSQL + Redis + Prisma*
