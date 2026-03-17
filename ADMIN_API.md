# GenAff Admin Portal API Documentation

## Overview

The Admin Portal provides comprehensive management capabilities for monitoring revenue, user activity, and system analytics. All endpoints require both **authentication** (JWT token) and **ADMIN role**.

## Authentication

All admin endpoints require a valid JWT token in the `Authorization` header:

```
Authorization: Bearer <JWT_TOKEN>
```

### Getting Admin Token

1. **Register/Login as Admin:**
   ```bash
   curl -X POST http://localhost:3000/auth/login \
     -H "Content-Type: application/json" \
     -d '{
       "email": "shouriyatayal1234@gmail",
       "password": "ChangeMe!123"
     }'
   ```

2. **Extract JWT token from response:**
   ```json
   {
     "success": true,
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "user": { "id": "...", "email": "shouriyatayal1234@gmail" }
   }
   ```

3. **Use token for all admin requests:**
   ```bash
   curl http://localhost:3000/admin/dashboard \
     -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   ```

---

## Endpoints

### 1. Dashboard Statistics
**GET** `/admin/dashboard`

Comprehensive overview with revenue, users, top performers, and failed transactions.

**Response:**
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
        "model": "gpt-4-turbo",
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

### 2. List All Users
**GET** `/admin/users`

List all users with pagination.

**Query Parameters:**
- `page` (optional): Page number, default = 1
- `limit` (optional): Items per page, default = 50

**Example:**
```bash
curl "http://localhost:3000/admin/users?page=1&limit=50" \
  -H "Authorization: Bearer <TOKEN>"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "role": "USER",
        "created_at": "2026-03-17T20:00:00Z",
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

### 3. Get User Details
**GET** `/admin/users/:userId`

Detailed user information including wallet, usage history, API keys, and top-ups.

**Example:**
```bash
curl "http://localhost:3000/admin/users/f94d8c9e-8f6b-48db-a430-60d4df14e452" \
  -H "Authorization: Bearer <TOKEN>"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "USER",
      "email_verified": true,
      "created_at": "2026-03-17T20:00:00Z",
      "free_units": 10
    },
    "wallet": {
      "balance_inr": "1250.75",
      "last_updated": "2026-03-17T22:00:00Z"
    },
    "statistics": {
      "total_spent_inr": "450.25",
      "total_topup_inr": "1500.00",
      "total_api_calls": 234,
      "active_api_keys": 2
    },
    "recent_usages": [
      {
        "id": "uuid",
        "provider": "openai",
        "model": "gpt-4-turbo",
        "tokens_used": 5000,
        "cost_inr": "125.50",
        "created_at": "2026-03-17T21:30:00Z"
      }
    ],
    "recent_topups": [...],
    "api_keys": [...]
  }
}
```

---

### 4. Suspend/Activate User
**PUT** `/admin/users/:userId/status`

Suspend or activate a user (deactivates/reactivates all API keys).

**Request Body:**
```json
{
  "suspend": true
}
```

**Example:**
```bash
curl -X PUT "http://localhost:3000/admin/users/uuid/status" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"suspend": true}'
```

**Response:**
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

---

### 5. Model Usage Analytics
**GET** `/admin/models/analytics`

Detailed usage breakdown by model and provider.

**Query Parameters:**
- `from` (optional): Start date, format YYYY-MM-DD, default = 30 days ago
- `to` (optional): End date, format YYYY-MM-DD, default = today

**Example:**
```bash
curl "http://localhost:3000/admin/models/analytics?from=2026-02-15&to=2026-03-17" \
  -H "Authorization: Bearer <TOKEN>"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-02-15T00:00:00Z",
      "to": "2026-03-17T00:00:00Z"
    },
    "model_analytics": [
      {
        "model": "gpt-4-turbo",
        "provider": "openai",
        "usage_count": 450,
        "total_tokens": 1250000,
        "total_cost_inr": "2500.00"
      },
      {
        "model": "qwen-coder-32b",
        "provider": "nvidia",
        "usage_count": 320,
        "total_tokens": 980000,
        "total_cost_inr": "1960.00"
      }
    ]
  }
}
```

---

### 6. Revenue Breakdown
**GET** `/admin/revenue/breakdown`

Detailed revenue analysis by model and transaction type.

**Query Parameters:**
- `from` (optional): Start date, format YYYY-MM-DD
- `to` (optional): End date, format YYYY-MM-DD

**Example:**
```bash
curl "http://localhost:3000/admin/revenue/breakdown?from=2026-02-15&to=2026-03-17" \
  -H "Authorization: Bearer <TOKEN>"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-02-15T00:00:00Z",
      "to": "2026-03-17T00:00:00Z"
    },
    "revenue_by_model": [
      {
        "model": "gpt-4-turbo",
        "usage_count": 450,
        "revenue_inr": "2500.00"
      },
      {
        "model": "qwen-coder-32b",
        "usage_count": 320,
        "revenue_inr": "1960.00"
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

### 7. Transaction History
**GET** `/admin/transactions`

Comprehensive transaction history (top-ups and usage).

**Query Parameters:**
- `page` (optional): Page number, default = 1
- `limit` (optional): Items per page, default = 100
- `type` (optional): Filter by type ('topup', 'usage', or mix)

**Example:**
```bash
curl "http://localhost:3000/admin/transactions?page=1&limit=50&type=topup" \
  -H "Authorization: Bearer <TOKEN>"
```

**Response:**
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
        "created_at": "2026-03-17T20:00:00Z"
      },
      {
        "id": "uuid",
        "type": "USAGE",
        "user_id": "uuid",
        "model": "gpt-4-turbo",
        "amount_inr": "25.50",
        "tokens_used": 5000,
        "created_at": "2026-03-17T21:30:00Z"
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

## Error Responses

### 401 Unauthorized (Missing/Invalid Token)
```json
{
  "error": "Missing or malformed Authorization header"
}
```

### 403 Forbidden (Not Admin)
```json
{
  "error": "Forbidden. Admin access required.",
  "userEmail": "user@example.com"
}
```

### 404 Not Found
```json
{
  "error": "User not found"
}
```

### 500 Server Error
```json
{
  "error": "Failed to fetch dashboard stats",
  "details": "Error details here"
}
```

---

## Testing with cURL

### Get Admin Token
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"shouriyatayal1234@gmail","password":"ChangeMe!123"}' | jq -r '.token')
echo $TOKEN
```

### Test Dashboard
```bash
TOKEN="your_token_here"
curl http://localhost:3000/admin/dashboard \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### Test List Users
```bash
curl "http://localhost:3000/admin/users?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- All monetary amounts are in INR (Indian Rupees)
- Date ranges default to last 30 days if not specified
- User suspension deactivates all their API keys but doesn't delete the account
- Admin user can view all user data and analytics
- The admin must change the temporary password on first login in production

---

## Admin User Credentials

**Email:** `shouriyatayal1234@gmail`  
**Temporary Password:** `ChangeMe!123`  
**ID:** `f94d8c9e-8f6b-48db-a430-60d4df14e452`

⚠️ **Change password immediately on first login in production!**
