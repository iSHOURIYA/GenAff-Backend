#!/usr/bin/env bash
# GenAff API — curl examples
# Set BASE_URL and credentials before running

BASE_URL="https://genaff-api.shauryacodes.xyz"
EMAIL="user@example.com"
PASSWORD="securepass123"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Register
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Register ==="
curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$EMAIL"'","password":"'"$PASSWORD"'"}' | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 2. Login — capture JWT
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Login ==="
JWT=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$EMAIL"'","password":"'"$PASSWORD"'"}' \
  | jq -r '.access_token')
echo "JWT: ${JWT:0:40}..."

# ─────────────────────────────────────────────────────────────────────────────
# 3. Get current user profile
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Profile ==="
curl -s "$BASE_URL/me" \
  -H "Authorization: Bearer $JWT" | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 4. Create API key — capture plaintext key
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Create API Key ==="
API_KEY=$(curl -s -X POST "$BASE_URL/keys" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"curl-demo-key"}' \
  | jq -r '.key')
echo "API Key: $API_KEY"

# ─────────────────────────────────────────────────────────────────────────────
# 5. List API keys
# ─────────────────────────────────────────────────────────────────────────────
echo "=== List Keys ==="
curl -s "$BASE_URL/keys" \
  -H "Authorization: Bearer $JWT" | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 6. List available models (no auth needed)
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Available Models ==="
curl -s "$BASE_URL/v1/models" | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 7. Chat completion (uses API Key, not JWT)
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Chat Completion ==="
curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -D - \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user",   "content": "Explain photosynthesis in one sentence."}
    ],
    "temperature": 0.5,
    "max_tokens": 100
  }' \
  | tee /tmp/genaff_response.txt | grep -A100 '^\{' | jq .

# Rate limit headers are in the HTTP response headers above the JSON body

# ─────────────────────────────────────────────────────────────────────────────
# 8. Chat with preferred provider
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Chat (prefer DeepSeek) ==="
curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}],
    "preferred_provider": "deepseek",
    "max_tokens": 50
  }' | jq '.choices[0].message.content'

# ─────────────────────────────────────────────────────────────────────────────
# 9. Initiate top-up (manual, for dev)
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Initiate Top-Up ==="
TX_ID=$(curl -s -X POST "$BASE_URL/wallet/topup/initiate" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"amount_inr_paisa": 10000, "method": "manual"}' \
  | jq -r '.transaction_id')
echo "Transaction ID: $TX_ID"

# ─────────────────────────────────────────────────────────────────────────────
# 10. [DEV] Mock-approve the top-up (admin JWT needed)
# ─────────────────────────────────────────────────────────────────────────────
# First login as admin:
ADMIN_JWT=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@genaff.dev","password":"Admin@123!GenAff"}' \
  | jq -r '.access_token')

echo "=== Mock Approve Top-Up ==="
curl -s -X POST "$BASE_URL/admin/topup-mock" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"'"$TX_ID"'"}' | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 11. Check wallet balance (via /me)
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Wallet Balance ==="
curl -s "$BASE_URL/me" \
  -H "Authorization: Bearer $JWT" | jq '.wallet.balance_inr_cents'

# ─────────────────────────────────────────────────────────────────────────────
# 12. Get usage history
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Usage History ==="
curl -s "$BASE_URL/billing/usage?from=2026-01-01&to=2026-12-31" \
  -H "Authorization: Bearer $JWT" | jq '.[] | {provider, model, tokens_used, cost_inr_cents}'

# ─────────────────────────────────────────────────────────────────────────────
# 13. Admin: list providers
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Admin: Providers ==="
curl -s "$BASE_URL/admin/providers" \
  -H "Authorization: Bearer $ADMIN_JWT" | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 14. Admin: update provider pricing
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Admin: Update OpenAI Pricing ==="
curl -s -X POST "$BASE_URL/admin/providers" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "enabled": true,
    "pricing_per_token_usd": 0.00001,
    "base_request_cost_usd": 0.0005,
    "priority": 1
  }' | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 15. Admin: add credits to a user
# ─────────────────────────────────────────────────────────────────────────────
USER_ID="a1b2c3d4-e5f6-7890-abcd-1234567890ab"  # replace with actual
echo "=== Admin: Add Credits ==="
curl -s -X PATCH "$BASE_URL/admin/users/$USER_ID/credits" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"free_units_delta": 10, "wallet_inr_paisa_delta": 10000}' | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 16. Disable an API key
# ─────────────────────────────────────────────────────────────────────────────
KEY_ID="k1b2c3d4-e5f6-7890-abcd-1234567890ab"  # replace with actual
echo "=== Disable Key ==="
curl -s -X PATCH "$BASE_URL/keys/$KEY_ID/disable" \
  -H "Authorization: Bearer $JWT" | jq .

# ─────────────────────────────────────────────────────────────────────────────
# 17. Delete an API key
# ─────────────────────────────────────────────────────────────────────────────
echo "=== Delete Key ==="
curl -s -X DELETE "$BASE_URL/keys/$KEY_ID" \
  -H "Authorization: Bearer $JWT" | jq .
