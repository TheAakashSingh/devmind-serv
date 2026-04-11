-- DevMind AI — PostgreSQL Database Migration
-- Run this once to set up all tables, indexes, and seed data

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT,
  api_key    TEXT UNIQUE NOT NULL,
  plan       TEXT DEFAULT 'free' CHECK (plan IN ('free','solo','pro','team')),
  is_admin   BOOLEAN DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_otps (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT,
  otp_hash    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Usage logs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL DEFAULT 'api',
  model      TEXT,
  tokens_in  INT  DEFAULT 0,
  tokens_out INT  DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payments ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL,
  order_id   TEXT NOT NULL,
  payment_id TEXT UNIQUE,
  amount     INT  NOT NULL,
  currency   TEXT DEFAULT 'INR',
  status     TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_usage_user_date  ON usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_created    ON usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_apikey     ON users(api_key);
CREATE INDEX IF NOT EXISTS idx_payments_user    ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_otps_email  ON auth_otps(email, created_at DESC);

-- ── Auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Views (handy for admin) ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_usage AS
  SELECT
    user_id,
    DATE(created_at) AS day,
    COUNT(*)         AS requests,
    SUM(tokens_in + tokens_out) AS total_tokens
  FROM usage_logs
  GROUP BY user_id, DATE(created_at);

CREATE OR REPLACE VIEW plan_summary AS
  SELECT plan, COUNT(*) AS user_count
  FROM users
  GROUP BY plan;

SELECT 'DevMind DB migration complete!' AS status;
