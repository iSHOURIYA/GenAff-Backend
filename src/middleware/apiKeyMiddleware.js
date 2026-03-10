const prisma = require('../services/prismaClient');
const { hashApiKey } = require('../utils/hash');

/**
 * Middleware: validate user-supplied API key (sk_genaff_...) from Authorization header.
 * Attaches req.apiKey and req.apiKeyUser on success.
 *
 * Used for the /v1/* proxy endpoints — the user authenticates with their
 * GenAff API key, NOT a JWT.
 */
async function apiKeyMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const rawKey = authHeader.split(' ')[1];

    if (!rawKey.startsWith('sk_genaff_')) {
      return res.status(401).json({ error: 'Invalid API key format' });
    }

    const keyHash = hashApiKey(rawKey);

    const apiKey = await prisma.apiKey.findUnique({
      where: { key_hash: keyHash },
      include: {
        user: {
          include: { wallet: true },
        },
      },
    });

    if (!apiKey) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    if (!apiKey.active) {
      return res.status(403).json({ error: 'API key is disabled' });
    }

    if (!apiKey.user.email_verified) {
      return res.status(403).json({
        error: 'Email not verified',
        message: 'Please verify your email address before using the API. Check your inbox or request a new code at POST /auth/resend-verification',
      });
    }

    req.apiKey = apiKey;
    req.apiKeyUser = apiKey.user;
    next();
  } catch (err) {
    console.error('[apiKeyMiddleware] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = apiKeyMiddleware;
