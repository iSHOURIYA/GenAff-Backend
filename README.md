# GenAff – AI API Gateway Backend

A production-ready Node.js backend that acts as a proxy gateway for OpenAI, DeepSeek, and Gemini APIs.  
Users register, get their own API keys, top up their ₹ wallet, and call AI models through a single unified endpoint.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [API Reference](#api-reference)
4. [Local Development Setup](#local-development-setup)
5. [Production VPS Deployment](#production-vps-deployment)
6. [Connecting Your Domain](#connecting-your-domain)
7. [Environment Variables](#environment-variables)
8. [Pricing Logic](#pricing-logic)

---

## Tech Stack

| Layer        | Technology                        |
|--------------|-----------------------------------|
| Runtime      | Node.js 18+                       |
| Framework    | Express.js                        |
| Database     | PostgreSQL                        |
| ORM          | Prisma                            |
| Auth         | JWT (jsonwebtoken)                |
| Passwords    | bcrypt                            |
| Rate Limiting| express-rate-limit (in-memory)    |
| AI Providers | OpenAI, DeepSeek, Gemini          |

---

## Project Structure

```
backend/
├── src/
│   ├── controllers/
│   │   ├── authController.js      ← register / login / me
│   │   ├── keyController.js       ← CRUD for API keys
│   │   ├── walletController.js    ← balance / top-up / usage history
│   │   └── proxyController.js     ← AI proxy endpoint
│   ├── routes/
│   │   ├── auth.js
│   │   ├── keys.js
│   │   ├── wallet.js
│   │   └── proxy.js
│   ├── middleware/
│   │   ├── authMiddleware.js      ← JWT verification
│   │   ├── apiKeyMiddleware.js    ← sk_genaff_... validation
│   │   └── rateLimiter.js        ← 20 req/min per API key
│   ├── services/
│   │   ├── prismaClient.js        ← singleton Prisma client
│   │   ├── userService.js
│   │   ├── keyService.js
│   │   ├── walletService.js
│   │   └── usageService.js
│   ├── providers/
│   │   ├── openai.js              ← OpenAI API caller
│   │   ├── deepseek.js            ← DeepSeek API caller
│   │   └── gemini.js              ← Gemini API caller (with format conversion)
│   ├── utils/
│   │   ├── jwt.js                 ← sign / verify tokens
│   │   ├── hash.js                ← bcrypt + API key generation
│   │   └── pricing.js             ← cost calculation per model
│   └── server.js                  ← Express app entry point
├── prisma/
│   └── schema.prisma
├── .env.example
├── package.json
└── README.md
```

---

## API Reference

### Base URL

- **Local:**  `http://localhost:3000`
- **Production:** `https://genaff-api.shauryacodes.xyz`

---

### Authentication

#### `POST /auth/register`

```json
// Request body
{ "email": "user@example.com", "password": "mypassword123" }

// Response 201
{
  "message": "Account created successfully",
  "token": "<JWT>",
  "user": { "id": "...", "email": "...", "free_units": 10 }
}
```

#### `POST /auth/login`

```json
// Request body
{ "email": "user@example.com", "password": "mypassword123" }

// Response 200
{ "token": "<JWT>", "user": { ... } }
```

#### `GET /auth/me` _(requires JWT)_

```
Authorization: Bearer <JWT>
```

---

### API Keys

All endpoints require `Authorization: Bearer <JWT>`.

| Method   | Endpoint      | Description                            |
|----------|---------------|----------------------------------------|
| `GET`    | `/keys`       | List all active keys (prefix only)     |
| `POST`   | `/keys`       | Generate a new key (shown **once**)    |
| `DELETE` | `/keys/:id`   | Revoke a key                           |

**API keys look like:** `sk_genaff_<48 hex chars>`

---

### Wallet

All endpoints require `Authorization: Bearer <JWT>`.

| Method | Endpoint           | Description                        |
|--------|--------------------|------------------------------------|
| `GET`  | `/wallet`          | Current balance                    |
| `POST` | `/wallet/topup`    | Add money (simulated, min ₹10)     |
| `GET`  | `/wallet/history`  | Top-up transactions                |
| `GET`  | `/wallet/usage`    | AI usage records (paginated)       |
| `GET`  | `/wallet/stats`    | Total tokens & spend               |

**Top-up request:**

```json
// POST /wallet/topup
{ "amount": 100 }
```

---

### AI Proxy

```
POST /v1/chat/completions
Authorization: Bearer sk_genaff_<your-key>
Content-Type: application/json
```

**Request:**

```json
{
  "model": "gemini-1.5-flash",
  "messages": [
    { "role": "user", "content": "Hello, who are you?" }
  ]
}
```

Optionally add `"max_tokens"` and `"temperature"`.

**Supported models:**

| Provider  | Models                                                        |
|-----------|---------------------------------------------------------------|
| OpenAI    | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`     |
| DeepSeek  | `deepseek-chat`, `deepseek-coder`, `deepseek-reasoner`        |
| Gemini    | `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`, … |

**Rate limit:** 20 requests per minute per API key (HTTP 429 if exceeded).

---

## Local Development Setup

### 1 – Install Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS (with Homebrew)
brew install node@20

# Verify
node --version   # should be v18+
npm --version
```

### 2 – Install PostgreSQL

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# macOS (Homebrew)
brew install postgresql@16
brew services start postgresql@16
```

### 3 – Create the Database

```bash
sudo -u postgres psql

-- Inside psql:
CREATE USER genaff_user WITH PASSWORD 'your_password';
CREATE DATABASE genaff OWNER genaff_user;
GRANT ALL PRIVILEGES ON DATABASE genaff TO genaff_user;
\q
```

### 4 – Setup Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL=postgresql://genaff_user:your_password@localhost:5432/genaff
JWT_SECRET=a_long_random_secret_string
OPENAI_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
GEMINI_API_KEY=AIza...
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### 5 – Install Dependencies & Run Prisma Migration

```bash
npm install
npx prisma migrate dev --name init
```

This creates all tables in your PostgreSQL database.

### 6 – Start Development Server

```bash
npm run dev
```

Server starts on `http://localhost:3000` with auto-reload.

---

## Production VPS Deployment

### Tested on: Ubuntu 22.04 VPS

### 1 – Initial Server Setup

```bash
# SSH into your server
ssh root@your-server-ip

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y
sudo systemctl enable postgresql

# Install PM2 (process manager)
sudo npm install -g pm2
```

### 2 – Clone and Configure

```bash
git clone https://github.com/youruser/genaff-backend.git
cd genaff-backend

npm install

cp .env.example .env
nano .env   # fill in your values
```

Set `NODE_ENV=production` in `.env`.

### 3 – Setup Database

```bash
sudo -u postgres psql -c "CREATE USER genaff_user WITH PASSWORD 'strongpassword';"
sudo -u postgres psql -c "CREATE DATABASE genaff OWNER genaff_user;"
```

Update `DATABASE_URL` in `.env` accordingly.

### 4 – Run Migrations & Generate Prisma Client

```bash
npm run build          # runs: npx prisma generate
npm run db:migrate     # runs: npx prisma migrate deploy
```

### 5 – Start with PM2

```bash
pm2 start src/server.js --name genaff-backend
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

Useful PM2 commands:

```bash
pm2 status                    # list running processes
pm2 logs genaff-backend       # view live logs
pm2 restart genaff-backend    # restart
pm2 stop genaff-backend       # stop
```

---

## Connecting Your Domain

### Domain: `genaff-api.shauryacodes.xyz`

### 1 – DNS Setup

Add an **A record** in your DNS provider:

| Type | Name                        | Value          | TTL  |
|------|-----------------------------|----------------|------|
| A    | `genaff-api.shauryacodes.xyz` | `YOUR_VPS_IP`  | Auto |

### 2 – Install Nginx

```bash
sudo apt install nginx -y
sudo systemctl enable nginx
```

### 3 – Create Nginx Config

```bash
sudo nano /etc/nginx/sites-available/genaff-api
```

Paste:

```nginx
server {
    listen 80;
    server_name genaff-api.shauryacodes.xyz;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/genaff-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4 – Enable HTTPS (SSL) with Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d genaff-api.shauryacodes.xyz
```

Follow prompts. Certbot auto-renews every 90 days.

Your API is now live at `https://genaff-api.shauryacodes.xyz`.

---

## Environment Variables

| Variable         | Required | Description                                  |
|------------------|----------|----------------------------------------------|
| `DATABASE_URL`   | ✅       | PostgreSQL connection string                 |
| `JWT_SECRET`     | ✅       | Secret for signing JWT tokens                |
| `JWT_EXPIRES_IN` | –        | Token expiry (default: `7d`)                 |
| `PORT`           | –        | Server port (default: `3000`)                |
| `NODE_ENV`       | –        | `development` or `production`                |
| `OPENAI_API_KEY` | ✅*      | Your OpenAI API key                          |
| `DEEPSEEK_API_KEY`| ✅*     | Your DeepSeek API key                        |
| `GEMINI_API_KEY` | ✅*      | Your Google Gemini API key                   |
| `FRONTEND_URL`   | –        | CORS-allowed frontend origin                 |
| `RATE_LIMIT_RPM` | –        | Requests per minute per key (default: `20`)  |
| `MIN_TOPUP_INR`  | –        | Minimum top-up amount (default: `10`)        |

*At least one AI provider key is required.

---

## Pricing Logic

Cost is calculated as:

```
cost_inr = (tokens_used / 1000) × price_per_1k_tokens_usd × USD_TO_INR
```

`USD_TO_INR` is hardcoded at `84`. Update `src/utils/pricing.js` to adjust.

Each request's cost is deducted from the user's INR wallet after a successful AI response.

New users receive **10 free units** (each unit covers one request regardless of cost, used as a fallback when wallet balance is 0).

---

## Quick Test (cURL)

```bash
# 1. Register
curl -X POST https://genaff-api.shauryacodes.xyz/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# 2. Login
curl -X POST https://genaff-api.shauryacodes.xyz/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# 3. Top up wallet (use JWT from login)
curl -X POST https://genaff-api.shauryacodes.xyz/wallet/topup \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"amount":50}'

# 4. Create API key
curl -X POST https://genaff-api.shauryacodes.xyz/keys \
  -H "Authorization: Bearer <JWT>"

# 5. Use AI proxy (use sk_genaff_... key from step 4)
curl -X POST https://genaff-api.shauryacodes.xyz/v1/chat/completions \
  -H "Authorization: Bearer sk_genaff_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-1.5-flash",
    "messages": [{"role":"user","content":"Say hello"}]
  }'
```

---

## License

MIT
