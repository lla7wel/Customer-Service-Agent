import type { ProductCandidate } from '../tools';

export interface LastImageContextOption {
  option_number: number;
  product_id: string;
  product_code: string | null;
  barcode: string | null;
  name: string;
  price: number | null;
  image: string | null;
  website_url: string | null;
  confidence: number | null;
  retrieval_tracks: string[];
}

export interface LastImageContext {
  kind: 'last_image_context';
  source: 'messenger_image' | 'playground_image' | 'stored_message';
  image_url: string | null;
  image_message_id: string | null;
  outcome: 'exact' | 'multiple' | 'none';
  selected_product_id: string | null;
  candidate_product_ids: string[];
  candidates: ProductCandidate[];
  option_numbers: LastImageContextOption[];
  image_family: string | null;
  confidence: number | null;
  diagnostics: {
    customer_image_hash: string | null;
    correction_match: boolean;
    hash_near_dup: boolean;
    vector_track_used: boolean;
    retrieval_tracks: string[];
  };
  created_at: string;
}

export interface FollowUpDecision {
  candidates: ProductCandidate[];
  /** Typed state for the prompt compiler; wording is owned by AI Control. */
  runtimeState: Record<string, unknown>;
  replyStrategy: 'single_price' | 'single_order_collect' | 'reuse_previous_options' | 'ask_clarify';
  selectedProductId: string | null;
  needsHuman: boolean;
  needsHumanReason: string | null;
}

const PRICE_RE = /(بكم|بكام|بقداش|قداش|تشحال|سعر|ثمن|تكلفة|price|how much|cost)/i;
const REFERENCE_RE = /(نفس|قبل|اللي قبل|هذا|هذه|هاد|هادا|هادي|هذي|this|that|same one|previous|last one)/i;
const ORDER_RE =
  /(نبيها|نبي هادي|نبي هذا|ناخذها|ناخدها|نبي نطلب|نبي نشري|بنطلب|ابيها|أبيها|ابغاها|عايزها|i want it|want this|i'll take it|ill take it|order it|buy it)/i;
const OPTION_ONE_RE = /(^|[\s,،.؟?!])(1|١|واحد|الأول|اول|first)([\s,،.؟?!]|$)/i;
const OPTION_TWO_RE = /(^|[\s,،.؟?!])(2|٢|اثنين|اتنين|الثاني|التاني|second)([\s,،.؟?!]|$)/i;
const OPTION_THREE_RE = /(^|[\s,،.؟?!])(3|٣|ثلاثة|تلاتة|الثالث|التالت|third)([\s,،.؟?!]|$)/i;
const OPTION_FOUR_RE = /(^|[\s,،.؟?!])(4|٤|اربعة|أربعة|الرابع|fourth)([\s,،.؟?!]|$)/i;
const OPTION_FIVE_RE = /(^|[\s,،.؟?!])(5|٥|خمسة|الخامس|fifth)([\s,،.؟?!]|$)/i;

const ADMIN_REQUIRED_RE =
  /(استرجاع|ترجيع|رد فلوس|فلوسي|refund|exchange|استبدال|تبديل|شكوى|نشتكي|مشكلة|complaint|زعلان|سيء|مش عاجب|الدفع|دفع|payment|pay|توصيل|delivery|شحن|وصل|وقت التوصيل|delivery fee|delivery time)/i;

export function isImageContextFollowUp(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  return PRICE_RE.test(t) || REFERENCE_RE.test(t) || ORDER_RE.test(t) || extractOptionNumber(t) != null;
}

export function isOrderIntent(text: string): boolean {
  return ORDER_RE.test(text || '');
}

export function isAdminRequiredText(text: string): boolean {
  return ADMIN_REQUIRED_RE.test(text || '') || isOrderIntent(text);
}

export function adminRequiredReason(text: string): string {
  const t = text || '';
  if (isOrderIntent(t)) return 'order_request';
  if (/(استرجاع|ترجيع|رد فلوس|refund)/i.test(t)) return 'refund_request';
  if (/(exchange|استبدال|تبديل)/i.test(t)) return 'exchange_request';
  if (/(شكوى|نشتكي|مشكلة|complaint|زعلان|سيء|مش عاجب)/i.test(t)) return 'complaint';
  if (/(الدفع|دفع|payment|pay)/i.test(t)) return 'payment_question';
  if (/(توصيل|delivery|شحن|وصل|وقت التوصيل|delivery fee|delivery time)/i.test(t)) return 'delivery_details_request';
  return 'admin_follow_up_required';
}

export function extractOptionNumber(text: string): number | null {
  if (OPTION_ONE_RE.test(text)) return 1;
  if (OPTION_TWO_RE.test(text)) return 2;
  if (OPTION_THREE_RE.test(text)) return 3;
  if (OPTION_FOUR_RE.test(text)) return 4;
  if (OPTION_FIVE_RE.test(text)) return 5;
  return null;
}

export function createLastImageContext(args: {
  source: LastImageContext['source'];
  imageUrl?: string | null;
  imageMessageId?: string | null;
  outcome: LastImageContext['outcome'];
  exactProductId?: string | null;
  candidates: ProductCandidate[];
  diagnostics?: Record<string, unknown>;
  createdAt?: string | null;
}): LastImageContext {
  const candidates = normalizeCandidates(args.candidates);
  const diagnostics = args.diagnostics ?? {};
  const retrievalTracks = Array.from(new Set(candidates.flatMap((c) => c.retrieval_tracks ?? [])));
  return {
    kind: 'last_image_context',
    source: args.source,
    image_url: args.imageUrl ?? null,
    image_message_id: args.imageMessageId ?? null,
    outcome: args.outcome,
    selected_product_id: args.exactProductId ?? null,
    candidate_product_ids: candidates.map((c) => c.id),
    candidates,
    option_numbers: candidates.map((c, i) => ({
      option_number: i + 1,
      product_id: c.id,
      product_code: c.product_code ?? null,
      barcode: c.barcode ?? null,
      name: c.name,
      price: c.price ?? null,
      image: c.image ?? null,
      website_url: c.website_url ?? null,
      confidence: typeof c.confidence === 'number' ? c.confidence : null,
      retrieval_tracks: c.retrieval_tracks ?? [],
    })),
    image_family: textOrNull(diagnostics.gemini_result_summary) ?? textOrNull(diagnostics.image_family),
    confidence: typeof candidates[0]?.confidence === 'number' ? candidates[0].confidence : null,
    diagnostics: {
      customer_image_hash: textOrNull(diagnostics.customer_image_hash),
      correction_match: diagnostics.correction_match === true,
      hash_near_dup: diagnostics.hash_near_dup === true,
      vector_track_used: diagnostics.vector_track_used === true,
      retrieval_tracks: retrievalTracks,
    },
    created_at: args.createdAt ?? new Date().toISOString(),
  };
}

/**
 * How long a remembered image context may be reused for a bare follow-up like
 * "بكم؟" (EH-035). Beyond this the customer is almost certainly talking about
 * something else, and reusing it would quote the wrong product's price.
 */
export const IMAGE_CONTEXT_TTL_MINUTES = 90;

export function isImageContextFresh(
  context: LastImageContext | null,
  ttlMinutes = IMAGE_CONTEXT_TTL_MINUTES,
): boolean {
  if (!context) return false;
  if (!context.created_at) return false;
  const age = Date.now() - new Date(context.created_at).getTime();
  return Number.isFinite(age) && age >= 0 && age <= ttlMinutes * 60_000;
}

export function normalizeLastImageContext(raw: unknown): LastImageContext | null {
  const obj = raw && typeof raw === 'object' ? raw as any : null;
  if (!obj) return null;
  const source = ['messenger_image', 'playground_image', 'stored_message'].includes(obj.source) ? obj.source : 'stored_message';
  const candidates = normalizeCandidates(Array.isArray(obj.candidates) ? obj.candidates : []);
  if (!candidates.length) return null;
  return createLastImageContext({
    source,
    imageUrl: typeof obj.image_url === 'string' ? obj.image_url : null,
    imageMessageId: typeof obj.image_message_id === 'string' ? obj.image_message_id : null,
    outcome: obj.outcome === 'exact' || obj.outcome === 'multiple' || obj.outcome === 'none' ? obj.outcome : inferOutcome(candidates, obj.selected_product_id),
    exactProductId: typeof obj.selected_product_id === 'string' ? obj.selected_product_id : null,
    candidates,
    diagnostics: obj.diagnostics && typeof obj.diagnostics === 'object' ? obj.diagnostics : {},
    createdAt: typeof obj.created_at === 'string' ? obj.created_at : null,
  });
}

/**
 * Decide how to follow up when the customer references an earlier photo (picks an
 * option, asks the price, or says they want it). Returns the structured decision
 * (which candidate, whether a human is needed) plus typed runtime state.
 */
export function decideImageContextFollowUp(context: LastImageContext, text: string): FollowUpDecision {
  const candidates = normalizeCandidates(context.candidates);
  if (!candidates.length) {
    return {
      candidates: [],
      runtimeState: { flow: 'image_followup', result: 'no_safe_match', action: 'clarify_product' },
      replyStrategy: 'ask_clarify',
      selectedProductId: null,
      needsHuman: true,
      needsHumanReason: 'unsafe_image_match',
    };
  }

  const selected = selectCandidate(context, text);
  const orderIntent = isOrderIntent(text);
  if (!selected) {
    return {
      candidates,
      runtimeState: { flow: 'image_followup', result: 'multiple_candidates', action: 'help_select' },
      replyStrategy: 'reuse_previous_options',
      selectedProductId: null,
      needsHuman: false,
      needsHumanReason: null,
    };
  }

  const missingPrice = selected.price == null;
  if (orderIntent) {
    return {
      candidates: [selected],
      runtimeState: { flow: 'image_followup', result: 'selected_product', intent: 'order', missing_price: missingPrice, required_contact_fields: ['name', 'phone', 'address'] },
      replyStrategy: 'single_order_collect',
      selectedProductId: selected.id,
      needsHuman: true,
      needsHumanReason: missingPrice ? 'order_request_missing_price' : 'order_request',
    };
  }

  if (missingPrice) {
    return {
      candidates: [selected],
      runtimeState: { flow: 'image_followup', result: 'selected_product', intent: 'price', missing_price: true },
      replyStrategy: 'single_price',
      selectedProductId: selected.id,
      needsHuman: true,
      needsHumanReason: 'missing_product_price',
    };
  }

  return {
    candidates: [selected],
    runtimeState: { flow: 'image_followup', result: 'selected_product', intent: 'price', missing_price: false },
    replyStrategy: 'single_price',
    selectedProductId: selected.id,
    needsHuman: false,
    needsHumanReason: null,
  };
}

function selectCandidate(context: LastImageContext, text: string): ProductCandidate | null {
  const candidates = normalizeCandidates(context.candidates);
  const option = extractOptionNumber(text);
  if (option != null) return candidates[option - 1] ?? null;
  if (context.selected_product_id) {
    const selected = candidates.find((c) => c.id === context.selected_product_id);
    if (selected) return selected;
  }
  if (context.outcome === 'exact' || candidates.length === 1) return candidates[0] ?? null;
  const [top, second] = candidates;
  if (top && top.confidence >= 0.82 && (!second || top.confidence - second.confidence >= 0.18)) return top;
  return null;
}

function inferOutcome(candidates: ProductCandidate[], selectedProductId: unknown): LastImageContext['outcome'] {
  if (typeof selectedProductId === 'string') return 'exact';
  if (candidates.length === 1) return 'exact';
  return candidates.length ? 'multiple' : 'none';
}

function normalizeCandidates(raw: unknown): ProductCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is ProductCandidate => !!c && typeof c === 'object' && typeof (c as any).id === 'string')
    .map((c: any) => ({
      id: c.id,
      product_code: c.product_code ?? c.code ?? null,
      barcode: c.barcode ?? null,
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'منتج من إنجلش هوم',
      original_name: c.original_name ?? null,
      price: c.price == null ? null : Number(c.price),
      image: c.image ?? null,
      website_url: c.website_url ?? null,
      confidence: typeof c.confidence === 'number' ? c.confidence : 0,
      reason: c.reason ?? null,
      retrieval_tracks: Array.isArray(c.retrieval_tracks) ? c.retrieval_tracks : [],
    }))
    .slice(0, 5);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
