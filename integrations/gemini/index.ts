/**
 * Gemini provider layer — the single, centralized place for ALL AI in the
 * platform. Customer chat, image→product matching, caption generation, and
 * campaign image editing all live here.
 *
 * Design rules:
 *  - Provider functions contain no configurable brand, language, tone, or task
 *    instructions. They require a compiled system instruction from AI Control.
 *  - Functions never throw for "not configured": they return `{ ok:false,
 *    reason:'not_configured' }` so the UI can show a setup state. They DO throw
 *    for genuine API errors so callers can log them to ai_events/integration_logs.
 */
import {
  generateContent,
  generateContentWithTools,
  generateImage,
  parseJsonLoose,
  isGeminiConfigured,
  textModel,
  marketingTextModel,
  visionModel,
  campaignImageModel,
  imageModelChain,
  type GeminiPart,
  type GeminiFunctionDeclaration,
  type ToolExecutor,
  type ToolCallTrace,
} from './client';

export * from './client';

export type AiOk<T> = { ok: true } & T;
export type AiNotConfigured = { ok: false; reason: 'not_configured'; missing: string[] };
export type AiResult<T> = AiOk<T> | AiNotConfigured;

const notConfigured: AiNotConfigured = {
  ok: false,
  reason: 'not_configured',
  missing: ['GEMINI_API_KEY'],
};

/**
 * Generation token ceiling for customer-facing replies. This is a SAFETY cap to
 * stop runaway output. Length and response style remain AI Control concerns.
 */
const CHAT_MAX_TOKENS = 2048;

export interface ProductContext {
  id: string;
  name: string;
  price?: number | null;
  category?: string | null;
  keywords?: string[];
  product_code?: string | null;
  website_url?: string | null;
}

/** ---- 1. Customer chat reply WITH controlled DB tools -------------------- */
export interface ChatReplyWithToolsInput {
  systemPrompt: string;
  /** Stable JSON produced by the central prompt compiler. */
  runtimeData: string;
  temperature?: number;
  maxOutputTokens?: number;
}
/**
 * The database-aware reply path. Tools are executed by the caller-supplied
 * executor; this provider adapter never touches the DB or adds hidden prose.
 */
export async function chatReplyWithTools(
  input: ChatReplyWithToolsInput,
  tools: GeminiFunctionDeclaration[],
  executor: ToolExecutor,
): Promise<AiResult<{ text: string; toolCalls: ToolCallTrace[]; rounds: number; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  if (!input.systemPrompt?.trim()) throw new Error('compiled_system_prompt_required');
  if (!input.runtimeData?.trim()) throw new Error('compiled_runtime_data_required');
  const r = await generateContentWithTools(input.runtimeData, tools, executor, {
    model: textModel(),
    systemInstruction: input.systemPrompt,
    temperature: input.temperature ?? 0.4,
    maxOutputTokens: input.maxOutputTokens ?? CHAT_MAX_TOKENS,
    maxRounds: 3,
  });
  return { ok: true, text: r.text, toolCalls: r.toolCalls, rounds: r.rounds, latencyMs: r.latencyMs, model: r.model };
}

/** ---- 2. Image → product matching --------------------------------------- */
export interface ImageMatch {
  product_id: string | null;
  name: string;
  confidence: number; // 0..1
  reason?: string;
}
export interface MatchResult {
  outcome: 'exact' | 'multiple' | 'none';
  matches: ImageMatch[];
}
export async function matchProductFromImage(args: {
  imageBase64: string;
  mimeType: string;
  candidates: ProductContext[];
  extraText?: string; // image+text => one context chunk
  systemPrompt: string;
}): Promise<AiResult<{ result: MatchResult; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  if (!args.systemPrompt?.trim()) throw new Error('compiled_system_prompt_required');
  const candidateText =
    'Candidate products:\n' +
    args.candidates
      .map((p) => `- [id:${p.id}] ${p.name}${p.category ? ` (${p.category})` : ''}`)
      .join('\n');
  const parts: GeminiPart[] = [
    { text: candidateText + (args.extraText ? `\n\nCustomer also wrote: ${args.extraText}` : '') },
    { inlineData: { mimeType: args.mimeType, data: args.imageBase64 } },
  ];
  const r = await generateContent(parts, {
    model: visionModel(),
    systemInstruction: args.systemPrompt,
    timeoutMs: 25_000,
    json: true,
    temperature: 0.1,
  });
  const parsed = parseJsonLoose<{ ranked?: unknown }>(r.text);
  // Strict validation (EH-022): only ids we actually offered, confidence
  // clamped to [0,1]. A malformed or hallucinated entry is dropped, never
  // propagated into product matching.
  const allowed = new Map(args.candidates.map((c) => [c.id, c.name] as const));
  const matches: ImageMatch[] = validateRanked(parsed?.ranked, allowed).map((item) => ({
    product_id: item.product_id,
    name: allowed.get(item.product_id) ?? '',
    confidence: item.confidence,
    reason: item.reason,
  }));
  const top = matches[0];
  const second = matches[1];
  const exact = !!top && top.confidence >= 0.8 && (!second || top.confidence - second.confidence >= 0.15);
  const result: MatchResult = { outcome: exact ? 'exact' : matches.length ? 'multiple' : 'none', matches };
  return { ok: true, result, latencyMs: r.latencyMs, model: r.model };
}

/** ---- 3b. Vision DESCRIBE a product image (drives real catalog retrieval) -- */
export interface ImageDescription {
  product_type: string | null;        // e.g. "coffee cup", "duvet cover"
  color: string | null;
  material: string | null;
  keywords_en: string[];               // search terms in English
  keywords_ar: string[];               // search terms in Arabic
  code_text: string | null;            // any product code visible in the image
  barcode_text: string | null;         // any barcode digits visible
  summary: string | null;              // one-line description
}
/**
 * Ask the vision model to describe a customer image so we can retrieve REAL
 * candidates from the catalog (instead of guessing against an arbitrary slice).
 * Returns search keywords + any visible code/barcode. No prices, no invented facts.
 */
export async function describeProductImage(args: {
  imageBase64: string;
  mimeType: string;
  extraText?: string;
  systemPrompt: string;
}): Promise<AiResult<{ result: ImageDescription; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  if (!args.systemPrompt?.trim()) throw new Error('compiled_system_prompt_required');
  const parts: GeminiPart[] = [
    { text: args.extraText ? `Customer also wrote: ${args.extraText}` : 'Describe this product.' },
    { inlineData: { mimeType: args.mimeType, data: args.imageBase64 } },
  ];
  const r = await generateContent(parts, { model: visionModel(), systemInstruction: args.systemPrompt, timeoutMs: 25_000, json: true, temperature: 0.1 });
  const parsed = parseJsonLoose<ImageDescription>(r.text) ?? {
    product_type: null, color: null, material: null,
    keywords_en: [], keywords_ar: [], code_text: null, barcode_text: null, summary: null,
  };
  // Normalize arrays defensively.
  parsed.keywords_en = Array.isArray(parsed.keywords_en) ? parsed.keywords_en.filter(Boolean).map(String) : [];
  parsed.keywords_ar = Array.isArray(parsed.keywords_ar) ? parsed.keywords_ar.filter(Boolean).map(String) : [];
  return { ok: true, result: parsed, latencyMs: r.latencyMs, model: r.model };
}

/** ---- 3c. Visual re-rank: compare the customer photo to candidate product
 * images (uses our real product-image database for accurate matching). -------- */
export interface VisualRankItem {
  imageBase64: string;
  mimeType: string;
  id: string;
  name: string;
}

/** One validated entry of a model ranking (never contains an unoffered id). */
export interface RankedProduct {
  product_id: string;
  confidence: number;
  reason?: string;
}
export async function rankProductsByImage(args: {
  customerImageBase64: string;
  customerMimeType: string;
  candidates: VisualRankItem[];
  extraText?: string;
  systemPrompt: string;
}): Promise<AiResult<{ ranked: RankedProduct[]; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  if (args.candidates.length === 0) return { ok: true, ranked: [], latencyMs: 0, model: visionModel() } as any;
  if (!args.systemPrompt?.trim()) throw new Error('compiled_system_prompt_required');
  const parts: GeminiPart[] = [
    { text: `CUSTOMER photo:${args.extraText ? ` (customer also wrote: ${args.extraText})` : ''}` },
    { inlineData: { mimeType: args.customerMimeType, data: args.customerImageBase64 } },
  ];
  for (const c of args.candidates) {
    parts.push({ text: `CANDIDATE [id:${c.id}] ${c.name}` });
    parts.push({ inlineData: { mimeType: c.mimeType, data: c.imageBase64 } });
  }
  const r = await generateContent(parts, { model: visionModel(), systemInstruction: args.systemPrompt, timeoutMs: 25_000, json: true, temperature: 0.1 });
  const parsed = parseJsonLoose<{ ranked?: unknown }>(r.text);
  const allowed = new Map(args.candidates.map((c) => [c.id, c.name] as const));
  return { ok: true, ranked: validateRanked(parsed?.ranked, allowed), latencyMs: r.latencyMs, model: r.model };
}

/**
 * Validate a model "ranked" array against the candidates that were actually
 * offered. Entries with an unknown id, a non-finite confidence or the wrong
 * shape are DROPPED — the model can never introduce a product into the result.
 */
function validateRanked(
  raw: unknown,
  allowed: Map<string, string>,
): RankedProduct[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RankedProduct[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as any).product_id;
    if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) continue;
    const rawConfidence = Number((entry as any).confidence);
    if (!Number.isFinite(rawConfidence)) continue;
    const reason = (entry as any).reason;
    seen.add(id);
    out.push({
      product_id: id,
      confidence: Math.max(0, Math.min(1, rawConfidence)),
      reason: typeof reason === 'string' ? reason.slice(0, 300) : undefined,
    });
  }
  return out;
}

/** ---- 3. Campaign caption ----------------------------------------------- */
export async function caption(args: {
  prompt: string;
  systemPrompt: string;
  temperature?: number;
}): Promise<AiResult<{ text: string; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  if (!args.systemPrompt?.trim()) throw new Error('compiled_system_prompt_required');
  // Caption/headline copy → marketing TEXT model (never the image model).
  const r = await generateContent(args.prompt, {
    model: marketingTextModel(),
    systemInstruction: args.systemPrompt,
    temperature: args.temperature ?? 0.9,
  });
  return { ok: true, text: r.text, latencyMs: r.latencyMs, model: r.model };
}

/** ---- 4. Campaign image edit / generation ------------------------------- */
/**
 * Actual image generation/editing — the ONLY place the strong image model is
 * used. Walks the campaign image-model fallback chain (preferred → fallback →
 * last fallback) and reports exactly which model produced the output and whether
 * a fallback was used, so the admin UI can show it / warn.
 */
export async function editImage(args: {
  prompt: string;
  systemPrompt: string;
  baseImageBase64?: string;
  mimeType?: string;
  temperature?: number;
}): Promise<AiResult<{
  images: { mimeType: string; data: string }[];
  text: string;
  latencyMs: number;
  model: string;
  requestedModel: string;
  fallbackUsed: boolean;
  attempts: { model: string; ok: boolean; error?: string }[];
}>> {
  if (!isGeminiConfigured()) return notConfigured;
  if (!args.systemPrompt?.trim()) throw new Error('compiled_system_prompt_required');
  const parts: GeminiPart[] = [{ text: args.prompt }];
  if (args.baseImageBase64 && args.mimeType) {
    parts.push({ inlineData: { mimeType: args.mimeType, data: args.baseImageBase64 } });
  }
  const r = await generateImage(parts, {
    chain: imageModelChain(campaignImageModel()),
    temperature: args.temperature ?? 0.8,
    systemInstruction: args.systemPrompt,
  });
  return {
    ok: true,
    images: r.images,
    text: r.text,
    latencyMs: r.latencyMs,
    model: r.model,
    requestedModel: r.requestedModel,
    fallbackUsed: r.fallbackUsed,
    attempts: r.attempts,
  };
}

export interface CampaignImageVerification {
  product_fidelity: number;
  product_status: 'acceptable' | 'warning' | 'unacceptable' | 'unverifiable';
  overlay_text_status: 'likely_exact' | 'mismatch' | 'missing' | 'unverifiable' | 'not_requested';
  observed_text: string | null;
  concerns: string[];
}

/** Probabilistic review only. Callers must never present this as pixel-perfect proof. */
export async function verifyCampaignImage(args: {
  systemPrompt: string;
  runtimeData: string;
  sourceImageBase64: string;
  sourceMimeType: string;
  generatedImageBase64: string;
  generatedMimeType: string;
  temperature?: number;
}): Promise<AiResult<{ result: CampaignImageVerification; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  if (!args.systemPrompt?.trim()) throw new Error('compiled_system_prompt_required');
  const parts: GeminiPart[] = [
    { text: args.runtimeData },
    { text: 'SOURCE PRODUCT IMAGE' },
    { inlineData: { mimeType: args.sourceMimeType, data: args.sourceImageBase64 } },
    { text: 'GENERATED CAMPAIGN IMAGE' },
    { inlineData: { mimeType: args.generatedMimeType, data: args.generatedImageBase64 } },
  ];
  const r = await generateContent(parts, {
    model: visionModel(),
    systemInstruction: args.systemPrompt,
    timeoutMs: 25_000,
    json: true,
    temperature: args.temperature ?? 0.1,
  });
  const parsed = parseJsonLoose<CampaignImageVerification>(r.text);
  const result: CampaignImageVerification = parsed ?? {
    product_fidelity: 0,
    product_status: 'unverifiable',
    overlay_text_status: 'unverifiable',
    observed_text: null,
    concerns: ['Vision verification returned no valid result.'],
  };
  result.product_fidelity = Math.max(0, Math.min(1, Number(result.product_fidelity) || 0));
  result.concerns = Array.isArray(result.concerns) ? result.concerns.map(String).slice(0, 10) : [];
  return { ok: true, result, latencyMs: r.latencyMs, model: r.model };
}
