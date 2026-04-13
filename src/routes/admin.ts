import { Router, Request, Response } from 'express';
import { db } from '../services/db';

export const adminRouter = Router();

// Middleware to check admin access
async function requireAdmin(req: Request, res: Response) {
  const userId = (req as any).userId;
  const check = await db.query('SELECT is_admin FROM users WHERE id=$1', [userId]);
  if (!check.rows[0]?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return null;
}

// ── GET /v1/admin/activity ───────────────────────────────────────────────
adminRouter.get('/activity', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
  const limit = parseInt(req.query.limit as string) || 50;
  const userId = req.query.userId as string;
  
  try {
    let query = `
      SELECT u.id, u.email, u.name, u.ip_address, u.last_login_at, u.created_at as joined_at,
        ul.action, ul.created_at as timestamp, ul.metadata
      FROM usage_logs ul
      JOIN users u ON ul.user_id = u.id
    `;
    const params: any[] = [limit];
    
    if (userId) {
      query += ` WHERE ul.user_id = $2`;
      params.push(userId);
    }
    
    query += ` ORDER BY ul.created_at DESC LIMIT $1`;
    
    const rows = await db.query(query, params);
    res.json({ activity: rows.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/ips ─────────────────────────────────────────────────
adminRouter.get('/ips', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
  try {
    const rows = await db.query(`
      SELECT u.id, u.email, u.name, u.ip_address, u.last_login_at,
        COUNT(ul.id) as request_count,
        MAX(ul.created_at) as last_request
      FROM users u
      LEFT JOIN usage_logs ul ON u.id = ul.user_id
      WHERE u.ip_address IS NOT NULL
      GROUP BY u.id, u.ip_address
      ORDER BY request_count DESC
      LIMIT 100
    `);
    res.json({ ips: rows.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/sessions ───────────────────────────────────────────────
adminRouter.get('/sessions', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
  try {
    const rows = await db.query(`
      SELECT u.id, u.email, u.name, 
        u.last_login_at, u.ip_address,
        COUNT(ul.id) as total_requests,
        MAX(ul.created_at) as last_activity
      FROM users u
      LEFT JOIN usage_logs ul ON u.id = ul.user_id
      WHERE u.email_verified_at IS NOT NULL
      GROUP BY u.id
      ORDER BY last_activity DESC
      LIMIT 50
    `);
    res.json({ sessions: rows.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/observability ───────────────────────────────────────────────
adminRouter.get('/observability', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  try {
    const [summary, byAction, errors] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)::int as total_requests,
          COALESCE(AVG(request_ms),0)::int as avg_latency_ms,
          COALESCE(MAX(request_ms),0)::int as max_latency_ms,
          COUNT(*) FILTER (WHERE status='error')::int as failed_requests
        FROM usage_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `),
      db.query(`
        SELECT action, COUNT(*)::int as cnt, COALESCE(AVG(request_ms),0)::int as avg_ms
        FROM usage_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY action ORDER BY cnt DESC LIMIT 20
      `),
      db.query(`
        SELECT action, error_message, created_at
        FROM usage_logs
        WHERE status='error'
        ORDER BY created_at DESC
        LIMIT 30
      `),
    ]);
    res.json({
      summary: summary.rows[0],
      byAction: byAction.rows,
      errors: errors.rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

adminRouter.get('/observability/live', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  try {
    const [last5m, fallback, risk] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::int as requests,
               COALESCE(AVG(request_ms),0)::int as avg_ms,
               COUNT(*) FILTER (WHERE status='error')::int as errors
        FROM usage_logs
        WHERE created_at > NOW() - INTERVAL '5 minutes'
      `),
      db.query(`
        SELECT COUNT(*)::int as fallback_count
        FROM usage_logs
        WHERE created_at > NOW() - INTERVAL '24 hours' AND used_fallback=true
      `),
      db.query(`
        SELECT COALESCE(risk_level,'unknown') as risk_level, COUNT(*)::int as cnt
        FROM usage_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY risk_level
        ORDER BY cnt DESC
      `),
    ]);
    res.json({
      last5m: last5m.rows[0],
      fallback: fallback.rows[0],
      risk: risk.rows,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/team-memory ────────────────────────────────────────────────
adminRouter.get('/team-memory', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  try {
    const rows = await db.query(
      `SELECT id, scope, policy_name, policy_text, is_active, status, priority, version, updated_by, created_at, updated_at
       FROM team_memory
       ORDER BY priority ASC, updated_at DESC
       LIMIT 100`
    );
    res.json({ items: rows.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/admin/team-memory ───────────────────────────────────────────────
adminRouter.post('/team-memory', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  const userId = (req as any).userId;
  const scope = String(req.body?.scope || 'global').slice(0, 32);
  const policyName = String(req.body?.policyName || '').trim().slice(0, 120);
  const policyText = String(req.body?.policyText || '').trim().slice(0, 12000);
  const status = String(req.body?.status || 'draft').slice(0, 20);
  const priority = Number(req.body?.priority ?? 100);
  if (!policyName || !policyText) return res.status(400).json({ error: 'policyName and policyText are required' });
  try {
    const row = await db.query(
      `INSERT INTO team_memory (scope, policy_name, policy_text, is_active, status, priority, version, updated_by, created_at, updated_at)
       VALUES ($1,$2,$3,true,$4,$5,1,$6,NOW(),NOW())
       RETURNING id, scope, policy_name, policy_text, is_active, status, priority, version, updated_by, created_at, updated_at`,
      [scope, policyName, policyText, status, Math.max(1, priority), userId]
    );
    res.json(row.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

adminRouter.patch('/team-memory/:id', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  const { id } = req.params;
  const updates: string[] = [];
  const values: any[] = [];
  if (typeof req.body?.status === 'string') {
    values.push(String(req.body.status).slice(0, 20));
    updates.push(`status=$${values.length}`);
  }
  if (typeof req.body?.isActive === 'boolean') {
    values.push(Boolean(req.body.isActive));
    updates.push(`is_active=$${values.length}`);
  }
  if (typeof req.body?.priority === 'number') {
    values.push(Math.max(1, Number(req.body.priority)));
    updates.push(`priority=$${values.length}`);
  }
  if (!updates.length) return res.status(400).json({ error: 'No updates provided' });
  values.push(id);
  try {
    const row = await db.query(
      `UPDATE team_memory SET ${updates.join(', ')}, version=version+1, updated_at=NOW() WHERE id=$${values.length}
       RETURNING id, scope, policy_name, policy_text, is_active, status, priority, version, updated_at`,
      values
    );
    res.json(row.rows[0] || null);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/payments ──────────────────────────────────────────────
adminRouter.get('/payments', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
  const limit = parseInt(req.query.limit as string) || 20;
  try {
    const rows = await db.query(
      `SELECT p.id, p.user_id, p.amount, p.currency, p.status, p.plan, p.payment_id, p.created_at, u.email, u.name
       FROM payments p
       LEFT JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ payments: rows.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/stats ───────────────────────────────────────────────────────
adminRouter.get('/stats', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
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
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
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
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
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

// ── GET /v1/admin/users/:id ────────────────────────────────────────────────
adminRouter.get('/users/:id', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
  const { id } = req.params;
  try {
    const user = await db.query(
      `SELECT id, email, name, plan, is_admin, api_key, email_verified_at, created_at
       FROM users WHERE id=$1`,
      [id]
    );
    if (!user.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const [summary, payments, usage] = await Promise.all([
      db.query(`SELECT COUNT(*) as totalRequests,
        COALESCE(SUM(CASE WHEN action IN ('chat','generate','fix','refactor','explain','complete','scaffold') THEN 1 ELSE 0 END),0) as tokensIn,
        COALESCE(SUM(CASE WHEN action IN ('chat','generate','fix','refactor','explain','complete','scaffold') THEN 1 ELSE 0 END),0) as tokensOut,
        (SELECT COUNT(*) FROM usage_logs WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 day') as requests24h
        FROM usage_logs WHERE user_id=$1`, [id]),
      db.query(`SELECT id, amount, currency, status, plan, payment_id, created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      db.query(`SELECT action, COUNT(*) as cnt, DATE_TRUNC('day', created_at)::date as day FROM usage_logs WHERE user_id=$1 GROUP BY action, day ORDER BY day DESC LIMIT 100`, [id]),
    ]);
    
    res.json({
      user: user.rows[0],
      summary: {
        totalRequests: parseInt(summary.rows[0].totalRequests) || 0,
        tokensIn: parseInt(summary.rows[0].tokensIn) || 0,
        tokensOut: parseInt(summary.rows[0].tokensOut) || 0,
        requests24h: parseInt(summary.rows[0].requests24h) || 0,
      },
      payments: payments.rows,
      usage: usage.rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/admin/users/:id/usage ─────────────────────────────────────────────
adminRouter.get('/users/:id/usage', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
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
adminRouter.get('/revenue', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
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

// ── PATCH /v1/admin/users/:id/admin ───────────────────────────────────────────
adminRouter.patch('/users/:id/admin', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
  const { id } = req.params;
  const { isAdmin } = req.body;
  try {
    await db.query('UPDATE users SET is_admin=$1, updated_at=NOW() WHERE id=$2', [isAdmin ? true : false, id]);
    res.json({ success: true, is_admin: isAdmin });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /v1/admin/users/:id ────────────────────────────────────────────────
adminRouter.delete('/users/:id', async (req: Request, res: Response) => {
  const adminCheck = await requireAdmin(req, res);
  if (adminCheck) return;
  
  const { id } = req.params;
  try {
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
