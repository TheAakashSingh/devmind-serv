import axios, { AxiosInstance } from 'axios';

// ── Create http client lazily so dotenv has already run ───────────────────────
function makeClient(): AxiosInstance {
  const key  = process.env.DEEPSEEK_API_KEY  || '';
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

  if (!key) {
    console.warn('[DeepSeek] WARNING: DEEPSEEK_API_KEY is not set in .env!');
  }

  return axios.create({
    baseURL:  base,
    timeout:  30_000,
    headers:  { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
}

let _http: AxiosInstance | null = null;
function http(): AxiosInstance {
  if (!_http) _http = makeClient();
  return _http;
}

export interface Message { role: 'system' | 'user' | 'assistant'; content: string; }

// ── Core chat call ────────────────────────────────────────────────────────────
export async function deepseekChat(
  model:     string,
  messages:  Message[],
  maxTokens: number,
  stream     = false
) {
  const res = await http().post('/chat/completions', {
    model,
    messages,
    max_tokens:  maxTokens,
    temperature: 0.2,
    stream,
  }, { responseType: stream ? 'stream' : 'json' });
  return res.data;
}

// ── Inline autocomplete ───────────────────────────────────────────────────────
export async function complete(
  prefix:   string,
  suffix:   string,
  language: string,
  fileName: string
): Promise<string> {
  const data = await deepseekChat('deepseek-chat', [
    {
      role:    'system',
      content: `You are an expert ${language} developer. Complete the code at <CURSOR>. Return ONLY the completion text — no explanation, no markdown fences, no backticks.`,
    },
    {
      role:    'user',
      content: `File: ${fileName}\n\n${prefix}<CURSOR>${suffix}`,
    },
  ], 256);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Code actions ──────────────────────────────────────────────────────────────
export async function codeAction(
  type:     'explain' | 'fix' | 'refactor',
  code:     string,
  language: string
): Promise<string> {
  const systemMap = {
    explain:  `You are an expert ${language} developer. Explain the following code clearly and concisely in plain English. Use bullet points where helpful.`,
    fix:      `You are an expert ${language} developer. Find and fix ALL bugs in the code below. Return ONLY the corrected code — no explanation, no markdown fences.`,
    refactor: `You are an expert ${language} developer. Refactor the code below for readability, performance, and best practices. Return ONLY the refactored code — no explanation, no fences.`,
  };
  const userMap = {
    explain:  `Explain this ${language} code:\n\n${code}`,
    fix:      `Fix all bugs:\n\n${code}`,
    refactor: `Refactor this code:\n\n${code}`,
  };
  const model = type === 'fix' ? 'deepseek-coder' : 'deepseek-chat';
  const data  = await deepseekChat(model, [
    { role: 'system', content: systemMap[type] },
    { role: 'user',   content: userMap[type]   },
  ], 2048);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Generate from natural language prompt ─────────────────────────────────────
export async function generate(prompt: string, language: string): Promise<string> {
  const data = await deepseekChat('deepseek-coder', [
    {
      role:    'system',
      content: `You are an expert ${language} developer. Write clean, production-ready ${language} code. Return ONLY the code — no markdown fences, no explanation, no comments unless necessary.`,
    },
    { role: 'user', content: `Write a ${language} function/module that does the following: ${prompt}` },
  ], 1500);
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Streaming chat ────────────────────────────────────────────────────────────
export async function chat(
  messages: Message[],
  language: string,
  stream:   boolean
) {
  const sys: Message = {
    role:    'system',
    content: `You are DevMind AI, an expert ${language} coding assistant embedded in VS Code. Be concise and practical. Always provide working code examples when relevant.`,
  };
  return deepseekChat('deepseek-chat', [sys, ...messages], 2048, stream);
}
