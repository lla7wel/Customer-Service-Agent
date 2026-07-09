import { strict as assert } from 'node:assert';
import {
  composeBehaviorContext,
  type BehaviorMap,
} from '../integrations/ai-behaviors';
import { decideAgentAction, isProductQuestion } from '../integrations/pipelines/agent-policy';

// The reduced, system-controlled behavior set (no escalation, no facebook_comment).
function behaviorMap(overrides: Partial<BehaviorMap> = {}): BehaviorMap {
  return {
    customer_service: { behavior_key: 'customer_service', title: 'Customer service', prompt: 'CUSTOMER SERVICE PROMPT v1', rules: 'CUSTOMER SERVICE RULES', memory: null, enabled: true, updated_at: '2026-06-01T00:00:00Z' },
    reply_language: { behavior_key: 'reply_language', title: 'Reply language', prompt: 'Reply in Libyan Arabic.', rules: null, memory: null, enabled: true, updated_at: '2026-06-01T00:00:01Z' },
    product_recommendation: { behavior_key: 'product_recommendation', title: 'Product recommendation', prompt: null, rules: 'Use active priced catalog products only.', memory: null, enabled: true, updated_at: '2026-06-01T00:00:02Z' },
    image_matching: { behavior_key: 'image_matching', title: 'Image matching', prompt: 'Show up to 5 candidate products when uncertain.', rules: 'Exact DB image should resolve to linked product.', memory: null, enabled: true, updated_at: '2026-06-01T00:00:03Z' },
    campaign_caption: { behavior_key: 'campaign_caption', title: 'Campaign captions', prompt: null, rules: 'Campaign captions should be friendly and sales-focused.', memory: null, enabled: true, updated_at: '2026-06-01T00:00:05Z' },
    campaign_image: { behavior_key: 'campaign_image', title: 'Campaign image', prompt: 'No fake text, prices, or discounts in generated images.', rules: null, memory: null, enabled: true, updated_at: '2026-06-01T00:00:06Z' },
    missing_price: { behavior_key: 'missing_price', title: 'Missing price', prompt: null, rules: 'Never invent prices; the team will confirm.', memory: null, enabled: true, updated_at: '2026-06-01T00:00:07Z' },
    memory_context: { behavior_key: 'memory_context', title: 'Memory', prompt: null, rules: null, memory: 'Store facts are shared here.', enabled: true, updated_at: '2026-06-01T00:00:09Z' },
    ...overrides,
  };
}

function includes(ctx: ReturnType<typeof composeBehaviorContext>, text: string) {
  assert.ok(ctx.systemPrompt.includes(text), `Expected prompt to include: ${text}`);
}

const messenger = composeBehaviorContext(behaviorMap(), 'messenger');
includes(messenger, 'CUSTOMER SERVICE PROMPT v1');
includes(messenger, 'Use active priced catalog products only.');
includes(messenger, 'Never invent prices');
assert.ok(messenger.metadata.tools_allowed.includes('catalog_search'));
assert.ok(messenger.metadata.tools_allowed.includes('product_image_matching'));
assert.ok(messenger.metadata.tools_allowed.includes('vector_search'));
// Escalation behavior is gone entirely.
assert.ok(!messenger.behaviorKeys.includes('escalation'), 'escalation behavior must be removed');

const changed = composeBehaviorContext(behaviorMap({
  customer_service: { behavior_key: 'customer_service', title: 'Customer service', prompt: 'CUSTOMER SERVICE PROMPT v2 from dashboard', rules: null, memory: null, enabled: true, updated_at: '2026-06-02T00:00:00Z' },
}), 'messenger');
includes(changed, 'CUSTOMER SERVICE PROMPT v2 from dashboard');
assert.notEqual(messenger.metadata.prompt_version, changed.metadata.prompt_version);

const caption = composeBehaviorContext(behaviorMap(), 'campaign_caption');
includes(caption, 'Campaign captions should be friendly and sales-focused.');
assert.ok(caption.metadata.tools_allowed.includes('campaign_product_lookup'));

const image = composeBehaviorContext(behaviorMap(), 'image_matching');
includes(image, 'Show up to 5 candidate products when uncertain.');
includes(image, 'Exact DB image should resolve to linked product.');
assert.ok(image.metadata.tools_allowed.includes('product_image_exact_url_lookup'));
assert.ok(image.metadata.tools_allowed.includes('active_price_lookup'));

const missingPrice = composeBehaviorContext(behaviorMap(), 'missing_price');
includes(missingPrice, 'Never invent prices; the team will confirm.');
includes(missingPrice, 'Never invent prices, discounts, stock');

const disabled = composeBehaviorContext(behaviorMap({
  product_recommendation: { behavior_key: 'product_recommendation', title: 'Product recommendation', prompt: null, rules: 'THIS SHOULD NOT APPEAR', memory: null, enabled: false, updated_at: '2026-06-03T00:00:00Z' },
}), 'messenger');
assert.ok(disabled.metadata.disabled_behavior_keys.includes('product_recommendation'));
assert.ok(!disabled.systemPrompt.includes('THIS SHOULD NOT APPEAR'));
includes(disabled, 'Never invent prices');

// Inbox suggest shares the same customer behaviors as live Messenger (parity).
const inbox = composeBehaviorContext(behaviorMap(), 'inbox_suggest');
includes(inbox, 'CUSTOMER SERVICE PROMPT v1');
includes(inbox, 'Use active priced catalog products only.');
for (const key of ['customer_service', 'reply_language', 'product_recommendation', 'missing_price', 'memory_context']) {
  assert.ok(messenger.behaviorKeys.includes(key), `messenger missing behavior ${key}`);
  assert.ok(inbox.behaviorKeys.includes(key), `inbox_suggest missing behavior ${key}`);
}

// Memory/context must reach customer-facing tasks.
includes(messenger, 'Store facts are shared here.');

// Hard safety must be present in EVERY task and never empty.
for (const task of ['messenger', 'inbox_suggest', 'image_matching', 'campaign_caption', 'product_recommendation'] as const) {
  const ctx = composeBehaviorContext(behaviorMap(), task);
  assert.ok(ctx.metadata.hard_safety.length > 0, `hard_safety empty for ${task}`);
  includes(ctx, 'Never invent prices, discounts, stock');
}

// ---------------------------------------------------------------------------
// Agent-turn policy: only image_turn | text_turn; admin handoff is handled in messenger.ts.
// ---------------------------------------------------------------------------
// Image + "بكم هادا" arriving as separate events: the text event matches the recent image.
assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: true, text: 'بكم هادا' }), 'image_turn');
// Image with caption in one event → image_turn.
assert.equal(decideAgentAction({ hasCurrentImage: true, hasRecentUnansweredImage: false, text: 'بكم هادا' }), 'image_turn');
// Pure image, no text → image_turn.
assert.equal(decideAgentAction({ hasCurrentImage: true, hasRecentUnansweredImage: false, text: '' }), 'image_turn');
// Product/price question, no image → text_turn (answer from catalog).
assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: false, text: 'كم سعر الكاسة' }), 'text_turn');
// A human request is simply answered by the AI now (admin pauses manually) → text_turn.
assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: false, text: 'ابغي موظف' }), 'text_turn');
// Greeting → text_turn.
assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: false, text: 'سلام عليكم' }), 'text_turn');
// A recent image is ignored if the new text is NOT a product question.
assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: true, text: 'شكرا' }), 'text_turn');
// Question detector sanity.
for (const q of ['بكم هادا', 'كم سعر', 'قداش', 'تشحال', 'how much', 'price?']) assert.ok(isProductQuestion(q), `should detect: ${q}`);
assert.ok(!isProductQuestion('شكرا جزيلا'));

console.log('AI Control behavior + agent policy tests passed.');
