import { Router, Request, Response } from 'express';
import * as DS from '../services/deepseek';
import { checkQuota, incrementUsage, incrementUsageDetailed } from '../services/quota';
import { db } from '../services/db';

export const aiRouter = Router();

// ── GET /v1/preferences ───────────────────────────────────────────────────────
aiRouter.get('/preferences', async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  try {
    const row = await DS.getPreferences(userId);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /v1/team-memory ───────────────────────────────────────────────────────
aiRouter.get('/team-memory', async (_req: Request, res: Response) => {
  try {
    const rows = await db.query(
      `SELECT id, scope, policy_name, policy_text, is_active, updated_by, created_at, updated_at
       FROM team_memory
       WHERE is_active = true
       ORDER BY updated_at DESC
       LIMIT 50`
    );
    res.json({ items: rows.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /v1/preferences ─────────────────────────────────────────────────────
aiRouter.patch('/preferences', async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const {
    defaultIntent,
    autoVerify,
    projectMemory,
    preferredTemperature,
  } = req.body || {};
  try {
    const row = await DS.updatePreferences(userId, {
      defaultIntent,
      autoVerify,
      projectMemory,
      preferredTemperature,
    });
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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
  console.log('[Scaffold] Request:', { type, name, language, userId });
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });
    console.log('[Scaffold] Calling DeepSeek...');
    const files = await DS.scaffold(type, name, language || 'typescript', projectCtx);
    console.log('[Scaffold] Done, files:', files.length);
    await incrementUsage(userId, 'scaffold');
    res.json({ files });
  } catch (e: any) {
    console.error('[Scaffold] Error:', e.message, e.stack);
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
  const { messages, language, stream, intent, projectMemory } = req.body;
  const userId = (req as any).userId;
  const started = Date.now();
  try {
    const allowed = await checkQuota(userId);
    if (!allowed) return res.status(429).json({ error: 'Daily quota exceeded.' });
    const pref = await DS.getPreferences(userId);
    const effectiveIntent = intent || pref.defaultIntent || 'build';
    const effectiveMemory = typeof projectMemory === 'string' && projectMemory.trim().length
      ? projectMemory
      : (pref.projectMemory || '');
    const effectiveTemp = Number(pref.preferredTemperature ?? 0.15);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(': ping\n\n');

      const dataStream = await DS.chat(
        messages || [],
        language || 'typescript',
        true,
        effectiveIntent,
        effectiveMemory,
        effectiveTemp
      );

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
        try {
          await incrementUsageDetailed(userId, {
            action: 'chat',
            model: 'deepseek-chat',
            tokensIn: 0,
            tokensOut: 0,
            requestMs: Date.now() - started,
            status: 'ok',
            usedFallback: false,
            errorMessage: null,
          });
        } catch {}
      });
      dataStream.on('error', (err: Error) => {
        res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
        res.end();
        void incrementUsageDetailed(userId, {
          action: 'chat',
          model: 'deepseek-chat',
          tokensIn: 0,
          tokensOut: 0,
          requestMs: Date.now() - started,
          status: 'error',
          usedFallback: false,
          errorMessage: err.message || 'stream error',
        }).catch(() => {});
      });
      req.on('close', () => { try { dataStream.destroy(); } catch {} });
    } else {
      const data  = await DS.chat(
        messages || [],
        language || 'typescript',
        false,
        effectiveIntent,
        effectiveMemory,
        effectiveTemp
      );
      const reply = data.choices?.[0]?.message?.content ?? '';
      await incrementUsageDetailed(userId, {
        action: 'chat',
        model: 'deepseek-chat',
        tokensIn: 0,
        tokensOut: 0,
        requestMs: Date.now() - started,
        status: 'ok',
        usedFallback: false,
        errorMessage: null,
      });
      res.json({ reply });
    }
  } catch (e: any) {
    console.error('[chat]', e.message);
    void incrementUsageDetailed(userId, {
      action: 'chat',
      model: 'deepseek-chat',
      tokensIn: 0,
      tokensOut: 0,
      requestMs: Date.now() - started,
      status: 'error',
      usedFallback: false,
      errorMessage: e.message || 'chat failed',
    }).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
      res.end();
    }
  }
});
