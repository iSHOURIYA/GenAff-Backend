const router = require('express').Router();
const { register, login, me, verifyOtp, verifyEmail, resendVerification } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { authRateLimiter, resendRateLimiter } = require('../middleware/rateLimiter');

// POST /auth/register
router.post('/register', register);

// POST /auth/login  (rate-limited to prevent brute-force)
router.post('/login', authRateLimiter, login);

// GET /auth/me  (requires JWT)
router.get('/me', authMiddleware, me);

// POST /auth/verify-otp  (cross-device: user types the 6-digit code)
router.post('/verify-otp', verifyOtp);

// GET /auth/verify-email?token=<uuid>  (same-device: magic link click)
router.get('/verify-email', verifyEmail);

// POST /auth/resend-verification  (rate-limited to prevent email flooding)
router.post('/resend-verification', resendRateLimiter, resendVerification);

module.exports = router;
