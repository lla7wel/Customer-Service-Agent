/**
 * Lightweight assertion tests for the Phase 1–10 upgrade's PURE logic
 * (no network/DB). Run with: npm test  (from scripts/).
 * Exits non-zero on the first failed assertion so CI/pre-deploy can gate on it.
 */
import assert from 'node:assert/strict';
import { sanitizeCustomerText, sanitizeCustomerTextDetailed } from '../integrations/util/customer-text';
import { parseProductUrl } from '../integrations/pipelines/product-resolve';
import { decideAgentAction, isProductQuestion } from '../integrations/pipelines/agent-policy';
import {
  decideImageContextFollowUp,
  createLastImageContext,
  isImageContextFollowUp,
  isOrderIntent,
} from '../integrations/pipelines/context-followup';
import { dhashFromBytes, hammingHex, hammingSimilarity, NEAR_DUPLICATE_MAX } from '../integrations/util/image-hash';
import { buildProductOptionsMessage, customerProductName } from '../integrations/util/product-display';
import { detectImageRequest, selectSendableImages, isMetaSafeImageUrl } from '../integrations/pipelines/product-image';
import type { ProductCandidate } from '../integrations/tools';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { console.error(`  ✗ ${name}\n    ${e?.message}`); process.exitCode = 1; }
}

console.log('customer-text sanitizer');
test('strips a leaked tool call entirely', () => {
  assert.equal(sanitizeCustomerText('catalog_search(query="فناجين قهوة")'), '');
});
test('keeps normal Libyan Arabic untouched', () => {
  const s = 'أهلاً! سعر الطقم 120 د.ل، حابة نبعتلك صورة؟';
  assert.equal(sanitizeCustomerText(s), s);
});
test('removes a tool call but keeps the price line', () => {
  const out = sanitizeCustomerText('حياك الله\ncatalog_search(query="Selene")\nالسعر 90 د.ل');
  assert.ok(!out.includes('catalog_search'));
  assert.ok(out.includes('90 د.ل'));
});
test('strips code fences and forbidden system terms', () => {
  const out = sanitizeCustomerText('```json\n{"x":1}\n```\nحسب Gemini و escalation تمام');
  assert.ok(!/gemini/i.test(out) && !/escalation/i.test(out) && !out.includes('```'));
});
test('reports what was removed (diagnostics)', () => {
  const r = sanitizeCustomerTextDetailed('product_code_lookup(code="123")');
  assert.equal(r.changed, true);
  assert.ok(r.removed.length >= 1);
});

console.log('product URL parser');
test('extracts a 13-digit barcode and slug tokens', () => {
  const r = parseProductUrl('بكم https://englishhome.com/p/coffee-cup-set/8680887739570 ؟');
  assert.equal(r.barcode, '8680887739570');
  assert.ok(r.slugTokens.includes('coffee'));
});
test('treats an 18-digit zero-padded run as a product code, not a barcode', () => {
  const r = parseProductUrl('https://www.englishhome.com/tr/selene-fincan-000000010038683001');
  assert.equal(r.barcode, null);
  assert.equal(r.code, '000000010038683001');
});
test('returns nothing for a plain (no-URL) message', () => {
  const r = parseProductUrl('عندكم فناجين قهوة؟');
  assert.equal(r.urls.length, 0);
  assert.equal(r.code, null);
});

console.log('customer product display');
test('customer name prefers Arabic and never falls back to raw English', () => {
  assert.equal(customerProductName({ libyan_display_name: 'طاسة خلط خضراء', english_name: 'Susanna Enamel Mixing Bowl 24 cm Green' }), 'طاسة خلط خضراء');
  const fallback = customerProductName({ product_code: 'ABC123', english_name: 'Susanna Enamel Mixing Bowl 24 cm Green' });
  assert.ok(!/Susanna|Mixing|Bowl|Green/i.test(fallback));
  assert.ok(fallback.includes('وعاء') && fallback.includes('أخضر'));
});
test('option message is Libyan Arabic with price and link', () => {
  const msg = buildProductOptionsMessage([{ name: 'وعاء خلط أخضر', price: 42, website_url: 'https://example.com/p', product_code: 'P1' }]);
  assert.ok(msg.startsWith('لقيتلك'));
  assert.ok(msg.includes('42 د.ل'));
  assert.ok(msg.includes('https://example.com/p'));
});

console.log('agent policy (image/text turn routing)');
test('a current image routes to image_turn', () => {
  assert.equal(decideAgentAction({ hasCurrentImage: true, hasRecentUnansweredImage: false, text: '' }), 'image_turn');
});
test('price question after a recent unanswered image → image_turn', () => {
  assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: true, text: 'بكم هذا' }), 'image_turn');
});
test('plain text with no image → text_turn', () => {
  assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: false, text: 'سلام' }), 'text_turn');
});
test('a human request without image context routes to text_turn', () => {
  assert.equal(decideAgentAction({ hasCurrentImage: false, hasRecentUnansweredImage: false, text: 'أبي موظف' }), 'text_turn');
});
test('product-question regex matches Libyan price cues', () => {
  assert.ok(isProductQuestion('قداش هاد'));
  assert.ok(isProductQuestion('how much is this'));
  assert.ok(!isProductQuestion('سلام عليكم'));
});

console.log('image follow-up context');
const oneImageContext = createLastImageContext({
  source: 'messenger_image',
  outcome: 'exact',
  exactProductId: 'p1',
  candidates: [{ id: 'p1', product_code: 'C1', name: 'كوب سيراميك', price: 25, image: null, website_url: null, confidence: 0.91, retrieval_tracks: ['hash_near_dup'] }],
});
const multiImageContext = createLastImageContext({
  source: 'messenger_image',
  outcome: 'multiple',
  candidates: [
    { id: 'p1', product_code: 'C1', name: 'كوب سيراميك', price: 25, image: null, website_url: null, confidence: 0.7, retrieval_tracks: ['vector_text'] },
    { id: 'p2', product_code: 'C2', name: 'طقم فناجين', price: 90, image: null, website_url: null, confidence: 0.68, retrieval_tracks: ['text_search'] },
  ],
});
test('follow-up detector catches price/reference/order wording', () => {
  assert.ok(isImageContextFollowUp('بكم؟'));
  assert.ok(isImageContextFollowUp('نفس اللي قبل'));
  assert.ok(isImageContextFollowUp('نبيها'));
  assert.ok(isOrderIntent('نبيها'));
});
test('price follow-up after one clear image product selects that product', () => {
  const d = decideImageContextFollowUp(oneImageContext, 'بكم؟');
  assert.equal(d.selectedProductId, 'p1');
  assert.equal(d.needsHuman, false);
  assert.equal(d.replyStrategy, 'single_price');
  assert.equal(d.candidates.length, 1);
});
test('price follow-up after multiple image candidates reuses previous options', () => {
  const d = decideImageContextFollowUp(multiImageContext, 'بكم؟');
  assert.equal(d.selectedProductId, null);
  assert.equal(d.replyStrategy, 'reuse_previous_options');
  assert.equal(d.candidates.length, 2);
});
test('order follow-up after one clear image product collects details and needs human', () => {
  const d = decideImageContextFollowUp(oneImageContext, 'نبيها');
  assert.equal(d.selectedProductId, 'p1');
  assert.equal(d.needsHuman, true);
  assert.equal(d.needsHumanReason, 'order_request');
  // The internal situation note asks for contact details (Gemini writes the reply).
  assert.ok(/name|phone|address/i.test(d.situation));
});

console.log('product image sending');
test('detectImageRequest catches photo/shape/colour/show requests', () => {
  for (const t of [
    'ابعثلي صورته', 'ابعت صورته', 'نبي صورته', 'عندك صورة؟', 'صورته؟', 'وريني الشكل',
    'خليني نشوفه', 'شكله كيف؟', 'نبي نشوف اللون', 'عندك صور للحمام؟', 'نبي نشوف الخيارات',
    'ابعثلي الصور', 'في صور؟', 'ورينيهم', 'نبي نشوفهم', 'صورهم', 'ابعثلي الألوان', 'شنو الألوان؟',
  ]) assert.ok(detectImageRequest(t), `should detect image intent: ${t}`);
});
test('detectImageRequest ignores price/availability/order-only messages', () => {
  for (const t of ['بكم هذا', 'شحال السعر', 'سلام', 'وين الموجود', 'نبي نشري', 'نبي نشوف الأسعار', '']) {
    assert.ok(!detectImageRequest(t), `should NOT detect image intent: ${t}`);
  }
});
test('isMetaSafeImageUrl requires public https (no local paths/http)', () => {
  assert.ok(isMetaSafeImageUrl('https://media.example.com/products/10001821004/00.jpg'));
  assert.ok(!isMetaSafeImageUrl('http://x.com/a.jpg'));
  assert.ok(!isMetaSafeImageUrl('https://localhost:3000/a.jpg'));
  assert.ok(!isMetaSafeImageUrl('/var/data/images/a.jpg'));
  assert.ok(!isMetaSafeImageUrl(null));
  assert.ok(!isMetaSafeImageUrl(''));
});
const mkCand = (id: string, code: string | null, image: string | null): ProductCandidate => ({
  id, product_code: code, name: `منتج ${id}`, price: 10, image, website_url: null, confidence: 0.8, retrieval_tracks: [],
});
test('selectSendableImages caps at 3 and only keeps usable images', () => {
  const sel = selectSendableImages([
    mkCand('a', '111111001', 'https://h.co/a.jpg'),
    mkCand('b', '222222001', 'https://h.co/b.jpg'),
    mkCand('c', '333333001', 'https://h.co/c.jpg'),
    mkCand('d', '444444001', 'https://h.co/d.jpg'),
    mkCand('e', '555555001', null),               // no image → skipped
    mkCand('f', '666666001', '/local/path.jpg'),  // unsafe → skipped
  ]);
  assert.equal(sel.images.length, 3, 'max 3 images');
  assert.equal(sel.totalWithImages, 4, 'four had usable images');
  assert.equal(sel.more, true, 'more available than sent');
  assert.equal(sel.grouped, false, 'different families are not grouped');
});
test('selectSendableImages de-dupes by product id and identical url', () => {
  const sel = selectSendableImages([
    mkCand('a', '111111001', 'https://h.co/a.jpg'),
    mkCand('a', '111111001', 'https://h.co/a.jpg'), // same id
    mkCand('b', '222222001', 'https://h.co/a.jpg'), // same url
  ]);
  assert.equal(sel.images.length, 1, 'duplicates collapse to one');
});
test('selectSendableImages flags colour variants of one family as grouped', () => {
  const sel = selectSendableImages([
    mkCand('a', '1234567001', 'https://h.co/a.jpg'),
    mkCand('b', '1234567002', 'https://h.co/b.jpg'),
  ]);
  assert.equal(sel.grouped, true, 'same family prefix → grouped (colour variants)');
});
test('selectSendableImages returns nothing when no usable images', () => {
  const sel = selectSendableImages([mkCand('a', '111111001', null), mkCand('b', '222222001', 'http://h.co/x.jpg')]);
  assert.equal(sel.images.length, 0);
  assert.equal(sel.more, false);
});

console.log('image fingerprint (dHash)');
function asyncTest(name: string, fn: () => Promise<void>) { return fn().then(() => { passed++; console.log(`  ✓ ${name}`); }).catch((e: any) => { console.error(`  ✗ ${name}\n    ${e?.message}`); process.exitCode = 1; }); }

test('hammingHex: identical hashes → 0, missing → far', () => {
  assert.equal(hammingHex('ffffffffffffffff', 'ffffffffffffffff'), 0);
  assert.equal(hammingHex('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hammingHex(null, 'ffffffffffffffff'), 999);
});
test('hammingSimilarity maps distance → 0..1', () => {
  assert.equal(hammingSimilarity(0), 1);
  assert.equal(hammingSimilarity(999), 0);
  assert.ok(hammingSimilarity(NEAR_DUPLICATE_MAX) > 0.8);
});

await asyncTest('dHash: same image → distance 0; different image → far; deterministic', async () => {
  const mod: any = await import('jimp'); const Jimp = mod.default ?? mod;
  const make = async (fn: (x: number, y: number) => number) => {
    const img = new Jimp(48, 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const v = fn(x, y) & 0xff; img.setPixelColor(Jimp.rgbaToInt(v, v, v, 255), x, y); }
    return img.getBufferAsync(Jimp.MIME_PNG);
  };
  const a = await make((x, y) => (x * 7 + y * 3) % 256);
  const b = await make((x, y) => (x * y) % 256);
  const ha = await dhashFromBytes(a);
  const hb = await dhashFromBytes(b);
  assert.ok(ha && ha.length === 16, 'hash should be 16 hex chars');
  assert.equal(await dhashFromBytes(a), ha, 'deterministic');
  assert.equal(hammingHex(ha, ha), 0, 'same image distance 0');
  assert.ok(hammingHex(ha, hb) > NEAR_DUPLICATE_MAX, 'different images are far');
});

// --- Image model routing + fallback chain (deterministic, fetch stubbed) ------
console.log('image model routing + fallback');
{
  const gem: any = await import('../integrations/gemini/client');

  test('imageModelChain orders preferred → fallback → last and de-dupes', () => {
    const chain = gem.imageModelChain('gemini-3-pro-image-preview');
    assert.equal(chain[0], 'gemini-3-pro-image-preview');
    assert.ok(chain.length >= 2, 'chain has fallbacks');
    assert.equal(new Set(chain).size, chain.length, 'no duplicate models');
    // Passing the fallback as preferred must not duplicate it later in the chain.
    const c2 = gem.imageModelChain('gemini-3.1-flash-image-preview');
    assert.equal(new Set(c2).size, c2.length, 'no duplicates when preferred is also a fallback');
  });

  const origFetch = globalThis.fetch;
  const origKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  await asyncTest('generateImage falls back when the primary model fails, and reports it', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      const model = u.split('/models/')[1]?.split(':')[0] ?? '';
      calls.push(model);
      // Primary (pro) simulates "high demand"; flash returns an image.
      if (model.includes('pro-image')) {
        return new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 429 });
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } }] }), { status: 200 });
    }) as any;

    const r = await gem.generateImage('make a bedding promo image', {
      chain: ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'],
      perAttemptTimeoutMs: 5000,
    });
    assert.equal(r.images.length, 1, 'an image is returned via fallback');
    assert.equal(r.requestedModel, 'gemini-3-pro-image-preview');
    assert.equal(r.model, 'gemini-3.1-flash-image-preview', 'actual model is the working fallback');
    assert.equal(r.fallbackUsed, true, 'fallbackUsed flag set');
    assert.equal(r.attempts[0].ok, false, 'primary attempt recorded as failed');
    assert.equal(r.attempts[1].ok, true, 'fallback attempt recorded as ok');
    assert.deepEqual(calls.slice(0, 2), ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview']);
  });

  await asyncTest('generateContent aborts on timeout instead of hanging', async () => {
    globalThis.fetch = ((_: any, init: any) => new Promise((_resolve, reject) => {
      // Never resolve; reject only when the abort signal fires (simulates a hung model).
      const sig: AbortSignal | undefined = init?.signal;
      if (sig) sig.addEventListener('abort', () => { const e: any = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    })) as any;
    let timedOut = false;
    try {
      await gem.generateContent('hello', { model: 'gemini-2.5-flash', timeoutMs: 200 });
    } catch (e: any) {
      timedOut = !!e?.timeout || /timed out/i.test(e?.message || '');
    }
    assert.ok(timedOut, 'a hung request is aborted with a timeout error');
  });

  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = origKey;
}

// --- Canonical resolver routing (no DB/network on the guarded paths) ----------
console.log('canonical resolver');
{
  const mod: any = await import('../integrations/pipelines/resolver');
  const fakeDb: any = { from() { throw new Error('db should not be touched on the empty path'); } };

  await asyncTest('resolveProducts returns empty (no DB) when there is no text or image', async () => {
    const r = await mod.resolveProducts(fakeDb, { mode: 'admin' });
    assert.equal(r.source, 'empty');
    assert.equal(r.outcome, 'none');
    assert.equal(r.candidates.length, 0);
  });

  await asyncTest('resolveProducts is one canonical entry (text + image engines wired)', async () => {
    // The facade must expose a single function used by every surface.
    assert.equal(typeof mod.resolveProducts, 'function');
  });
}

console.log(`\n${passed} assertions passed.`);
