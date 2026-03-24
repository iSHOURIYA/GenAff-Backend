const prisma = require('./prismaClient');
const { hashPassword, comparePassword } = require('../utils/hash');

const FREE_UNITS_ON_VERIFY = parseInt(process.env.FREE_UNITS_ON_VERIFY || '10', 10);

/**
 * Create a new user account with a wallet and free units.
 * @param {string} email
 * @param {string} password  plain-text password
 * @returns {Promise<object>}  created user (without password_hash)
 */
async function createUser(email, password) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err = new Error('Email already in use');
    err.status = 409;
    throw err;
  }

  const password_hash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      password_hash,
      // Free units are granted only after successful email verification.
      free_units: 0,
      wallet: {
        create: { balance_inr: 0 },
      },
    },
    select: {
      id: true,
      email: true,
      created_at: true,
      free_units: true,
      role: true,
    },
  });

  return user;
}

/**
 * Validate credentials and return the user.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>} user object
 */
async function authenticateUser(email, password) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  if (!user.email_verified) {
    const err = new Error('Email not verified. Please verify your email before logging in.');
    err.status = 403;
    throw err;
  }

  if (user.is_suspended) {
    const err = new Error('Account suspended. Please contact support.');
    err.status = 403;
    throw err;
  }

  return user;
}

/**
 * Fetch a user by ID (no password_hash).
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      created_at: true,
      free_units: true,
      role: true,
      wallet: {
        select: { balance_inr: true },
      },
    },
  });
}

/**
 * Fetch a user by email (no password_hash).
 * Used for resend-verification — returns null if not found.
 * @param {string} email
 * @returns {Promise<object|null>}
 */
async function getUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      created_at: true,
      free_units: true,
      email_verified: true,
    },
  });
}

/**
 * Update a user's password hash.
 * @param {string} userId
 * @param {string} newPassword
 * @returns {Promise<void>}
 */
async function updateUserPassword(userId, newPassword) {
  const password_hash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { password_hash },
  });
}

/**
 * Mark user verified and grant one-time free units.
 * If user already has free units, preserve the higher value.
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function verifyUserAndGrantUnits(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email_verified: true, free_units: true },
  });

  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (user.email_verified) {
    const err = new Error('Email is already verified');
    err.status = 409;
    throw err;
  }

  const newFreeUnits = Math.max(user.free_units || 0, FREE_UNITS_ON_VERIFY);

  return prisma.user.update({
    where: { id: userId },
    data: {
      email_verified: true,
      free_units: newFreeUnits,
    },
    select: { id: true, email: true, created_at: true, free_units: true },
  });
}

module.exports = {
  createUser,
  authenticateUser,
  getUserById,
  getUserByEmail,
  updateUserPassword,
  verifyUserAndGrantUnits,
};
