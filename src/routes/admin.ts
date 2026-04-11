import { Router, Request, Response } from 'express';
import { db } from '../services/db';

export const adminRouter = Router();

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const userId = (req as any).userId;
  const result = await db.query('SELECT is_admin FROM users WHERE id=$1', [userId]);

  if (!result.rows.length || !result.rows[0].is_admin) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }

  return true;
}

adminRouter.get('/stats', async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const users = await db.query('SELECT COUNT(*) as total FROM users');
    const paid = await db.query("SELECT COUNT(*) as total FROM users WHERE plan != 'free'");
    const revenue = await db.query('SELECT COALESCE(SUM(amount),0) as total FROM payments');
    const todayUse = await db.query(
      "SELECT COUNT(*) as total FROM usage_logs WHERE created_at > NOW() - INTERVAL '1 day'"
    );
    const planBreak = await db.query('SELECT plan, COUNT(*) as cnt FROM users GROUP BY plan');
    const recentPayments = await db.query(
      `SELECT p.id, p.plan, p.amount, p.payment_id, p.order_id, p.status, p.created_at,
              u.email, u.name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT 8`
    );
    const recentUsers = await db.query(
      `SELECT id, email, name, plan, is_admin, email_verified_at, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 8`
    );

    res.json({
      totalUsers: parseInt(users.rows[0].total, 10),
      paidUsers: parseInt(paid.rows[0].total, 10),
      revenueInPaise: parseInt(revenue.rows[0].total, 10),
      todayRequests: parseInt(todayUse.rows[0].total, 10),
      planBreakdown: planBreak.rows,
      recentPayments: recentPayments.rows,
      recentUsers: recentUsers.rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.get('/users', async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = String(req.query.q || '').trim();
  const planFilter = String(req.query.plan || '').trim();

  try {
    const where: string[] = [];
    const params: any[] = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
    }

    if (planFilter) {
      params.push(planFilter);
      where.push(`u.plan = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.query(
      `
      SELECT
        u.id,
        u.email,
        u.name,
        u.plan,
        u.is_admin,
        u.email_verified_at,
        u.created_at,
        u.updated_at,
        COALESCE(pay.total_paid_paise, 0) AS total_paid_paise,
        pay.last_payment_at,
        COALESCE(usage.requests_24h, 0) AS requests_24h
      FROM users u
      LEFT JOIN (
        SELECT user_id, SUM(amount) AS total_paid_paise, MAX(created_at) AS last_payment_at
        FROM payments
        GROUP BY user_id
      ) pay ON pay.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS requests_24h
        FROM usage_logs
        WHERE created_at > NOW() - INTERVAL '1 day'
        GROUP BY user_id
      ) usage ON usage.user_id = u.id
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    );

    const count = await db.query(
      `
      SELECT COUNT(*) as total
      FROM users u
      ${whereSql}
      `,
      params
    );

    res.json({
      users: rows.rows,
      total: parseInt(count.rows[0].total, 10),
      page,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.patch('/users/:id/plan', async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const { id } = req.params;
  const { plan } = req.body;

  try {
    await db.query('UPDATE users SET plan=$1 WHERE id=$2', [plan, id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.patch('/users/:id/admin', async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const { id } = req.params;
  const { isAdmin } = req.body;

  try {
    await db.query('UPDATE users SET is_admin=$1 WHERE id=$2', [Boolean(isAdmin), id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.get('/users/:id', async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const { id } = req.params;

  try {
    const user = await db.query(
      `SELECT id, email, name, plan, api_key, is_admin, email_verified_at, created_at, updated_at
       FROM users
       WHERE id=$1`,
      [id]
    );

    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    const payments = await db.query(
      `SELECT id, plan, amount, payment_id, order_id, status, created_at
       FROM payments
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    const usage = await db.query(
      `SELECT id, action, model,
              COALESCE(tokens_in, tokens, 0) AS tokens_in,
              COALESCE(tokens_out, 0) AS tokens_out,
              created_at
       FROM usage_logs
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    const summary = await db.query(
      `SELECT
        COUNT(*) AS total_requests,
        COALESCE(SUM(tokens_in), SUM(tokens), 0) AS tokens_in,
        COALESCE(SUM(tokens_out), 0) AS tokens_out,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') AS requests_24h
       FROM usage_logs
       WHERE user_id=$1`,
      [id]
    );

    res.json({
      user: user.rows[0],
      payments: payments.rows,
      usage: usage.rows,
      summary: {
        totalRequests: parseInt(summary.rows[0].total_requests, 10),
        tokensIn: parseInt(summary.rows[0].tokens_in, 10),
        tokensOut: parseInt(summary.rows[0].tokens_out, 10),
        requests24h: parseInt(summary.rows[0].requests_24h, 10),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.get('/payments', async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const limit = Math.min(parseInt(String(req.query.limit || '20'), 10), 100);

  try {
    const rows = await db.query(
      `SELECT p.id, p.plan, p.amount, p.payment_id, p.order_id, p.status, p.created_at,
              u.email, u.name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT $1`,
      [limit]
    );

    res.json({ payments: rows.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
