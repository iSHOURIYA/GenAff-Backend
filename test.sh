#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GenAff API – Complete Test Suite
# Usage: bash test.sh [https://your-api-domain.com]
#   If argument omitted, reads API_URL from .env
# ─────────────────────────────────────────────────────────────────

# Read API_URL from .env if exists
if [ -f .env ]; then
  ENV_API_URL=$(grep '^API_URL=' .env | cut -d= -f2 | tr -d ' "')
fi

BASE="${1:-${ENV_API_URL:-https://genaff-api.shouriya.tech}}"
PASS=0
FAIL=0

# Unique email per run so re-running never hits "already in use"
TS=$(date +%s)
TEST_EMAIL="testuser_${TS}@genaff.dev"
TEST_PASS="Secret@123"

# ── Helpers ───────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

section() { echo -e "\n${CYAN}━━━  $1  ━━━${NC}"; }

run() {
  local label="$1"; shift
  echo -e "\n${YELLOW}▶ $label${NC}"
  RESPONSE=$(eval "$@" 2>/dev/null)
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
}

check() {
  local label="$1"
  local response="$2"
  local expected="$3"
  if echo "$response" | grep -q "$expected"; then
    echo -e "${GREEN}✔ PASS${NC} – $label"
    PASS=$((PASS+1))
  else
    echo -e "${RED}✘ FAIL${NC} – $label (expected to find: \"$expected\")"
    FAIL=$((FAIL+1))
  fi
}

# ── 0. Health ─────────────────────────────────────────────────────
section "0. Health Check"

run "GET /health" \
  'curl -s "$BASE/health"'
check "health returns ok" "$RESPONSE" '"status":"ok"'

# ── 1. Models (public) ────────────────────────────────────────────
section "1. Public Model List"

run "GET /v1/models" \
  'curl -s "$BASE/v1/models"'
check "models list returned" "$RESPONSE" '"object":"list"'

# ── 2. Auth – Register ────────────────────────────────────────────
section "2. Auth"

run "POST /auth/register" \
  'curl -s -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}"'
check "register returns token" "$RESPONSE" '"token"'

# Grab token from register
JWT=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

run "POST /auth/register – duplicate email (should 409)" \
  'curl -s -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}"'
check "duplicate email returns error" "$RESPONSE" '"error"'

run "POST /auth/login" \
  'curl -s -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}"'
check "login returns token" "$RESPONSE" '"token"'

# Refresh token from login
JWT=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo -e "  JWT: ${JWT:0:40}..."

run "POST /auth/login – wrong password (should 401)" \
  'curl -s -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"wrongpass\"}"'
check "wrong password returns 401" "$RESPONSE" '"error"'

run "GET /auth/me" \
  'curl -s "$BASE/auth/me" -H "Authorization: Bearer $JWT"'
check "me returns email" "$RESPONSE" '"email"'

run "GET /auth/me – no token (should 401)" \
  'curl -s "$BASE/auth/me"'
check "missing token returns error" "$RESPONSE" '"error"'

# ── 3. API Keys ───────────────────────────────────────────────────
section "3. API Keys"

run "GET /keys – empty list" \
  'curl -s "$BASE/keys" -H "Authorization: Bearer $JWT"'
check "keys list returned" "$RESPONSE" '"keys"'

run "POST /keys – create key" \
  'curl -s -X POST "$BASE/keys" -H "Authorization: Bearer $JWT"'
check "key created" "$RESPONSE" 'sk_genaff_'

# Grab raw API key
API_KEY=$(echo "$RESPONSE" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)
echo -e "  API Key: ${API_KEY:0:30}..."

run "POST /keys – create second key" \
  'curl -s -X POST "$BASE/keys" -H "Authorization: Bearer $JWT"'

run "GET /keys – list after creation" \
  'curl -s "$BASE/keys" -H "Authorization: Bearer $JWT"'
check "two keys listed" "$RESPONSE" '"keys"'

# Grab first key id for deletion
KEY_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

run "DELETE /keys/:id" \
  'curl -s -X DELETE "$BASE/keys/$KEY_ID" -H "Authorization: Bearer $JWT"'
check "key revoked" "$RESPONSE" 'revoked successfully'

run "DELETE /keys/:id – wrong id (should 404)" \
  'curl -s -X DELETE "$BASE/keys/nonexistent-id-000" -H "Authorization: Bearer $JWT"'
check "wrong key id returns error" "$RESPONSE" '"error"'

# ── 4. Wallet ─────────────────────────────────────────────────────
section "4. Wallet"

run "GET /wallet – initial balance (should be 0)" \
  'curl -s "$BASE/wallet" -H "Authorization: Bearer $JWT"'
check "wallet returned" "$RESPONSE" '"balance_inr"'

run "POST /wallet/topup/order – below minimum (should 400)" \
  'curl -s -X POST "$BASE/wallet/topup/order" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"amount\":5}"'
check "below minimum rejected" "$RESPONSE" '"error"'

run "POST /wallet/topup/order – valid amount ₹100" \
  'curl -s -X POST "$BASE/wallet/topup/order" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"amount\":100}"'

# If blocked by a pre-existing pending order, cancel it first then retry
if echo "$RESPONSE" | grep -q 'pending top-up'; then
  echo -e "  ${YELLOW}→ Found existing pending order. Cancelling it...${NC}"
  PENDING_ID=$(curl -s "$BASE/wallet/history" -H "Authorization: Bearer $JWT" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  curl -s -X POST "$BASE/wallet/topup/cancel" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"topup_id\":\"$PENDING_ID\"}" > /dev/null
  RESPONSE=$(curl -s -X POST "$BASE/wallet/topup/order" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d '{"amount":100}')
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
fi
check "razorpay order created" "$RESPONSE" '"order_id"'

RAZORPAY_ORDER_ID=$(echo "$RESPONSE" | grep -o '"order_id":"[^"]*"' | cut -d'"' -f4)
echo -e "  Razorpay Order ID: $RAZORPAY_ORDER_ID"
echo -e "  ${YELLOW}⚠  Complete Razorpay checkout in your frontend to get payment_id + signature.${NC}"
echo -e "  ${YELLOW}   Then call POST /wallet/topup/verify with those values.${NC}"

run "POST /wallet/topup/verify – fake signature (should 400)" \
  'curl -s -X POST "$BASE/wallet/topup/verify" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"razorpay_order_id\":\"order_fake\",\"razorpay_payment_id\":\"pay_fake\",\"razorpay_signature\":\"invalidsignature\"}"'
check "invalid signature rejected" "$RESPONSE" '"error"'

run "GET /wallet/history" \
  'curl -s "$BASE/wallet/history" -H "Authorization: Bearer $JWT"'
check "history returned" "$RESPONSE" '"history"'

run "GET /wallet/stats" \
  'curl -s "$BASE/wallet/stats" -H "Authorization: Bearer $JWT"'
check "stats returned" "$RESPONSE" '"stats"'

# ── 5. AI Proxy ───────────────────────────────────────────────────
section "5. AI Proxy – /v1/chat/completions"

echo -e "\n  ${YELLOW}Using API key: ${API_KEY:0:30}...${NC}"

run "POST /v1/chat/completions – no auth (should 401)" \
  'curl -s -X POST "$BASE/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"gemini-2.0-flash\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"'
check "missing key rejected" "$RESPONSE" '"error"'

run "POST /v1/chat/completions – invalid key (should 401)" \
  'curl -s -X POST "$BASE/v1/chat/completions" \
    -H "Authorization: Bearer sk_genaff_00000000000000000000000000000000000000000000000000" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"gemini-2.0-flash\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"'
check "invalid key rejected" "$RESPONSE" '"error"'

run "POST /v1/chat/completions – missing model (should 400)" \
  'curl -s -X POST "$BASE/v1/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"'
check "missing model rejected" "$RESPONSE" '"error"'

run "POST /v1/chat/completions – unsupported model (should 400)" \
  'curl -s -X POST "$BASE/v1/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"claude-3\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"'
check "unsupported model rejected" "$RESPONSE" '"error"'

run "POST /v1/chat/completions – MAAS model (should 400)" \
  'curl -s -X POST "$BASE/v1/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"deepseek-r1-0528-maas\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"'
check "MAAS model rejected with explanation" "$RESPONSE" '"error"'

echo -e "\n${YELLOW}▶ POST /v1/chat/completions – Gemini (LIVE REQUEST – uses balance/free units)${NC}"
GEMINI_RESP=$(curl -s -X POST "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.0-flash","messages":[{"role":"user","content":"Reply with exactly: GENAFF_TEST_OK"}]}')
echo "$GEMINI_RESP" | python3 -m json.tool 2>/dev/null || echo "$GEMINI_RESP"
if echo "$GEMINI_RESP" | grep -q '"content"'; then
  check "gemini live response" "$GEMINI_RESP" '"content"'
elif echo "$GEMINI_RESP" | grep -q 'quota\|billing\|free_tier'; then
  echo -e "${YELLOW}⚠ SKIP${NC} – gemini live response (Gemini free-tier quota exhausted – enable billing at https://console.cloud.google.com/billing)"
else
  check "gemini live response" "$GEMINI_RESP" '"content"'
fi

echo -e "\n${YELLOW}▶ POST /v1/chat/completions – OpenAI (LIVE REQUEST)${NC}"
OPENAI_RESP=$(curl -s -X POST "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Reply with exactly: GENAFF_TEST_OK"}]}')
echo "$OPENAI_RESP" | python3 -m json.tool 2>/dev/null || echo "$OPENAI_RESP"
check "openai live response" "$OPENAI_RESP" '"content"'

echo -e "\n${YELLOW}▶ POST /v1/chat/completions – DeepSeek (LIVE REQUEST)${NC}"
DEEPSEEK_RESP=$(curl -s -X POST "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Reply with exactly: GENAFF_TEST_OK"}]}')
echo "$DEEPSEEK_RESP" | python3 -m json.tool 2>/dev/null || echo "$DEEPSEEK_RESP"
check "deepseek live response" "$DEEPSEEK_RESP" '"content"'

# ── 6. Usage logged after requests ────────────────────────────────
section "6. Usage Logging (after live requests above)"

run "GET /wallet/usage – should have records" \
  'curl -s "$BASE/wallet/usage" -H "Authorization: Bearer $JWT"'
check "usage records logged" "$RESPONSE" '"provider"'

run "GET /wallet/stats – should show spend" \
  'curl -s "$BASE/wallet/stats" -H "Authorization: Bearer $JWT"'
check "stats updated" "$RESPONSE" '"total_requests"'

run "GET /wallet – balance deducted" \
  'curl -s "$BASE/wallet" -H "Authorization: Bearer $JWT"'
check "wallet balance present" "$RESPONSE" '"balance_inr"'

# ── 7. 404 ────────────────────────────────────────────────────────
section "7. 404 Handler"

run "GET /nonexistent" \
  'curl -s "$BASE/nonexistent"'
check "404 returned" "$RESPONSE" '"error"'

# ── Summary ───────────────────────────────────────────────────────
echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
