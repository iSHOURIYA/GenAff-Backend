const prisma = require('./prismaClient');
const { hashPassword, comparePassword } = require('../utils/hash');

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
      free_units: 10,
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

module.exports = { createUser, authenticateUser, getUserById, getUserByEmail, updateUserPassword };
