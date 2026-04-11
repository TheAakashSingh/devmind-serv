/**
 * Seed script — creates an admin user for testing
 * Run: npx ts-node scripts/seed.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  console.log('🌱 Seeding database...');

  // Create tables first
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      name TEXT, api_key TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'free', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS usage_logs (
      id SERIAL PRIMARY KEY, user_id TEXT REFERENCES users(id),
      action TEXT, tokens INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY, user_id TEXT REFERENCES users(id),
      plan TEXT, order_id TEXT, payment_id TEXT,
      amount INT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_users_apikey ON users(api_key);
  `);

  // Admin test user
  const adminId  = uuid();
  const adminKey = 'dm_admin_testkey_' + Math.random().toString(36).slice(2, 10);
  await db.query(`
    INSERT INTO users (id, email, name, api_key, plan)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (email) DO NOTHING
  `, [adminId, 'admin@devmind.in', 'Admin', adminKey, 'pro']);

  // Regular test user
  const userId  = uuid();
  const userKey = 'dm_free_testkey_' + Math.random().toString(36).slice(2, 10);
  await db.query(`
    INSERT INTO users (id, email, name, api_key, plan)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (email) DO NOTHING
  `, [userId, 'test@devmind.in', 'Test User', userKey, 'free']);

  console.log('\n✅ Seed complete!\n');
  console.log('Admin user:');
  console.log('  Email  :', 'admin@devmind.in');
  console.log('  API Key:', adminKey);
  console.log('  Plan   : pro\n');
  console.log('Free user:');
  console.log('  Email  :', 'test@devmind.in');
  console.log('  API Key:', userKey);
  console.log('  Plan   : free\n');

  await db.end();
}

seed().catch(e => { console.error(e); process.exit(1); });
