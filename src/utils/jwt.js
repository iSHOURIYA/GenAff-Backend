const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Sign a JWT token for a given user payload
 * @param {object} payload - { id, email }
 * @returns {string} signed JWT
 */
function signToken(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not set in environment');
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode a JWT token
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyToken(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not set in environment');
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, verifyToken };
