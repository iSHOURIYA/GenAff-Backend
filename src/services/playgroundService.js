const prisma = require('./prismaClient');
const { generateApiKey, hashApiKey, getKeyPrefix } = require('../utils/hash');

const PLAYGROUND_SESSION_TTL_MINUTES = parseInt(process.env.PLAYGROUND_SESSION_TTL_MINUTES || '60', 10);
const PLAYGROUND_MAX_ACTIVE_SESSIONS = parseInt(process.env.PLAYGROUND_MAX_ACTIVE_SESSIONS || '3', 10);
const PLAYGROUND_CLEANUP_INTERVAL_MS = parseInt(process.env.PLAYGROUND_CLEANUP_INTERVAL_MS || '300000', 10);

async function createPlaygroundSession(userId, ttlMinutes = PLAYGROUND_SESSION_TTL_MINUTES, title) {
  const safeTtl = Math.max(5, Math.min(parseInt(ttlMinutes || PLAYGROUND_SESSION_TTL_MINUTES, 10), 240));
  const now = Date.now();
  const expiresAt = new Date(now + safeTtl * 60 * 1000);

  const activeCount = await prisma.playgroundSession.count({
    where: {
      user_id: userId,
      expires_at: { gt: new Date() },
    },
  });

  if (activeCount >= PLAYGROUND_MAX_ACTIVE_SESSIONS) {
    const err = new Error(`Maximum ${PLAYGROUND_MAX_ACTIVE_SESSIONS} active playground sessions allowed`);
    err.status = 409;
    throw err;
  }

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);

  const { session, keyRecord } = await prisma.$transaction(async (tx) => {
    const createdSession = await tx.playgroundSession.create({
      data: {
        user_id: userId,
        title: title?.trim() || `Playground ${new Date().toISOString()}`,
        expires_at: expiresAt,
      },
    });

    const createdKey = await tx.apiKey.create({
      data: {
        key_hash: keyHash,
        key_prefix: keyPrefix,
        user_id: userId,
        active: true,
        is_playground: true,
        expires_at: expiresAt,
        playground_session_id: createdSession.id,
      },
      select: {
        id: true,
        key_prefix: true,
        expires_at: true,
        created_at: true,
      },
    });

    return { session: createdSession, keyRecord: createdKey };
  });

  return {
    session,
    key: {
      raw: rawKey,
      ...keyRecord,
    },
  };
}

async function listPlaygroundSessions(userId) {
  return prisma.playgroundSession.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    include: {
      api_key: {
        select: {
          id: true,
          key_prefix: true,
          active: true,
          expires_at: true,
        },
      },
      _count: {
        select: { messages: true },
      },
    },
    take: 100,
  });
}

async function getPlaygroundHistory(userId, sessionId, limit = 200) {
  const session = await prisma.playgroundSession.findFirst({
    where: { id: sessionId, user_id: userId },
    select: { id: true, title: true, created_at: true, expires_at: true },
  });

  if (!session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  const safeLimit = Math.max(1, Math.min(parseInt(limit || '200', 10), 500));

  const messages = await prisma.playgroundMessage.findMany({
    where: { session_id: sessionId },
    orderBy: { created_at: 'asc' },
    take: safeLimit,
    select: {
      id: true,
      role: true,
      content: true,
      provider: true,
      model: true,
      tokens_used: true,
      cost_inr: true,
      created_at: true,
    },
  });

  return { session, messages };
}

async function deletePlaygroundSession(userId, sessionId) {
  const session = await prisma.playgroundSession.findFirst({
    where: { id: sessionId, user_id: userId },
    include: {
      api_key: {
        select: { id: true },
      },
    },
  });

  if (!session) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }

  await prisma.$transaction([
    prisma.apiKey.updateMany({
      where: { playground_session_id: sessionId },
      data: { active: false },
    }),
    prisma.playgroundSession.delete({
      where: { id: sessionId },
    }),
  ]);
}

async function storePlaygroundTurn({
  sessionId,
  apiKeyId,
  provider,
  model,
  userMessage,
  assistantMessage,
  tokensUsed,
  costInr,
}) {
  if (!sessionId || !apiKeyId || !userMessage || !assistantMessage) {
    return;
  }

  await prisma.playgroundMessage.createMany({
    data: [
      {
        session_id: sessionId,
        api_key_id: apiKeyId,
        role: 'user',
        content: userMessage,
        provider,
        model,
        tokens_used: 0,
        cost_inr: 0,
      },
      {
        session_id: sessionId,
        api_key_id: apiKeyId,
        role: 'assistant',
        content: assistantMessage,
        provider,
        model,
        tokens_used: tokensUsed || 0,
        cost_inr: costInr || 0,
      },
    ],
  });
}

async function cleanupExpiredPlaygroundResources() {
  const now = new Date();

  // Always deactivate expired playground keys.
  await prisma.apiKey.updateMany({
    where: {
      is_playground: true,
      active: true,
      expires_at: { lt: now },
    },
    data: { active: false },
  });

  const expiredSessions = await prisma.playgroundSession.findMany({
    where: { expires_at: { lt: now } },
    select: { id: true },
    take: 500,
  });

  if (expiredSessions.length === 0) {
    return { deactivatedKeys: 0, deletedSessions: 0 };
  }

  const ids = expiredSessions.map((s) => s.id);

  await prisma.$transaction([
    prisma.apiKey.updateMany({
      where: {
        playground_session_id: { in: ids },
      },
      data: { active: false },
    }),
    prisma.playgroundSession.deleteMany({
      where: { id: { in: ids } },
    }),
  ]);

  return { deletedSessions: ids.length };
}

function startPlaygroundCleanupSchedule() {
  setInterval(() => {
    cleanupExpiredPlaygroundResources().catch((err) => {
      console.error('[playground.cleanup] error:', err.message);
    });
  }, PLAYGROUND_CLEANUP_INTERVAL_MS);

  cleanupExpiredPlaygroundResources().catch((err) => {
    console.error('[playground.cleanup.init] error:', err.message);
  });
}

module.exports = {
  createPlaygroundSession,
  listPlaygroundSessions,
  getPlaygroundHistory,
  deletePlaygroundSession,
  storePlaygroundTurn,
  cleanupExpiredPlaygroundResources,
  startPlaygroundCleanupSchedule,
};
