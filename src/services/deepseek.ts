import axios, { AxiosInstance } from 'axios';

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
    auth:   `Complete authentication system for ${Name}:
- POST /auth/register — create user, hash password, return JWT
- POST /auth/login — verify credentials, return JWT + refresh token
- POST /auth/logout — invalidate token
- POST /auth/refresh — refresh access token
- POST /auth/forgot-password — send reset email
Include: model/schema, controller, routes, middleware (auth guard), input validation, error handling`,

    crud:   `Complete CRUD module for '${Name}' resource:
- GET    /${name}s         — paginated list with filters
- GET    /${name}s/:id     — get by ID
- POST   /${name}s         — create with validation
- PUT    /${name}s/:id     — update
- DELETE /${name}s/:id     — soft delete
Include: model/schema, controller, routes, validation, middleware`,

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

  console.log('[Scaffold] Sending to DeepSeek, maxTokens: 7000');
  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Scaffold a '${scaffoldType}' module for '${name}' in ${language}.\n\nRequirements:\n${description}\n\nGenerate all necessary files with complete, working code following the project's conventions.` },
  ], 7000);
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
export async function chat(messages: Message[], language: string, stream: boolean) {
  const sys: Message = {
    role:    'system',
    content: `You are DevMind AI, an expert ${language} coding assistant embedded in VS Code.
- Always provide working code in properly labelled markdown code blocks
- Use the project context provided in the conversation when relevant
- Be concise but thorough
- For complex questions, structure your answer with headings
- Suggest follow-up improvements when appropriate`,
  };
  return deepseekChat('deepseek-chat', [sys, ...messages], 3500, stream);
}
