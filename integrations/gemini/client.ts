import { env, envAny } from '../env';
import { geminiStatus } from '../status';

/**
 * Low-level Gemini REST client (no SDK — uses fetch, so it runs in Node 18+,
 * and Next.js). This is the ONLY place that
 * talks to Google. Every higher-level helper (chat, intent, vision, caption,
 * image edit) goes through `generateContent`.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiNotConfiguredError extends Error {
  missing: string[];
  constructor() {
    super('Gemini is not configured. Missing GEMINI_API_KEY. Set GEMINI_API_KEY.');
    this.name = 'GeminiNotConfiguredError';
    this.missing = ['GEMINI_API_KEY'];
  }
}

export function isGeminiConfigured(): boolean {
  return geminiStatus().configured;
}

/*
 * Central model router — the ONLY place model names are chosen. Every Gemini
 * call routes through one of these accessors BY TASK, so the strong/expensive
 * image model is never used for text/classification/captions, and the
 * embedding model is never used for generation.
 */

const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image';

/** Fast, affordable text model: customer replies, order wording, store/delivery
 *  info, product Q&A after tools retrieve data. Never the image model. */
export function textModel(): string {
  return envAny('GEMINI_TEXT_MODEL') || 'gemini-2.5-flash';
}
/** Cheapest reliable model: intent detection, category/safety classification,
 *  follow-up detection, small routing decisions, memory summaries. */
export function routerModel(): string {
  return envAny('GEMINI_ROUTER_MODEL', 'GEMINI_TEXT_MODEL') || 'gemini-2.5-flash-lite';
}
/** Marketing copy: campaign captions and related text tasks.
 *  A normal text model — NEVER the image model. */
export function marketingTextModel(): string {
  return envAny('GEMINI_MARKETING_TEXT_MODEL', 'GEMINI_TEXT_MODEL') || 'gemini-2.5-flash';
}
/** Fast vision-capable model: describing/comparing customer product photos,
 *  product-family detection, image-candidate confirmation. NOT image generation.
 *  NOTE: gemini-2.5-PRO vision was measured at 90s+ on this key (it never
 *  finished within the request budget, so image matching always degraded to
 *  keyword/vector). gemini-2.5-flash returns accurate descriptions in ~3-6s, so
 *  vision ranking actually runs. Override with GEMINI_VISION_MODEL if needed. */
export function visionModel(): string {
  return envAny('GEMINI_VISION_MODEL') || 'gemini-2.5-flash';
}
/** Focused vision model for final Content Studio product/text verification.
 * Verification never renders the creative, so the fast vision model preserves
 * output quality while avoiding a long, expensive second reasoning pass. It is
 * still independently configurable when a different reviewer is required. */
export function creativeVerificationModel(): string {
  return envAny('GEMINI_CREATIVE_VERIFICATION_MODEL') || 'gemini-2.5-flash';
}

/* ---- Image generation / editing (strongest available) -------------------- */
/** Strongest available image model — actual image GENERATION only. */
export function imageModel(): string {
  return envAny('GEMINI_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL;
}
/** Image EDITING model (defaults to the generation model). */
export function imageEditModel(): string {
  return envAny('GEMINI_IMAGE_EDIT_MODEL', 'GEMINI_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL;
}
/** Final Content Studio creative model. It is intentionally independent from
 * generic image-generation overrides so production cannot silently downgrade. */
export function campaignImageModel(): string {
  return envAny('GEMINI_CAMPAIGN_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL;
}
/**
 * Ordered image-model fallback chain: preferred → fallback → last fallback.
 * Image utilities outside final Content Studio generation may be transiently rate-limited;
 * ("high demand"); the chain keeps image generation working and we ALWAYS log /
 * surface which model actually produced the output (never a silent fallback).
 */
export function imageModelChain(preferred?: string): string[] {
  const primary = preferred || imageModel();
  const fb = envAny('GEMINI_IMAGE_FALLBACK_MODEL') || 'gemini-3.1-flash-image-preview';
  const last = envAny('GEMINI_IMAGE_LAST_FALLBACK_MODEL') || 'gemini-2.5-flash-image';
  return [...new Set([primary, fb, last].filter((m): m is string => !!m))];
}

/** Real text-embedding model. Override with GEMINI_EMBEDDING_MODEL.
 * Default `gemini-embedding-001` (current GA model; verified available on the
 * project key, returns 768-dim vectors via outputDimensionality). */
export function embeddingModel(): string {
  return envAny('GEMINI_EMBEDDING_MODEL') || 'gemini-embedding-001';
}
/** Embedding dimensionality (must match what was stored in products.text_embedding). */
export function embeddingDim(): number {
  const v = parseInt((envAny('GEMINI_EMBEDDING_DIM') ?? '').trim(), 10);
  return Number.isFinite(v) && v >= 128 && v <= 3072 ? v : 768;
}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string }; // base64 (no data: prefix)
}

export interface GenerateOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  /** Hard cap on generated tokens. Keeps customer replies short. */
  maxOutputTokens?: number;
  /** Gemini 2.5 thinking budget. Set to 0 for deterministic short-form copy so
   * internal reasoning cannot consume the entire visible-output allowance. */
  thinkingBudget?: number;
  /** Ask the model to return JSON (sets responseMimeType). */
  json?: boolean;
  /** For image generation models. */
  responseModalities?: ('TEXT' | 'IMAGE')[];
  /** Native image output controls supported by Gemini image models. */
  imageConfig?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K' };
  signal?: AbortSignal;
  /** Abort the request after this many ms (default below). Prevents hangs. */
  timeoutMs?: number;
}

/** Default per-call timeout for text/JSON Gemini calls. */
export const DEFAULT_TEXT_TIMEOUT_MS = 30_000;
/** Default per-attempt timeout for a single image-model generation. Deliberately
 *  tight: the strong model is frequently slow/high-demand, so we abort and fall
 *  back rather than let one attempt eat the whole request budget. Two attempts
 *  (≈25s + a ≈30s working fallback) then comfortably fit a 90s function budget. */
export const DEFAULT_IMAGE_TIMEOUT_MS = 120_000;
/** Default timeout for a single embedding call. */
export const DEFAULT_EMBED_TIMEOUT_MS = 12_000;
/** Default timeout for ONE round of the tool-calling loop. */
export const DEFAULT_TOOL_ROUND_TIMEOUT_MS = 30_000;

/**
 * Build an AbortSignal that fires when EITHER the caller's signal aborts or the
 * timeout elapses. Returns the signal plus a cleanup fn to clear the timer.
 * `timedOut` is readable after the fact so callers can label the error.
 */
function timeoutSignal(timeoutMs: number, external?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const ctrl = new AbortController();
  let didTimeout = false;
  const onAbort = () => ctrl.abort();
  const timer = setTimeout(() => { didTimeout = true; ctrl.abort(); }, timeoutMs);
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => { clearTimeout(timer); external?.removeEventListener('abort', onAbort); },
    timedOut: () => didTimeout,
  };
}

export interface GenerateResult {
  text: string;
  /** base64 images returned by image-capable models. */
  images: { mimeType: string; data: string }[];
  raw: unknown;
  latencyMs: number;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Core call. Throws GeminiNotConfiguredError if no key. */
export async function generateContent(
  parts: GeminiPart[] | string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const apiKey = env('GEMINI_API_KEY');
  if (!apiKey) throw new GeminiNotConfiguredError();

  const model = opts.model || textModel();
  const contentParts: GeminiPart[] =
    typeof parts === 'string' ? [{ text: parts }] : parts;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: contentParts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      ...(opts.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } } : {}),
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      ...(opts.responseModalities ? { responseModalities: opts.responseModalities } : {}),
      ...(opts.imageConfig ? { imageConfig: opts.imageConfig } : {}),
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const started = Date.now();
  const isImage = !!opts.responseModalities?.includes('IMAGE');
  const to = timeoutSignal(
    opts.timeoutMs ?? (isImage ? DEFAULT_IMAGE_TIMEOUT_MS : DEFAULT_TEXT_TIMEOUT_MS),
    opts.signal,
  );
  let res: Response;
  try {
    res = await fetch(`${BASE}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: to.signal,
    });
  } catch (e: any) {
    to.cleanup();
    if (to.timedOut() || e?.name === 'AbortError') {
      const err = new Error(`Gemini ${model} timed out after ${opts.timeoutMs ?? (isImage ? DEFAULT_IMAGE_TIMEOUT_MS : DEFAULT_TEXT_TIMEOUT_MS)}ms`);
      (err as any).status = 504;
      (err as any).timeout = true;
      throw err;
    }
    throw e;
  }
  to.cleanup();
  const latencyMs = Date.now() - started;
  const data = (await res.json()) as any;

  if (!res.ok) {
    const msg = data?.error?.message || `Gemini HTTP ${res.status}`;
    const err = new Error(msg);
    (err as any).status = res.status;
    throw err;
  }

  const candidate = data?.candidates?.[0];
  const outParts: any[] = candidate?.content?.parts ?? [];
  const text = outParts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  const images = outParts
    .filter((p) => p?.inlineData?.data)
    .map((p) => ({ mimeType: p.inlineData.mimeType as string, data: p.inlineData.data as string }));

  return {
    text,
    images,
    raw: data,
    latencyMs,
    model,
    usage: {
      inputTokens: data?.usageMetadata?.promptTokenCount,
      outputTokens: data?.usageMetadata?.candidatesTokenCount,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Image generation / editing with explicit fallback chain                    */
/* -------------------------------------------------------------------------- */

export interface ImageGenAttempt {
  model: string;
  ok: boolean;
  error?: string;
}
export interface ImageGenResult {
  images: { mimeType: string; data: string }[];
  text: string;
  latencyMs: number;
  /** Model that actually produced the output. */
  model: string;
  /** First (preferred) model that was requested. */
  requestedModel: string;
  /** True when a model other than the preferred one produced the output. */
  fallbackUsed: boolean;
  /** Per-model trace (for admin debug / logging). */
  attempts: ImageGenAttempt[];
}

/**
 * Generate/edit an image, walking the model fallback chain until one returns an
 * image. Never silently falls back: every attempt is recorded in `attempts`,
 * `fallbackUsed`/`model` tell the caller exactly what ran, and a console.warn is
 * emitted on fallback so it shows up in server logs.
 */
export async function generateImage(
  parts: GeminiPart[] | string,
  opts: {
    chain?: string[];
    temperature?: number;
    signal?: AbortSignal;
    perAttemptTimeoutMs?: number;
    systemInstruction?: string;
    imageConfig?: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K' };
  } = {},
): Promise<ImageGenResult> {
  const apiKey = env('GEMINI_API_KEY');
  if (!apiKey) throw new GeminiNotConfiguredError();
  const chain = opts.chain && opts.chain.length ? opts.chain : imageModelChain();
  const requestedModel = chain[0];
  const attempts: ImageGenAttempt[] = [];
  const started = Date.now();
  const perAttempt = opts.perAttemptTimeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;

  for (const model of chain) {
    try {
      const r = await generateContent(parts, {
        model,
        responseModalities: ['TEXT', 'IMAGE'],
        temperature: opts.temperature ?? 0.8,
        systemInstruction: opts.systemInstruction,
        signal: opts.signal,
        timeoutMs: perAttempt,
        imageConfig: opts.imageConfig,
      });
      if (r.images.length) {
        attempts.push({ model, ok: true });
        const fallbackUsed = model !== requestedModel;
        if (fallbackUsed) {
          // eslint-disable-next-line no-console
          console.warn(
            `[gemini] image model fallback: "${requestedModel}" unavailable, used "${model}". ` +
              `Trace: ${attempts.map((a) => `${a.model}=${a.ok ? 'ok' : a.error}`).join(' → ')}`,
          );
        }
        return {
          images: r.images,
          text: r.text,
          latencyMs: Date.now() - started,
          model,
          requestedModel,
          fallbackUsed,
          attempts,
        };
      }
      attempts.push({ model, ok: false, error: 'no_image_returned' });
    } catch (e: any) {
      attempts.push({ model, ok: false, error: e?.message ?? 'error' });
    }
  }
  // Whole chain failed — surface a precise error including each attempt.
  const detail = attempts.map((a) => `${a.model}: ${a.error}`).join('; ');
  const err = new Error(`All image models failed — ${detail}`);
  (err as any).attempts = attempts;
  throw err;
}

/* -------------------------------------------------------------------------- */
/* Real text embeddings (semantic vector search)                              */
/* -------------------------------------------------------------------------- */

export interface EmbedResult {
  values: number[] | null;
  model: string;
}

/**
 * Generate a REAL embedding vector for a piece of text using the Gemini
 * embedding model. Returns { values: null } (never a fake/zero vector) when the
 * key is missing or the call fails, so callers can safely skip vector search.
 */
export async function embedText(
  text: string,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_QUERY',
): Promise<EmbedResult> {
  const apiKey = env('GEMINI_API_KEY');
  const model = embeddingModel();
  const trimmed = (text ?? '').trim();
  if (!apiKey || !trimmed) return { values: null, model };
  try {
    const body: Record<string, unknown> = {
      model: `models/${model}`,
      content: { parts: [{ text: trimmed.slice(0, 8000) }] },
      taskType,
      outputDimensionality: embeddingDim(),
    };
    // Bounded: an embedding call must never hang a customer turn (EH-004).
    const to = timeoutSignal(DEFAULT_EMBED_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${model}:embedContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: to.signal,
      });
    } finally {
      to.cleanup();
    }
    if (!res.ok) return { values: null, model };
    const data = (await res.json()) as any;
    // embedContent → data.embedding.values ; some variants → data.embeddings[0].values
    const values: unknown = data?.embedding?.values ?? data?.embeddings?.[0]?.values ?? null;
    if (!Array.isArray(values) || values.length === 0) return { values: null, model };
    return { values: values.map((n: any) => Number(n)), model };
  } catch {
    return { values: null, model };
  }
}

/* -------------------------------------------------------------------------- */
/* Function calling (controlled DB tools exposed to the model)                */
/* -------------------------------------------------------------------------- */

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; items?: { type: string } }>;
    required?: string[];
  };
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
}

export interface GenerateWithToolsResult {
  text: string;
  toolCalls: ToolCallTrace[];
  rounds: number;
  model: string;
  latencyMs: number;
}

/**
 * Multi-round function-calling loop. The model may call the provided READ tools
 * (executed by `executor`) up to `maxRounds` times, then must produce a final
 * text answer. The executor is supplied by the caller — this client never
 * touches the database directly. Falls back to a plain answer if the model does
 * not call any tool.
 */
export async function generateContentWithTools(
  initialParts: GeminiPart[] | string,
  tools: GeminiFunctionDeclaration[],
  executor: ToolExecutor,
  opts: GenerateOptions & { maxRounds?: number } = {},
): Promise<GenerateWithToolsResult> {
  const apiKey = env('GEMINI_API_KEY');
  if (!apiKey) throw new GeminiNotConfiguredError();
  const model = opts.model || textModel();
  const maxRounds = opts.maxRounds ?? 3;

  const firstParts: GeminiPart[] = typeof initialParts === 'string' ? [{ text: initialParts }] : initialParts;
  const contents: any[] = [{ role: 'user', parts: firstParts }];
  const toolCalls: ToolCallTrace[] = [];
  const started = Date.now();
  let rounds = 0;

  const baseBody: Record<string, unknown> = {
    tools: [{ functionDeclarations: tools }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    },
    ...(opts.systemInstruction ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } } : {}),
  };

  for (let i = 0; i <= maxRounds; i++) {
    rounds = i;
    // Every round is individually bounded so a stalled provider can never hang
    // a customer turn or a worker job (EH-004).
    const to = timeoutSignal(opts.timeoutMs ?? DEFAULT_TOOL_ROUND_TIMEOUT_MS, opts.signal);
    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...baseBody, contents }),
        signal: to.signal,
      });
    } catch (e: any) {
      if (to.timedOut()) {
        const err = new Error(`Gemini tool call timed out after ${opts.timeoutMs ?? DEFAULT_TOOL_ROUND_TIMEOUT_MS}ms`);
        (err as any).timeout = true;
        throw err;
      }
      throw e;
    } finally {
      to.cleanup();
    }
    const data = (await res.json()) as any;
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini HTTP ${res.status}`;
      const err = new Error(msg);
      (err as any).status = res.status;
      throw err;
    }
    const candidate = data?.candidates?.[0];
    const parts: any[] = candidate?.content?.parts ?? [];
    const calls = parts.filter((p) => p?.functionCall).map((p) => p.functionCall);

    if (!calls.length || i === maxRounds) {
      const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
      return { text, toolCalls, rounds, model, latencyMs: Date.now() - started };
    }

    // Record the model turn, execute each requested tool, feed results back.
    contents.push({ role: 'model', parts });
    const responseParts: any[] = [];
    for (const call of calls) {
      const name = String(call?.name ?? '');
      const args = (call?.args ?? {}) as Record<string, unknown>;
      toolCalls.push({ name, args });
      let result: unknown;
      try {
        result = await executor(name, args);
      } catch (e: any) {
        result = { error: e?.message ?? 'tool_error' };
      }
      responseParts.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { text: '', toolCalls, rounds, model, latencyMs: Date.now() - started };
}

/** Best-effort JSON parse from a model response (handles ```json fences). */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(t.slice(first, last + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
