const bcrypt = require('bcrypt');
const crypto = require('crypto');

const SALT_ROUNDS = 12;

// ─────────────────────────────────────────
// Password helpers
// ─────────────────────────────────────────

/**
 * Hash a plain-text password
 * @param {string} password
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plain-text password against a stored bcrypt hash
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ─────────────────────────────────────────
// API Key helpers
// ─────────────────────────────────────────

/**
 * Generate a raw API key in the format sk_genaff_<random>
 * @returns {string} raw API key (shown to user ONCE)
 */
function generateApiKey() {
  const random = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  return `sk_genaff_${random}`;
}

/**
 * Hash an API key with SHA-256 for safe storage
 * @param {string} rawKey
 * @returns {string} hex-encoded SHA-256 hash
 */
function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Extract a display prefix from a raw key (first 20 chars)
 * e.g. sk_genaff_abcd1234...  → sk_genaff_abcd1234...
 * @param {string} rawKey
 * @returns {string}
 */
function getKeyPrefix(rawKey) {
  return rawKey.substring(0, 20) + '...';
}

module.exports = {
  hashPassword,
  comparePassword,
  generateApiKey,
  hashApiKey,
  getKeyPrefix,
};
