const { Resend } = require('resend');

let _resend = null;

function getResendClient() {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY is not set in environment');
    _resend = new Resend(apiKey);
  }
  return _resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const APP_NAME   = 'GenAff';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://genaff.shauryacodes.xyz';

/**
 * Send a hybrid verification email containing:
 *  – a one-click magic link (same device)
 *  – a 6-digit OTP (cross-device fallback)
 *
 * @param {string} email       recipient email address
 * @param {string} otp         6-digit numeric OTP
 * @param {string} token       UUID token for the magic link
 * @param {number} expiryMins  expiry in minutes (shown to user)
 */
async function sendVerificationEmail(email, otp, token, expiryMins = 15) {
  const resend = getResendClient();

  const magicLink = `${FRONTEND_URL}/auth/verify-email?token=${token}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verify your ${APP_NAME} account</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f7; margin: 0; padding: 0; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #0f172a; padding: 32px 40px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 22px; letter-spacing: -0.5px; }
    .header span { color: #6366f1; }
    .body { padding: 36px 40px; }
    .body p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px; }
    .btn { display: block; width: fit-content; margin: 0 auto 28px; background: #6366f1; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-size: 15px; font-weight: 600; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 28px 0; }
    .otp-label { color: #6b7280; font-size: 13px; text-align: center; margin-bottom: 10px; }
    .otp { font-size: 38px; font-weight: 700; letter-spacing: 10px; color: #0f172a; text-align: center; font-family: 'Courier New', monospace; margin: 0 0 8px; }
    .expiry { color: #9ca3af; font-size: 13px; text-align: center; }
    .footer { background: #f9fafb; padding: 20px 40px; text-align: center; }
    .footer p { color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1><span>Gen</span>Aff</h1>
    </div>
    <div class="body">
      <p>Hi there,</p>
      <p>Thanks for signing up! Please verify your email address to activate your account.</p>

      <a href="${magicLink}" class="btn">✓ &nbsp; Verify my account</a>

      <p style="color:#6b7280; font-size:13px; text-align:center;">
        Button not working? <a href="${magicLink}" style="color:#6366f1;">Click here</a>
      </p>

      <hr class="divider" />

      <p class="otp-label">Or enter this code on a different device:</p>
      <p class="otp">${otp}</p>
      <p class="expiry">Expires in ${expiryMins} minutes · One-time use only</p>
    </div>
    <div class="footer">
      <p>If you didn't create a ${APP_NAME} account, you can safely ignore this email.<br/>
      This link and code will expire in ${expiryMins} minutes.</p>
    </div>
  </div>
</body>
</html>`;

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `Verify your ${APP_NAME} account`,
    html,
  });

  if (error) {
    console.error('[emailService.sendVerificationEmail] Resend error:', error);
    const err = new Error('Failed to send verification email. Please try again.');
    err.status = 502;
    throw err;
  }
}

/**
 * Send a hybrid password-reset email containing:
 *  – a one-click reset link (same device)
 *  – a 6-digit OTP (cross-device fallback)
 */
async function sendPasswordResetEmail(email, otp, token, expiryMins = 15) {
  const resend = getResendClient();

  const resetLink = `${FRONTEND_URL}/auth/reset-password?token=${token}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset your ${APP_NAME} password</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f7; margin: 0; padding: 0; }
    .wrapper { max-width: 520px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #0f172a; padding: 32px 40px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 22px; letter-spacing: -0.5px; }
    .header span { color: #6366f1; }
    .body { padding: 36px 40px; }
    .body p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px; }
    .btn { display: block; width: fit-content; margin: 0 auto 28px; background: #6366f1; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-size: 15px; font-weight: 600; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 28px 0; }
    .otp-label { color: #6b7280; font-size: 13px; text-align: center; margin-bottom: 10px; }
    .otp { font-size: 38px; font-weight: 700; letter-spacing: 10px; color: #0f172a; text-align: center; font-family: 'Courier New', monospace; margin: 0 0 8px; }
    .expiry { color: #9ca3af; font-size: 13px; text-align: center; }
    .footer { background: #f9fafb; padding: 20px 40px; text-align: center; }
    .footer p { color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1><span>Gen</span>Aff</h1>
    </div>
    <div class="body">
      <p>Hi there,</p>
      <p>We received a request to reset your password. If this was you, continue below.</p>

      <a href="${resetLink}" class="btn">Reset my password</a>

      <p style="color:#6b7280; font-size:13px; text-align:center;">
        Button not working? <a href="${resetLink}" style="color:#6366f1;">Click here</a>
      </p>

      <hr class="divider" />

      <p class="otp-label">Or enter this code on a different device:</p>
      <p class="otp">${otp}</p>
      <p class="expiry">Expires in ${expiryMins} minutes · One-time use only</p>
    </div>
    <div class="footer">
      <p>If you didn't request a password reset, you can safely ignore this email.<br/>
      This link and code will expire in ${expiryMins} minutes.</p>
    </div>
  </div>
</body>
</html>`;

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `Reset your ${APP_NAME} password`,
    html,
  });

  if (error) {
    console.error('[emailService.sendPasswordResetEmail] Resend error:', error);
    const err = new Error('Failed to send password reset email. Please try again.');
    err.status = 502;
    throw err;
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
