import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../services/db';

const SECRET = process.env.JWT_SECRET || 'change-me';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.replace('Bearer ', '').trim();
  const apiKey = (req.headers['x-api-key'] as string)?.trim();

  try {
    if (bearer) {
      const payload = jwt.verify(bearer, SECRET) as { userId: string };
      // Check user exists and is not banned
      const row = await db.query(
        'SELECT id, COALESCE(banned, false) as banned FROM users WHERE id=$1',
        [payload.userId]
      );
      if (!row.rows.length) return res.status(401).json({ error: 'Account not found' });
      if (row.rows[0].banned) return res.status(403).json({ error: 'Account suspended. Contact support.' });
      (req as any).userId = payload.userId;
      return next();
    }

    if (apiKey) {
      const row = await db.query(
        'SELECT id, COALESCE(banned, false) as banned FROM users WHERE api_key=$1',
        [apiKey]
      );
      if (!row.rows.length) return res.status(401).json({ error: 'Invalid API key' });
      if (row.rows[0].banned) return res.status(403).json({ error: 'Account suspended. Contact support@singhjitech.com' });
      (req as any).userId = row.rows[0].id;
      return next();
    }

    res.status(401).json({ error: 'Authentication required' });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
