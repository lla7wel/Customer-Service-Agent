/**
 * Tiny runtime-agnostic env reader.
 * Works in Node (process.env) and Cloudflare Workers (env passed in).
 * In Workers, call `setEnv(env)` at the top of your handler.
 */
let injected: Record<string, string | undefined> | null = null;

export function setEnv(env: Record<string, string | undefined>) {
  injected = env;
}

export function env(key: string): string | undefined {
  if (injected && key in injected) return injected[key];
  // eslint-disable-next-line no-process-env
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
}

/** First non-empty value among several env keys (used for prefixed/aliased vars). */
export function envAny(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = env(k);
    if (v && v.trim() !== '') return v;
  }
  return undefined;
}
