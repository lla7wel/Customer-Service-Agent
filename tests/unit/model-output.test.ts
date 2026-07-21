import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { rankProductsByImage, type VisualRankItem } from '../../integrations/gemini';

const candidates: VisualRankItem[] = [
  { id: 'p1', name: 'Duvet A', imageBase64: 'x', mimeType: 'image/jpeg' },
  { id: 'p2', name: 'Duvet B', imageBase64: 'y', mimeType: 'image/jpeg' },
];

/** Fake a Gemini generateContent response body. */
function stubGemini(text: string) {
  return vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () =>
    new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('model ranking output is strictly validated (EH-022)', () => {
  beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.GEMINI_API_KEY = '';
  });

  const rank = async () => {
    const r = await rankProductsByImage({
      customerImageBase64: 'z', customerMimeType: 'image/jpeg',
      candidates, systemPrompt: 'test policy',
    });
    if (!r.ok) throw new Error('expected ok');
    return r.ranked;
  };

  it('drops product ids that were never offered — the model cannot invent a product', async () => {
    stubGemini(JSON.stringify({ ranked: [
      { product_id: 'p1', confidence: 0.9 },
      { product_id: 'HALLUCINATED', confidence: 0.95 },
    ] }));
    const ranked = await rank();
    expect(ranked.map((r) => r.product_id)).toEqual(['p1']);
  });

  it('clamps out-of-range confidences instead of trusting them', async () => {
    stubGemini(JSON.stringify({ ranked: [
      { product_id: 'p1', confidence: 7.5 },
      { product_id: 'p2', confidence: -3 },
    ] }));
    const ranked = await rank();
    expect(ranked.find((r) => r.product_id === 'p1')!.confidence).toBe(1);
    expect(ranked.find((r) => r.product_id === 'p2')!.confidence).toBe(0);
  });

  it('drops entries with a non-numeric confidence', async () => {
    stubGemini(JSON.stringify({ ranked: [
      { product_id: 'p1', confidence: 'very sure' },
      { product_id: 'p2', confidence: 0.5 },
    ] }));
    expect((await rank()).map((r) => r.product_id)).toEqual(['p2']);
  });

  it('de-duplicates repeated ids', async () => {
    stubGemini(JSON.stringify({ ranked: [
      { product_id: 'p1', confidence: 0.8 },
      { product_id: 'p1', confidence: 0.2 },
    ] }));
    const ranked = await rank();
    expect(ranked).toHaveLength(1);
    expect(ranked[0].confidence).toBe(0.8);
  });

  it('survives a malformed or non-JSON response without throwing', async () => {
    stubGemini('I am not JSON at all');
    expect(await rank()).toEqual([]);
    vi.restoreAllMocks();
    stubGemini(JSON.stringify({ ranked: 'not-an-array' }));
    expect(await rank()).toEqual([]);
  });

  it('truncates an over-long reason instead of storing it whole', async () => {
    stubGemini(JSON.stringify({ ranked: [
      { product_id: 'p1', confidence: 0.7, reason: 'x'.repeat(5000) },
    ] }));
    const ranked = await rank();
    expect(ranked[0].reason!.length).toBeLessThanOrEqual(300);
  });
});
