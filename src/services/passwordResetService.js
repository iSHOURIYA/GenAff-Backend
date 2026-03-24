const crypto = require('crypto');
const prisma = require('./prismaClient');
const { hashPassword } = require('../utils/hash');
const { sendPasswordResetEmail } = require('./emailService');

const PASSWORD_RESET_EXPIRY_MINUTES = parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES || '15', 10);

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

async function createAndSendPasswordReset(userId, email) {
  await prisma.pendingPasswordReset.deleteMany({
    where: { user_id: userId, used: false },
  });

  const otp = generateOtp();
  const token = crypto.randomUUID();
  const expires_at = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);

  await prisma.pendingPasswordReset.create({
    data: { user_id: userId, otp, token, expires_at },
  });

  await sendPasswordResetEmail(email, otp, token, PASSWORD_RESET_EXPIRY_MINUTES);
}

async function consumePasswordResetAndUpdatePassword(record, newPassword) {
  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.user_id },
      data: { password_hash: passwordHash },
    }),
    prisma.pendingPasswordReset.update({
      where: { id: record.id },
      data: { used: true },
    }),
    prisma.pendingPasswordReset.updateMany({
      where: {
        user_id: record.user_id,
        used: false,
        id: { not: record.id },
      },
      data: { used: true },
    }),
  ]);
}

async function resetPasswordByToken(token, newPassword) {
  const record = await prisma.pendingPasswordReset.findUnique({
    where: { token },
  });

  if (!record) {
    const err = new Error('Invalid or expired reset link');
    err.status = 404;
    throw err;
  }

  if (record.used) {
    const err = new Error('This reset link has already been used');
    err.status = 409;
    throw err;
  }

  if (new Date() > record.expires_at) {
    const err = new Error('Reset link has expired. Please request a new one.');
    err.status = 410;
    throw err;
  }

  await consumePasswordResetAndUpdatePassword(record, newPassword);
}

async function resetPasswordByOtp(email, otp, newPassword) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (!user) {
    const err = new Error('Invalid email or reset code');
    err.status = 400;
    throw err;
  }

  const record = await prisma.pendingPasswordReset.findFirst({
    where: { user_id: user.id, used: false },
    orderBy: { created_at: 'desc' },
  });

  if (!record) {
    const err = new Error('No active password reset found. Please request a new one.');
    err.status = 404;
    throw err;
  }

  if (new Date() > record.expires_at) {
    const err = new Error('Reset code has expired. Please request a new one.');
    err.status = 410;
    throw err;
  }

  if (record.otp !== otp.trim()) {
    const err = new Error('Invalid email or reset code');
    err.status = 400;
    throw err;
  }

  await consumePasswordResetAndUpdatePassword(record, newPassword);
}

module.exports = {
  createAndSendPasswordReset,
  resetPasswordByToken,
  resetPasswordByOtp,
};
