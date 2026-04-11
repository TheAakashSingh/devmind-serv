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

const PLANS: Record<string, { amount: number; name: string }> = {
  solo: { amount: 49900, name: 'DevMind Solo' },
  pro:  { amount: 99900, name: 'DevMind Pro'  },
  team: { amount: 79900, name: 'DevMind Team' },
};

// ── POST /v1/billing/create-order ─────────────────────────────────────────────
billingRouter.post('/create-order', async (req: Request, res: Response) => {
  const { plan } = req.body;
  const userId   = (req as any).userId;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  try {
    const razorpay = getRazorpay();
    const order    = await razorpay.orders.create({
      amount:   PLANS[plan].amount,
      currency: 'INR',
      notes:    { userId, plan },
    });
    res.json({ orderId: order.id, amount: PLANS[plan].amount, currency: 'INR', plan });
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
  } = req.body;
  const userId = (req as any).userId;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  // Verify signature
  const secret   = process.env.RAZORPAY_KEY_SECRET || '';
  const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Invalid payment signature — possible fraud attempt' });
  }

  try {
    await db.query('UPDATE users SET plan=$1 WHERE id=$2', [plan, userId]);
    await db.query(
      `INSERT INTO payments (user_id, plan, order_id, payment_id, amount, currency, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [userId, plan, razorpay_order_id, razorpay_payment_id, PLANS[plan].amount, 'INR', 'completed']
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
      'SELECT plan, amount, payment_id, created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(rows.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
