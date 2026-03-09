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

module.exports = { proxyRateLimiter, authRateLimiter };
