const router = require('express').Router();
const {
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
} = require('../controllers/walletController');
const authMiddleware = require('../middleware/authMiddleware');

// All wallet routes require JWT authentication
router.use(authMiddleware);

// GET  /wallet                  – current balance
router.get('/', walletBalance);

// POST /wallet/topup/order      – create Razorpay order (Step 1)
router.post('/topup/order', createOrder);

// POST /wallet/topup/verify     – verify signature & credit wallet (Step 2)
router.post('/topup/verify', verifyPayment);

// GET  /wallet/topup/pending    – check for pending top-up
router.get('/topup/pending', getPendingOrder);

// POST /wallet/topup/cancel     – cancel a pending order
router.post('/topup/cancel', cancelOrder);

// GET  /wallet/history          – top-up transaction history
router.get('/history', topUpHistory);

// GET  /wallet/usage            – AI usage records (paginated)
router.get('/usage', usageHistory);

// GET  /wallet/stats            – aggregate usage stats
router.get('/stats', usageStats);

// GET  /wallet/invoice/:topupId/pdf     – download top-up invoice PDF
router.get('/invoice/:topupId/pdf', downloadTopUpInvoicePdf);

// GET  /wallet/statement/pdf            – download wallet statement PDF
router.get('/statement/pdf', downloadWalletStatementPdf);

// GET  /wallet/billing/pdf              – download combined statement + receipt PDF
router.get('/billing/pdf', downloadCombinedBillingPdf);

module.exports = router;
