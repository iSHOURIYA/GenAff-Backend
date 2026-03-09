const prisma = require('./prismaClient');

/**
 * Record a usage entry after a successful API proxy call.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.apiKeyId
 * @param {string} params.provider   - openai | deepseek | gemini
 * @param {string} params.model
 * @param {number} params.tokensUsed
 * @param {number} params.costInr
 * @returns {Promise<object>} created Usage record
 */
async function logUsage({ userId, apiKeyId, provider, model, tokensUsed, costInr }) {
  return prisma.usage.create({
    data: {
      user_id: userId,
      api_key_id: apiKeyId,
      provider,
      model,
      tokens_used: tokensUsed,
      cost_inr: costInr,
    },
  });
}

/**
 * Get paginated usage history for a user.
 * @param {string} userId
 * @param {number} page   1-based
 * @param {number} limit
 * @returns {Promise<{records: Array, total: number}>}
 */
async function getUsageHistory(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [records, total] = await prisma.$transaction([
    prisma.usage.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        provider: true,
        model: true,
        tokens_used: true,
        cost_inr: true,
        created_at: true,
        api_key: { select: { key_prefix: true } },
      },
    }),
    prisma.usage.count({ where: { user_id: userId } }),
  ]);

  return { records, total, page, limit };
}

/**
 * Get aggregate usage stats for a user.
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function getUsageStats(userId) {
  const result = await prisma.usage.aggregate({
    where: { user_id: userId },
    _sum: { tokens_used: true, cost_inr: true },
    _count: { id: true },
  });

  return {
    total_requests: result._count.id,
    total_tokens: result._sum.tokens_used ?? 0,
    total_spent_inr: parseFloat(result._sum.cost_inr ?? 0),
  };
}

module.exports = { logUsage, getUsageHistory, getUsageStats };
