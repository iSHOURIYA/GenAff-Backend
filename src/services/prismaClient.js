const { PrismaClient } = require('@prisma/client');

// Prevent multiple Prisma Client instances in development (hot-reload)
let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global._prisma) {
    global._prisma = new PrismaClient({
      log: ['warn', 'error'],
    });
  }
  prisma = global._prisma;
}

module.exports = prisma;
