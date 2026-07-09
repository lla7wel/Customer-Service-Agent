/**
 * AI Playground endpoint — runs the REAL product-recognition workflow for
 * testing, and returns BOTH a technical debug payload and the exact customer
 * reply. Never sends to customers; only ai_events may be written elsewhere.
 *
 * Modes:
 *   - text/code/barcode/url (+ optional image)  → full Messenger-style turn
 *   - image_matching                            → canonical image matcher
 *   - campaign_caption                          → caption generator
 *   - campaign_image                            → image generate/edit
 *   - behavior-key quick tests (customer_service, product_recommendation, …)
 */
import { NextRequest, NextResponse } from 'next/server';
import { geminiStatus } from '@integrations/status';
import {
  caption, editImage,
} from '@integrations/gemini';
import { matchCustomerImage } from '@integrations/pipelines/image-match';
import { resolveProductsFromText, parseProductUrl } from '@integrations/pipelines/product-resolve';
import { composeCustomerReply, situationNote } from '@integrations/pipelines/compose-reply';
import { getDb } from '@integrations/db/client';
import { composeBehaviorContext, loadBehaviors, type AiBehaviorTask } from '@/lib/ai-behaviors';
import {
  getCustomerMemory, buildMemoryContext,
} from '@integrations/tools';
import { isMetaConfigured } from '@integrations/meta';
import { sanitizeCustomerTextDetailed } from '@integrations/util/customer-text';
import { isProductQuestion } from '@integrations/pipelines/agent-policy';
import {
  decideImageContextFollowUp,
  createLastImageContext,
  isImageContextFollowUp,
  normalizeLastImageContext,
} from '@integrations/pipelines/context-followup';
import { detectImageRequest, selectSendableImages, imageSendSituation } from '@integrations/pipelines/product-image';

export const runtime = 'nodejs';
// Playground runs the full image pipeline / image generation — allow headroom
// so the platform doesn't kill it mid-call (each Gemini call is itself capped).
export const maxDuration = 90;

const TEXT_BEHAVIOR_TASK: Record<string, AiBehaviorTask> = {
  customer_service: 'customer_chat',
  reply_language: 'customer_chat',
  memory_context: 'customer_chat',
  product_recommendation: 'product_recommendation',
  missing_price: 'missing_price',
};

export async function POST(req: NextRequest) {
  if (!geminiStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: ['GEMINI_API_KEY'] }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? 'customer');
  const text: string = typeof body?.text === 'string' ? body.text : '';
  const image = body?.image && body.image.data ? { data: String(body.image.data), mime: String(body.image.mime || 'image/jpeg') } : null;
  const customerId: string | null = typeof body?.customer_id === 'string' ? body.customer_id : null;
  const previousImageContext = normalizeLastImageContext(body?.previousImageContext ?? body?.previous_image_context);

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'integration_not_configured', missing: ['DATABASE_URL'] }, { status: 503 });

  const behaviors = await loadBehaviors();
  const memory = customerId ? await getCustomerMemory(db, customerId) : null;
  const memoryContext = buildMemoryContext(memory);
  const started = Date.now();

  try {
    // --- Campaign caption -----------------------------------------------------
    if (mode === 'campaign_caption') {
      const behavior = composeBehaviorContext(behaviors, 'campaign_caption');
      const r = await caption({ prompt: text || '', systemPrompt: behavior.systemPrompt });
      if (!r.ok) return notConfigured(r);
      return NextResponse.json({ reply: r.text, debug: { mode, gemini_calls: [{ fn: 'caption', model: r.model, latency_ms: r.latencyMs }], total_latency_ms: Date.now() - started } });
    }

    // --- Campaign image -------------------------------------------------------
    if (mode === 'campaign_image') {
      const behavior = composeBehaviorContext(behaviors, 'campaign_image');
      const r = await editImage({ prompt: [behavior.systemPrompt, text].filter(Boolean).join('\n\n') || 'A clean English Home product promo image.', baseImageBase64: image?.data, mimeType: image?.mime });
      if (!r.ok) return notConfigured(r);
      const img = r.images[0];
      return NextResponse.json({ reply: r.text || (img ? 'Image generated.' : 'No image returned.'), image: img ? `data:${img.mimeType};base64,${img.data}` : null, model: r.model, requestedModel: r.requestedModel, fallbackUsed: r.fallbackUsed, debug: { mode, gemini_calls: [{ fn: 'editImage', model: r.model, requested_model: r.requestedModel, fallback_used: r.fallbackUsed, attempts: r.attempts, latency_ms: r.latencyMs }], total_latency_ms: Date.now() - started } });
    }

    // --- Image recognition workflow ------------------------------------------
    if (mode === 'image_matching' || (image && !TEXT_BEHAVIOR_TASK[mode])) {
      if (!image) return NextResponse.json({ error: 'no_image' }, { status: 400 });
      const behavior = composeBehaviorContext(behaviors, 'image_matching');
      const result = await matchCustomerImage(db, {
        imageBase64: image.data, mimeType: image.mime, extraText: text || undefined, memoryContext,
        behaviorSystemPrompt: behavior.systemPrompt, searchLimit: 50,
      });
      const lastImageContext = createLastImageContext({
        source: 'playground_image',
        imageUrl: null,
        imageMessageId: null,
        outcome: result.outcome,
        exactProductId: result.exactProductId,
        candidates: result.candidates,
        diagnostics: result.diagnostics,
      });
      // Same composition the live Messenger pipeline uses (Gemini writes it).
      const replyBehavior = composeBehaviorContext(behaviors, 'messenger');
      const situation = result.candidates.length
        ? 'The customer sent a photo of a product. The catalog results are the closest visual matches. Present them naturally in Libyan Arabic (at most 5) and help them confirm which one they mean. Use ONLY these prices; if a price is missing, say it will be confirmed. Do not claim certainty you do not have.'
        : 'The customer sent a photo but no product matched it confidently. Ask ONE short, friendly clarifying question to narrow it down. Do not guess products.';
      const composed = await composeCustomerReply(db, {
        systemPrompt: replyBehavior.systemPrompt, message: text || '',
        candidates: result.candidates, contextNote: situationNote(memoryContext, situation),
      });
      const san = sanitizeCustomerTextDetailed(composed.text);
      const imgWantImages = detectImageRequest(text);
      const imgSel = imgWantImages ? selectSendableImages(result.candidates) : null;
      return NextResponse.json({
        reply: san.text,
        debug: {
          mode: 'image',
          input_signals: { image_present: true, text: text || null, image_request: imgWantImages },
          retrieval: { diagnostics: result.diagnostics, candidates: result.candidates, last_image_context: lastImageContext },
          memory_used: memory,
          outcome: { outcome: result.outcome, selected_product: result.candidates[0] ?? null, confidence: result.candidates[0]?.confidence ?? 0, price_source: 'active_price', would_auto_send: isMetaConfigured(), would_send_images: imgSel?.images ?? [] },
          gemini_calls: [{ fn: 'composeCustomerReply', model: composed.model, tool_calls_made: composed.toolCalls }],
          sanitization: { changed: san.changed, removed: san.removed },
          total_latency_ms: Date.now() - started,
        },
      });
    }

    // --- Text / code / barcode / url workflow (real Messenger-style turn) -----
    const task = TEXT_BEHAVIOR_TASK[mode] ?? 'messenger';
    const behavior = composeBehaviorContext(behaviors, task);
    const hasUrl = /https?:\/\//i.test(text);
    const isCatalogQuestion = !!text && (isProductQuestion(text) || hasUrl);
    const parsedSignals = parseProductUrl(text);

    if (!image && previousImageContext && isImageContextFollowUp(text)) {
      const decision = decideImageContextFollowUp(previousImageContext, text);
      const fuProducts = decision.selectedProductId
        ? decision.candidates.filter((c) => c.id === decision.selectedProductId)
        : decision.candidates;
      const composed = await composeCustomerReply(db, {
        systemPrompt: composeBehaviorContext(behaviors, 'messenger').systemPrompt,
        message: text || 'سلام', candidates: fuProducts,
        contextNote: situationNote(memoryContext, decision.situation),
      });
      const san = sanitizeCustomerTextDetailed(composed.text);
      return NextResponse.json({
        reply: san.text,
        debug: {
          mode: 'image_followup',
          input_signals: { text, reused_previous_image_context: true },
          retrieval: { outcome: previousImageContext.outcome, candidates: previousImageContext.candidates, last_image_context: previousImageContext },
          memory_used: memory,
          outcome: {
            selected_product: decision.candidates[0] ?? null,
            selected_product_id: decision.selectedProductId,
            confidence: decision.candidates[0]?.confidence ?? previousImageContext.confidence ?? 0,
            price_source: 'active_price',
            reply_strategy: decision.replyStrategy,
            would_auto_send: isMetaConfigured(),
            would_pause_ai: decision.needsHuman,
            needs_human_reason: decision.needsHumanReason,
          },
          sanitization: { changed: san.changed, removed: san.removed },
          total_latency_ms: Date.now() - started,
        },
      });
    }

    const wantsImages = detectImageRequest(text);
    let resolvedHits: any[] = [];
    let resolveOutcome = 'none';
    if (isCatalogQuestion || wantsImages) {
      const r = await resolveProductsFromText(db, text, 5);
      resolvedHits = r.hits;
      resolveOutcome = r.outcome;
    }
    const textImgSel = wantsImages ? selectSendableImages(resolvedHits) : null;

    // Single composed path — identical to the live Messenger auto-reply: Gemini
    // writes the reply, grounded by any resolved candidates, with the controlled
    // read-only tools available. No robotic option template.
    const situation = textImgSel?.images.length
      ? imageSendSituation({ count: textImgSel.images.length, grouped: textImgSel.grouped, more: textImgSel.more })
      : resolvedHits.length
        ? 'The customer is asking about products. Use ONLY the catalog results provided; show at most 5 options and help them choose. If a price is missing, say it will be confirmed — never invent it.'
        : undefined;
    const composed = await composeCustomerReply(db, {
      systemPrompt: behavior.systemPrompt,
      message: text || 'سلام',
      candidates: textImgSel?.images.length ? textImgSel.products : resolvedHits,
      contextNote: situationNote(memoryContext, situation),
    });
    const san = sanitizeCustomerTextDetailed(composed.text);
    return NextResponse.json({
      reply: san.text,
      debug: {
        mode: 'text',
        input_signals: { text, extracted_code: parsedSignals.code, extracted_barcode: parsedSignals.barcode, extracted_url: parsedSignals.urls[0] ?? null, slug_tokens: parsedSignals.slugTokens, image_request: wantsImages },
        retrieval: { outcome: resolveOutcome, candidates: resolvedHits },
        gemini_calls: [{ fn: 'composeCustomerReply', model: composed.model, rounds: composed.rounds, tool_calls_made: composed.toolCalls }],
        memory_used: memory,
        outcome: { selected_product: resolvedHits[0] ?? null, confidence: resolvedHits[0]?.confidence ?? 0, price_source: 'active_price', would_auto_send: isMetaConfigured(), would_send_images: textImgSel?.images ?? [] },
        sanitization: { changed: san.changed, removed: san.removed },
        total_latency_ms: Date.now() - started,
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? 'server_error';
    const isTimeout = e?.timeout || e?.status === 504 || /timed out/i.test(msg);
    return NextResponse.json(
      { error: msg, timeout: !!isTimeout, hint: isTimeout ? 'The model was busy/slow and the request was aborted. Try again — fallback models are used automatically.' : undefined },
      { status: isTimeout ? 504 : 500 },
    );
  }
}

function notConfigured(r: { missing: string[] }) {
  return NextResponse.json({ error: 'integration_not_configured', missing: r.missing }, { status: 503 });
}
