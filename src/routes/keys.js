const router = require('express').Router();
const { getKeys, createApiKey, revokeKey } = require('../controllers/keyController');
const authMiddleware = require('../middleware/authMiddleware');

// All key routes require JWT authentication
router.use(authMiddleware);

// GET /keys  – list all active keys
router.get('/', getKeys);

// POST /keys  – generate a new key
router.post('/', createApiKey);

// DELETE /keys/:id  – revoke a key
router.delete('/:id', revokeKey);

module.exports = router;
