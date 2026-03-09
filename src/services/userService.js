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
      wallet: {
        select: { balance_inr: true },
      },
    },
  });
}

module.exports = { createUser, authenticateUser, getUserById };
