#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# GenAff – Automated Deployment Script
# Usage: ./deploy.sh
# ═══════════════════════════════════════════════════════════════
#
# Reads all domain/env values from .env.
# Steps:
#   1. Validate required env vars
#   2. Install system deps (if missing)
#   3. Configure Nginx for $API_DOMAIN
#   4. Obtain/renew SSL via Certbot
#   5. Run Prisma generate + migrate
#   6. Start/restart PM2
#
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Load .env ──────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "❌  .env file not found. Run: cp .env.example .env && nano .env"
  exit 1
fi

export $(grep -v '^#' .env | grep -E '^[A-Z_]+=' | xargs 2>/dev/null || true)

# ── Validate critical vars ─────────────────────────────────────
REQUIRED=("API_DOMAIN" "FRONTEND_URL" "DATABASE_URL" "JWT_SECRET")
MISSING=0
for var in "${REQUIRED[@]}"; do
  val="${!var:-}"
  if [ -z "$val" ]; then
    echo "❌  Missing required env var: $var"
    MISSING=1
  fi
done
if [ "$MISSING" -eq 1 ]; then
  echo "   Please set all required variables in .env"
  exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║        GenAff Deployment Script                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "  API Domain    : $API_DOMAIN"
echo "  Frontend URL  : $FRONTEND_URL"
echo "  Node Env      : ${NODE_ENV:-development}"
echo ""

# ── Install Node.js 20 (if needed) ─────────────────────────────
if ! command -v node &>/dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]; then
  echo "▶ Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "  Node: $(node -v) │ NPM: $(npm -v)"

# ── Install PostgreSQL (if needed) ─────────────────────────────
if ! command -v psql &>/dev/null; then
  echo "▶ Installing PostgreSQL..."
  sudo apt update
  sudo apt install -y postgresql postgresql-contrib
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
fi

# ── Install PM2 (if needed) ────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "▶ Installing PM2..."
  sudo npm install -g pm2
fi

# ── Install Nginx (if needed) ──────────────────────────────────
if ! command -v nginx &>/dev/null; then
  echo "▶ Installing Nginx..."
  sudo apt install -y nginx
  sudo systemctl enable nginx
fi

# ── Install dependencies ───────────────────────────────────────
echo "▶ Installing npm dependencies..."
npm install

# ── Prisma generate + migrate ──────────────────────────────────
echo "▶ Generating Prisma client..."
npm run build

echo "▶ Running database migrations..."
npm run db:migrate

# ── Generate Nginx config ──────────────────────────────────────
NGINX_CONF="/etc/nginx/sites-available/genaff-api"
NGINX_ENABLED="/etc/nginx/sites-enabled/genaff-api"

echo "▶ Configuring Nginx for $API_DOMAIN..."

sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 80;
    server_name $API_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:${PORT:-3000};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF

# Enable site
if [ ! -L "$NGINX_ENABLED" ]; then
  sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
fi

# Remove default site if it conflicts
if [ -L /etc/nginx/sites-enabled/default ]; then
  sudo rm /etc/nginx/sites-enabled/default
fi

sudo nginx -t
sudo systemctl reload nginx

# ── SSL with Certbot ───────────────────────────────────────────
echo "▶ Obtaining SSL certificate for $API_DOMAIN..."

if ! command -v certbot &>/dev/null; then
  echo "  Installing Certbot..."
  sudo apt install -y certbot python3-certbot-nginx
fi

# Check if cert already exists
if sudo certbot certificates 2>/dev/null | grep -q "$API_DOMAIN"; then
  echo "  SSL certificate already exists for $API_DOMAIN. Renewing if needed..."
  sudo certbot renew --nginx --quiet || true
else
  # Non-interactive certbot
  sudo certbot --nginx -d "$API_DOMAIN" --non-interactive --agree-tos \
    --email "${SUPPORT_EMAIL:-admin@$API_DOMAIN}" || {
    echo "⚠️  Certbot failed. You can re-run manually:"
    echo "   sudo certbot --nginx -d $API_DOMAIN"
  }
fi

# ── Start / Restart PM2 ────────────────────────────────────────
echo "▶ Starting GenAff with PM2..."

if pm2 list | grep -q "genaff-backend"; then
  pm2 restart genaff-backend --update-env
else
  pm2 start src/server.js --name genaff-backend
fi

pm2 save

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              Deployment Complete ✔                       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "  API Base URL  : https://$API_DOMAIN"
echo "  Health Check  : https://$API_DOMAIN/health"
echo "  Nginx Config  : $NGINX_CONF"
echo "  SSL Cert      : /etc/letsencrypt/live/$API_DOMAIN/"
echo ""
echo "  Useful commands:"
echo "    pm2 logs genaff-backend       # View logs"
echo "    pm2 status                    # Process status"
echo "    pm2 restart genaff-backend    # Restart"
echo "    pm2 stop genaff-backend       # Stop"
echo "    sudo nginx -t                 # Test Nginx config"
echo "    sudo certbot renew --dry-run  # Test SSL renewal"
echo ""
echo "  Future updates:"
echo "    git pull origin main && npm install && pm2 restart genaff-backend"
echo ""
