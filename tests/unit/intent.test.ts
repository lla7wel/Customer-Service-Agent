import { describe, expect, it } from 'vitest';
import { classifyIntent, shouldSendHandoff } from '../../integrations/pipelines/intent';
import { buildOrderHandoffMessage } from '../../integrations/pipelines/business-facts';

describe('classifyIntent', () => {
  it('detects clear order intent', () => {
    for (const text of ['نبي نطلب هذا', 'كيف نحجز؟', 'نشري منه اثنين', 'اطلبولي اياه', 'I want to order']) {
      const r = classifyIntent(text);
      expect(r.intent).toBe('order');
      expect(r.needsHumanAttention).toBe(true);
      expect(r.sendOrderHandoff).toBe(true);
    }
  });

  it('flags complaints/refunds/payment for human attention WITHOUT the order handoff', () => {
    for (const text of ['نبي استرجاع الفلوس', 'عندي شكوى على المنتج', 'خصم مرتين من بطاقتي']) {
      const r = classifyIntent(text);
      expect(r.needsHumanAttention).toBe(true);
      expect(r.sendOrderHandoff).toBe(false);
    }
  });

  it('treats a plain delivery-availability question as answerable, not escalation', () => {
    const r = classifyIntent('عندكم توصيل لطرابلس؟');
    expect(r.intent).toBe('delivery_question');
    expect(r.needsHumanAttention).toBe(false);
  });

  it('treats a delivery DISPUTE as human attention', () => {
    const r = classifyIntent('طلبي ما وصلنيش ليوم');
    expect(r.intent).toBe('delivery_dispute');
    expect(r.needsHumanAttention).toBe(true);
  });

  it('normal product questions stay with the AI', () => {
    const r = classifyIntent('بكم طقم أغطية السرير القطن؟');
    expect(r.needsHumanAttention).toBe(false);
    expect(r.sendOrderHandoff).toBe(false);
  });
});

describe('shouldSendHandoff (anti-loop)', () => {
  const order = classifyIntent('نبي نطلب');
  it('sends the first handoff', () => {
    expect(shouldSendHandoff(order, null)).toBe(true);
  });
  it('suppresses a repeat within 24h', () => {
    expect(shouldSendHandoff(order, new Date(Date.now() - 3600_000).toISOString())).toBe(false);
  });
  it('allows a fresh handoff after the suppression window', () => {
    expect(shouldSendHandoff(order, new Date(Date.now() - 26 * 3600_000).toISOString())).toBe(true);
  });
});

describe('buildOrderHandoffMessage', () => {
  it('produces the exact official handoff with the configured contacts', () => {
    const msg = buildOrderHandoffMessage({
      branches: [], contacts: ['+218 91-1315900'], workingHours: null,
      deliveryAvailable: true, pickupAvailable: true,
      raw: {},
    });
    expect(msg).toBe([
      'تمام، الفريق بيكمل معاك في الطلب 🤍',
      'وتقدر تتواصل وتطلب مباشرة على واتساب: +218 91-1315900',
      'ولو عندك سؤال على المقاس أو اللون أو المنتج، أنا معاك.',
    ].join('\n'));
  });
});
