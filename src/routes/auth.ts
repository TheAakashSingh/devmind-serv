import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import jwt from 'jsonwebtoken';
import { db } from '../services/db';
import { authenticate } from '../middleware/authenticate';

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const OTP_SECRET = process.env.OTP_SECRET || JWT_SECRET;
const OTP_TTL_MINUTES = 10;
const OTP_ATTEMPT_LIMIT = 5;

function isGmailEmail(email: string) {
  return /^[^\s@]+@gmail\.com$/i.test(email.trim());
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(email: string, otp: string) {
  return crypto
    .createHash('sha256')
    .update(`${normalizeEmail(email)}:${otp}:${OTP_SECRET}`)
    .digest('hex');
}

function createApiKey() {
  return 'dm_' + crypto.randomBytes(24).toString('hex');
}

type MailTheme = {
  accent: string;
  accentSoft: string;
  title: string;
  subtitle: string;
  ctaText: string;
};

const COMPANY_NAME = 'SinghJitech';
const PRODUCT_NAME = 'DevMind AI';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMailTemplate(options: {
  theme: MailTheme;
  preheader: string;
  headline: string;
  body: string;
  brandLine?: string;
  logoUrl?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
  code?: string;
  codeCaption?: string;
  steps?: string[];
}) {
  const {
    theme,
    preheader,
    headline,
    body,
    brandLine,
    logoUrl,
    ctaLabel,
    ctaUrl,
    footerNote,
    code,
    codeCaption,
    steps = [],
  } = options;

  const safeHeadline = escapeHtml(headline);
  const safeBody = body;
  const safeCode = code ? escapeHtml(code) : '';
  const safeCodeCaption = codeCaption ? escapeHtml(codeCaption) : 'Verification code';
  const safeSteps = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="DevMind AI" width="50" height="50" style="display:block;border-radius:16px;object-fit:cover;box-shadow:0 14px 32px rgba(96,165,250,.22), 0 10px 18px rgba(168,85,247,.18);" />`
    : `<div style="width:50px;height:50px;border-radius:16px;background:linear-gradient(135deg, ${theme.accent}, ${theme.accentSoft});display:grid;place-items:center;color:#06101b;font-weight:900;">DM</div>`;
  const cta = ctaLabel && ctaUrl
    ? `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:${theme.accent};color:#08111f;text-decoration:none;font-weight:800;font-size:14px">${escapeHtml(ctaLabel)}</a>`
    : '';
  const safeBrandLine = escapeHtml(brandLine || `${COMPANY_NAME} presents ${PRODUCT_NAME}`);

  return `<!DOCTYPE html>
  <html lang="en">
  <body style="margin:0;padding:0;background:#06101b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
    <div style="padding:32px 16px;background:
      radial-gradient(circle at top left, rgba(56,189,248,.18), transparent 30%),
      radial-gradient(circle at top right, rgba(244,114,182,.14), transparent 24%),
      linear-gradient(180deg, #07111f 0%, #060d16 100%);">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;border-collapse:separate;">
        <tr>
          <td style="padding:0 0 18px 0;font-family:Arial,sans-serif;">
            <div style="display:inline-flex;align-items:center;gap:12px;color:#ecf5ff;font-weight:800;font-size:18px;letter-spacing:-.02em;">
              ${logo}
              <div>
                <div style="font-size:12px;font-weight:700;color:#7dd3fc;letter-spacing:.08em;text-transform:uppercase;">${safeBrandLine}</div>
                <div style="font-size:18px;line-height:1.1;margin-top:4px;">${PRODUCT_NAME}</div>
                <div style="font-size:12px;font-weight:600;color:#8ea2c6;margin-top:2px;">${escapeHtml(theme.subtitle)}</div>
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#0b1626;border:1px solid rgba(148,163,184,.16);border-radius:28px;overflow:hidden;font-family:Arial,sans-serif;box-shadow:0 24px 64px rgba(0,0,0,.24);">
            <div style="padding:30px 30px 20px 30px;border-bottom:1px solid rgba(148,163,184,.12);">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(56,189,248,.12);color:#8fe3ff;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">
                ${escapeHtml(preheader)}
              </div>
              <h1 style="margin:18px 0 10px 0;font-size:28px;line-height:1.1;letter-spacing:-.04em;color:#f4f8ff;">${safeHeadline}</h1>
              <div style="color:#aebdd5;font-size:15px;line-height:1.7;">
                ${safeBody}
              </div>
            </div>

            ${code ? `
            <div style="padding:20px 28px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8ea2c6;font-weight:700;">${safeCodeCaption}</div>
                <div style="padding:6px 10px;border-radius:999px;background:rgba(148,163,184,.09);color:#cbd5e1;font-size:12px;font-weight:600;">Copy manually if needed</div>
              </div>
              <div style="display:inline-block;padding:18px 22px;border-radius:18px;background:linear-gradient(180deg,#08111f,#0b1729);border:1px solid rgba(148,163,184,.18);color:#f4f8ff;font-family:'Courier New',monospace;font-size:30px;font-weight:800;letter-spacing:8px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 12px 30px rgba(0,0,0,.18);">
                ${safeCode}
              </div>
            </div>` : ''}

            ${steps.length ? `
            <div style="padding:8px 28px 24px 28px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8ea2c6;margin-bottom:10px;font-weight:700;">Next steps</div>
              <ul style="margin:0;padding:0;list-style:none;display:grid;gap:10px;color:#d8e2f2;font-size:14px;line-height:1.6;">
                ${safeSteps}
              </ul>
            </div>` : ''}

            <div style="padding:0 30px 30px 30px;">
              ${cta}
              ${footerNote ? `<div style="margin-top:14px;color:#90a3c6;font-size:13px;line-height:1.6;">${footerNote}</div>` : ''}
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 4px 0 4px;color:#6f7f9c;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;text-align:center;">
            Built by ${COMPANY_NAME} for a cleaner AI coding workflow inside DevMind.
          </td>
        </tr>
      </table>
    </div>
  </body>
  </html>`;
}

async function sendWelcomeBackEmail(email: string, name: string | undefined) {
  const displayName = name?.trim() || 'there';
  const transport = getMailer();
  const dashboardUrl = process.env.DASHBOARD_URL || process.env.FRONTEND_URL || 'https://devmind.in/dashboard';
  const logoUrl = process.env.BRAND_LOGO_URL || `${dashboardUrl.replace(/\/+$/, '')}/logo.png`;

  const html = renderMailTemplate({
    theme: {
      accent: '#38bdf8',
      accentSoft: '#818cf8',
      title: 'Welcome back',
      subtitle: 'Return to your workspace',
      ctaText: 'Open dashboard',
    },
    preheader: 'Welcome back to DevMind',
    headline: `Welcome back, ${displayName}.`,
    body: `
      <p style="margin:0 0 12px 0;">Your workspace is still linked to your verified Gmail account.</p>
      <p style="margin:0;">Open the dashboard to review usage, copy your API key, or jump back into the VS Code extension.</p>
    `,
    brandLine: `${COMPANY_NAME} | Returning member`,
    logoUrl,
    ctaLabel: 'Open dashboard',
    ctaUrl: dashboardUrl,
    footerNote: 'You can keep using the same dashboard and API key whenever you return.',
    steps: [
      'Open the dashboard to review your current plan.',
      'Use the same API key in the VS Code extension.',
      'Continue coding without creating a new account.',
    ],
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    to: email,
    subject: 'Welcome back to DevMind',
    text: [
      `Welcome back, ${displayName}.`,
      '',
      'Your workspace is still linked to your verified Gmail account.',
      'Open the dashboard to review usage, copy your API key, or jump back into the VS Code extension.',
      '',
      'Next steps:',
      '1. Open the dashboard to review your current plan.',
      '2. Use the same API key in the VS Code extension.',
      '3. Continue coding without creating a new account.',
    ].join('\n'),
    html,
  });
}

async function sendSetupEmail(email: string, name: string | undefined) {
  const displayName = name?.trim() || 'there';
  const transport = getMailer();
  const dashboardUrl = process.env.DASHBOARD_URL || process.env.FRONTEND_URL || 'https://devmind.in/dashboard';
  const logoUrl = process.env.BRAND_LOGO_URL || `${dashboardUrl.replace(/\/+$/, '')}/logo.png`;

  const html = renderMailTemplate({
    theme: {
      accent: '#38bdf8',
      accentSoft: '#818cf8',
      title: 'Your workspace is ready',
      subtitle: 'Setup complete',
      ctaText: 'Open dashboard',
    },
    brandLine: `${COMPANY_NAME} | New member setup`,
    preheader: 'DevMind setup complete',
    headline: `Welcome to DevMind, ${displayName}.`,
    body: `
      <p style="margin:0 0 12px 0;">Your account has been verified and your workspace is ready.</p>
      <p style="margin:0;">Open the dashboard to copy your API key, review billing, and connect the VS Code extension.</p>
    `,
    logoUrl,
    ctaLabel: 'Open dashboard',
    ctaUrl: dashboardUrl,
    footerNote: 'Tip: keep your API key private and paste it only inside the DevMind extension settings.',
    steps: [
      'Open the dashboard and copy your API key.',
      'Run DevMind: Set API Key inside VS Code.',
      'Use the sidebar chat, code actions, and autocomplete.',
    ],
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    to: email,
    subject: 'Welcome to DevMind - your workspace is ready',
    text: [
      `Welcome to DevMind, ${displayName}.`,
      '',
      'Your account has been verified and your workspace is ready.',
      'Open the dashboard to copy your API key, review billing, and connect the VS Code extension.',
      '',
      'Next steps:',
      '1. Open the dashboard and copy your API key.',
      '2. Run DevMind: Set API Key inside VS Code.',
      '3. Use the sidebar chat, code actions, and autocomplete.',
    ].join('\n'),
    html,
  });
}

function getMailer() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodemailer = require('nodemailer');

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true' || port === 465;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  if (!user || !pass) {
    throw new Error('SMTP credentials are not configured.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

async function sendOtpEmail(email: string, name: string | undefined, otp: string) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  if (!from) {
    throw new Error('SMTP_FROM or SMTP_USER must be set.');
  }

  const transporter = getMailer();
  const displayName = name?.trim() || 'there';
  const dashboardUrl = process.env.DASHBOARD_URL || process.env.FRONTEND_URL || 'https://devmind.in/dashboard';
  const logoUrl = process.env.BRAND_LOGO_URL || `${dashboardUrl.replace(/\/+$/, '')}/logo.png`;
  const html = renderMailTemplate({
    theme: {
      accent: '#38bdf8',
      accentSoft: '#818cf8',
      title: 'Verify your email',
      subtitle: 'OTP verification',
      ctaText: 'Open dashboard',
    },
    brandLine: `${COMPANY_NAME} | Secure verification`,
    preheader: 'DevMind verification code',
    headline: `Hi ${displayName}, your DevMind verification code is ready.`,
    body: `
      <p style="margin:0 0 12px 0;">Use the 6-digit code below to finish signup or sign in.</p>
      <p style="margin:0;">This code expires in ${OTP_TTL_MINUTES} minutes. If you did not request it, you can safely ignore this email.</p>
    `,
    logoUrl,
    code: otp,
    codeCaption: 'One-time verification code',
    ctaLabel: 'Open dashboard',
    ctaUrl: dashboardUrl,
    footerNote: 'For security, DevMind only accepts Gmail addresses for account access.',
  });

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Your DevMind verification code',
    text: [
      `Hi ${displayName},`,
      '',
      `Your DevMind verification code is: ${otp}`,
      '',
      `This code expires in ${OTP_TTL_MINUTES} minutes.`,
      'If you did not request this, you can ignore this email.',
    ].join('\n'),
    html,
  });
}

async function requestOtp(req: Request, res: Response) {
  const email = normalizeEmail(String(req.body.email || ''));
  const name = String(req.body.name || '').trim();

  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!isGmailEmail(email)) {
    return res.status(400).json({ error: 'Only @gmail.com email addresses are supported.' });
  }

  try {
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    const otpHash = hashOtp(email, otp);

    await db.query(
      `INSERT INTO auth_otps (email, name, otp_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [email, name || null, otpHash, expiresAt]
    );

    await sendOtpEmail(email, name || undefined, otp);

    res.json({
      success: true,
      email,
      message: 'Verification code sent to your Gmail inbox.',
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

async function verifyOtp(req: Request, res: Response) {
  const email = normalizeEmail(String(req.body.email || ''));
  const code = String(req.body.code || req.body.otp || '').trim();
  const name = String(req.body.name || '').trim();

  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!isGmailEmail(email)) {
    return res.status(400).json({ error: 'Only @gmail.com email addresses are supported.' });
  }
  if (!code || code.length !== 6) {
    return res.status(400).json({ error: 'A 6-digit verification code is required.' });
  }

  try {
    const otpRow = await db.query(
      `SELECT id, otp_hash, expires_at, attempts
       FROM auth_otps
       WHERE email=$1 AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    if (!otpRow.rows.length) {
      return res.status(400).json({ error: 'No active verification code found. Request a new code.' });
    }

    const otp = otpRow.rows[0];
    const now = Date.now();
    if (new Date(otp.expires_at).getTime() < now) {
      await db.query('UPDATE auth_otps SET consumed_at=NOW() WHERE id=$1', [otp.id]);
      return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
    }

    if ((otp.attempts || 0) >= OTP_ATTEMPT_LIMIT) {
      await db.query('UPDATE auth_otps SET consumed_at=NOW() WHERE id=$1', [otp.id]);
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    }

    const expectedHash = hashOtp(email, code);
    if (expectedHash !== otp.otp_hash) {
      await db.query('UPDATE auth_otps SET attempts = attempts + 1 WHERE id=$1', [otp.id]);
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    await db.query('UPDATE auth_otps SET consumed_at=NOW() WHERE id=$1', [otp.id]);

    const existing = await db.query('SELECT id, api_key, plan, name FROM users WHERE email=$1', [email]);
    let userId: string;
    let apiKey: string;
    let plan: string;
    let createdNewUser = false;

    if (existing.rows.length) {
      const user = existing.rows[0];
      userId = user.id;
      apiKey = user.api_key;
      plan = user.plan || 'free';

      if (name && name !== user.name) {
        await db.query(
          'UPDATE users SET name=$1, email_verified_at=NOW(), updated_at=NOW() WHERE id=$2',
          [name, userId]
        );
      } else {
        await db.query('UPDATE users SET email_verified_at=NOW(), updated_at=NOW() WHERE id=$1', [userId]);
      }
    } else {
      userId = uuid();
      apiKey = createApiKey();
      plan = 'free';
      createdNewUser = true;

      await db.query(
        `INSERT INTO users (id, email, name, api_key, plan, email_verified_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),NOW())`,
        [userId, email, name || email.split('@')[0], apiKey, plan]
      );
    }

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

    if (createdNewUser) {
      void sendSetupEmail(email, name || email.split('@')[0]).catch((mailError) => {
        console.error('[MAIL] setup email failed:', mailError?.message || mailError);
      });
    } else {
      void sendWelcomeBackEmail(email, name || existing.rows[0].name).catch((mailError) => {
        console.error('[MAIL] welcome-back email failed:', mailError?.message || mailError);
      });
    }

    res.json({
      token,
      apiKey,
      plan,
      userId,
      email,
      emailVerified: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

authRouter.post('/request-otp', requestOtp);
authRouter.post('/verify-otp', verifyOtp);
authRouter.post('/register', requestOtp);
authRouter.post('/login', verifyOtp);

authRouter.get('/validate', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  try {
    const account = await db.query(
      'SELECT plan, api_key, is_admin, email_verified_at FROM users WHERE id=$1',
      [userId]
    );
    if (!account.rows.length) return res.status(404).json({ valid: false });

    const usage = await db.query(
      "SELECT COUNT(*) as cnt FROM usage_logs WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 day'",
      [userId]
    );

    const limits: Record<string, number> = { free: 20, solo: 100, pro: 500, team: 2000 };
    const plan = account.rows[0].plan;
    const used = parseInt(usage.rows[0].cnt, 10);
    const remaining = Math.max(0, (limits[plan] || limits.free) - used);

    res.json({
      valid: true,
      plan,
      used,
      remaining,
      isAdmin: account.rows[0].is_admin,
      emailVerified: Boolean(account.rows[0].email_verified_at),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

authRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  try {
    const result = await db.query(
      'SELECT id, email, name, plan, api_key, is_admin, email_verified_at, created_at FROM users WHERE id=$1',
      [userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
