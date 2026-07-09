/**
 * Final safety gate for ANY text about to be sent to a customer (Messenger
 * replies, admin-sent messages, campaign captions).
 *
 * It is intentionally conservative: it removes things that must NEVER reach a
 * customer (internal tool/debug/prompt/system text) without mangling normal
 * Libyan-Arabic prose. It is NOT a translator and NOT a length truncator for
 * normal replies — generation-time controls (maxOutputTokens + the length rule
 * in the system prompt) keep replies short; this is the last line of defense.
 */

/** Patterns that look like leaked tool/function calls, e.g. catalog_search(query="..."). */
const TOOL_CALL_RE = /\b[a-z_][a-z0-9_]*\s*\((?:[^()]|\([^()]*\))*\)/gi;

/** Markdown code fences / inline backtick blocks (often wrap leaked JSON/tools). */
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

/** Whole lines that are clearly internal scaffolding, not customer text. */
const INTERNAL_LINE_RE =
  /^\s*(?:\[?(?:situation|context|catalog results?|tool[- ]use policy|hard safety|allowed tool|system|assistant|developer)\b.*|#{1,6}\s+.*|\{[\s\S]*\}|\[[\s\S]*\])\s*$/i;

/**
 * Internal/system terms that must never appear in customer text. Matched
 * case-insensitively as whole words. We strip the term (and an immediately
 * following "(...)" if present) rather than dropping the whole message.
 */
const FORBIDDEN_TERMS = [
  'gemini', 'supabase', 'openai', 'anthropic', 'claude', 'llm',
  'system prompt', 'prompt', 'tool call', 'function call', 'escalation',
  'catalog_search', 'product_code_lookup', 'barcode_lookup', 'active_price_lookup',
  'conversation_memory', 'product_image_matching', 'escalation_creation',
  'order_draft_creation', 'webhook', 'api key', 'json', 'needs_human',
];

const FORBIDDEN_RE = new RegExp(
  `\\b(?:${FORBIDDEN_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b\\s*(?:\\((?:[^()]|\\([^()]*\\))*\\))?`,
  'gi',
);

export interface SanitizeResult {
  text: string;
  changed: boolean;
  removed: string[];
}

/**
 * Clean a customer-bound string. Returns the safe text plus what was removed
 * (for diagnostics/ai_meta — NEVER shown to the customer).
 */
export function sanitizeCustomerTextDetailed(input: string | null | undefined): SanitizeResult {
  const original = (input ?? '').toString();
  if (!original.trim()) return { text: '', changed: false, removed: [] };

  const removed: string[] = [];
  const note = (m: string) => { if (m && m.trim()) removed.push(m.trim().slice(0, 80)); return ''; };

  let t = original;
  t = t.replace(CODE_FENCE_RE, note);
  t = t.replace(INLINE_CODE_RE, note);
  t = t.replace(TOOL_CALL_RE, note);

  // Drop whole internal-scaffolding lines.
  t = t
    .split('\n')
    .filter((line) => {
      if (INTERNAL_LINE_RE.test(line)) { note(line); return false; }
      return true;
    })
    .join('\n');

  t = t.replace(FORBIDDEN_RE, note);

  // Tidy whitespace left behind by removals.
  t = t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();

  return { text: t, changed: t !== original, removed };
}

/** Convenience: just the cleaned string. */
export function sanitizeCustomerText(input: string | null | undefined): string {
  return sanitizeCustomerTextDetailed(input).text;
}
