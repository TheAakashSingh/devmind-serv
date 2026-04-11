// Run this once to set up the database tables
// Usage: npx ts-node scripts/setup-db.ts

import { Pool } from 'pg';
import fs       from 'fs';
import path     from 'path';
import dotenv   from 'dotenv';

dotenv.config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log('Connecting to database...');

  const sql = fs.readFileSync(path.join(__dirname, '../migrate.sql'), 'utf-8');
  await pool.query(sql);

  console.log('Database setup complete!');
  await pool.end();
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
