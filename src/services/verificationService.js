const crypto = require('crypto');
const prisma = require('./prismaClient');
const { sendVerificationEmail } = require('./emailService');

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '15', 10);

/**
 * Generate a cryptographically secure 6-digit OTP.
 * Uses crypto.randomInt to avoid modulo bias.
 * @returns {string} zero-padded 6 digit string e.g. "047291"
 */
function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Create a new PendingVerification record for a user and send the email.
 *
 * Deletes any previous unused verifications for this user first
 * so there's never more than one active record per user.
 *
 * @param {string} userId
 * @param {string} email    recipient email
 * @returns {Promise<void>}
 */
async function createAndSendVerification(userId, email) {
  // Remove any existing (unused) verification for this user
  await prisma.pendingVerification.deleteMany({
    where: { user_id: userId, used: false },
  });

  const otp   = generateOtp();
  const token = crypto.randomUUID(); // magic link token
  const expires_at = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.pendingVerification.create({
    data: { user_id: userId, otp, token, expires_at },
  });

  await sendVerificationEmail(email, otp, token, OTP_EXPIRY_MINUTES);
}

/**
 * Verify a user by OTP (cross-device flow).
 *
 * @param {string} email
 * @param {string} otp
 * @returns {Promise<{id: string, email: string, created_at: Date, free_units: number}>} verified user
 */
async function verifyByOtp(email, otp) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const err = new Error('No account found with that email');
    err.status = 404;
    throw err;
  }

  if (user.email_verified) {
    const err = new Error('Email is already verified');
    err.status = 409;
    throw err;
  }

  const record = await prisma.pendingVerification.findFirst({
    where: { user_id: user.id, used: false },
    orderBy: { created_at: 'desc' },
  });

  if (!record) {
    const err = new Error('No active verification found. Please request a new code.');
    err.status = 404;
    throw err;
  }

  if (new Date() > record.expires_at) {
    const err = new Error('Verification code has expired. Please request a new one.');
    err.status = 410;
    throw err;
  }

  if (record.otp !== otp.trim()) {
    const err = new Error('Invalid verification code');
    err.status = 400;
    throw err;
  }

  // Atomically mark used + verify user
  const [verifiedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { email_verified: true },
      select: { id: true, email: true, created_at: true, free_units: true },
    }),
    prisma.pendingVerification.update({
      where: { id: record.id },
      data: { used: true },
    }),
  ]);

  return verifiedUser;
}

/**
 * Verify a user by magic link token (same-device flow).
 *
 * @param {string} token  UUID from the magic link query param
 * @returns {Promise<{id: string, email: string, created_at: Date, free_units: number}>} verified user
 */
async function verifyByToken(token) {
  const record = await prisma.pendingVerification.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, created_at: true, free_units: true, email_verified: true } } },
  });

  if (!record) {
    const err = new Error('Invalid or expired verification link');
    err.status = 404;
    throw err;
  }

  if (record.used) {
    const err = new Error('This verification link has already been used');
    err.status = 409;
    throw err;
  }

  if (new Date() > record.expires_at) {
    const err = new Error('Verification link has expired. Please request a new one.');
    err.status = 410;
    throw err;
  }

  if (record.user.email_verified) {
    const err = new Error('Email is already verified');
    err.status = 409;
    throw err;
  }

  // Atomically mark used + verify user
  const [verifiedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: record.user_id },
      data: { email_verified: true },
      select: { id: true, email: true, created_at: true, free_units: true },
    }),
    prisma.pendingVerification.update({
      where: { id: record.id },
      data: { used: true },
    }),
  ]);

  return verifiedUser;
}

module.exports = { createAndSendVerification, verifyByOtp, verifyByToken };
