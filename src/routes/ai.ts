import { Router, Request, Response } from 'express';
import * as DS from '../services/deepseek';
import { checkQuota, incrementUsage } from '../services/quota';

export const aiRouter = Router();

// ── POST /v1/complete ─────────────────────────────────────────────────────────
aiRouter.post('/complete', async (req: Request, res: Response) => {
  const { prefix, suffix, language, fileName, projectCtx } = req.body;
  const userId = (req as any).userId;
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded. Upgrade your plan.' });
    const completion = await DS.complete(prefix || '', suffix || '', language || 'text', fileName || 'file', projectCtx);
    await incrementUsage(userId, 'complete');
    res.json({ completion });
  } catch (e: any) {
    console.error('[complete]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/action ───────────────────────────────────────────────────────────
aiRouter.post('/action', async (req: Request, res: Response) => {
  const { type, code, language, contextPrompt } = req.body;
  const userId = (req as any).userId;
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });
    const result = await DS.codeAction(type, code, language || 'text', contextPrompt);
    await incrementUsage(userId, type);
    res.json({ result });
  } catch (e: any) {
    console.error('[action]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/explain-file ─────────────────────────────────────────────────────
aiRouter.post('/explain-file', async (req: Request, res: Response) => {
  const { content, fileName, language, projectCtx } = req.body;
  const userId = (req as any).userId;
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });
    const result = await DS.explainFile(content, fileName, language, projectCtx);
    await incrementUsage(userId, 'explain-file');
    res.json({ result });
  } catch (e: any) {
    console.error('[explain-file]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/generate ─────────────────────────────────────────────────────────
aiRouter.post('/generate', async (req: Request, res: Response) => {
  const { prompt, language, projectCtx } = req.body;
  const userId = (req as any).userId;
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });
    const code = await DS.generate(prompt, language || 'typescript', projectCtx);
    await incrementUsage(userId, 'generate');
    res.json({ code });
  } catch (e: any) {
    console.error('[generate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/generate-tests ───────────────────────────────────────────────────
aiRouter.post('/generate-tests', async (req: Request, res: Response) => {
  const { code, language, fileName, projectCtx } = req.body;
  const userId = (req as any).userId;
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });
    const tests = await DS.generateTests(code, language || 'typescript', fileName, projectCtx);
    await incrementUsage(userId, 'generate-tests');
    res.json({ tests });
  } catch (e: any) {
    console.error('[generate-tests]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/scaffold ─────────────────────────────────────────────────────────
aiRouter.post('/scaffold', async (req: Request, res: Response) => {
  const { type, name, language, projectCtx } = req.body;
  const userId = (req as any).userId;
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });
    // Scaffold uses multiple tokens — count as 5 requests
    const files = await DS.scaffold(type, name, language || 'typescript', projectCtx);
    await incrementUsage(userId, 'scaffold');
    res.json({ files });
  } catch (e: any) {
    console.error('[scaffold]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/multi-refactor ───────────────────────────────────────────────────
aiRouter.post('/multi-refactor', async (req: Request, res: Response) => {
  const { instruction, files, language, projectCtx } = req.body;
  const userId = (req as any).userId;
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });
    const result = await DS.multiRefactor(instruction, files, language, projectCtx);
    await incrementUsage(userId, 'multi-refactor');
    res.json(result);
  } catch (e: any) {
    console.error('[multi-refactor]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/chat ─────────────────────────────────────────────────────────────
aiRouter.post('/chat', async (req: Request, res: Response) => {
  const { messages, language, stream } = req.body;
  const userId = (req as any).userId;
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(': ping\n\n');

      const dataStream = await DS.chat(messages || [], language || 'typescript', true);

      dataStream.on('data', (chunk: Buffer) => {
        const raw   = chunk.toString();
        const lines = raw.split('\n');
        for (const line of lines) {
          const t = line.trim();
          if (!t || t === 'data: [DONE]') { continue; }
          if (t.startsWith('data: ')) { res.write(t + '\n\n'); }
        }
      });
      dataStream.on('end', async () => {
        res.write('data: [DONE]\n\n');
        res.end();
        try { await incrementUsage(userId, 'chat'); } catch {}
      });
      dataStream.on('error', (err: Error) => {
        res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
        res.end();
      });
      req.on('close', () => { try { dataStream.destroy(); } catch {} });
    } else {
      const data  = await DS.chat(messages || [], language || 'typescript', false);
      const reply = data.choices?.[0]?.message?.content ?? '';
      await incrementUsage(userId, 'chat');
      res.json({ reply });
    }
  } catch (e: any) {
    console.error('[chat]', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
      res.end();
    }
  }
});
