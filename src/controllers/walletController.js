const {
  getWallet,
  createTopUpOrder,
  verifyAndCreditWallet,
  cancelTopUpOrder,
  getPendingTopUp,
  getTopUpHistory,
} = require('../services/walletService');
const { getUsageHistory, getUsageStats } = require('../services/usageService');
const {
  generateTopUpInvoicePdf,
  generateWalletStatementPdf,
  generateCombinedBillingPdf,
} = require('../services/billingPdfService');

/**
 * GET /wallet
 * Return the current wallet balance.
 */
async function walletBalance(req, res) {
  try {
    const wallet = await getWallet(req.user.id);
    return res.status(200).json({ wallet });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[walletController.walletBalance]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /wallet/topup/order
 *
 * Step 1 — Create a Razorpay order.
 * Frontend uses the returned order details to open the Razorpay checkout modal.
 *
 * Body: { amount }  (INR, min ₹10)
 *
 * Response:
 * {
 *   order_id    : "order_xxxxxx"   ← pass to Razorpay checkout
 *   amount      : 5000             ← paise
 *   currency    : "INR"
 *   key_id      : "rzp_live_..."
 *   topup_id    : "uuid"           ← internal reference
 * }
 */
async function createOrder(req, res) {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: 'amount is required' });
    }

    const { topUpId, razorpayOrder, keyId } = await createTopUpOrder(req.user.id, amount);

    return res.status(201).json({
      order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,      // in paise
      currency: razorpayOrder.currency,
      key_id: keyId,
      topup_id: topUpId,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[walletController.createOrder]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /wallet/topup/verify
 *
 * Step 2 — Verify Razorpay payment signature and credit the wallet.
 * Call this AFTER the user completes payment on the frontend.
 *
 * Body:
 * {
 *   razorpay_order_id   : "order_xxxxxx"
 *   razorpay_payment_id : "pay_xxxxxx"
 *   razorpay_signature  : "<hmac-sha256-hex>"
 * }
 */
async function verifyPayment(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        error: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required',
      });
    }

    const result = await verifyAndCreditWallet(
      req.user.id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    return res.status(200).json({
      message: `₹${parseFloat(result.topUp.amount)} added to your wallet successfully`,
      topUp: result.topUp,
      new_balance_inr: parseFloat(result.newBalance),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[walletController.verifyPayment]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /wallet/topup/cancel
 * Cancel a pending Razorpay order (before payment is made).
 * Body: { topup_id }
 */
async function cancelOrder(req, res) {
  try {
    const { topup_id } = req.body;
    if (!topup_id) return res.status(400).json({ error: 'topup_id is required' });

    const topUp = await cancelTopUpOrder(req.user.id, topup_id);
    return res.status(200).json({ message: 'Top-up order cancelled', topUp });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[walletController.cancelOrder]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /wallet/topup/pending
 * Get the user's pending top-up order if any.
 * Frontend can use this to check before attempting to create a new order.
 */
async function getPendingOrder(req, res) {
  try {
    const pending = await getPendingTopUp(req.user.id);
    return res.status(200).json({ pending });
  } catch (err) {
    console.error('[walletController.getPendingOrder]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /wallet/history
 * Return top-up transaction history.
 */
async function topUpHistory(req, res) {
  try {
    const history = await getTopUpHistory(req.user.id);
    return res.status(200).json({ history });
  } catch (err) {
    console.error('[walletController.topUpHistory]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /wallet/usage
 * Return paginated usage records for the authenticated user.
 * Query params: ?page=1&limit=20
 */
async function usageHistory(req, res) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const data = await getUsageHistory(req.user.id, page, limit);
    return res.status(200).json(data);
  } catch (err) {
    console.error('[walletController.usageHistory]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /wallet/stats
 * Return aggregate usage stats.
 */
async function usageStats(req, res) {
  try {
    const stats = await getUsageStats(req.user.id);
    return res.status(200).json({ stats });
  } catch (err) {
    console.error('[walletController.usageStats]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /wallet/invoice/:topupId/pdf
 * Download a branded PDF invoice for a completed top-up.
 */
async function downloadTopUpInvoicePdf(req, res) {
  try {
    const { topupId } = req.params;
    const pdfBuffer = await generateTopUpInvoicePdf({ userId: req.user.id, topUpId: topupId });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="genaff-invoice-${topupId.slice(0, 8)}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[walletController.downloadTopUpInvoicePdf]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /wallet/statement/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Download branded wallet statement PDF for the selected period.
 */
async function downloadWalletStatementPdf(req, res) {
  try {
    const { from, to } = req.query;
    const pdfBuffer = await generateWalletStatementPdf({ userId: req.user.id, from, to });

    const fromSafe = from || 'last-30-days';
    const toSafe = to || 'today';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="genaff-wallet-statement-${fromSafe}-to-${toSafe}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[walletController.downloadWalletStatementPdf]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /wallet/billing/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD&topupId=<optional>
 * Download combined bill PDF with statement + top-up receipt section.
 */
async function downloadCombinedBillingPdf(req, res) {
  try {
    const { from, to, topupId } = req.query;
    const pdfBuffer = await generateCombinedBillingPdf({
      userId: req.user.id,
      from,
      to,
      topUpId: topupId,
    });

    const fromSafe = from || 'last-30-days';
    const toSafe = to || 'today';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="genaff-billing-${fromSafe}-to-${toSafe}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[walletController.downloadCombinedBillingPdf]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  walletBalance,
  createOrder,
  verifyPayment,
  cancelOrder,
  getPendingOrder,
  topUpHistory,
  usageHistory,
  usageStats,
  downloadTopUpInvoicePdf,
  downloadWalletStatementPdf,
  downloadCombinedBillingPdf,
};
