// GenAff – Webhook Handler Example
//
// Use this as a reference for:
// 1. How the GenAff backend verifies Razorpay webhook signatures
// 2. How to build your own webhook consumer (e.g. frontend notification service)
// 3. How Razorpay webhooks are structured
//
// Install: npm install express crypto

import express from 'express';
import crypto from 'crypto';

const app = express();
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'change-me-in-env';

// ─────────────────────────────────────────────────────────────────────────────
// Raw body capture middleware (required for HMAC verification)
// ─────────────────────────────────────────────────────────────────────────────
app.use('/webhooks/payments', express.raw({ type: 'application/json' }));

// ─────────────────────────────────────────────────────────────────────────────
// Signature Verification Helper
//
// Razorpay sends HMAC-SHA256(rawBody, webhookSecret) in hex as:
//   x-razorpay-signature: <hex>
//
// GenAff backend uses crypto.timingSafeEqual to prevent timing attacks.
// ─────────────────────────────────────────────────────────────────────────────
function verifyRazorpaySignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)             // rawBody must be Buffer or string, NOT parsed JSON
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false; // Buffer length mismatch → invalid
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.post('/webhooks/payments', (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body; // Buffer (because of express.raw())

  // 1. Verify signature
  if (!signature || !verifyRazorpaySignature(rawBody, signature, WEBHOOK_SECRET)) {
    console.warn('[Webhook] Invalid signature — rejecting');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // 2. Parse payload
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { event } = payload;
  console.log(`[Webhook] Received event: ${event}`);

  // 3. Handle events
  switch (event) {
    case 'payment.captured': {
      const payment = payload.payload?.payment?.entity;
      const transactionId = payment?.receipt;   // = TopUpTransaction.id
      const razorpayPaymentId = payment?.id;     // = "pay_Abc123"
      const amountPaisa = payment?.amount;       // in paisa (Razorpay uses smallest currency unit)

      console.log(`[payment.captured] tx=${transactionId} pay=${razorpayPaymentId} amount=${amountPaisa}p`);

      // GenAff backend automatically:
      // 1. Finds TopUpTransaction by receipt (= transactionId)
      // 2. Calls walletService.completeTopUp(transactionId, razorpayPaymentId)
      //    which atomically:
      //    a. Updates transaction status to "completed"
      //    b. Increments wallet.balance_inr_cents by amount_inr_cents
      // 3. Returns { received: true }

      // If you need to notify your frontend (e.g. WebSocket/SSE), do it here:
      // notifyUser(transaction.userId, { type: 'TOPUP_CONFIRMED', amountPaisa });

      break;
    }

    case 'order.paid': {
      const order = payload.payload?.order?.entity;
      const transactionId = order?.receipt;
      console.log(`[order.paid] tx=${transactionId}`);
      // Same handling as payment.captured
      break;
    }

    case 'payment.failed': {
      const payment = payload.payload?.payment?.entity;
      console.warn(`[payment.failed] reason=${payment?.error_description}`);
      // Optionally mark transaction as "failed" and notify user
      break;
    }

    default:
      console.log(`[Webhook] Unhandled event: ${event} — acknowledged`);
  }

  // Always return 200 to acknowledge receipt
  // Razorpay will retry on 4xx/5xx (up to 3× over 2h for 5xx)
  return res.status(200).json({ received: true, event });
});

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay example payloads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * payment.captured event payload
 */
const PAYMENT_CAPTURED_EXAMPLE = {
  entity: 'event',
  account_id: 'acc_BFQ7uQEaa6iOgQ',
  event: 'payment.captured',
  contains: ['payment'],
  payload: {
    payment: {
      entity: {
        id: 'pay_AbcXyz123',
        entity: 'payment',
        amount: 10000,           // 10000 paisa = ₹100
        currency: 'INR',
        status: 'captured',
        order_id: 'order_AbcXyz123',
        receipt: 'tx-uuid-1234', // ← This is TopUpTransaction.id
        method: 'upi',
        captured: true,
        description: 'GenAff Wallet Top-Up',
        created_at: 1772986004,
      },
    },
  },
};

/**
 * order.paid event payload
 */
const ORDER_PAID_EXAMPLE = {
  event: 'order.paid',
  payload: {
    payment: {
      entity: {
        id: 'pay_AbcXyz123',
        receipt: 'tx-uuid-1234',
        amount: 10000,
      },
    },
    order: {
      entity: {
        id: 'order_AbcXyz123',
        receipt: 'tx-uuid-1234', // ← Also available here
        amount: 10000,
        status: 'paid',
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay frontend integration (Razorpay.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * After POST /wallet/topup/initiate returns a razorpay_order_id,
 * open the Razorpay checkout on the frontend:
 *
 * <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
 *
 * const options = {
 *   key: process.env.RAZORPAY_KEY_ID,         // your Razorpay key_id
 *   amount: topUpResponse.amount_inr_paisa,    // in paisa
 *   currency: 'INR',
 *   name: 'GenAff',
 *   description: 'Wallet Top-Up',
 *   order_id: topUpResponse.razorpay_order_id,
 *   handler: function (response) {
 *     // payment_id, order_id, signature are returned here
 *     // The backend webhook will auto-credit the wallet
 *     // You can also verify on your backend via POST /webhooks/payments
 *     console.log('Payment successful:', response.razorpay_payment_id);
 *   },
 *   prefill: { email: user.email },
 *   theme: { color: '#6366f1' },
 * };
 * const rzp = new Razorpay(options);
 * rzp.open();
 */

app.listen(4000, () => console.log('Webhook listener on http://localhost:4000'));
