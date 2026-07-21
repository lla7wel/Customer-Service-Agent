import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { compilePrompt, behaviorKeysForTask, type AiTask } from '../../integrations/prompt-compiler';
import { loadBehaviorsWith } from '../../integrations/ai-behaviors';
import { createTestDatabase, type TestDb } from './setup';

const TASKS: AiTask[] = [
  'customer_reply', 'product_recommendation', 'handoff_reply',
  'vision_describe', 'vision_rank', 'memory_summary',
  'campaign_caption', 'campaign_image', 'campaign_image_verify',
];

describe('prompt compiler on a FRESH install', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase('eh_prompt'); });
  afterAll(async () => { await t.destroy(); });

  it('every task compiles out of the box — a new deployment can actually reply', async () => {
    const behaviors = await loadBehaviorsWith(t.db);
    for (const task of TASKS) {
      const envelope = compilePrompt(behaviors, task, {});
      expect(envelope.effectiveSystemInstruction.length).toBeGreaterThan(50);
      expect(envelope.contributors.length).toBeGreaterThan(0);
    }
  });

  it('the immutable safety policy is always present and separate from editable text', async () => {
    const behaviors = await loadBehaviorsWith(t.db);
    const envelope = compilePrompt(behaviors, 'customer_reply', {});
    expect(envelope.immutablePolicy).toContain('Immutable execution and safety policy');
    expect(envelope.immutablePolicy).toMatch(/[Nn]ever invent/);
    // Editable AI Control text is a distinct section the owner fully controls.
    expect(envelope.configurableInstruction).toContain('AI Control:');
    expect(envelope.effectiveSystemInstruction.indexOf(envelope.immutablePolicy))
      .toBeLessThan(envelope.effectiveSystemInstruction.indexOf(envelope.configurableInstruction));
  });

  it('customer replies are instructed in Libyan Arabic and grounded in verified data', async () => {
    const behaviors = await loadBehaviorsWith(t.db);
    const envelope = compilePrompt(behaviors, 'customer_reply', {});
    expect(behaviorKeysForTask('customer_reply')).toContain('reply_language');
    expect(envelope.effectiveSystemInstruction).toMatch(/الليبية/);
    expect(envelope.effectiveSystemInstruction).toMatch(/لا تؤكد طلباً|لا تخترع/);
  });

  it('the read-only tool policy is attached for customer-facing tasks', async () => {
    const behaviors = await loadBehaviorsWith(t.db);
    const envelope = compilePrompt(behaviors, 'customer_reply', {});
    expect(envelope.toolPolicy).toEqual(expect.arrayContaining(['findProductByCode', 'getProductPrice']));
  });

  it('runtime data is serialized deterministically (stable trace ids)', async () => {
    const behaviors = await loadBehaviorsWith(t.db);
    const a = compilePrompt(behaviors, 'customer_reply', { b: 2, a: 1 });
    const b = compilePrompt(behaviors, 'customer_reply', { a: 1, b: 2 });
    expect(a.traceId).toBe(b.traceId);
  });
});
