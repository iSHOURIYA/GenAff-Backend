const Razorpay = require('razorpay');
const crypto = require('crypto');

// ── Client singleton ──────────────────────────────────────────────────────────
let _instance = null;

function getRazorpayInstance() {
  if (!_instance) {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment');
    }

    _instance = new Razorpay({ key_id, key_secret });
  }
  return _instance;
}

// ── Order Creation ────────────────────────────────────────────────────────────

/**
 * Create a Razorpay order.
 *
 * Razorpay expects amount in PAISE (1 INR = 100 paise).
 *
 * @param {number} amountInr   Amount in INR (e.g. 50)
 * @param {string} receiptId   Unique receipt reference (your TopUp DB id)
 * @returns {Promise<object>}  Razorpay order object
 */
async function createRazorpayOrder(amountInr, receiptId) {
  const razorpay = getRazorpayInstance();

  const order = await razorpay.orders.create({
    amount: Math.round(amountInr * 100), // convert INR → paise
    currency: 'INR',
    receipt: receiptId,
    payment_capture: true, // auto-capture on payment success
  });

  return order;
}

// ── Signature Verification ────────────────────────────────────────────────────

/**
 * Verify a Razorpay payment signature.
 *
 * Razorpay signs with:
 *   HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)
 *
 * @param {string} razorpay_order_id
 * @param {string} razorpay_payment_id
 * @param {string} razorpay_signature   signature sent by Razorpay to frontend
 * @returns {boolean}  true if valid
 */
function verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature) {
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_secret) throw new Error('RAZORPAY_KEY_SECRET is not set');

  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', key_secret)
    .update(body)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  const expected = Buffer.from(expectedSignature, 'hex');
  const received = Buffer.from(razorpay_signature, 'hex');

  if (expected.length !== received.length) return false;

  return crypto.timingSafeEqual(expected, received);
}

module.exports = { createRazorpayOrder, verifyPaymentSignature };
