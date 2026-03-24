const { createUser, authenticateUser } = require('../services/userService');
const { signToken } = require('../utils/jwt');
const {
  createAndSendVerification,
  verifyByOtp,
  verifyByToken,
} = require('../services/verificationService');
const {
  createAndSendPasswordReset,
  resetPasswordByToken,
  resetPasswordByOtp,
} = require('../services/passwordResetService');

const DEFAULT_DISPOSABLE_EMAIL_DOMAINS = [
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'sharklasers.com',
  'dispostable.com',
  'maildrop.cc',
  'getnada.com',
];

const EXTRA_DISPOSABLE_DOMAINS = (process.env.DISPOSABLE_EMAIL_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  ...DEFAULT_DISPOSABLE_EMAIL_DOMAINS,
  ...EXTRA_DISPOSABLE_DOMAINS,
]);

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

    const normalizedEmail = email.toLowerCase().trim();
    const emailDomain = normalizedEmail.split('@')[1];
    if (emailDomain && DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
      return res.status(400).json({ error: 'Disposable email domains are not allowed' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (password.length > 72) {
      return res.status(400).json({ error: 'Password must be 72 characters or fewer' });
    }

    const user = await createUser(normalizedEmail, password);

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

/**
 * POST /auth/forgot-password
 * Body: { email }
 * Returns a generic 200 response regardless of whether the user exists.
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const user = await getUserByEmail(normalizedEmail);

    // Generic response to prevent user enumeration
    if (!user) {
      return res.status(200).json({
        message: 'If that email exists, password reset instructions have been sent.',
      });
    }

    await createAndSendPasswordReset(user.id, user.email);

    return res.status(200).json({
      message: 'If that email exists, password reset instructions have been sent.',
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[authController.forgotPassword]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /auth/reset-password
 * Body (magic link): { token, new_password }
 * Body (OTP):        { email, otp, new_password }
 */
async function resetPassword(req, res) {
  try {
    const { token, email, otp, new_password } = req.body;

    if (!new_password) {
      return res.status(400).json({ error: 'new_password is required' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (new_password.length > 72) {
      return res.status(400).json({ error: 'Password must be 72 characters or fewer' });
    }

    if (token) {
      await resetPasswordByToken(String(token).trim(), new_password);
      return res.status(200).json({ message: 'Password reset successful. Please login with your new password.' });
    }

    if (!email || !otp) {
      return res.status(400).json({ error: 'Provide either { token, new_password } or { email, otp, new_password }' });
    }

    await resetPasswordByOtp(email.toLowerCase().trim(), String(otp).trim(), new_password);
    return res.status(200).json({ message: 'Password reset successful. Please login with your new password.' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[authController.resetPassword]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  register,
  login,
  me,
  verifyOtp,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
};
