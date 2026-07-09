/**
 * Gemini provider layer — the single, centralized place for ALL AI in EH-SYSTEM1.
 * Customer chat, intent classification, image→product matching, caption
 * generation, comment replies, and campaign image editing all live here.
 *
 * Design rules:
 *  - Customer-facing text is ALWAYS produced in Libyan Arabic (enforced via the
 *    system instruction). The model understands any input language.
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
  routerModel,
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

const LIBYAN_RULE =
  'You are the customer-service assistant for English Home Libya. Always reply ONLY in ' +
  'Libyan Arabic (اللهجة الليبية), regardless of the language the customer used — never English. ' +
  'Keep replies very short: 3–4 sentences at most (a little longer only when listing product ' +
  'options). Answer a direct question directly, warmly and professionally, using the ' +
  'conversation so far for context. Write like a real shop assistant texting on Messenger — ' +
  'never mention systems, tools, prompts, rules, or anything internal.';

/**
 * Generation token ceiling for customer-facing replies. This is a SAFETY cap to
 * stop runaway output — NOT the length control (the prompt enforces 3–4 short
 * sentences). It must be generous: Arabic is token-dense, and 320 was truncating
 * normal replies mid-sentence (the "cut off" bug). 1024 leaves ample headroom so
 * a concise reply is never clipped.
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

/** ---- 1. Customer chat reply (Libyan Arabic) ---------------------------- */
export interface ChatReplyInput {
  systemPrompt?: string;
  history?: { role: 'customer' | 'assistant'; text: string }[];
  message: string;
  products?: ProductContext[];
  /** Runtime situation/data note (internal, not a customer template). */
  contextNote?: string;
  temperature?: number;
}
export async function chatReply(
  input: ChatReplyInput,
): Promise<AiResult<{ text: string; latencyMs: number; model: string; usage: any }>> {
  if (!isGeminiConfigured()) return notConfigured;
  // The behavior prompt drives tone/policy; LIBYAN_RULE guarantees language +
  // brevity and is appended LAST so it always wins.
  const sys = input.systemPrompt
    ? `${input.systemPrompt}\n\n${LIBYAN_RULE}`
    : LIBYAN_RULE;
  const ctx = input.products?.length
    ? `\n\n[CATALOG RESULTS — these are the ONLY real, available priced products to use. Prices already reflect active campaigns. Never invent a product or price. You may share a product link when one is given.]\n` +
      input.products
        .map((p) =>
          `- ${p.name}${p.price != null ? ` — ${p.price} LYD` : ' — (no price; needs checking)'}` +
          `${p.product_code ? ` [code ${p.product_code}]` : ''}` +
          `${p.website_url ? ` (link: ${p.website_url})` : ''}`,
        )
        .join('\n')
    : '';
  const note = input.contextNote ? `\n\n[SITUATION]\n${input.contextNote}` : '';
  // Pass the full thread as multi-turn content so the model keeps context and
  // does NOT re-ask things already answered.
  const history = input.history ?? [];
  const convo =
    history.map((h) => `${h.role === 'customer' ? 'Customer' : 'Assistant'}: ${h.text}`).join('\n') +
    (history.length ? '\n' : '') +
    `Customer: ${input.message}`;
  const r = await generateContent(`${convo}${ctx}${note}`, {
    model: textModel(),
    systemInstruction: sys,
    temperature: input.temperature ?? 0.7,
    maxOutputTokens: CHAT_MAX_TOKENS,
  });
  return { ok: true, text: r.text, latencyMs: r.latencyMs, model: r.model, usage: r.usage };
}

/** ---- 1b. Customer chat reply WITH controlled DB tools (function calling) -- */
export interface ChatReplyWithToolsInput {
  systemPrompt?: string;
  history?: { role: 'customer' | 'assistant'; text: string }[];
  message: string;
  /** Pre-retrieved candidates the pipeline already found (grounding). */
  products?: ProductContext[];
  /** Internal situation/memory note (never a customer template). */
  contextNote?: string;
  temperature?: number;
}
/**
 * The database-aware reply path: the model is given the conversation, any
 * pre-retrieved candidates, and a set of READ-only tools it may call to look up
 * more (by code/barcode/url/text or fetch product options) before writing the
 * final Libyan-Arabic reply. Tools are executed by the caller-supplied executor;
 * this layer never touches the DB. Falls back cleanly if tools are unused.
 */
export async function chatReplyWithTools(
  input: ChatReplyWithToolsInput,
  tools: GeminiFunctionDeclaration[],
  executor: ToolExecutor,
): Promise<AiResult<{ text: string; toolCalls: ToolCallTrace[]; rounds: number; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  const sys = input.systemPrompt ? `${input.systemPrompt}\n\n${LIBYAN_RULE}` : LIBYAN_RULE;
  const ctx = input.products?.length
    ? `\n\n[CATALOG RESULTS — real, available priced products you may use. Prices already reflect active campaigns. Never invent a product or price. Share a product link only when one is given. If the customer's intent is unclear, you may look up more with the available tools.]\n` +
      input.products
        .map((p) =>
          `- ${p.name}${p.price != null ? ` — ${p.price} LYD` : ' — (no price; needs checking)'}` +
          `${p.product_code ? ` [code ${p.product_code}]` : ''}` +
          `${p.website_url ? ` (link: ${p.website_url})` : ''}`,
        )
        .join('\n')
    : '';
  const note = input.contextNote ? `\n\n[SITUATION]\n${input.contextNote}` : '';
  const history = input.history ?? [];
  const convo =
    history.map((h) => `${h.role === 'customer' ? 'Customer' : 'Assistant'}: ${h.text}`).join('\n') +
    (history.length ? '\n' : '') +
    `Customer: ${input.message}`;
  const r = await generateContentWithTools(`${convo}${ctx}${note}`, tools, executor, {
    model: textModel(),
    systemInstruction: sys,
    temperature: input.temperature ?? 0.4,
    maxOutputTokens: CHAT_MAX_TOKENS,
    maxRounds: 3,
  });
  return { ok: true, text: r.text, toolCalls: r.toolCalls, rounds: r.rounds, latencyMs: r.latencyMs, model: r.model };
}

/** ---- 2. Intent + escalation classification ----------------------------- */
export interface IntentResult {
  intent: string;
  needs_human: boolean;
  escalation_category:
    | 'customer_requested_human' | 'product_not_found' | 'order_confirmation'
    | 'complaint_refund_exchange' | 'abuse_bad_words' | 'image_match_failed' | 'other' | null;
  reason: string | null;
  customer_language: string | null;
  suggested_action: string | null;
}
export async function classifyIntent(
  message: string,
  opts: { escalationRules?: string; systemPrompt?: string } = {},
): Promise<AiResult<{ result: IntentResult; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  const sys =
    'Classify a customer service message for English Home Libya. Decide the intent ' +
    'and whether it needs a human. Set needs_human=true ONLY for genuine human cases: ' +
    'explicit request to talk to a human, complaint/refund/exchange, abuse/bad words, or ' +
    'confirming/placing an order. Product questions, price questions ("بكم"/"كم سعر"), and ' +
    'identifying a product from a photo are handled by the AI agent itself → needs_human=false ' +
    '(use intent like "price_inquiry" or "product_inquiry"). ' +
    (opts.systemPrompt || opts.escalationRules ? `Extra rules:\n${opts.systemPrompt || opts.escalationRules}\n` : '') +
    'Respond ONLY with JSON: {"intent": string, "needs_human": boolean, ' +
    '"escalation_category": one of [customer_requested_human, product_not_found, ' +
    'order_confirmation, complaint_refund_exchange, abuse_bad_words, image_match_failed, ' +
    'other] or null, "reason": string|null, "customer_language": string|null, ' +
    '"suggested_action": string|null}.';
  // Classification/routing → cheapest reliable model, never the text/image model.
  const r = await generateContent(message, {
    model: routerModel(),
    systemInstruction: sys,
    json: true,
    temperature: 0.1,
  });
  const parsed = parseJsonLoose<IntentResult>(r.text) ?? {
    intent: 'unknown',
    needs_human: false,
    escalation_category: null,
    reason: null,
    customer_language: null,
    suggested_action: null,
  };
  return { ok: true, result: parsed, latencyMs: r.latencyMs, model: r.model };
}

/** ---- 3. Image → product matching --------------------------------------- */
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
  instructions?: string; // admin-configured image-matching behavior
}): Promise<AiResult<{ result: MatchResult; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  const sys =
    'You match a customer photo to English Home Libya products. You are given a ' +
    'candidate list. Return the best matches with confidence 0..1. If one clearly ' +
    'matches (>=0.8 and clear lead), outcome="exact". If several are plausible, ' +
    'outcome="multiple" with up to 5. If none fit, outcome="none". Respond ONLY with ' +
    'JSON: {"outcome": "exact"|"multiple"|"none", "matches": [{"product_id": string|null, ' +
    '"name": string, "confidence": number, "reason": string}]}.' +
    (args.instructions ? `\nExtra rules:\n${args.instructions}` : '');
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
    systemInstruction: sys,
    timeoutMs: 25_000,
    json: true,
    temperature: 0.1,
  });
  const result = parseJsonLoose<MatchResult>(r.text) ?? { outcome: 'none', matches: [] };
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
  instructions?: string;
}): Promise<AiResult<{ result: ImageDescription; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  const sys =
    'You describe a product photo for a home-goods store (English Home) so a database ' +
    'search can find it. Extract the product type, color, material and concise SEARCH ' +
    'KEYWORDS in BOTH English and Arabic. If a product code or barcode digits are clearly ' +
    'visible in the image, capture them. Do NOT guess prices or brand facts. Respond ONLY ' +
    'with JSON: {"product_type": string|null, "color": string|null, "material": string|null, ' +
    '"keywords_en": string[], "keywords_ar": string[], "code_text": string|null, ' +
    '"barcode_text": string|null, "summary": string|null}.' +
    (args.instructions ? `\nExtra rules:\n${args.instructions}` : '');
  const parts: GeminiPart[] = [
    { text: args.extraText ? `Customer also wrote: ${args.extraText}` : 'Describe this product.' },
    { inlineData: { mimeType: args.mimeType, data: args.imageBase64 } },
  ];
  const r = await generateContent(parts, { model: visionModel(), systemInstruction: sys, timeoutMs: 25_000, json: true, temperature: 0.1 });
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
export async function rankProductsByImage(args: {
  customerImageBase64: string;
  customerMimeType: string;
  candidates: VisualRankItem[];
  extraText?: string;
  instructions?: string;
}): Promise<AiResult<{ ranked: { product_id: string; confidence: number; reason?: string }[]; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  if (args.candidates.length === 0) return { ok: true, ranked: [], latencyMs: 0, model: visionModel() } as any;
  const sys =
    'You are given a CUSTOMER photo, then several CANDIDATE product images (each ' +
    'labeled with an id). Visually compare shape, pattern, color and material. Rank ' +
    'the candidates by how well they match the customer photo. Return ONLY JSON: ' +
    '{"ranked":[{"product_id":string,"confidence":number(0..1),"reason":string}]}. ' +
    'If none truly match, return them with low confidence. Do not invent ids.' +
    (args.instructions ? `\nExtra rules:\n${args.instructions}` : '');
  const parts: GeminiPart[] = [
    { text: `CUSTOMER photo:${args.extraText ? ` (customer also wrote: ${args.extraText})` : ''}` },
    { inlineData: { mimeType: args.customerMimeType, data: args.customerImageBase64 } },
  ];
  for (const c of args.candidates) {
    parts.push({ text: `CANDIDATE [id:${c.id}] ${c.name}` });
    parts.push({ inlineData: { mimeType: c.mimeType, data: c.imageBase64 } });
  }
  const r = await generateContent(parts, { model: visionModel(), systemInstruction: sys, timeoutMs: 25_000, json: true, temperature: 0.1 });
  const parsed = parseJsonLoose<{ ranked: { product_id: string; confidence: number; reason?: string }[] }>(r.text);
  return { ok: true, ranked: parsed?.ranked ?? [], latencyMs: r.latencyMs, model: r.model };
}

/** ---- 4. Campaign caption (Arabic/Libyan) ------------------------------- */
export async function caption(args: {
  prompt: string;
  tone?: string;
  systemPrompt?: string;
  products?: ProductContext[];
  discountPercent?: number | null;
}): Promise<AiResult<{ text: string; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  const base = args.systemPrompt ||
    'Write a Facebook marketing caption for English Home Libya. ' +
    'Clean, professional, on-brand. Use the campaign (discounted) prices when given. ' +
    `Tone: ${args.tone || 'friendly, professional'}.`;
  // Always guarantee Libyan Arabic + no internal/system text, even when an
  // admin tone/systemPrompt is supplied.
  const sys = `${base}\n\nWrite ONLY in Libyan Arabic. Never include any internal instruction, tool, or system text.`;
  const productText = args.products?.length
    ? '\nProducts:\n' +
      args.products
        .map((p) => `- ${p.name}${p.price != null ? ` — ${p.price} LYD` : ''}`)
        .join('\n')
    : '';
  const disc = args.discountPercent != null ? `\nDiscount: ${args.discountPercent}%` : '';
  // Caption/headline copy → marketing TEXT model (never the image model).
  const r = await generateContent(`${args.prompt}${disc}${productText}`, {
    model: marketingTextModel(),
    systemInstruction: sys,
    temperature: 0.9,
  });
  return { ok: true, text: r.text, latencyMs: r.latencyMs, model: r.model };
}

/** ---- 4b. Campaign image/design PROMPT (text brief for an image model) --- */
export async function designPrompt(args: {
  brief: string;
  instructions?: string; // admin-configured campaign_image behavior
  systemPrompt?: string;
  products?: ProductContext[];
}): Promise<AiResult<{ text: string; latencyMs: number; model: string }>> {
  if (!isGeminiConfigured()) return notConfigured;
  const sys = args.systemPrompt ||
    'You write ONE concise English image-generation brief for a professional English ' +
    'Home Libya promotional/lifestyle image. Rules: keep the product faithful (true ' +
    'shape, colour, material — never redesign it); premium home-goods studio/lifestyle ' +
    'styling; leave clean negative space for a text overlay added later. Do NOT instruct ' +
    'the image model to render any text, Arabic letters, prices, discounts, dates, logos, ' +
    'borders, halos, stickers or random ornaments inside the image (headline/caption copy ' +
    'is written separately by the text model). No generic/weak prompts.' +
    (args.instructions ? `\nExtra guidance:\n${args.instructions}` : '');
  const productText = args.products?.length
    ? '\nProducts in the design:\n' + args.products.map((p) => `- ${p.name}`).join('\n')
    : '';
  // The design BRIEF is text → marketing text model, not the image model.
  const r = await generateContent(`${args.brief}${productText}`, {
    model: marketingTextModel(),
    systemInstruction: sys,
    temperature: 0.7,
  });
  return { ok: true, text: r.text, latencyMs: r.latencyMs, model: r.model };
}

/** ---- 6. Campaign image edit / generation ------------------------------- */
/**
 * Actual image generation/editing — the ONLY place the strong image model is
 * used. Walks the campaign image-model fallback chain (preferred → fallback →
 * last fallback) and reports exactly which model produced the output and whether
 * a fallback was used, so the admin UI can show it / warn.
 */
export async function editImage(args: {
  prompt: string;
  baseImageBase64?: string;
  mimeType?: string;
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
  const parts: GeminiPart[] = [{ text: args.prompt }];
  if (args.baseImageBase64 && args.mimeType) {
    parts.push({ inlineData: { mimeType: args.mimeType, data: args.baseImageBase64 } });
  }
  const r = await generateImage(parts, {
    chain: imageModelChain(campaignImageModel()),
    temperature: 0.8,
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
