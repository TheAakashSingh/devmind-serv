import { Router, Request, Response } from 'express';
import { db } from '../services/db';

export const adminRouter = Router();

// ── GET /v1/admin/stats ───────────────────────────────────────────────────────
adminRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [users, paid, revenue, todayUse, planBreak, featureBreak, dailyActive] = await Promise.all([
      db.query('SELECT COUNT(*) as total FROM users'),
      db.query("SELECT COUNT(*) as total FROM users WHERE plan != 'free'"),
      db.query('SELECT COALESCE(SUM(amount),0) as total FROM payments'),
      db.query("SELECT COUNT(*) as total FROM usage_logs WHERE created_at > NOW() - INTERVAL '1 day'"),
      db.query("SELECT plan, COUNT(*) as cnt FROM users GROUP BY plan ORDER BY cnt DESC"),
      db.query(`
        SELECT action, COUNT(*) as cnt
        FROM usage_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY action ORDER BY cnt DESC LIMIT 10
      `),
      db.query(`
        SELECT DATE_TRUNC('day', created_at)::date as day, COUNT(DISTINCT user_id) as users
        FROM usage_logs
        WHERE created_at > NOW() - INTERVAL '14 days'
        GROUP BY day ORDER BY day
      `),
    ]);

    res.json({
      totalUsers:     parseInt(users.rows[0].total),
      paidUsers:      parseInt(paid.rows[0].total),
      revenueInPaise: parseInt(revenue.rows[0].total),
      todayRequests:  parseInt(todayUse.rows[0].total),
      planBreakdown:  planBreak.rows,
      featureUsage:   featureBreak.rows,
      dailyActive:    dailyActive.rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/users ───────────────────────────────────────────────────────
adminRouter.get('/users', async (req: Request, res: Response) => {
  const page  = parseInt((req.query.page as string) || '1');
  const limit = 20;
  const off   = (page - 1) * limit;
  const q     = (req.query.q as string) || '';
  try {
    const whereClause = q ? `WHERE email ILIKE $3 OR name ILIKE $3` : '';
    const params: any[] = [limit, off];
    if (q) { params.push(`%${q}%`); }

    const [rows, count] = await Promise.all([
      db.query(
        `SELECT id, email, name, plan, created_at, email_verified_at
         FROM users ${whereClause}
         ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        params
      ),
      db.query(`SELECT COUNT(*) as total FROM users ${q ? 'WHERE email ILIKE $1 OR name ILIKE $1' : ''}`,
        q ? [`%${q}%`] : []
      ),
    ]);
    res.json({ users: rows.rows, total: parseInt(count.rows[0].total), page });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /v1/admin/users/:id/plan ───────────────────────────────────────────
adminRouter.patch('/users/:id/plan', async (req: Request, res: Response) => {
  const { id }   = req.params;
  const { plan } = req.body;
  const valid = ['free','solo','pro','team','enterprise'];
  if (!valid.includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  try {
    await db.query('UPDATE users SET plan=$1, updated_at=NOW() WHERE id=$2', [plan, id]);
    res.json({ success: true, plan });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/users/:id/usage ─────────────────────────────────────────────
adminRouter.get('/users/:id/usage', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rows = await db.query(
      `SELECT action, COUNT(*) as cnt, DATE_TRUNC('day', created_at)::date as day
       FROM usage_logs WHERE user_id=$1
       GROUP BY action, day ORDER BY day DESC LIMIT 100`,
      [id]
    );
    res.json(rows.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/revenue ─────────────────────────────────────────────────────
adminRouter.get('/revenue', async (_req: Request, res: Response) => {
  try {
    const rows = await db.query(
      `SELECT plan, amount, created_at FROM payments ORDER BY created_at DESC LIMIT 50`
    );
    const byPlan = await db.query(
      `SELECT plan, COUNT(*) as cnt, SUM(amount) as total FROM payments GROUP BY plan`
    );
    res.json({ recent: rows.rows, byPlan: byPlan.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /v1/admin/users/:id ────────────────────────────────────────────────
adminRouter.delete('/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  // Only superadmin can delete — check is_admin
  const requesterId = (req as any).userId;
  try {
    const check = await db.query('SELECT is_admin FROM users WHERE id=$1', [requesterId]);
    if (!check.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
