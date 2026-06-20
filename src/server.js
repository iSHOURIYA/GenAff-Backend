/**
 * GenAff Backend – Main Server Entry Point
 *
 * Start for development : npm run dev
 * Start for production  : npm start
 */

require('dotenv').config();

const config = require('./config');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// ── Routes & Services ────────────────────────────────────────────────
const authRoutes   = require('./routes/auth');
const keyRoutes    = require('./routes/keys');
const walletRoutes = require('./routes/wallet');
const adminRoutes  = require('./routes/admin');
const proxyRoutes  = require('./routes/proxy');
const { startHealthCheckSchedule } = require('./services/modelHealthCheckService');
const playgroundRoutes = require('./routes/playground');
const { startPlaygroundCleanupSchedule } = require('./services/playgroundService');

// ── App Setup ─────────────────────────────────────────────────────────
const app = express();

// Trust proxy headers (needed when behind nginx on VPS)
app.set('trust proxy', 1);

// ── Security Headers (helmet) ─────────────────────────────────────────
app.use(helmet({
  // API-only server — disable browser-only protections that would
  // add noise to JSON responses or break CORS preflight.
  contentSecurityPolicy: false,   // no HTML served
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────
const allowedOrigins = [
  config.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173', // Vite dev server
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS policy: origin "${origin}" is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Body Parser ───────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Health Check ──────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'GenAff API Gateway',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  });
});

// ── API Routes ────────────────────────────────────────────────────────
app.use('/auth',   authRoutes);
app.use('/keys',   keyRoutes);
app.use('/wallet', walletRoutes);
app.use('/admin',  adminRoutes);
app.use('/v1',     proxyRoutes);
app.use('/playground', playgroundRoutes);

// ── 404 Handler ───────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global Error Handler ──────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[GlobalErrorHandler]', err);
  const status = err.status || 500;
  const message = err.expose ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
});

// ── Start Server ──────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, () => {
  console.log(`\n🚀  GenAff API Gateway running on port ${PORT}`);
  console.log(`    ENV  : ${process.env.NODE_ENV || 'development'}`);
  console.log(`    URL  : http://localhost:${PORT}`);
  console.log(`    Health: http://localhost:${PORT}/health\n`);

  // Start model health checks (runs in background)
  startHealthCheckSchedule();
  // Start playground cleanup schedule (deactivates expired temporary keys/sessions)
  startPlaygroundCleanupSchedule();
});

module.exports = app; // export for testing
