import axios, { AxiosInstance } from 'axios';
import { db } from './db';

function makeClient(): AxiosInstance {
  const key  = process.env.DEEPSEEK_API_KEY  || '';
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  if (!key) { console.warn('[DeepSeek] WARNING: DEEPSEEK_API_KEY not set!'); }
  return axios.create({
    baseURL:  base,
    timeout:  180_000,  // 3 min timeout for large requests
    headers:  { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
}

let _http: AxiosInstance | null = null;
function http(): AxiosInstance {
  if (!_http) { _http = makeClient(); }
  return _http;
}

export interface Message { role: 'system' | 'user' | 'assistant'; content: string; }
type Intent = 'build' | 'debug' | 'refactor' | 'optimize' | 'secure';

export async function getPreferences(userId: string) {
  const row = await db.query(
    `SELECT user_id, default_intent, auto_verify, project_memory, preferred_temperature, updated_at
     FROM ai_preferences WHERE user_id=$1`,
    [userId]
  );
  if (!row.rows.length) {
    return {
      userId,
      defaultIntent: 'build',
      autoVerify: false,
      projectMemory: '',
      preferredTemperature: 0.15,
    };
  }
  const p = row.rows[0];
  return {
    userId: p.user_id,
    defaultIntent: p.default_intent || 'build',
    autoVerify: Boolean(p.auto_verify),
    projectMemory: p.project_memory || '',
    preferredTemperature: Number(p.preferred_temperature ?? 0.15),
    updatedAt: p.updated_at,
  };
}

export async function updatePreferences(userId: string, input: {
  defaultIntent?: string;
  autoVerify?: boolean;
  projectMemory?: string;
  preferredTemperature?: number;
}) {
  const intent = String(input.defaultIntent || 'build').toLowerCase();
  const validIntents = new Set(['build', 'debug', 'refactor', 'optimize', 'secure']);
  const safeIntent = validIntents.has(intent) ? intent : 'build';
  const autoVerify = Boolean(input.autoVerify);
  const projectMemory = String(input.projectMemory || '').slice(0, 12000);
  const temp = Math.max(0, Math.min(1, Number(input.preferredTemperature ?? 0.15)));

  const row = await db.query(
    `INSERT INTO ai_preferences (user_id, default_intent, auto_verify, project_memory, preferred_temperature, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       default_intent = EXCLUDED.default_intent,
       auto_verify = EXCLUDED.auto_verify,
       project_memory = EXCLUDED.project_memory,
       preferred_temperature = EXCLUDED.preferred_temperature,
       updated_at = NOW()
     RETURNING user_id, default_intent, auto_verify, project_memory, preferred_temperature, updated_at`,
    [userId, safeIntent, autoVerify, projectMemory, temp]
  );
  const p = row.rows[0];
  return {
    userId: p.user_id,
    defaultIntent: p.default_intent,
    autoVerify: Boolean(p.auto_verify),
    projectMemory: p.project_memory || '',
    preferredTemperature: Number(p.preferred_temperature ?? 0.15),
    updatedAt: p.updated_at,
  };
}

// ── Core call ─────────────────────────────────────────────────────────────────
export async function deepseekChat(
  model: string, messages: Message[], maxTokens: number, stream = false
) {
  const res = await http().post('/chat/completions', {
    model,
    messages,
    max_tokens:  maxTokens,
    temperature: 0.15,
    stream,
  }, { responseType: stream ? 'stream' : 'json' });
  return res.data;
}

// ── Inline autocomplete ───────────────────────────────────────────────────────
export async function complete(
  prefix: string, suffix: string, language: string,
  fileName: string, projectCtx?: string
): Promise<string> {
  const sys = projectCtx
    ? `${projectCtx}\n\nYou are completing ${language} code at <CURSOR>. Return ONLY the completion — no explanation, no fences, no backticks.`
    : `You are an expert ${language} developer. Complete the code at <CURSOR>. Return ONLY the completion text — no explanation, no backticks.`;

  const data = await deepseekChat('deepseek-chat', [
    { role: 'system', content: sys },
    { role: 'user',   content: `File: ${fileName}\n\n${prefix}<CURSOR>${suffix}` },
  ], 256);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Code actions (explain / fix / refactor) ───────────────────────────────────
export async function codeAction(
  type: 'explain' | 'fix' | 'refactor',
  code: string, language: string, contextPrompt?: string
): Promise<string> {
  const sysMap = {
    explain: `You are an expert ${language} developer. Explain the following code in detail using markdown:
## Purpose
## Inputs & Outputs
## Key Logic
## Dependencies
## Security Concerns
## Performance Notes
## Optimization Suggestions`,
    fix:      `You are an expert ${language} developer. Find and fix ALL bugs in the code. Return ONLY the corrected code — no markdown fences, no explanation, no preamble.`,
    refactor: `You are an expert ${language} developer. Refactor for readability, performance, and best practices. Return ONLY the refactored code — no fences, no explanation.`,
  };
  const userMap = {
    explain:  `Explain this ${language} code:\n\n${code}`,
    fix:      `Fix all bugs:\n\n${code}`,
    refactor: `Refactor:\n\n${code}`,
  };
  const model = (type === 'fix' || type === 'refactor') ? 'deepseek-coder' : 'deepseek-chat';
  const sys   = contextPrompt ? `${contextPrompt}\n\n${sysMap[type]}` : sysMap[type];
  const data  = await deepseekChat(model, [
    { role: 'system', content: sys },
    { role: 'user',   content: userMap[type] },
  ], 3000);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Explain entire file ───────────────────────────────────────────────────────
export async function explainFile(
  content: string, fileName: string, language: string, projectCtx?: string
): Promise<string> {
  const sys = `You are a senior ${language} code reviewer. Provide a thorough file analysis in markdown:

## File Purpose
## Architecture & Patterns
## Key Functions/Classes
## Dependencies & Imports
## Data Flow
## Security Considerations
## Performance Notes
## Potential Issues & Bugs
## Refactoring Suggestions

Be specific, actionable, and reference actual code where relevant.`;

  const ctx  = projectCtx ? `${projectCtx}\n\n` : '';
  const data = await deepseekChat('deepseek-chat', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Analyse this file: **${fileName}**\n\n\`\`\`${language}\n${content.slice(0, 14000)}\n\`\`\`` },
  ], 4000);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Generate from prompt ──────────────────────────────────────────────────────
export async function generate(
  prompt: string, language: string, projectCtx?: string
): Promise<string> {
  const sys = projectCtx
    ? `${projectCtx}\n\nGenerate production-ready ${language} code. No markdown fences, no preamble, just code.`
    : `You are an expert ${language} developer. Write clean, production-ready code. No markdown fences, no explanation.`;

  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: prompt },
  ], 2500);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Generate tests ────────────────────────────────────────────────────────────
export async function generateTests(
  code: string, language: string, fileName: string, projectCtx?: string
): Promise<string> {
  const fw = projectCtx?.includes('Next.js') || projectCtx?.includes('React') ? 'Jest/React Testing Library'
    : language === 'python' ? 'pytest'
    : language === 'java'   ? 'JUnit 5'
    : 'Jest/Vitest';

  const sys = `You are a ${language} testing expert. Generate comprehensive unit tests using ${fw}.
Requirements:
- Happy path tests
- Edge case tests (null, empty, boundary values)
- Error/exception tests
- Mock all external dependencies
- Aim for 80%+ code coverage
- Use describe/it blocks for organisation
Return ONLY the test code — no markdown fences, no explanation.`;

  const ctx  = projectCtx ? `${projectCtx}\n\n` : '';
  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Write tests for file: ${fileName}\n\n${code}` },
  ], 3500);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Scaffold (one-command generators) ────────────────────────────────────────
export async function scaffold(
  type: string, name: string, language: string, projectCtx?: string
): Promise<Array<{ path: string; content: string }>> {
  const [scaffoldType, customDesc] = type.split(':');
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  const ext  = language === 'typescript' ? 'ts' : language === 'javascript' ? 'js' : language;

  const typeDescriptions: Record<string, string> = {
    auth:   `Authentication for ${Name}:
- POST /auth/login — verify credentials, return JWT
- POST /auth/register — create user, hash password, return JWT
- Middleware: auth guard
Include: controller, routes, middleware, model (minimal)`,

    crud:   `CRUD for '${Name}':
- GET /${name}s — list
- GET /${name}s/:id — get by ID
- POST /${name}s — create
- PUT /${name}s/:id — update
Include: controller, routes, model`,

    api:    `REST API endpoint for '${Name}':
- Full CRUD with pagination
- Request validation
- Error handling with proper HTTP status codes
- Response formatting
Include: controller, routes, validation middleware`,

    schema: `Database schema/model for '${Name}':
- All necessary fields with proper types
- Indexes for frequently queried fields
- Relations/foreign keys if applicable
- Timestamps (createdAt, updatedAt)
- Soft delete support`,

    admin:  `Admin panel routes for '${Name}':
- GET  /admin/${name}s     — list with search/filter/sort/pagination
- GET  /admin/${name}s/:id — detail view
- POST /admin/${name}s     — create
- PUT  /admin/${name}s/:id — update
- DELETE /admin/${name}s/:id — delete (hard)
Include: admin middleware (is_admin check), routes, controller`,

    server: `Production-ready Express.js server boilerplate:
- Express with TypeScript
- CORS, helmet, compression middleware
- Rate limiting
- Request logging (morgan)
- Global error handler
- Health check endpoint
- Database connection
- Environment config
- Graceful shutdown
Include: index.ts, middleware, config, types`,

    custom: customDesc || `Custom module for '${Name}'`,
  };

  const description = typeDescriptions[scaffoldType] || customDesc || type;
  const ctx = projectCtx ? `${projectCtx}\n\n` : '';

  const sys = `You are a ${language} software architect. Generate complete, working code files.
CRITICAL: Return ONLY valid JSON in this EXACT format — nothing before or after:
{"files":[{"path":"src/modules/${name}/file.${ext}","content":"...actual working code..."}]}
No markdown, no explanation, no code fences around the JSON.`;

  console.log('[Scaffold] Sending to DeepSeek, maxTokens: 4000');
  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Scaffold a '${scaffoldType}' module for '${name}' in ${language}.\n\nRequirements:\n${description}\n\nGenerate all necessary files with complete, working code following the project's conventions.` },
  ], 4000);
  console.log('[Scaffold] DeepSeek responded');

  const raw = data.choices?.[0]?.message?.content?.trim() ?? '{"files":[]}';
  try {
    // Strip markdown fences if model adds them anyway
    const cleaned = raw
      .replace(/^```json\s*/m, '')
      .replace(/^```\s*/m, '')
      .replace(/\s*```$/m, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch {
    // Fallback: wrap raw as a single file
    return [{
      path:    `src/${name}/${scaffoldType}.${ext}`,
      content: raw,
    }];
  }
}

// ── Multi-file refactor ───────────────────────────────────────────────────────
export async function multiRefactor(
  instruction: string,
  files:       Array<{ path: string; content: string }>,
  language:    string,
  projectCtx?: string
): Promise<{ files: Array<{ path: string; content: string; summary: string }> }> {
  const ctx      = projectCtx ? `${projectCtx}\n\n` : '';
  const fileList = files.map((f, i) =>
    `=== FILE ${i + 1}: ${f.path} ===\n${f.content}`
  ).join('\n\n');

  const sys = `You are a ${language} refactoring expert.
Apply the refactor instruction to ALL provided files.
CRITICAL: Return ONLY valid JSON — nothing else:
{"files":[{"path":"original/path","content":"refactored code","summary":"what changed"}]}
Return ALL files including unchanged ones. No markdown.`;

  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Refactor instruction: ${instruction}\n\n${fileList}` },
  ], 8000);

  const raw = data.choices?.[0]?.message?.content?.trim() ?? '{"files":[]}';
  try {
    const cleaned = raw.replace(/^```json?\s*/m, '').replace(/\s*```$/m, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { files: files.map(f => ({ ...f, summary: 'Could not parse refactor result' })) };
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export async function chat(
  messages: Message[],
  language: string,
  stream: boolean,
  intent: Intent = 'build',
  projectMemory = ''
) {
  const intentRules: Record<Intent, string> = {
    build: 'Focus on implementation details and production-ready code.',
    debug: 'Prioritize root-cause analysis, precise fixes, and validation steps.',
    refactor: 'Preserve behavior while improving clarity, structure, and maintainability.',
    optimize: 'Prioritize measurable performance improvements and trade-offs.',
    secure: 'Prioritize security hardening, threat modeling, and safe defaults.',
  };
  const sys: Message = {
    role:    'system',
    content: `You are DevMind AI, a senior ${language} pair programmer inside VS Code.
Core behavior:
- Prioritize correctness, safety, and maintainability over verbosity.
- Read the user context carefully and ask 1 short clarifying question only when absolutely required.
- When writing code, give production-ready snippets with clear file-oriented guidance.
- For debugging requests, include root cause, fix, and a quick verification step.
- For refactors, preserve behavior and call out risky changes.
- If information is missing, state assumptions explicitly.
Response style:
- Be concise, structured, and practical.
- Use markdown code blocks for code, and short bullet points for plans/checklists.
- Prefer actionable outputs over generic explanations.`,
  };
  const memoryBlock = projectMemory
    ? `\nProject memory:\n${projectMemory.slice(0, 6000)}`
    : '';
  const intentBlock = `\nCurrent intent mode: ${intent}\n${intentRules[intent] || intentRules.build}`;
  const patchedSystem: Message = { role: 'system', content: `${sys.content}${intentBlock}${memoryBlock}` };
  return deepseekChat('deepseek-chat', [patchedSystem, ...messages], 3500, stream);
}
