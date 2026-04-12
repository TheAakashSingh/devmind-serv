import axios, { AxiosInstance } from 'axios';

function makeClient(): AxiosInstance {
  const key  = process.env.DEEPSEEK_API_KEY  || '';
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  if (!key) { console.warn('[DeepSeek] WARNING: DEEPSEEK_API_KEY not set!'); }
  return axios.create({
    baseURL: base,
    timeout: 60_000,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
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
    model, messages, max_tokens: maxTokens, temperature: 0.15, stream,
  }, { responseType: stream ? 'stream' : 'json' });
  return res.data;
}

// ── Inline autocomplete ───────────────────────────────────────────────────────
export async function complete(
  prefix: string, suffix: string, language: string,
  fileName: string, projectCtx?: string
): Promise<string> {
  const sysContent = projectCtx
    ? `${projectCtx}\n\nYou are completing ${language} code. Return ONLY the completion text — no explanation, no fences.`
    : `You are an expert ${language} developer. Complete the code at <CURSOR>. Return ONLY the completion — no explanation, no backticks.`;

  const data = await deepseekChat('deepseek-chat', [
    { role: 'system', content: sysContent },
    { role: 'user',   content: `File: ${fileName}\n\n${prefix}<CURSOR>${suffix}` },
  ], 256);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Code action ───────────────────────────────────────────────────────────────
export async function codeAction(
  type: 'explain' | 'fix' | 'refactor', code: string,
  language: string, contextPrompt?: string
): Promise<string> {
  const sysMap = {
    explain:  `You are an expert ${language} developer. Explain the following code in detail:\n- Purpose and what it does\n- Input/output parameters\n- Key dependencies and imports\n- Complexity and performance notes\n- Security concerns if any\n- Optimization suggestions\nUse clear headings and bullet points.`,
    fix:      `You are an expert ${language} developer. Find and fix ALL bugs. Return ONLY the corrected code — no explanation, no fences, no comments added unless necessary.`,
    refactor: `You are an expert ${language} developer. Refactor for readability, performance, and best practices. Return ONLY the refactored code — no explanation, no fences.`,
  };
  const userMap = {
    explain:  `Explain this ${language} code:\n\n${code}`,
    fix:      `Fix all bugs:\n\n${code}`,
    refactor: `Refactor this code:\n\n${code}`,
  };
  const model = (type === 'fix' || type === 'refactor') ? 'deepseek-coder' : 'deepseek-chat';
  const sys   = contextPrompt ? `${contextPrompt}\n\n${sysMap[type]}` : sysMap[type];
  const data  = await deepseekChat(model, [
    { role: 'system', content: sys        },
    { role: 'user',   content: userMap[type] },
  ], 3000);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Explain entire file ───────────────────────────────────────────────────────
export async function explainFile(
  content: string, fileName: string, language: string, projectCtx?: string
): Promise<string> {
  const sys = `You are a senior ${language} developer reviewing code. Provide a comprehensive explanation of the file including:
## File Purpose
## Architecture & Design Patterns
## Key Functions/Classes
## Dependencies & Imports
## Data Flow
## Security Considerations
## Performance Notes
## Potential Issues
## Refactoring Suggestions

Be specific and actionable. Use markdown formatting.`;

  const ctx  = projectCtx ? `${projectCtx}\n\n` : '';
  const data = await deepseekChat('deepseek-chat', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Explain this file: ${fileName}\n\n\`\`\`${language}\n${content.slice(0, 12000)}\n\`\`\`` },
  ], 3000);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Generate from prompt ──────────────────────────────────────────────────────
export async function generate(
  prompt: string, language: string, projectCtx?: string
): Promise<string> {
  const sys = projectCtx
    ? `${projectCtx}\n\nGenerate clean, production-ready ${language} code. No markdown fences, no preamble.`
    : `You are an expert ${language} developer. Write clean, production-ready code. No markdown fences, no explanation.`;

  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: prompt },
  ], 2000);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Generate tests ────────────────────────────────────────────────────────────
export async function generateTests(
  code: string, language: string, fileName: string, projectCtx?: string
): Promise<string> {
  const sys = `You are a ${language} testing expert. Generate comprehensive unit tests:
- Happy path tests
- Edge case tests
- Error/failure tests
- Use Jest/Vitest for JS/TS, pytest for Python, JUnit for Java
- Mock external dependencies
- Cover at least 80% of code paths
Return ONLY the test code — no explanation, no markdown fences.`;

  const ctx  = projectCtx ? `${projectCtx}\n\n` : '';
  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Write tests for: ${fileName}\n\n${code}` },
  ], 3000);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Scaffold ──────────────────────────────────────────────────────────────────
export async function scaffold(
  type: string, name: string, language: string, projectCtx?: string
): Promise<Array<{ path: string; content: string }>> {
  const [scaffoldType, customDesc] = type.split(':');

  const typeDescriptions: Record<string, string> = {
    auth:   `Complete authentication system: register, login, logout, refresh token, password reset. Use JWT. Include model, controller, routes, middleware, and validation.`,
    crud:   `Complete CRUD module for '${name}': model/schema, controller, routes, validation, and error handling.`,
    api:    `REST API endpoint for '${name}': controller, routes, request validation, response formatting, and error handling.`,
    schema: `Database schema/model for '${name}': fields with types, indexes, relations, and timestamps.`,
    admin:  `Admin panel routes and logic for '${name}': list, view, create, update, delete with admin middleware.`,
    server: `Boilerplate server setup with middleware, routing, error handling, and database connection.`,
    custom: customDesc || `Custom module for '${name}'`,
  };

  const description = typeDescriptions[scaffoldType] || customDesc || type;
  const ctx = projectCtx ? `${projectCtx}\n\n` : '';

  const sys = `You are a ${language} architect. Generate production-ready code files.
IMPORTANT: Return ONLY valid JSON in this exact format:
{"files": [{"path": "src/modules/name/file.ts", "content": "...actual code..."}]}
No markdown, no explanation, no code fences around the JSON. Just the JSON object.`;

  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Generate a ${scaffoldType} scaffold for '${name}' in ${language}.\n\nRequirements: ${description}\n\nGenerate all necessary files with complete, working code.` },
  ], 6000);

  const raw = data.choices?.[0]?.message?.content?.trim() ?? '{"files":[]}';
  try {
    const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed  = JSON.parse(cleaned);
    return parsed.files || [];
  } catch {
    // Fallback: return raw as a single file
    return [{ path: `src/${name}/${scaffoldType}.${language === 'typescript' ? 'ts' : 'js'}`, content: raw }];
  }
}

// ── Multi-file refactor ───────────────────────────────────────────────────────
export async function multiRefactor(
  instruction: string,
  files: Array<{ path: string; content: string }>,
  language:    string,
  projectCtx?: string
): Promise<{ files: Array<{ path: string; content: string; summary: string }> }> {
  const ctx = projectCtx ? `${projectCtx}\n\n` : '';
  const fileList = files.map((f, i) =>
    `--- FILE ${i + 1}: ${f.path} ---\n${f.content}`
  ).join('\n\n');

  const sys = `You are a ${language} refactoring expert. Apply the given refactor instruction across all provided files.
IMPORTANT: Return ONLY valid JSON in this exact format:
{"files": [{"path": "original/path.ts", "content": "...refactored code...", "summary": "what changed"}]}
Return ALL files, even unchanged ones. No markdown, no explanation outside JSON.`;

  const data = await deepseekChat('deepseek-coder', [
    { role: 'system', content: sys },
    { role: 'user',   content: `${ctx}Refactor instruction: ${instruction}\n\nFiles to refactor:\n${fileList}` },
  ], 8000);

  const raw = data.choices?.[0]?.message?.content?.trim() ?? '{"files":[]}';
  try {
    const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(cleaned);
  } catch {
    return { files: files.map(f => ({ ...f, summary: 'Parse error — no changes applied' })) };
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export async function chat(messages: Message[], language: string, stream: boolean) {
  const sys: Message = {
    role:    'system',
    content: `You are DevMind AI, an expert ${language} coding assistant embedded in VS Code.
Be concise and practical. Always provide working code in markdown code blocks.
When generating code, use best practices for the detected framework and language.
If the user's active file context is provided, use it to give more relevant answers.`,
  };
  return deepseekChat('deepseek-chat', [sys, ...messages], 3000, stream);
}
