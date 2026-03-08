// Test environment setup
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/genaff_test";
process.env.REDIS_URL = "redis://localhost:6379/1";
process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-for-tests";
process.env.JWT_EXPIRES_IN = "1d";
process.env.EXCHANGE_RATE_USD_TO_INR = "83.5";
process.env.DEFAULT_FREE_UNITS = "100";
process.env.FREE_UNIT_MODE = "request";
process.env.FRONTEND_URL = "http://localhost:3001";
process.env.BACKEND_URL = "http://localhost:3000";
