import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
export const filesRouter = Router();

function sanitizePath(p: string): string {
  const allowed = process.cwd();
  const resolved = path.resolve(allowed, p);
  if (!resolved.startsWith(allowed)) {
    throw new Error('Invalid path');
  }
  return resolved;
}

// ── POST /v1/files/read ───────────────────────────────────────────────────────
filesRouter.post('/read', async (req: Request, res: Response) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });

  try {
    const safePath = sanitizePath(filePath);
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is a directory' });
    }
    const content = fs.readFileSync(safePath, 'utf8');
    res.json({ content });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /v1/files/write ───────────────────────────────────────────────────────
filesRouter.post('/write', async (req: Request, res: Response) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'Missing path or content' });
  }

  try {
    const safePath = sanitizePath(filePath);
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(safePath, content, 'utf8');
    res.json({ success: true, message: 'File written successfully' });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /v1/files/search ───────────────────────────────────────────────────────
filesRouter.post('/search', async (req: Request, res: Response) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    const workspace = process.cwd();
    const { stdout } = await execAsync(
      `grep -rli "${query.replace(/"/g, '\\"')}" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" --include="*.json" --include="*.md" . 2>/dev/null | head -20`,
      { cwd: workspace, timeout: 10000 }
    );
    const files = stdout.trim().split('\n').filter(Boolean);
    const results = files.map((file: string) => ({
      path: file,
      preview: '',
    }));
    res.json({ results });
  } catch {
    res.json({ results: [] });
  }
});

// ── POST /v1/files/list ───────────────────────────────────────────────────────
filesRouter.post('/list', async (req: Request, res: Response) => {
  const { path: dirPath } = req.body;

  try {
    const safePath = dirPath ? sanitizePath(dirPath) : process.cwd();
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }
    const stat = fs.statSync(safePath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    const entries = fs.readdirSync(safePath).map(name => {
      const fullPath = path.join(safePath, name);
      const st = fs.statSync(fullPath);
      return {
        name,
        isDirectory: st.isDirectory(),
        path: path.relative(process.cwd(), fullPath),
      };
    });
    res.json({ entries });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});