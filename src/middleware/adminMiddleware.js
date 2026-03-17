const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Middleware: verify user is authenticated and has ADMIN role.
 * Must be used after authMiddleware.
 * Returns 403 if user is not an admin.
 */
async function adminMiddleware(req, res, next) {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized. Please authenticate first.' });
    }

    // Fetch user from database to check role
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, role: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check if user is admin
    if (user.role !== 'ADMIN') {
      return res.status(403).json({ 
        error: 'Forbidden. Admin access required.',
        userEmail: user.email 
      });
    }

    // Attach user info to request
    req.user = { ...req.user, ...user };
    next();
  } catch (err) {
    console.error('Admin middleware error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = adminMiddleware;
