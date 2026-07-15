import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import type { BehaviorMap } from '../integrations/ai-behaviors';
import { compilePrompt, PromptConfigurationError, publicPromptPreview } from '../integrations/prompt-compiler';
import { imageModelChain } from '../integrations/gemini/client';
import { decideAgentAction, isProductQuestion } from '../integrations/pipelines/agent-policy';

function row(key: string, text: string, enabled = true) { return { behavior_key: key, title: key, prompt: text, rules: null, memory: null, enabled, updated_at: '2026-07-15T00:00:00Z' }; }
function behaviorMap(overrides: Partial<BehaviorMap> = {}): BehaviorMap {
  return {
    brand_identity: row('brand_identity', 'BRAND EXACT'), customer_service: row('customer_service', 'CUSTOMER EXACT\n  keep inner spacing'),
    reply_language: row('reply_language', 'LANGUAGE EXACT'), product_recommendation: row('product_recommendation', 'RECOMMEND EXACT'),
    missing_price: row('missing_price', 'MISSING EXACT'), memory_context: row('memory_context', 'STORE FACTS EXACT'),
    human_handoff: row('human_handoff', 'HANDOFF EXACT'), image_matching: row('image_matching', 'VISION EXACT'),
    memory_summary: row('memory_summary', 'MEMORY SUMMARY EXACT'), campaign_caption: row('campaign_caption', 'CAPTION EXACT'),
    campaign_image: row('campaign_image', 'IMAGE MASTER EXACT'), product_preservation: row('product_preservation', 'PRESERVE EXACT'),
    image_typography: row('image_typography', 'TYPOGRAPHY EXACT'), advanced_task_instructions: row('advanced_task_instructions', ''),
    ...overrides,
  };
}

const map = behaviorMap();
const customer = compilePrompt(map, 'customer_reply', { customer_message: 'سلام' });
for (const exact of ['BRAND EXACT', 'CUSTOMER EXACT\n  keep inner spacing', 'LANGUAGE EXACT', 'RECOMMEND EXACT', 'MISSING EXACT', 'STORE FACTS EXACT']) assert.ok(customer.configurableInstruction.includes(exact));
assert.deepEqual(customer.contributors.map((c) => c.behaviorKey), ['brand_identity', 'customer_service', 'reply_language', 'product_recommendation', 'missing_price', 'memory_context']);
assert.ok(customer.toolPolicy.includes('getProductPrice'));
assert.ok(customer.immutablePolicy.includes('verified runtime data'));
assert.equal(customer.generationSettings.modelClass, 'customer_text');
assert.equal(publicPromptPreview(customer).effective_system_instruction, customer.effectiveSystemInstruction);

const disabled = compilePrompt(behaviorMap({ reply_language: row('reply_language', 'MUST NOT APPEAR', false) }), 'customer_reply');
assert.ok(!disabled.effectiveSystemInstruction.includes('MUST NOT APPEAR'));
assert.ok(disabled.disabledBehaviorKeys.includes('reply_language'));

const vision = compilePrompt(map, 'vision_describe');
assert.ok(vision.effectiveSystemInstruction.includes('VISION EXACT'));
for (const unrelated of ['CUSTOMER EXACT', 'LANGUAGE EXACT', 'CAPTION EXACT', 'IMAGE MASTER EXACT', 'STORE FACTS EXACT']) assert.ok(!vision.effectiveSystemInstruction.includes(unrelated), `vision leaked ${unrelated}`);
assert.ok(vision.responseSchema?.includes('product_type'));

const image = compilePrompt(map, 'campaign_image', { exact_image_text: 'خصم الصيف' });
assert.deepEqual(image.contributors.map((c) => c.behaviorKey), ['campaign_image', 'product_preservation', 'image_typography']);
assert.ok(image.runtimeData.includes('خصم الصيف'));
assert.equal(image.traceId, compilePrompt(map, 'campaign_image', { exact_image_text: 'خصم الصيف' }).traceId);
assert.notEqual(image.traceId, compilePrompt(map, 'campaign_image', { exact_image_text: 'جديد' }).traceId);

assert.throws(() => compilePrompt({ ...map, campaign_image: undefined as any }, 'campaign_image'), PromptConfigurationError);
assert.throws(() => compilePrompt(behaviorMap({ campaign_image: row('campaign_image', '') }), 'campaign_image'), PromptConfigurationError);

// Provider adapters must not restore configurable English Home behavior after
// compilation. These regression assertions intentionally inspect source text.
const providerSource = readFileSync(new URL('../integrations/gemini/index.ts', import.meta.url), 'utf8');
for (const forbidden of ['ALWAYS produced in Libyan Arabic', 'English Home Libya. Decide the intent', 'CATALOG RESULTS — real', '[SITUATION]']) {
  assert.ok(!providerSource.includes(forbidden), `provider contains hidden configurable prose: ${forbidden}`);
}

// Production generation/regeneration both load current AI Control and clear the
// deprecated per-asset prompt instead of reading it.
const campaignRoute = readFileSync(new URL('../admin-app/src/app/api/campaigns/[campaignId]/route.ts', import.meta.url), 'utf8');
assert.ok((campaignRoute.match(/loadBehaviors\(\)/g) ?? []).length >= 3);
assert.ok(!/source_prompt\s*\|\||source_prompt\s*\?\?/.test(campaignRoute));
assert.ok(campaignRoute.includes('source_prompt: null'));

const imageChain = imageModelChain('strongest-test-model');
assert.equal(imageChain[0], 'strongest-test-model');
assert.ok(imageChain.length >= 2);

assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: true, text: 'بكم هادا' }), 'image_turn');
assert.equal(decideAgentAction({ hasCurrentImage: true, hasRecentUnansweredImage: false, text: 'بكم هادا' }), 'image_turn');
assert.equal(decideAgentAction({ hasCurrentImage: true, hasRecentUnansweredImage: false, text: '' }), 'image_turn');
assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: false, text: 'كم سعر الكاسة' }), 'text_turn');
assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: false, text: 'سلام عليكم' }), 'text_turn');
for (const q of ['بكم هادا', 'كم سعر', 'قداش', 'تشحال', 'how much', 'price?']) assert.ok(isProductQuestion(q));

console.log('AI Control compiler + agent policy tests passed.');
