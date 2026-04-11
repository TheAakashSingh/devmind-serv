import { Pool } from 'pg';

export const db = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      name       TEXT,
      api_key    TEXT UNIQUE NOT NULL,
      plan       TEXT DEFAULT 'free',
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

    CREATE TABLE IF NOT EXISTS usage_logs (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
      action     TEXT NOT NULL DEFAULT 'api',
      model      TEXT,
      tokens     INT DEFAULT 0,
      tokens_in  INT DEFAULT 0,
      tokens_out INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
      plan       TEXT NOT NULL,
      order_id   TEXT NOT NULL,
      payment_id TEXT UNIQUE,
      amount     INT NOT NULL,
      currency   TEXT DEFAULT 'INR',
      status     TEXT DEFAULT 'completed',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE auth_otps ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;
    ALTER TABLE auth_otps ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
    ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS model TEXT;
    ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens INT DEFAULT 0;
    ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens_in INT DEFAULT 0;
    ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens_out INT DEFAULT 0;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

    CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_users_apikey    ON users(api_key);
    CREATE INDEX IF NOT EXISTS idx_auth_otps_email ON auth_otps(email, created_at DESC);
  `);

  console.log('[DB] Tables ready');
}
