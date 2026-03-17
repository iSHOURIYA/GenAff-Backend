const { createUser, authenticateUser } = require('../services/userService');
const { signToken } = require('../utils/jwt');
const {
  createAndSendVerification,
  verifyByOtp,
  verifyByToken,
} = require('../services/verificationService');

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

    if (password.length > 72) {
      return res.status(400).json({ error: 'Password must be 72 characters or fewer' });
    }

    const user = await createUser(email.toLowerCase().trim(), password);

    // Send hybrid OTP + magic-link verification email
    await createAndSendVerification(user.id, user.email);

    return res.status(201).json({
      message: 'Account created. Please check your email to verify your account.',
      user_id: user.id,
      email: user.email,
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
    const token = signToken({ id: user.id, email: user.email, role: user.role });

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        free_units: user.free_units,
        role: user.role,
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

/**
 * POST /auth/verify-otp
 * Cross-device flow: user types the 6-digit code.
 * Body: { email, otp }
 */
async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'email and otp are required' });
    }

    const user = await verifyByOtp(email.toLowerCase().trim(), String(otp).trim());
    const token = signToken({ id: user.id, email: user.email });

    return res.status(200).json({
      message: 'Email verified successfully. Welcome to GenAff!',
      token,
      user,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[authController.verifyOtp]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /auth/verify-email?token=<uuid>
 * Same-device magic-link flow.
 */
async function verifyEmail(req, res) {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'token query parameter is required' });
    }

    const user = await verifyByToken(token);
    const jwt = signToken({ id: user.id, email: user.email });

    return res.status(200).json({
      message: 'Email verified successfully. Welcome to GenAff!',
      token: jwt,
      user,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[authController.verifyEmail]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /auth/resend-verification
 * Resend the hybrid email to an unverified user.
 * Body: { email }
 */
const { getUserByEmail } = require('../services/userService');

async function resendVerification(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const user = await getUserByEmail(email.toLowerCase().trim());

    // Return 200 even if email not found — prevents user enumeration
    if (!user || user.email_verified) {
      return res.status(200).json({
        message: 'If that email exists and is unverified, a new code has been sent.',
      });
    }

    await createAndSendVerification(user.id, user.email);

    return res.status(200).json({
      message: 'A new verification code has been sent to your email.',
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[authController.resendVerification]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { register, login, me, verifyOtp, verifyEmail, resendVerification };
