const prisma = require('./prismaClient');
const { createRazorpayOrder, verifyPaymentSignature } = require('./razorpayService');

const MIN_TOPUP_INR = parseFloat(process.env.MIN_TOPUP_INR || '10');

/**
 * Get the wallet balance for a user.
 * @param {string} userId
 * @returns {Promise<{balance_inr: Decimal, updated_at: Date}>}
 */
async function getWallet(userId) {
  const wallet = await prisma.wallet.findUnique({
    where: { user_id: userId },
    select: { balance_inr: true, updated_at: true },
  });
  if (!wallet) {
    const err = new Error('Wallet not found');
    err.status = 404;
    throw err;
  }
  return wallet;
}

/**
 * Step 1 of the Razorpay top-up flow.
 *
 * Creates a pending TopUp record in the DB, then creates a corresponding
 * Razorpay order. Returns the order details the frontend needs to open
 * the Razorpay checkout widget.
 *
 * @param {string} userId
 * @param {number} amount  INR (must be >= MIN_TOPUP_INR)
 * @returns {Promise<{topUpId: string, razorpayOrder: object, keyId: string}>}
 */
async function createTopUpOrder(userId, amount) {
  const numAmount = parseFloat(amount);

  if (isNaN(numAmount) || numAmount < MIN_TOPUP_INR) {
    const err = new Error(`Minimum top-up is ₹${MIN_TOPUP_INR}`);
    err.status = 400;
    throw err;
  }

  // Guard: prevent duplicate pending orders for the same user
  const existingPending = await prisma.topUp.findFirst({
    where: { user_id: userId, status: 'pending' },
  });
  if (existingPending) {
    const err = new Error(
      'You have a pending top-up order. Complete or cancel it before creating a new one.'
    );
    err.status = 409;
    throw err;
  }

  // Create pending DB record first so we have an id for the receipt
  const topUp = await prisma.topUp.create({
    data: { user_id: userId, amount: numAmount, status: 'pending' },
  });

  // Create Razorpay order (throws on API failure — DB record stays pending,
  // which prevents duplicate orders via the guard above)
  let razorpayOrder;
  try {
    razorpayOrder = await createRazorpayOrder(numAmount, topUp.id);
  } catch (rpErr) {
    // Clean up the pending record so the user can try again
    await prisma.topUp.delete({ where: { id: topUp.id } }).catch(() => {});
    throw rpErr;
  }

  // Store the Razorpay order id for later signature verification
  await prisma.topUp.update({
    where: { id: topUp.id },
    data: { razorpay_order_id: razorpayOrder.id },
  });

  return {
    topUpId: topUp.id,
    razorpayOrder,
    keyId: process.env.RAZORPAY_KEY_ID,
  };
}

/**
 * Step 2 of the Razorpay top-up flow.
 *
 * Verifies the HMAC-SHA256 signature returned by Razorpay after the user
 * completes payment, then atomically marks the TopUp as completed and
 * credits the wallet.
 *
 * @param {string} userId
 * @param {string} razorpay_order_id    From Razorpay checkout callback
 * @param {string} razorpay_payment_id  From Razorpay checkout callback
 * @param {string} razorpay_signature   From Razorpay checkout callback
 * @returns {Promise<{topUp: object, newBalance: Decimal}>}
 */
async function verifyAndCreditWallet(userId, razorpay_order_id, razorpay_payment_id, razorpay_signature) {
  // 1. Verify signature — reject tampered requests immediately
  const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!isValid) {
    const err = new Error('Invalid payment signature');
    err.status = 400;
    throw err;
  }

  // 2. Find the matching pending TopUp owned by this user
  const topUp = await prisma.topUp.findFirst({
    where: {
      razorpay_order_id,
      user_id: userId,
      status: 'pending',
    },
  });

  if (!topUp) {
    const err = new Error('No matching pending top-up found for this order');
    err.status = 404;
    throw err;
  }

  // 3. Atomically mark completed + credit wallet
  const [updatedTopUp, updatedWallet] = await prisma.$transaction([
    prisma.topUp.update({
      where: { id: topUp.id },
      data: {
        status: 'completed',
        razorpay_payment_id,
      },
    }),
    prisma.wallet.update({
      where: { user_id: userId },
      data: { balance_inr: { increment: parseFloat(topUp.amount) } },
    }),
  ]);

  return { topUp: updatedTopUp, newBalance: updatedWallet.balance_inr };
}

/**
 * Atomically deduct an amount from the user's wallet.
 * Uses a single SQL UPDATE with a WHERE balance >= cost guard to
 * eliminate the read-modify-write race condition and prevent overdraft.
 *
 * @param {string} userId
 * @param {number} costInr
 * @returns {Promise<void>}
 * @throws {Error} status 402 if balance is insufficient at deduction time
 * @throws {Error} if wallet not found
 */
async function deductBalance(userId, costInr) {
  // Single atomic statement: only deducts if balance is sufficient at that instant.
  // GREATEST(..., 0) is a safety net; the WHERE clause is the real guard.
  const rowsAffected = await prisma.$executeRaw`
    UPDATE wallets
    SET    balance_inr = GREATEST(balance_inr - ${costInr}::numeric, 0),
           updated_at  = NOW()
    WHERE  user_id     = ${userId}
    AND    balance_inr >= ${costInr}::numeric
  `;

  if (rowsAffected === 0) {
    // Either wallet doesn't exist or balance was insufficient at deduction time
    const wallet = await prisma.wallet.findUnique({ where: { user_id: userId } });
    if (!wallet) throw new Error('Wallet not found');
    const err = new Error('Insufficient balance');
    err.status = 402;
    throw err;
  }
}

/**
 * Get top-up history for a user.
 * @param {string} userId
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getTopUpHistory(userId, limit = 20) {
  return prisma.topUp.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: limit,
    select: {
      id: true,
      amount: true,
      status: true,
      razorpay_order_id: true,
      razorpay_payment_id: true,
      created_at: true,
    },
  });
}

/**
 * Cancel a pending top-up order.
 * Only the owner can cancel their own pending order.
 * @param {string} userId
 * @param {string} topUpId
 * @returns {Promise<object>} updated TopUp record
 */
async function cancelTopUpOrder(userId, topUpId) {
  const topUp = await prisma.topUp.findFirst({
    where: { id: topUpId, user_id: userId, status: 'pending' },
  });

  if (!topUp) {
    const err = new Error('No pending top-up order found with that id');
    err.status = 404;
    throw err;
  }

  return prisma.topUp.update({
    where: { id: topUpId },
    data: { status: 'cancelled' },
  });
}

module.exports = {
  getWallet,
  createTopUpOrder,
  verifyAndCreditWallet,
  cancelTopUpOrder,
  deductBalance,
  getTopUpHistory,
};
