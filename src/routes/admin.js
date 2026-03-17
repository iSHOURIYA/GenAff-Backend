const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const {
  getDashboardStats,
  listUsers,
  getUserDetails,
  updateUserStatus,
  getModelAnalytics,
  getRevenueBreakdown,
  getTransactionHistory
} = require('../controllers/adminController');

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

module.exports = router;
