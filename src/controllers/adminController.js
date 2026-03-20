const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { listSupportedModels } = require('../utils/pricing');

function normalizeRestrictedModels(input) {
  if (!Array.isArray(input)) return { error: 'restricted_models must be an array of model IDs' };

  const supported = new Set(listSupportedModels().map((model) => model.toLowerCase()));
  const normalized = [];
  const seen = new Set();

  for (const raw of input) {
    if (typeof raw !== 'string' || !raw.trim()) {
      return { error: 'restricted_models must contain non-empty strings' };
    }

    const model = raw.trim().toLowerCase();
    if (!supported.has(model)) {
      return { error: `Unsupported model in restricted_models: ${raw}` };
    }

    if (!seen.has(model)) {
      seen.add(model);
      normalized.push(model);
    }
  }

  return { normalized };
}

/**
 * Admin Dashboard: Comprehensive statistics
 * Returns: total revenue, active users, top users, top models, failed transactions
 */
async function getDashboardStats(req, res) {
  try {
    const timeRanges = {
      all_time: null,
      monthly: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      daily: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    };

    // Total revenue (all-time and monthly)
    const [totalRevenue, monthlyRevenue] = await Promise.all([
      prisma.topUp.aggregate({
        where: { status: 'completed' },
        _sum: { amount: true }
      }),
      prisma.topUp.aggregate({
        where: { 
          status: 'completed',
          created_at: { gte: timeRanges.monthly }
        },
        _sum: { amount: true }
      })
    ]);

    // Active users (last 30 days, last 24 hours)
    const [activeUsersMonth, activeUsersDay, totalUsers] = await Promise.all([
      prisma.user.count({
        where: {
          created_at: { gte: timeRanges.monthly }
        }
      }),
      prisma.user.count({
        where: {
          created_at: { gte: timeRanges.daily }
        }
      }),
      prisma.user.count()
    ]);

    // Top users by spending
    const topUsersBySpending = await prisma.topUp.groupBy({
      by: ['user_id'],
      where: { status: 'completed' },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10
    });

    // Enrich with user emails
    const topUsersWithDetails = await Promise.all(
      topUsersBySpending.map(async (u) => {
        const user = await prisma.user.findUnique({
          where: { id: u.user_id },
          select: { email: true }
        });
        return {
          user_id: u.user_id,
          email: user?.email || 'Unknown',
          total_spent_inr: parseFloat(u._sum.amount || 0).toFixed(2)
        };
      })
    );

    // Top models by usage
    const topModelsByUsage = await prisma.usage.groupBy({
      by: ['model'],
      _count: { id: true },
      _sum: { tokens_used: true, cost_inr: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10
    });

    const topModelsWithStats = topModelsByUsage.map(m => ({
      model: m.model,
      usage_count: m._count.id,
      total_tokens: m._sum.tokens_used || 0,
      total_cost_inr: parseFloat(m._sum.cost_inr || 0).toFixed(2)
    }));

    // Failed transactions (last 30 days)
    const failedTransactions = await prisma.topUp.count({
      where: {
        status: 'failed',
        created_at: { gte: timeRanges.monthly }
      }
    });

    // Total failed transactions (all-time)
    const totalFailedTransactions = await prisma.topUp.count({
      where: { status: 'failed' }
    });

    res.json({
      success: true,
      data: {
        revenue: {
          all_time_inr: parseFloat(totalRevenue._sum.amount || 0).toFixed(2),
          last_30_days_inr: parseFloat(monthlyRevenue._sum.amount || 0).toFixed(2)
        },
        users: {
          total_count: totalUsers,
          active_last_30_days: activeUsersMonth,
          active_last_24_hours: activeUsersDay
        },
        top_users_by_spending: topUsersWithDetails,
        top_models_by_usage: topModelsWithStats,
        failed_transactions: {
          last_30_days: failedTransactions,
          all_time: totalFailedTransactions
        }
      }
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats', details: err.message });
  }
}

/**
 * Get all users with pagination
 */
async function listUsers(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        select: { 
          id: true, 
          email: true, 
          role: true,
          is_suspended: true,
          created_at: true,
          email_verified: true
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      }),
      prisma.user.count()
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        users,
        pagination: { page, limit, totalCount, totalPages }
      }
    });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to fetch users', details: err.message });
  }
}

/**
 * Get detailed user information including wallet, usage, api keys
 */
async function getUserDetails(req, res) {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: {
          select: { balance_inr: true, updated_at: true }
        },
        usages: {
          select: { 
            id: true, 
            provider: true,
            model: true,
            tokens_used: true,
            cost_inr: true,
            created_at: true
          },
          orderBy: { created_at: 'desc' },
          take: 50
        },
        api_keys: {
          select: {
            id: true,
            key_prefix: true,
            created_at: true,
            active: true
          }
        },
        model_restrictions: {
          select: {
            model: true,
            created_at: true
          },
          orderBy: { model: 'asc' }
        },
        top_ups: {
          select: {
            id: true,
            amount: true,
            status: true,
            created_at: true
          },
          orderBy: { created_at: 'desc' },
          take: 20
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate user statistics
    const totalSpent = user.usages.reduce((sum, u) => sum + parseFloat(u.cost_inr || 0), 0);
    const totalTopUp = user.top_ups.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          is_suspended: user.is_suspended,
          email_verified: user.email_verified,
          created_at: user.created_at,
          free_units: user.free_units
        },
        wallet: {
          balance_inr: user.wallet ? parseFloat(user.wallet.balance_inr).toFixed(2) : '0.00',
          last_updated: user.wallet?.updated_at
        },
        statistics: {
          total_spent_inr: totalSpent.toFixed(2),
          total_topup_inr: totalTopUp.toFixed(2),
          total_api_calls: user.usages.length,
          active_api_keys: user.api_keys.filter(k => k.active).length
        },
        recent_usages: user.usages,
        recent_topups: user.top_ups,
        api_keys: user.api_keys,
        restricted_models: user.model_restrictions.map((item) => item.model)
      }
    });
  } catch (err) {
    console.error('Get user details error:', err);
    res.status(500).json({ error: 'Failed to fetch user details', details: err.message });
  }
}

/**
 * Suspend/activate user
 */
async function updateUserStatus(req, res) {
  try {
    const { userId } = req.params;
    const { suspend } = req.body;

    if (typeof suspend !== 'boolean') {
      return res.status(400).json({ error: 'suspend must be a boolean' });
    }

    if (req.user.id === userId) {
      return res.status(400).json({ error: 'You cannot suspend or activate your own admin account' });
    }

    // For now, we'll deactivate API keys instead of deleting the user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, id: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { is_suspended: suspend }
      }),
      prisma.apiKey.updateMany({
        where: { user_id: userId },
        data: { active: !suspend }
      })
    ]);

    res.json({
      success: true,
      message: suspend ? `User ${user.email} has been suspended` : `User ${user.email} has been activated`,
      data: { user_id: userId, suspended: suspend }
    });
  } catch (err) {
    console.error('Update user status error:', err);
    res.status(500).json({ error: 'Failed to update user status', details: err.message });
  }
}

async function deleteUserAccount(req, res) {
  try {
    const { userId } = req.params;

    if (req.user.id === userId) {
      return res.status(400).json({ error: 'You cannot delete your own admin account' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await prisma.user.delete({ where: { id: userId } });

    return res.json({
      success: true,
      message: `User ${user.email} deleted successfully`,
      data: { user_id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ error: 'Failed to delete user', details: err.message });
  }
}

async function grantFreeUnits(req, res) {
  try {
    const { userId } = req.params;
    const { units, mode = 'add' } = req.body;

    if (!Number.isInteger(units) || units < 0) {
      return res.status(400).json({ error: 'units must be a non-negative integer' });
    }

    if (!['add', 'set'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be either "add" or "set"' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, free_units: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: mode === 'set' ? { free_units: units } : { free_units: { increment: units } },
      select: { id: true, email: true, free_units: true }
    });

    return res.json({
      success: true,
      message: mode === 'set'
        ? `Free units set to ${updated.free_units} for ${updated.email}`
        : `Added ${units} free units to ${updated.email}`,
      data: {
        user_id: updated.id,
        email: updated.email,
        previous_free_units: user.free_units,
        current_free_units: updated.free_units,
        mode,
        units
      }
    });
  } catch (err) {
    console.error('Grant free units error:', err);
    return res.status(500).json({ error: 'Failed to update free units', details: err.message });
  }
}

async function getUserModelRestrictions(req, res) {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        model_restrictions: {
          select: { model: true },
          orderBy: { model: 'asc' }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      success: true,
      data: {
        user_id: user.id,
        email: user.email,
        restricted_models: user.model_restrictions.map((item) => item.model)
      }
    });
  } catch (err) {
    console.error('Get user model restrictions error:', err);
    return res.status(500).json({ error: 'Failed to fetch model restrictions', details: err.message });
  }
}

async function updateUserModelRestrictions(req, res) {
  try {
    const { userId } = req.params;
    const { restricted_models = [] } = req.body;

    const { normalized, error } = normalizeRestrictedModels(restricted_models);
    if (error) {
      return res.status(400).json({ error });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await prisma.$transaction([
      prisma.userModelRestriction.deleteMany({ where: { user_id: userId } }),
      ...(normalized.length > 0
        ? [prisma.userModelRestriction.createMany({
            data: normalized.map((model) => ({ user_id: userId, model }))
          })]
        : [])
    ]);

    return res.json({
      success: true,
      message: `Updated restricted models for ${user.email}`,
      data: {
        user_id: user.id,
        email: user.email,
        restricted_models: normalized
      }
    });
  } catch (err) {
    console.error('Update user model restrictions error:', err);
    return res.status(500).json({ error: 'Failed to update model restrictions', details: err.message });
  }
}

/**
 * Model analytics: usage breakdown by model
 */
async function getModelAnalytics(req, res) {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();

    const usageByModel = await prisma.usage.groupBy({
      by: ['model', 'provider'],
      where: {
        created_at: {
          gte: from,
          lte: to
        }
      },
      _count: { id: true },
      _sum: { tokens_used: true, cost_inr: true },
      orderBy: { _count: { id: 'desc' } }
    });

    const analytics = usageByModel.map(item => ({
      model: item.model,
      provider: item.provider,
      usage_count: item._count.id,
      total_tokens: item._sum.tokens_used || 0,
      total_cost_inr: parseFloat(item._sum.cost_inr || 0).toFixed(2)
    }));

    res.json({
      success: true,
      data: {
        period: { from, to },
        model_analytics: analytics
      }
    });
  } catch (err) {
    console.error('Model analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch model analytics', details: err.message });
  }
}

/**
 * Revenue breakdown: by model, by time period
 */
async function getRevenueBreakdown(req, res) {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();

    // Revenue by model (via usage costs)
    const revenueByModel = await prisma.usage.groupBy({
      by: ['model'],
      where: {
        created_at: {
          gte: from,
          lte: to
        }
      },
      _sum: { cost_inr: true },
      _count: { id: true },
      orderBy: { _sum: { cost_inr: 'desc' } }
    });

    // Revenue by topups
    const topupRevenue = await prisma.topUp.aggregate({
      where: {
        status: 'completed',
        created_at: {
          gte: from,
          lte: to
        }
      },
      _sum: { amount: true },
      _count: { id: true }
    });

    const revenueByModel_formatted = revenueByModel.map(item => ({
      model: item.model,
      usage_count: item._count.id,
      revenue_inr: parseFloat(item._sum.cost_inr || 0).toFixed(2)
    }));

    const totalUsageRevenue = revenueByModel.reduce((sum, item) => sum + parseFloat(item._sum.cost_inr || 0), 0);

    res.json({
      success: true,
      data: {
        period: { from, to },
        revenue_by_model: revenueByModel_formatted,
        topup_revenue: {
          total_inr: parseFloat(topupRevenue._sum.amount || 0).toFixed(2),
          transaction_count: topupRevenue._count
        },
        summary: {
          usage_revenue_inr: totalUsageRevenue.toFixed(2),
          topup_revenue_inr: parseFloat(topupRevenue._sum.amount || 0).toFixed(2),
          total_revenue_inr: (totalUsageRevenue + parseFloat(topupRevenue._sum.amount || 0)).toFixed(2)
        }
      }
    });
  } catch (err) {
    console.error('Revenue breakdown error:', err);
    res.status(500).json({ error: 'Failed to fetch revenue breakdown', details: err.message });
  }
}

/**
 * Transaction history: all top-ups and usages
 */
async function getTransactionHistory(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;
    const type = req.query.type; // 'topup', 'usage', or mix if not specified

    let transactionType = [];
    
    if (!type || type === 'topup') {
      transactionType.push('topup');
    }
    if (!type || type === 'usage') {
      transactionType.push('usage');
    }

    const [topups, usages, totalTopups, totalUsages] = await Promise.all([
      transactionType.includes('topup') ? prisma.topUp.findMany({
        select: {
          id: true,
          user_id: true,
          amount: true,
          status: true,
          created_at: true
        },
        orderBy: { created_at: 'desc' },
        skip: type === 'topup' ? skip : 0,
        take: type === 'topup' ? limit : 1000
      }) : [],
      transactionType.includes('usage') ? prisma.usage.findMany({
        select: {
          id: true,
          user_id: true,
          model: true,
          cost_inr: true,
          tokens_used: true,
          created_at: true
        },
        orderBy: { created_at: 'desc' },
        skip: type === 'usage' ? skip : 0,
        take: type === 'usage' ? limit : 1000
      }) : [],
      transactionType.includes('topup') ? prisma.topUp.count() : 0,
      transactionType.includes('usage') ? prisma.usage.count() : 0
    ]);

    // Merge and format transactions
    let transactions = [];
    
    topups.forEach(t => {
      transactions.push({
        id: t.id,
        type: 'TOPUP',
        user_id: t.user_id,
        amount_inr: parseFloat(t.amount).toFixed(2),
        status: t.status,
        created_at: t.created_at
      });
    });

    usages.forEach(u => {
      transactions.push({
        id: u.id,
        type: 'USAGE',
        user_id: u.user_id,
        model: u.model,
        amount_inr: parseFloat(u.cost_inr).toFixed(2),
        tokens_used: u.tokens_used,
        created_at: u.created_at
      });
    });

    // Sort by created_at
    transactions = transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Apply pagination on merged data
    const paginatedTransactions = transactions.slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        transactions: paginatedTransactions,
        pagination: {
          page,
          limit,
          totalTransactions: transactions.length,
          topupCount: totalTopups,
          usageCount: totalUsages
        }
      }
    });
  } catch (err) {
    console.error('Transaction history error:', err);
    res.status(500).json({ error: 'Failed to fetch transaction history', details: err.message });
  }
}

module.exports = {
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
};
