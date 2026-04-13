type Candidate = { path: string; content: string };
type RetrievalResult = { path: string; score: number; reason: string };

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter(Boolean)
    .slice(0, 24);
}

function extractSymbols(content: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g,
    /\bexport\s+(?:class|function|const|type|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    /\btype\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null = null;
    while ((m = p.exec(content))) out.add(m[1].toLowerCase());
  }
  return [...out];
}

export function rankRelevant(query: string, candidates: Candidate[], limit = 8): RetrievalResult[] {
  const qTokens = tokenize(query);
  return candidates
    .map((c) => {
      const pathLower = c.path.toLowerCase();
      const contentLower = String(c.content || '').toLowerCase();
      const symbols = extractSymbols(contentLower);
      let score = 0;
      const reasons: string[] = [];
      for (const t of qTokens) {
        if (pathLower.includes(t)) { score += 22; reasons.push(`path:${t}`); }
        if (contentLower.includes(t)) { score += 10; reasons.push(`content:${t}`); }
        if (symbols.some((s) => s.includes(t))) { score += 28; reasons.push(`symbol:${t}`); }
      }
      if (/route|controller|endpoint/i.test(pathLower) && /api|endpoint|route/i.test(query)) score += 12;
      if (/service/i.test(pathLower) && /service|logic|business/i.test(query)) score += 12;
      if (/schema|migration|model/i.test(pathLower) && /db|schema|table|sql/i.test(query)) score += 12;
      return {
        path: c.path,
        score,
        reason: reasons.slice(0, 4).join(', ') || 'fallback-rank',
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
