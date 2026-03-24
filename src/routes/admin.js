const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const {
  getDashboardStats,
  listUsers,
  getUserDetails,
  updateUserStatus,
  deleteUserAccount,
  grantFreeUnits,
  getUserModelRestrictions,
  updateUserModelRestrictions,
  getModelAnalytics,
  getRevenueBreakdown,
  getTransactionHistory
} = require('../controllers/adminController');
const { getHealthStatus, forceHealthCheck } = require('../services/modelHealthCheckService');

/**
 * All admin routes require authentication AND admin role
 */

/**
 * GET /admin/dashboard
 * Dashboard with comprehensive statistics
 */
router.get('/dashboard', authMiddleware, adminMiddleware, getDashboardStats);

/**
 * GET /admin/users
 * List all users with pagination
 * Query params: page (default 1), limit (default 50)
 */
router.get('/users', authMiddleware, adminMiddleware, listUsers);

/**
 * GET /admin/users/:userId
 * Get detailed user information including wallet, usage, api keys, top-ups
 */
router.get('/users/:userId', authMiddleware, adminMiddleware, getUserDetails);

/**
 * PUT /admin/users/:userId/status
 * Suspend/activate user
 * Body: { suspend: boolean }
 */
router.put('/users/:userId/status', authMiddleware, adminMiddleware, updateUserStatus);

/**
 * DELETE /admin/users/:userId
 * Permanently delete user account and all related data (cascade)
 */
router.delete('/users/:userId', authMiddleware, adminMiddleware, deleteUserAccount);

/**
 * PATCH /admin/users/:userId/free-units
 * Add or set free units for a user
 * Body: { units: number, mode?: 'add' | 'set' }
 */
router.patch('/users/:userId/free-units', authMiddleware, adminMiddleware, grantFreeUnits);

/**
 * GET /admin/users/:userId/model-restrictions
 * Returns list of restricted model IDs for the user
 */
router.get('/users/:userId/model-restrictions', authMiddleware, adminMiddleware, getUserModelRestrictions);

/**
 * PUT /admin/users/:userId/model-restrictions
 * Replace restricted model list for the user
 * Body: { restricted_models: string[] }
 */
router.put('/users/:userId/model-restrictions', authMiddleware, adminMiddleware, updateUserModelRestrictions);

/**
 * GET /admin/models/analytics
 * Model usage analytics with date range filtering
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), defaults to last 30 days
 */
router.get('/models/analytics', authMiddleware, adminMiddleware, getModelAnalytics);

/**
 * GET /admin/revenue/breakdown
 * Revenue breakdown by model and time period
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD)
 */
router.get('/revenue/breakdown', authMiddleware, adminMiddleware, getRevenueBreakdown);

/**
 * GET /admin/transactions
 * Transaction history with pagination
 * Query params: page (default 1), limit (default 100), type ('topup'/'usage'/mix)
 */
router.get('/transactions', authMiddleware, adminMiddleware, getTransactionHistory);

/**
 * GET /admin/models/health
 * View current model health status and cache age
 */
router.get('/models/health', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const health = await getHealthStatus();
    const summary = {
      healthy: Object.values(health).filter((h) => h.status === 'healthy').length,
      unhealthy: Object.values(health).filter((h) => h.status === 'unhealthy').length,
      error: Object.values(health).filter((h) => h.status === 'error').length,
      total: Object.keys(health).length,
    };

    return res.json({
      success: true,
      data: {
        summary,
        models: Object.entries(health)
          .map(([model, status]) => ({
            model,
            status: status.status,
            error: status.error || null,
            checked_at: new Date(status.timestamp).toISOString(),
          }))
          .sort((a, b) => {
            // Sort: healthy first, then by model name
            if (a.status !== b.status) {
              return a.status === 'healthy' ? -1 : 1;
            }
            return a.model.localeCompare(b.model);
          }),
      },
    });
  } catch (err) {
    console.error('[admin.models.health] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch model health status' });
  }
});

/**
 * POST /admin/models/health/refresh
 * Force an immediate model health check (async, non-blocking)
 */
router.post('/models/health/refresh', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Trigger refresh in background (don't wait)
    forceHealthCheck().catch((err) => console.error('[admin.models.health.refresh] Error:', err));

    return res.json({
      success: true,
      message: 'Model health check triggered. Results will be available shortly.',
    });
  } catch (err) {
    console.error('[admin.models.health.refresh] Error:', err);
    return res.status(500).json({ error: 'Failed to trigger health check' });
  }
});

module.exports = router;
