import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db  } from '../services/db';

export const billingRouter = Router();

// ── Razorpay loaded lazily after dotenv runs ──────────────────────────────────
function getRazorpay() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Razorpay = require('razorpay');
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID     || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '',
  });
}

const PLANS: Record<string, { inr: number; usd: number; name: string }> = {
  solo: { inr: 49900, usd: 900,  name: 'DevMind Solo' },
  pro:  { inr: 99900, usd: 1900, name: 'DevMind Pro'  },
  team: { inr: 79900, usd: 1500, name: 'DevMind Team' },
};

billingRouter.get('/catalog', (_req: Request, res: Response) => {
  res.json({
    currencies: ['INR', 'USD'],
    plans: Object.entries(PLANS).map(([id, p]) => ({
      id,
      name: p.name,
      prices: { INR: p.inr, USD: p.usd },
    })),
  });
});

// ── POST /v1/billing/create-order ─────────────────────────────────────────────
billingRouter.post('/create-order', async (req: Request, res: Response) => {
  const { plan } = req.body;
  const currency = String(req.body?.currency || 'INR').toUpperCase();
  const userId   = (req as any).userId;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!['INR', 'USD'].includes(currency)) return res.status(400).json({ error: 'Invalid currency' });
  const amount = currency === 'USD' ? PLANS[plan].usd : PLANS[plan].inr;

  try {
    const razorpay = getRazorpay();
    const order    = await razorpay.orders.create({
      amount,
      currency,
      notes:    { userId, plan, currency },
    });
    res.json({ orderId: order.id, amount, currency, plan });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/billing/verify ───────────────────────────────────────────────────
billingRouter.post('/verify', async (req: Request, res: Response) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    plan,
    currency,
  } = req.body;
  const userId = (req as any).userId;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }
  const cc = String(currency || 'INR').toUpperCase();
  if (!['INR', 'USD'].includes(cc)) return res.status(400).json({ error: 'Invalid currency' });
  const amount = cc === 'USD' ? PLANS[plan].usd : PLANS[plan].inr;

  // Verify signature
  const secret   = process.env.RAZORPAY_KEY_SECRET || '';
  const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Invalid payment signature — possible fraud attempt' });
  }

  try {
    const existing = await db.query(
      'SELECT id, status FROM payments WHERE order_id=$1 LIMIT 1',
      [razorpay_order_id]
    );
    if (existing.rows.length && existing.rows[0].status === 'completed') {
      return res.json({ success: true, plan, alreadyVerified: true });
    }
    await db.query('UPDATE users SET plan=$1, updated_at=NOW() WHERE id=$2', [plan, userId]);
    await db.query(
      `INSERT INTO payments (user_id, plan, order_id, payment_id, amount, currency, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [userId, plan, razorpay_order_id, razorpay_payment_id, amount, cc, 'completed']
    );
    res.json({ success: true, plan });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/billing/history ───────────────────────────────────────────────────
billingRouter.get('/history', async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  try {
    const rows = await db.query(
      'SELECT plan, amount, currency, payment_id, created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(rows.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
