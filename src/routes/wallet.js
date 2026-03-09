const router = require('express').Router();
const {
  walletBalance,
  createOrder,
  verifyPayment,
  topUpHistory,
  usageHistory,
  usageStats,
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

// GET  /wallet/history          – top-up transaction history
router.get('/history', topUpHistory);

// GET  /wallet/usage            – AI usage records (paginated)
router.get('/usage', usageHistory);

// GET  /wallet/stats            – aggregate usage stats
router.get('/stats', usageStats);

module.exports = router;
