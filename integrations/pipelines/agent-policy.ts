/**
 * Pure agent-turn decision policy. Dependency-free so the EXACT logic that runs
 * in production (messenger pipeline) is the logic covered by tests.
 *
 * There is no legacy escalation workflow here. This policy only decides whether
 * the current turn should use the image matcher or text flow; the Messenger
 * pipeline separately marks needs_human + pauses AI for admin-required cases.
 */

export type AgentAction = 'image_turn' | 'text_turn';

/**
 * Strong, unambiguous price/product cues (safe as substrings).
 * NOTE: bare "كم" is intentionally NOT here — it matches inside common greetings
 * like "عليكم"/"معكم". It is handled as a whole word below.
 */
export const PRODUCT_QUESTION_RE =
  /(بكم|بكام|بقداش|قداش|تشحال|سعر|ثمن|تكلفة|بثمن|price|how much|cost)/i;

/** Whole-word weak cues that count as a product/follow-up question on their own. */
const WEAK_WORD_CUE_RE =
  /(^|[\s,،.؟?!])(كم|كام|نفس|هذا|هذه|هاد|هادا|هادي)([\s,،.؟?!]|$)/i;

export function isProductQuestion(text: string): boolean {
  const t = text || '';
  return PRODUCT_QUESTION_RE.test(t) || WEAK_WORD_CUE_RE.test(t);
}

export interface AgentTurnInput {
  hasCurrentImage: boolean;
  hasRecentUnansweredImage: boolean;
  text: string;
}

/**
 * Decide the turn type. An image (now, or a recent unanswered one when the new
 * text has no other clear product subject) → image turn; otherwise text turn.
 */
export function decideAgentAction(input: AgentTurnInput): AgentAction {
  const text = (input.text || '').trim();
  const considerRecentImage = (!text || isProductQuestion(text)) && input.hasRecentUnansweredImage;
  if (input.hasCurrentImage || considerRecentImage) return 'image_turn';
  return 'text_turn';
}
