import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';

// Load env FIRST before anything else imports process.env
dotenv.config();

import { aiRouter }      from './routes/ai';
import { authRouter }    from './routes/auth';
import { billingRouter } from './routes/billing';
import { adminRouter }   from './routes/admin';
import { rateLimiter }   from './middleware/rateLimiter';
import { authenticate }  from './middleware/authenticate';
import { initDb }        from './services/db';

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(rateLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/v1/auth',    authRouter);
app.use('/v1/billing', authenticate, billingRouter);
app.use('/v1/admin',   authenticate, adminRouter);
app.use('/v1',         authenticate, aiRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', ts: Date.now(), env: process.env.NODE_ENV })
);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start: init DB tables THEN listen ────────────────────────────────────────
async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`\n🚀 DevMind server running on http://localhost:${PORT}`);
      console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   DeepSeek key: ${process.env.DEEPSEEK_API_KEY ? '✓ set' : '✗ MISSING — set in .env'}`);
      console.log(`   Database    : ${process.env.DATABASE_URL ? '✓ set' : '✗ MISSING'}\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
export default app;
