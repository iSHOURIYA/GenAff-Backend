const { createUser, authenticateUser } = require('../services/userService');
const { signToken } = require('../utils/jwt');

/**
 * POST /auth/register
 * Body: { email, password }
 */
async function register(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await createUser(email.toLowerCase().trim(), password);
    const token = signToken({ id: user.id, email: user.email });

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[authController.register]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /auth/login
 * Body: { email, password }
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await authenticateUser(email.toLowerCase().trim(), password);
    const token = signToken({ id: user.id, email: user.email });

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        free_units: user.free_units,
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[authController.login]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /auth/me
 * Returns current authenticated user info.
 */
const { getUserById } = require('../services/userService');

async function me(req, res) {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user });
  } catch (err) {
    console.error('[authController.me]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { register, login, me };
