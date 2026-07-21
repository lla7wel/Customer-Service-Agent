import { describe, expect, it } from 'vitest';
import { lintPrompt } from '../../integrations/prompt-lint';

describe('prompt linting', () => {
  it('rejects an empty required task prompt', () => {
    expect(lintPrompt('customer_reply', '   ')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'empty', level: 'error' }),
      expect.objectContaining({ code: 'missing_arabic_rule', level: 'error' }),
    ]));
  });

  it('flags outdated terminology, duplicated blocks and unsafe order instructions', () => {
    const line = 'Always use the approved campaign workflow for every customer interaction.';
    const issues = lintPrompt('customer_reply', [
      'Reply in Libyan Arabic.',
      line,
      line,
      'Confirm the customer order and collect order details.',
    ].join('\n'));

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'outdated_campaign_term',
      'duplicate_blocks',
      'order_confirmation_conflict',
    ]));
  });

  it('accepts the locked customer-service behavior without errors', () => {
    const issues = lintPrompt('customer_reply', [
      'Always reply in natural Libyan Arabic (العربية الليبية).',
      'Use only verified catalog products and prices.',
      'Assume active priced products are available.',
      'Never confirm or collect an order.',
      'At order intent, give the approved WhatsApp wording once without looping.',
      'Continue answering ordinary product questions after handoff.',
    ].join('\n'));

    expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });
});
