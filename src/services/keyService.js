const prisma = require('./prismaClient');
const { generateApiKey, hashApiKey, getKeyPrefix } = require('../utils/hash');

/**
 * List all active API keys for a user.
 * Returns key_prefix (safe to display) and metadata – never the raw key.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function listKeys(userId) {
  return prisma.apiKey.findMany({
    where: { user_id: userId, active: true },
    select: {
      id: true,
      key_prefix: true,
      created_at: true,
      active: true,
    },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Generate a new API key for a user.
 * Returns the RAW key (shown once) along with the DB record.
 * @param {string} userId
 * @returns {Promise<{rawKey: string, record: object}>}
 */
async function createKey(userId) {
  const rawKey = generateApiKey();
  const key_hash = hashApiKey(rawKey);
  const key_prefix = getKeyPrefix(rawKey);

  const record = await prisma.apiKey.create({
    data: {
      key_hash,
      key_prefix,
      user_id: userId,
      active: true,
    },
    select: {
      id: true,
      key_prefix: true,
      created_at: true,
      active: true,
    },
  });

  return { rawKey, record };
}

/**
 * Deactivate (soft-delete) an API key.
 * Only the owner can delete their own key.
 * @param {string} keyId
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function deleteKey(keyId, userId) {
  const key = await prisma.apiKey.findFirst({
    where: { id: keyId, user_id: userId },
  });

  if (!key) {
    const err = new Error('API key not found');
    err.status = 404;
    throw err;
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { active: false },
  });
}

module.exports = { listKeys, createKey, deleteKey };
