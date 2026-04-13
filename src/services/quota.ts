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
  await incrementUsageDetailed(userId, {
    action,
    model: null,
    tokensIn: tokens,
    tokensOut: 0,
    requestMs: 0,
    status: 'ok',
    usedFallback: false,
    errorMessage: null,
  });
}

export async function incrementUsageDetailed(
  userId: string,
  input: {
    action: string;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
    requestMs: number;
    status: 'ok' | 'error';
    usedFallback: boolean;
    errorMessage: string | null;
  }
) {
  await db.query(
    `INSERT INTO usage_logs (user_id, action, model, tokens, tokens_in, tokens_out, request_ms, status, used_fallback, error_message, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    [
      userId,
      input.action,
      input.model,
      Math.max(0, (input.tokensIn || 0) + (input.tokensOut || 0)),
      input.tokensIn || 0,
      input.tokensOut || 0,
      input.requestMs || 0,
      input.status || 'ok',
      Boolean(input.usedFallback),
      input.errorMessage || null,
    ]
  );
}
