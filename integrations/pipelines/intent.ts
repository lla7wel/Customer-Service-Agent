/**
 * Deterministic intent classification for the human-attention rules.
 *
 * Business rules (owner brief — cannot be violated):
 *   * ORDER intent → flag human attention + send ONE deterministic handoff
 *     message; never collect order details, never confirm an order, never
 *     loop the handoff; AI keeps answering product questions afterwards.
 *   * complaints / refunds / payment issues / delivery disputes / sensitive
 *     cases → flag human attention; AI still answers ordinary product
 *     questions unless an admin presses Take Over.
 *   * plain delivery-availability questions are answered from verified
 *     Business Facts (delivery exists, pickup exists) — NOT escalated.
 */

export type CustomerIntent =
  | 'order'
  | 'complaint'
  | 'refund_exchange'
  | 'payment_issue'
  | 'delivery_dispute'
  | 'delivery_question'
  | 'product_question'
  | 'other';

const ORDER_RE =
  /(نبي نطلب|نطلبه|نطلبها|نحجز|احجز|نشري|نشتري|شراء|اطلبولي|طلبيه|طلبية|اطلب|أطلب|نأكد الطلب|نكمل الطلب|ندفع|عنواني|هذا عنواني|وصلولي|ابعثولي اياه|order|buy it|reserve|checkout)/i;

const REFUND_RE = /(استرجاع|ترجيع|رد فلوس|فلوسي|refund|استبدال|تبديل|exchange)/i;
const COMPLAINT_RE = /(شكوى|نشتكي|مشكلة|خربان|مكسور|ناقص|غلط في الطلب|complaint|زعلان|سيء جدا|مش عاجب)/i;
const PAYMENT_ISSUE_RE = /(خصم مرتين|دفعت ومارجعش|مشكلة في الدفع|الدفع ما تمش|payment (failed|problem|issue))/i;
const DELIVERY_DISPUTE_RE = /(ما وصلنيش|ما وصلش|وين طلبي|تأخر التوصيل|الطلب متأخر|ضاع الطلب|late delivery|didn'?t arrive|lost order)/i;
const DELIVERY_QUESTION_RE = /(في توصيل|عندكم توصيل|التوصيل متوفر|توصلو|كيف التوصيل|سعر التوصيل|بكم التوصيل|التوصيل لل|do you deliver|delivery)/i;

export interface IntentResult {
  intent: CustomerIntent;
  /** Human attention must be flagged (order/complaint/sensitive/etc.). */
  needsHumanAttention: boolean;
  /** Send the single deterministic order-handoff message. */
  sendOrderHandoff: boolean;
}

export function classifyIntent(text: string): IntentResult {
  const t = (text || '').trim();
  if (!t) return { intent: 'other', needsHumanAttention: false, sendOrderHandoff: false };
  if (ORDER_RE.test(t)) return { intent: 'order', needsHumanAttention: true, sendOrderHandoff: true };
  if (REFUND_RE.test(t)) return { intent: 'refund_exchange', needsHumanAttention: true, sendOrderHandoff: false };
  if (PAYMENT_ISSUE_RE.test(t)) return { intent: 'payment_issue', needsHumanAttention: true, sendOrderHandoff: false };
  if (DELIVERY_DISPUTE_RE.test(t)) return { intent: 'delivery_dispute', needsHumanAttention: true, sendOrderHandoff: false };
  if (COMPLAINT_RE.test(t)) return { intent: 'complaint', needsHumanAttention: true, sendOrderHandoff: false };
  if (DELIVERY_QUESTION_RE.test(t)) return { intent: 'delivery_question', needsHumanAttention: false, sendOrderHandoff: false };
  return { intent: 'other', needsHumanAttention: false, sendOrderHandoff: false };
}

/** Hours within which a repeated order intent does NOT re-send the handoff. */
export const HANDOFF_REPEAT_SUPPRESSION_HOURS = 24;

export function shouldSendHandoff(intent: IntentResult, handoffSentAt: string | Date | null): boolean {
  if (!intent.sendOrderHandoff) return false;
  if (!handoffSentAt) return true;
  const last = new Date(handoffSentAt).getTime();
  return Number.isFinite(last)
    ? Date.now() - last > HANDOFF_REPEAT_SUPPRESSION_HOURS * 3600 * 1000
    : true;
}
