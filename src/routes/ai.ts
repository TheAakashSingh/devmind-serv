import { Router, Request, Response } from 'express';
import * as DS from '../services/deepseek';
import { checkQuota, incrementUsage } from '../services/quota';

export const aiRouter = Router();

// ── POST /v1/complete ─────────────────────────────────────────────────────────
aiRouter.post('/complete', async (req: Request, res: Response) => {
  const { prefix, suffix, language, fileName } = req.body;
  const userId = (req as any).userId;

  const allowed = await checkQuota(userId);
  if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded. Upgrade your plan.' });

  try {
    const completion = await DS.complete(prefix, suffix, language, fileName);
    await incrementUsage(userId);
    res.json({ completion });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/action ───────────────────────────────────────────────────────────
aiRouter.post('/action', async (req: Request, res: Response) => {
  const { type, code, language } = req.body;
  const userId = (req as any).userId;

  const allowed = await checkQuota(userId);
  if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });

  try {
    const result = await DS.codeAction(type, code, language);
    await incrementUsage(userId);
    res.json({ result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/generate ─────────────────────────────────────────────────────────
aiRouter.post('/generate', async (req: Request, res: Response) => {
  const { prompt, language } = req.body;
  const userId = (req as any).userId;

  const allowed = await checkQuota(userId);
  if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });

  try {
    const code = await DS.generate(prompt, language);
    await incrementUsage(userId);
    res.json({ code });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/chat ─────────────────────────────────────────────────────────────
aiRouter.post('/chat', async (req: Request, res: Response) => {
  const { messages, language, stream } = req.body;
  const userId = (req as any).userId;

  const allowed = await checkQuota(userId);
  if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });

  try {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      
      const data = await DS.chat(messages, language, true);
      data.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        // Only forward actual data, not [DONE]
        if (text.includes('data: ') && !text.includes('[DONE]')) {
          res.write(text);
        }
      });
      data.on('end',  () => { res.write('data: [DONE]\n\n'); res.end(); });
      data.on('error', (e: Error) => { 
        console.error('Stream error:', e.message);
        res.end(); 
      });
    } else {
      const data  = await DS.chat(messages, language, false);
      const reply = data.choices?.[0]?.message?.content ?? '';
      await incrementUsage(userId);
      res.json({ reply });
    }
  } catch (e: any) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
