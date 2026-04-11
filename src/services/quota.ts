import { db } from './db';

const LIMITS: Record<string, number> = {
  free: 20,
  solo: 100,
  pro:  500,
  team: 2000,
};

export async function checkQuota(userId: string): Promise<boolean> {
  const userRow = await db.query('SELECT plan FROM users WHERE id=$1', [userId]);
  if (!userRow.rows.length) return false;

  const plan  = userRow.rows[0].plan;
  const limit = LIMITS[plan] ?? LIMITS.free;

  const usageRow = await db.query(
    "SELECT COUNT(*) as cnt FROM usage_logs WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 day'",
    [userId]
  );
  const used = parseInt(usageRow.rows[0].cnt, 10);
  return used < limit;
}

export async function incrementUsage(userId: string, action = 'api', tokens = 0) {
  await db.query(
    `INSERT INTO usage_logs (user_id, action, model, tokens, tokens_in, tokens_out, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    [userId, action, null, tokens, tokens, 0]
  );
}
