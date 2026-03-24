const rateLimit = require('express-rate-limit');

const RPM = parseInt(process.env.RATE_LIMIT_RPM || '20', 10);

/**
 * Rate limiter for the AI proxy endpoint.
 * Limit: RATE_LIMIT_RPM requests per minute per API key.
 *
 * The key function uses the raw API key extracted from the Bearer token so
 * each user key gets its own counter.
 *
 * Uses in-memory store (default). For multi-process/VPS deployments where you
 * run pm2 cluster mode, swap to redis-rate-limit or route all traffic through
 * a single process.
 */
const proxyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: RPM,
  standardHeaders: true,  // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,

  // Identify requester by their API key, not IP
  keyGenerator: (req) => {
    const auth = req.headers.authorization || '';
    return auth.startsWith('Bearer ') ? auth.split(' ')[1] : req.ip;
  },

  handler: (req, res) => {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `You have exceeded ${RPM} requests per minute. Please slow down.`,
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    });
  },
});

/**
 * General auth route limiter – prevents brute-force on /auth/login
 * 10 attempts per minute per IP.
 */
const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

/**
 * Resend verification limiter – prevents email flooding.
 * 3 resend attempts per 10 minutes per IP.
 */
const resendRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resend attempts. Please wait 10 minutes before trying again.' },
});

/**
 * OTP verification limiter – prevents brute-force of 6-digit codes.
 * 5 attempts per 15 minutes per IP. A 6-digit code has 1,000,000
 * combinations; at 5 attempts/15 min an attacker needs ~2 million
 * minutes (~4 years) on average to guess one code.
 */
const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please wait 15 minutes or request a new code.' },
});

/**
 * Forgot-password limiter – prevents reset-email flooding.
 * 3 attempts per 10 minutes per IP.
 */
const forgotPasswordRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please wait 10 minutes before trying again.' },
});

/**
 * Reset-password limiter – throttles reset attempts.
 * 5 attempts per 15 minutes per IP.
 */
const resetPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Please wait 15 minutes before trying again.' },
});

/**
 * Signup limiter – prevents rapid account farming from a single IP.
 * Default: 2 accounts/hour/IP.
 */
const signupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.SIGNUP_RATE_LIMIT_PER_HOUR || '2', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many accounts created from this IP. Please try again later.' },
});

/**
 * Playground session creation limiter – controls temporary key creation.
 * 10 sessions per hour per authenticated user.
 */
const playgroundSessionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // authMiddleware runs before this limiter in /playground routes.
  // Fallback to IP if req.user is unavailable for safety.
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many playground sessions created. Please try again later.' },
});

module.exports = {
  proxyRateLimiter,
  authRateLimiter,
  resendRateLimiter,
  otpRateLimiter,
  forgotPasswordRateLimiter,
  resetPasswordRateLimiter,
  signupRateLimiter,
  playgroundSessionRateLimiter,
};
