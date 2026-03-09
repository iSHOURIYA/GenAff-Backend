const { listKeys, createKey, deleteKey } = require('../services/keyService');

/**
 * GET /keys
 * List all active API keys for the authenticated user.
 */
async function getKeys(req, res) {
  try {
    const keys = await listKeys(req.user.id);
    return res.status(200).json({ keys });
  } catch (err) {
    console.error('[keyController.getKeys]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /keys
 * Generate a new API key for the authenticated user.
 * The raw key is returned ONCE – it cannot be retrieved again.
 */
async function createApiKey(req, res) {
  try {
    const { rawKey, record } = await createKey(req.user.id);

    return res.status(201).json({
      message: 'API key created. Save this key – it will not be shown again.',
      key: rawKey,   // shown once
      record,
    });
  } catch (err) {
    console.error('[keyController.createApiKey]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /keys/:id
 * Deactivate (soft-delete) an API key belonging to the authenticated user.
 */
async function revokeKey(req, res) {
  try {
    await deleteKey(req.params.id, req.user.id);
    return res.status(200).json({ message: 'API key revoked successfully' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[keyController.revokeKey]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getKeys, createApiKey, revokeKey };
