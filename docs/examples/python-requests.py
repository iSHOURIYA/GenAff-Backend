"""
GenAff SDK Examples — Python (requests)
Install: pip install requests
"""

import requests
import json
import math

BASE_URL = "https://genaff-api.shauryacodes.xyz"


# ─────────────────────────────────────────────────────────────────────────────
# 1. Authenticate — get JWT
# ─────────────────────────────────────────────────────────────────────────────
def login(email: str, password: str) -> str:
    res = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    res.raise_for_status()
    return res.json()["access_token"]


def register(email: str, password: str) -> dict:
    res = requests.post(f"{BASE_URL}/auth/register", json={"email": email, "password": password})
    res.raise_for_status()
    return res.json()  # { id, email, role, free_units_remaining }


# ─────────────────────────────────────────────────────────────────────────────
# 2. Generate an API key
# ─────────────────────────────────────────────────────────────────────────────
def generate_api_key(jwt: str, name: str = "python-key") -> str:
    res = requests.post(
        f"{BASE_URL}/keys",
        json={"name": name},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    res.raise_for_status()
    data = res.json()
    print(f"Key created: ...{data['plain_key_preview']} (ID: {data['id']})")
    print(f"SAVE THIS — shown only once: {data['key']}")
    return data["key"]  # "sk_..."


def list_api_keys(jwt: str) -> list:
    res = requests.get(
        f"{BASE_URL}/keys",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    res.raise_for_status()
    return res.json()


# ─────────────────────────────────────────────────────────────────────────────
# 3. Make a proxied chat request
# ─────────────────────────────────────────────────────────────────────────────
def chat_completion(
    api_key: str,
    messages: list,
    model: str = None,
    temperature: float = 0.7,
    max_tokens: int = 500,
    preferred_provider: str = None,  # "openai" | "deepseek" | "gemini"
) -> str:
    payload = {
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if model:
        payload["model"] = model
    if preferred_provider:
        payload["preferred_provider"] = preferred_provider

    res = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
    )

    # Print rate limit headers
    print(f"Rate limit — minute: {res.headers.get('x-ratelimit-minute-remaining')}, "
          f"day: {res.headers.get('x-ratelimit-day-remaining')}")

    if res.status_code == 402:
        data = res.json()
        raise InsufficientFundsError(
            required_paisa=data["required_inr_paisa"],
            current_paisa=data["current_balance_inr_paisa"],
        )

    if res.status_code == 429:
        data = res.json()
        raise RateLimitError(retry_after=data.get("retry_after", 60))

    res.raise_for_status()
    return res.json()["choices"][0]["message"]["content"]


class InsufficientFundsError(Exception):
    def __init__(self, required_paisa: int, current_paisa: int):
        self.required_paisa = required_paisa
        self.current_paisa = current_paisa
        super().__init__(
            f"Insufficient balance: {current_paisa}p available, {required_paisa}p needed"
        )


class RateLimitError(Exception):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after
        super().__init__(f"Rate limit exceeded. Retry after {retry_after}s")


# ─────────────────────────────────────────────────────────────────────────────
# 4. Handle 402 Payment Required — auto top-up flow
# ─────────────────────────────────────────────────────────────────────────────
def chat_with_auto_topup(jwt: str, api_key: str, messages: list) -> str:
    try:
        return chat_completion(api_key, messages)
    except InsufficientFundsError as e:
        print(f"Wallet low: {e.current_paisa}p available, {e.required_paisa}p needed")

        # Top up 10× the required amount, minimum ₹50 (5000 paisa)
        top_up_amount = max(e.required_paisa * 10, 5000)
        top_up = initiate_topup(jwt, top_up_amount, method="manual")
        print(f"Top-up initiated: ₹{top_up_amount / 100:.2f} (tx: {top_up['transaction_id']})")

        # DEV: approve immediately via admin mock
        mock_approve_topup(jwt, top_up["transaction_id"])
        print("Top-up approved. Retrying...")

        return chat_completion(api_key, messages)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Wallet top-up
# ─────────────────────────────────────────────────────────────────────────────
def initiate_topup(jwt: str, amount_paisa: int, method: str = "razorpay") -> dict:
    res = requests.post(
        f"{BASE_URL}/wallet/topup/initiate",
        json={"amount_inr_paisa": amount_paisa, "method": method},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    res.raise_for_status()
    return res.json()
    # { transaction_id, razorpay_order_id, amount_inr_paisa, currency, status }


# ─────────────────────────────────────────────────────────────────────────────
# 6. [DEV ONLY] Mock-approve top-up
# ─────────────────────────────────────────────────────────────────────────────
def mock_approve_topup(admin_jwt: str, transaction_id: str) -> dict:
    res = requests.post(
        f"{BASE_URL}/admin/topup-mock",
        json={"transaction_id": transaction_id},
        headers={"Authorization": f"Bearer {admin_jwt}"},
    )
    res.raise_for_status()
    return res.json()


# ─────────────────────────────────────────────────────────────────────────────
# 7. Usage history
# ─────────────────────────────────────────────────────────────────────────────
def get_usage(jwt: str, from_date: str = None, to_date: str = None) -> list:
    params = {}
    if from_date:
        params["from"] = from_date  # "2026-01-01"
    if to_date:
        params["to"] = to_date

    res = requests.get(
        f"{BASE_URL}/billing/usage",
        params=params,
        headers={"Authorization": f"Bearer {jwt}"},
    )
    res.raise_for_status()
    return res.json()


# ─────────────────────────────────────────────────────────────────────────────
# 8. Simulate billing math locally
# ─────────────────────────────────────────────────────────────────────────────
def estimate_cost_paisa(
    pricing_per_token_usd: float,
    base_request_cost_usd: float,
    tokens: int,
    exchange_rate: float = 83.50,
) -> int:
    """Mirrors ProviderService.estimateCost() in the backend."""
    cost_usd = base_request_cost_usd + pricing_per_token_usd * tokens
    cost_inr = cost_usd * exchange_rate
    return math.ceil(cost_inr * 100)  # paisa, ceiling rounded


# ─────────────────────────────────────────────────────────────────────────────
# Demo
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Billing math example
    cost = estimate_cost_paisa(
        pricing_per_token_usd=0.00001,
        base_request_cost_usd=0.0005,
        tokens=200,
        exchange_rate=83.50,
    )
    print(f"Estimated cost for 200 tokens (OpenAI): {cost} paisa = ₹{cost / 100:.4f}")
    # → 21 paisa = ₹0.2100

    # Full flow
    jwt = login("user@example.com", "securepass123")
    api_key = generate_api_key(jwt, "python-demo")

    reply = chat_with_auto_topup(jwt, api_key, [
        {"role": "user", "content": "What is the boiling point of water?"}
    ])
    print("AI reply:", reply)

    # Usage
    records = get_usage(jwt, from_date="2026-01-01")
    total_cost = sum(r["cost_inr_cents"] for r in records)
    print(f"Total spend (all time): {total_cost} paisa = ₹{total_cost / 100:.2f}")
