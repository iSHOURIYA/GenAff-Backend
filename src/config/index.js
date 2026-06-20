/**
 * GenAff – Central Configuration
 *
 * Single source of truth for all environment-derived values.
 * The server REFUSES to start if any critical variable is missing.
 * This prevents silent failures caused by forgotten env vars (e.g.,
 * magic links pointing to a dead domain).
 *
 * Usage: const config = require('./config');
 *          config.frontendUrl
 *
 * ── On Domain Loss ──
 * Only change these 4 lines in .env:
 *   FRONTEND_URL   = https://genaff.shouriya.tech
 *   API_DOMAIN     = genaff-api.shouriya.tech
 *   SUPPORT_EMAIL  = support@genaff.shouriya.tech
 *   FROM_EMAIL     = noreply@genaff.shouriya.tech
 * Then run: ./deploy.sh
 */

require('dotenv').config();

// ── Helpers ──────────────────────────────────────────────────────────

function getEnv(key, required = true) {
  const value = process.env[key];
  if (required && (!value || value.trim() === '')) {
    throw new Error(
      `[Config] Missing required environment variable: ${key}\n` +
        'The server cannot start safely without this value.\n' +
        'Please check your .env file.'
    );
  }
  return value || '';
}

function getInt(key, fallback) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getBool(key, fallback = false) {
  const raw = (process.env[key] || '').toLowerCase().trim();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return fallback;
}

function getUrl(key, required = true) {
  const raw = getEnv(key, required);
  if (!raw) return '';
  // Ensure it starts with https:// in production
  if (process.env.NODE_ENV === 'production' && !raw.startsWith('https://')) {
    console.warn(`[Config] ${key} should use https:// in production (got ${raw})`);
  }
  return raw;
}

// ── Critical: always required ────────────────────────────────────────

const DATABASE_URL = getEnv('DATABASE_URL', true);
const JWT_SECRET = getEnv('JWT_SECRET', true);
const FRONTEND_URL = getUrl('FRONTEND_URL', true);
const API_DOMAIN = getEnv('API_DOMAIN', true);

// Build explicit API URL from domain
const API_URL = (() => {
  if (API_DOMAIN.startsWith('http')) return API_DOMAIN;
  return `https://${API_DOMAIN}`;
})();

// ── Billing / Branding (soft-fail with warnings) ─────────────────────

const COMPANY_NAME = getEnv('BILLING_COMPANY_NAME', false) || 'GenAff';
const BILLING_COMPANY_WEBSITE = getEnv('BILLING_COMPANY_WEBSITE', false) || FRONTEND_URL;
const SUPPORT_EMAIL = getEnv('SUPPORT_EMAIL', false) || `support@${API_DOMAIN}`;
const FROM_EMAIL = getEnv('FROM_EMAIL', false) || `noreply@${API_DOMAIN}`;
const BILLING_SIGNATORY_NAME = getEnv('BILLING_SIGNATORY_NAME', false) || 'Ishouriya';

// ── Server ───────────────────────────────────────────────────────────

const PORT = getInt('PORT', 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── AI Provider Keys (at least one required operationally) ───────────

const OPENAI_API_KEY = getEnv('OPENAI_API_KEY', false);
const DEEPSEEK_API_KEY = getEnv('DEEPSEEK_API_KEY', false);
const GEMINI_API_KEY = getEnv('GEMINI_API_KEY', false);
const NVIDIA_API_KEY = getEnv('NVIDIA_API_KEY', false);

// ── Razorpay (required for payments) ─────────────────────────────────

const RAZORPAY_KEY_ID = getEnv('RAZORPAY_KEY_ID', false);
const RAZORPAY_KEY_SECRET = getEnv('RAZORPAY_KEY_SECRET', false);

// ── Resend Email ─────────────────────────────────────────────────────

const RESEND_API_KEY = getEnv('RESEND_API_KEY', false);
const RESEND_FROM_EMAIL = getEnv('RESEND_FROM_EMAIL', false) || FROM_EMAIL;

// ── Rate Limiting ────────────────────────────────────────────────────

const RATE_LIMIT_RPM = getInt('RATE_LIMIT_RPM', 20);

// ── Top-up ───────────────────────────────────────────────────────────

const MIN_TOPUP_INR = getInt('MIN_TOPUP_INR', 10);

// ── OTP ──────────────────────────────────────────────────────────────

const OTP_EXPIRY_MINUTES = getInt('OTP_EXPIRY_MINUTES', 15);

// ── Health Check (optimized defaults) ────────────────────────────────

const HEALTH_CHECK_ENABLED = getBool('HEALTH_CHECK_ENABLED', true);
const HEALTH_CHECK_INTERVAL_MS = getInt(
  'HEALTH_CHECK_INTERVAL_MS',
  6 * 60 * 60 * 1000 // 6 hours (passive-first)
);
const HEALTH_CHECK_TIMEOUT_MS = getInt('HEALTH_CHECK_TIMEOUT_MS', 8000);
const HEALTH_CHECK_STALE_AFTER_MS = getInt(
  'HEALTH_CHECK_STALE_AFTER_MS',
  2 * HEALTH_CHECK_INTERVAL_MS
);
const HEALTH_CHECK_MIN_GAP_MS = getInt('HEALTH_CHECK_MIN_GAP_MS', 60000);
const HEALTH_CHECK_BASE_BACKOFF_MS = getInt(
  'HEALTH_CHECK_BASE_BACKOFF_MS',
  15 * 60 * 1000
);
const HEALTH_CHECK_MAX_BACKOFF_MS = getInt(
  'HEALTH_CHECK_MAX_BACKOFF_MS',
  4 * 60 * 60 * 1000
);
const HEALTH_CHECK_MAX_PROBES_PER_CYCLE = getInt(
  'HEALTH_CHECK_MAX_PROBES_PER_CYCLE',
  4 // canaries only
);
const HEALTH_CHECK_PROMPT = process.env.HEALTH_CHECK_PROMPT || 'ping';

// Optional: admin can override which models to serve
const LIVE_MODELS_OVERRIDE = (process.env.LIVE_MODELS_OVERRIDE || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

// ── Extra disposable domains (comma-separated) ───────────────────────

const EXTRA_DISPOSABLE_DOMAINS = (process.env.DISPOSABLE_EMAIL_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// ── JWT ──────────────────────────────────────────────────────────────

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ── Export ───────────────────────────────────────────────────────────

module.exports = {
  // Critical
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  FRONTEND_URL,
  API_DOMAIN,
  API_URL,

  // Server
  PORT,
  NODE_ENV,

  // AI Providers
  OPENAI_API_KEY,
  DEEPSEEK_API_KEY,
  GEMINI_API_KEY,
  NVIDIA_API_KEY,

  // Payments
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,

  // Email
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  FROM_EMAIL,
  COMPANY_NAME,
  SUPPORT_EMAIL,

  // Billing / Branding
  BILLING_COMPANY_NAME: COMPANY_NAME,
  BILLING_COMPANY_WEBSITE,
  BILLING_SUPPORT_EMAIL: SUPPORT_EMAIL,
  BILLING_SIGNATORY_NAME,

  // Limits
  RATE_LIMIT_RPM,
  MIN_TOPUP_INR,
  OTP_EXPIRY_MINUTES,

  // Health Check
  HEALTH_CHECK_ENABLED,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_STALE_AFTER_MS,
  HEALTH_CHECK_MIN_GAP_MS,
  HEALTH_CHECK_BASE_BACKOFF_MS,
  HEALTH_CHECK_MAX_BACKOFF_MS,
  HEALTH_CHECK_MAX_PROBES_PER_CYCLE,
  HEALTH_CHECK_PROMPT,
  LIVE_MODELS_OVERRIDE,

  // Misc
  EXTRA_DISPOSABLE_DOMAINS,
};
