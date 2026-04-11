import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../services/db';

const SECRET = process.env.JWT_SECRET || 'change-me';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  // Accept either Bearer JWT or x-api-key header
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  const apiKey = req.headers['x-api-key'] as string;

  try {
    if (bearer) {
      const payload = jwt.verify(bearer, SECRET) as { userId: string };
      (req as any).userId = payload.userId;
      return next();
    }

    if (apiKey) {
      const row = await db.query('SELECT id FROM users WHERE api_key=$1', [apiKey]);
      if (!row.rows.length) return res.status(401).json({ error: 'Invalid API key' });
      (req as any).userId = row.rows[0].id;
      return next();
    }

    res.status(401).json({ error: 'Authentication required' });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
