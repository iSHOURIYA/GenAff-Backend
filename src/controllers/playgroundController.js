const {
  createPlaygroundSession,
  listPlaygroundSessions,
  getPlaygroundHistory,
  deletePlaygroundSession,
} = require('../services/playgroundService');

async function createSession(req, res) {
  try {
    const { ttl_minutes, title } = req.body || {};
    const result = await createPlaygroundSession(req.user.id, ttl_minutes, title);

    return res.status(201).json({
      message: 'Playground session created',
      session: {
        id: result.session.id,
        title: result.session.title,
        created_at: result.session.created_at,
        expires_at: result.session.expires_at,
      },
      api_key: {
        key: result.key.raw,
        key_prefix: result.key.key_prefix,
        expires_at: result.key.expires_at,
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[playgroundController.createSession]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listSessions(req, res) {
  try {
    const sessions = await listPlaygroundSessions(req.user.id);
    return res.status(200).json({ sessions });
  } catch (err) {
    console.error('[playgroundController.listSessions]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getHistory(req, res) {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    const data = await getPlaygroundHistory(req.user.id, req.params.id, limit);
    return res.status(200).json(data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[playgroundController.getHistory]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteSession(req, res) {
  try {
    await deletePlaygroundSession(req.user.id, req.params.id);
    return res.status(200).json({ message: 'Playground session deleted' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[playgroundController.deleteSession]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createSession,
  listSessions,
  getHistory,
  deleteSession,
};
