/**
 * Seed script for DevMind AI.
 * Run with: npm run seed
 *
 * Creates the current backend schema if needed and inserts deterministic
 * demo data for admin, billing, and usage flows.
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const ADMIN_USER = {
  id: 'seed-admin-user',
  email: 'aakashskilldevelopment@gmail.com',
  name: 'Aakash Singh',
  apiKey: 'devmind_seed_admin_key',
  plan: 'pro',
  isAdmin: true,
};

const SAMPLE_USER = {
  id: 'seed-sample-user',
  email: 'test@gmail.com',
  name: 'Test User',
  apiKey: 'devmind_seed_sample_key',
  plan: 'free',
  isAdmin: false,
};

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      api_key TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'free',
      is_admin BOOLEAN DEFAULT false,
      email_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS auth_otps (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INT DEFAULT 0,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL DEFAULT 'api',
      model TEXT,
      tokens INT DEFAULT 0,
      tokens_in INT DEFAULT 0,
      tokens_out INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      order_id TEXT NOT NULL,
      payment_id TEXT UNIQUE,
      amount INT NOT NULL,
      currency TEXT DEFAULT 'INR',
      status TEXT DEFAULT 'completed',
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
    CREATE INDEX IF NOT EXISTS idx_users_apikey ON users(api_key);
    CREATE INDEX IF NOT EXISTS idx_auth_otps_email ON auth_otps(email, created_at DESC);
  `);
}

async function upsertUser(user: typeof ADMIN_USER | typeof SAMPLE_USER) {
  await db.query(
    `
    INSERT INTO users (id, email, name, api_key, plan, is_admin, email_verified_at, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      id = EXCLUDED.id,
      name = EXCLUDED.name,
      api_key = EXCLUDED.api_key,
      plan = EXCLUDED.plan,
      is_admin = EXCLUDED.is_admin,
      email_verified_at = COALESCE(users.email_verified_at, NOW()),
      updated_at = NOW()
    `,
    [user.id, user.email, user.name, user.apiKey, user.plan, user.isAdmin]
  );
}

async function seedUsageAndPayments() {
  await db.query(
    `DELETE FROM usage_logs WHERE action = 'seed' AND user_id IN ($1, $2)`,
    [ADMIN_USER.id, SAMPLE_USER.id]
  );
  await db.query(`DELETE FROM payments WHERE payment_id IN ($1, $2)`, [
    'seed_payment_admin_001',
    'seed_payment_sample_001',
  ]);

  await db.query(
    `
    INSERT INTO usage_logs (user_id, action, model, tokens, tokens_in, tokens_out, created_at)
    VALUES
      ($1, 'seed', 'devmind-chat', 420, 260, 160, NOW() - INTERVAL '2 days'),
      ($1, 'seed', 'devmind-chat', 220, 140, 80, NOW() - INTERVAL '1 day'),
      ($2, 'seed', 'devmind-coder', 80, 50, 30, NOW() - INTERVAL '3 hours')
    `,
    [ADMIN_USER.id, SAMPLE_USER.id]
  );

  await db.query(
    `
    INSERT INTO payments (user_id, plan, order_id, payment_id, amount, currency, status, created_at)
    VALUES
      ($1, 'pro', 'seed_order_admin_001', 'seed_payment_admin_001', 99900, 'INR', 'completed', NOW() - INTERVAL '8 days'),
      ($2, 'free', 'seed_order_sample_001', 'seed_payment_sample_001', 0, 'INR', 'completed', NOW() - INTERVAL '12 days')
    `,
    [ADMIN_USER.id, SAMPLE_USER.id]
  );
}

async function seed() {
  console.log('Seeding DevMind AI database...');

  await ensureSchema();
  await upsertUser(ADMIN_USER);
  await upsertUser(SAMPLE_USER);
  await seedUsageAndPayments();

  console.log('Seed complete.');
  console.log(`Admin: ${ADMIN_USER.email} | api_key=${ADMIN_USER.apiKey} | plan=${ADMIN_USER.plan}`);
  console.log(`Sample: ${SAMPLE_USER.email} | api_key=${SAMPLE_USER.apiKey} | plan=${SAMPLE_USER.plan}`);

  await db.end();
}

seed().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => undefined);
  process.exit(1);
});
