/**
 * Messenger agent pipeline. Entry point: /api/meta/webhook (unified Vercel route).
 *
 * Per burst of customer messages (batched into ONE turn within a 5s window) it:
 *   1. Upserts customer + open conversation, stores each inbound message.
 *      Fetches first_name/last_name from Meta Graph for new customers.
 *   2. If AI is enabled (admin has not paused it) + Gemini configured, runs ONE
 *      turn over the unanswered batch (merged text + images), grounded by:
 *        - customer-specific MEMORY (recent products, name, facts, preferences),
 *        - the CONTROLLED TOOLS layer (code/barcode/url/text/vector lookups),
 *        - the CANONICAL image matcher for any image,
 *      then replies in Libyan Arabic with real catalog data (never invented).
 *
 * There is no legacy escalation workflow. For admin-required cases, the pipeline
 * sends one natural handoff reply, marks the conversation needs_human, and sets
 * ai_enabled=false. Outbound sends when Meta is configured and AI is still on for
 * the conversation.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { type MessengerEvent, sendMessage, sendImageMessage, isMetaConfigured, getUserProfile } from '../meta';
import {
  isGeminiConfigured, generateContent, routerModel,
} from '../gemini';
import {
  detectImageRequest, selectSendableImages, imageSendSituation, imageUnavailableSituation,
  type SendableSelection, MAX_AUTO_IMAGES,
} from './product-image';
import { loadBehaviorsWith, behaviorMetadata, composeBehaviorContext, type BehaviorMap } from '../ai-behaviors';
import { messageBatchingEnabled, batchWindowMs } from '../flags';
import { matchCustomerImage } from './image-match';
import { resolveProductsFromText } from './product-resolve';
import { composeCustomerReply, situationNote } from './compose-reply';
import { decideAgentAction, isProductQuestion } from './agent-policy';
import {
  adminRequiredReason,
  adminRequiredSituation,
  decideImageContextFollowUp,
  createLastImageContext,
  isAdminRequiredText,
  isImageContextFollowUp,
  normalizeLastImageContext,
  type LastImageContext,
} from './context-followup';
import { sanitizeCustomerTextDetailed } from '../util/customer-text';
import {
  getCustomerMemory, updateCustomerMemory, buildMemoryContext,
  toCandidate, PRODUCT_COLUMNS,
  type ProductCandidate, type RecentProduct,
} from '../tools';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processMessengerEvents(
  db: SupabaseClient,
  events: MessengerEvent[],
): Promise<{ pendingConversationIds: string[]; pending: { conversationId: string; messageId: string }[] }> {
  const latest = new Map<string, string>();
  const batching = messageBatchingEnabled();
  for (const ev of events) {
    try {
      const ing = await ingestInbound(db, ev);
      if (!ing) continue;
      if (batching) latest.set(ing.conversationId, ing.messageId);
      else await runConversationTurn(db, ing.conversationId);
    } catch (e: any) {
      await db.from('integration_logs').insert({
        integration: 'meta', direction: 'inbound', ok: false,
        error: e?.message ?? 'messenger_process_error', request: ev as any,
      });
    }
  }
  const pending = [...latest.entries()].map(([conversationId, messageId]) => ({ conversationId, messageId }));
  return { pendingConversationIds: pending.map((p) => p.conversationId), pending };
}

/**
 * Column-free debounce: wait the batch window, then run ONE merged turn per
 * conversation — only if the message that triggered the wait is STILL the newest
 * inbound (otherwise a newer message's own webhook handles the whole burst).
 */
export async function runMessageBatchDebounce(
  db: SupabaseClient,
  pending: { conversationId: string; messageId: string }[] | string[],
  windowMs = batchWindowMs(),
): Promise<void> {
  if (!pending.length) return;
  const items = (typeof pending[0] === 'string')
    ? (pending as string[]).map((conversationId) => ({ conversationId, messageId: '' }))
    : (pending as { conversationId: string; messageId: string }[]);
  await sleep(windowMs + 250);
  for (const it of items) {
    try {
      if (it.messageId && !(await isLatestInbound(db, it.conversationId, it.messageId))) continue;
      await runConversationTurn(db, it.conversationId);
    } catch { /* logged inside runConversationTurn */ }
  }
}

async function isLatestInbound(db: SupabaseClient, conversationId: string, messageId: string): Promise<boolean> {
  const { data } = await db
    .from('messages').select('id')
    .eq('conversation_id', conversationId).eq('direction', 'inbound')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return !data || (data as any).id === messageId;
}

async function ingestInbound(db: SupabaseClient, ev: MessengerEvent): Promise<{ conversationId: string; messageId: string } | null> {
  const psid = ev.sender?.id;
  if (!psid || !ev.message) return null;

  const { data: customer } = await db
    .from('customers')
    .upsert({ channel: 'messenger', external_id: psid }, { onConflict: 'channel,external_id' })
    .select('id, is_blocked, first_name')
    .single();
  if (!customer || customer.is_blocked) return null;
  if (!customer.first_name) void fetchAndSaveCustomerProfile(db, customer.id, psid);

  const terminal = ['resolved', 'completed', 'cancelled', 'spam', 'blocked'];
  let { data: convo } = await db
    .from('conversations').select('id')
    .eq('customer_id', customer.id)
    .not('status', 'in', `(${terminal.join(',')})`)
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (!convo) {
    const { data: created } = await db
      .from('conversations')
      .insert({ customer_id: customer.id, channel: 'messenger', status: 'new', ai_enabled: true })
      .select('id').single();
    convo = created;
  }
  if (!convo) return null;

  const text = (ev.message.text ?? '').trim();
  const attachments = (ev.message.attachments ?? []).map((a) => ({ type: a.type, url: a.payload?.url }));
  // A reply to a story carries the story media URL — treat it as the product
  // image so a price question on a story reply routes to the image matcher.
  const storyUrl = ev.message.reply_to?.story?.url;
  if (storyUrl && !attachments.some((a) => a.url === storyUrl)) {
    attachments.push({ type: 'image', url: storyUrl });
  }
  const mid = ev.message.mid;
  if (mid) {
    const { data: existing } = await db.from('messages').select('id').eq('external_id', mid).maybeSingle();
    if (existing) return null;
  }
  const { data: inserted } = await db.from('messages').insert({
    conversation_id: convo.id, direction: 'inbound', sender_type: 'customer',
    body: text, attachments, external_id: mid,
  }).select('id').single();
  await db.from('conversations').update({
    last_message_at: new Date().toISOString(),
    last_customer_message_at: new Date().toISOString(),
    last_message_preview: (text || '[image]').slice(0, 120),
  }).eq('id', convo.id);
  if (!inserted) return null;
  return { conversationId: convo.id, messageId: inserted.id };
}

export async function runConversationTurn(db: SupabaseClient, conversationId: string): Promise<void> {
  const { data: convo } = await db
    .from('conversations').select('id, ai_enabled, status, customer_id')
    .eq('id', conversationId).maybeSingle();
  if (!convo) return;
  if (!convo.ai_enabled || !isGeminiConfigured()) return; // admin paused, or AI not configured

  const { data: cust } = convo.customer_id
    ? await db.from('customers').select('external_id, channel, first_name, last_name, phone, address, city').eq('id', convo.customer_id).maybeSingle()
    : { data: null as any };
  const psid: string | null = cust?.external_id ?? null;

  // Unanswered batch: inbound messages after the last outbound reply.
  const { data: lastOut } = await db
    .from('messages').select('created_at')
    .eq('conversation_id', conversationId).eq('direction', 'outbound')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  let q = db.from('messages').select('id, body, attachments, created_at')
    .eq('conversation_id', conversationId).eq('direction', 'inbound')
    .order('created_at', { ascending: true });
  if (lastOut?.created_at) q = q.gt('created_at', lastOut.created_at);
  const { data: batchRows } = await q.limit(20);
  const batch = batchRows ?? [];
  if (batch.length === 0) return;

  const text = batch.map((m: any) => (m.body ? String(m.body).trim() : '')).filter(Boolean).join('\n').trim();
  const images: string[] = [];
  for (const m of batch) {
    for (const a of (((m as any).attachments ?? []) as { type?: string; url?: string }[])) {
      if (a?.type === 'image' && a?.url) images.push(a.url);
    }
  }
  const currentImage = images.length ? images[images.length - 1] : null;
  const triggerMessageId = (batch[batch.length - 1] as any).id as string;

  const behaviors = await loadBehaviorsWith(db);
  const memory = convo.customer_id ? await getCustomerMemory(db, convo.customer_id) : null;
  const memoryContext = buildMemoryContext(memory);

  let recentImage: string | null = null;
  if (!currentImage && (!text || isProductQuestion(text))) {
    recentImage = await findRecentUnansweredImage(db, conversationId, triggerMessageId);
  }
  const lastImageContext = !currentImage && !recentImage && isImageContextFollowUp(text)
    ? await findLastImageContext(db, conversationId, triggerMessageId)
    : null;

  const action = decideAgentAction({ hasCurrentImage: !!currentImage, hasRecentUnansweredImage: !!recentImage, text });

  let resolved: ProductCandidate[] = [];
  if (lastImageContext) {
    resolved = await handleImageFollowUpTurn(db, conversationId, triggerMessageId, psid ?? '', lastImageContext, text, memoryContext, behaviors);
  } else if (action === 'image_turn') {
    const imageUrl = currentImage ?? recentImage;
    if (imageUrl) {
      resolved = await handleImageTurn(db, conversationId, triggerMessageId, psid ?? '', imageUrl, text, memoryContext, behaviors);
    }
  } else {
    resolved = await handleTextTurn(db, conversationId, triggerMessageId, psid ?? '', text, memoryContext, behaviors);
  }

  // Persist customer memory after the turn (best-effort).
  if (convo.customer_id) {
    await updateMemoryAfterTurn(db, convo.customer_id, cust, resolved, conversationId, text);
  }
}

async function loadHistory(
  db: SupabaseClient, conversationId: string, excludeMessageId: string | null, limit = 24,
): Promise<{ role: 'customer' | 'assistant'; text: string }[]> {
  const { data } = await db
    .from('messages').select('id, direction, body, created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit + 2);
  const rows = (data ?? []).filter((m: any) => m.id !== excludeMessageId && m.body && String(m.body).trim());
  rows.reverse();
  return rows.slice(-limit).map((m: any) => ({ role: m.direction === 'inbound' ? 'customer' : 'assistant', text: String(m.body) }));
}

async function handleImageTurn(
  db: SupabaseClient, conversationId: string, messageId: string | null, psid: string,
  imageUrl: string, extraText: string, memoryContext: string, behaviors: BehaviorMap,
): Promise<ProductCandidate[]> {
  const behavior = composeBehaviorContext(behaviors, 'image_matching');
  const result = await matchCustomerImage(db, {
    imageUrl, extraText, memoryContext,
    behaviorSystemPrompt: behavior.systemPrompt,
    baseDiagnostics: behaviorMetadata(behavior, { workflow: 'messenger_image' }),
    searchLimit: 50,
  });
  const lastImageContext = createLastImageContext({
    source: 'messenger_image',
    imageUrl,
    imageMessageId: messageId,
    outcome: result.outcome,
    exactProductId: result.exactProductId,
    candidates: result.candidates,
    diagnostics: result.diagnostics,
  });
  const diagnostics: Record<string, unknown> = { ...result.diagnostics, candidates: result.candidates, last_image_context: lastImageContext };
  if (messageId) await updateMessageMeta(db, messageId, diagnostics);

  // Gemini writes the customer reply from the visual matches (no option template).
  const replyBehavior = composeBehaviorContext(behaviors, 'messenger');
  const history = await loadHistory(db, conversationId, messageId);
  // If the customer also asked to SEE photos, attach images of THIS turn's
  // matches only (never fall back to older products on a fresh, unmatched photo).
  const imageSel = detectImageRequest(extraText) ? selectSendableImages(result.candidates, MAX_AUTO_IMAGES) : null;
  const sendImages = imageSel?.images ?? [];
  const baseSituation = result.candidates.length
    ? 'The customer sent a photo of a product. The catalog results are the closest visual matches. Present them naturally in Libyan Arabic (at most 5) and help them confirm which one they mean. Use ONLY these prices; if a price is missing, say it will be confirmed. Do not claim certainty you do not have.'
    : 'The customer sent a photo but no product matched it confidently. Ask ONE short, friendly clarifying question to narrow it down (what the item is, its colour or use). Do not guess products.';
  const situation = sendImages.length
    ? `${baseSituation} ${imageSendSituation({ count: sendImages.length, grouped: imageSel!.grouped, more: imageSel!.more })}`
    : baseSituation;
  const composed = await composeCustomerReply(db, {
    systemPrompt: replyBehavior.systemPrompt,
    history,
    message: extraText || '',
    candidates: result.candidates,
    contextNote: situationNote(memoryContext, situation),
  });
  const delivery = await deliverAndStore(db, conversationId, psid, composed.text, behaviorMetadata(behavior, {
    workflow: 'messenger_image',
    model: composed.model,
    selected_product_id: result.exactProductId,
    confidence: result.candidates[0]?.confidence ?? null,
    candidates: result.candidates,
    last_image_context: lastImageContext,
    memory_used: !!memoryContext,
    reply_strategy: result.candidates.length ? 'composed_options' : 'ask_clarify',
    image_request: !!imageSel,
  }), messageId, sendImages);
  // A newer customer message arrived mid-turn → the superseding turn owns the
  // reply and conversation state. Do not write audit/needs_human side effects.
  if (delivery.superseded) return result.candidates;

  // Audit row for review (AI's own guess — NOT an admin-confirmed fingerprint).
  await db.from('image_match_corrections').insert({
    conversation_id: conversationId, message_id: messageId, customer_image_url: imageUrl,
    customer_image_hash: result.customerImageHash,
    ai_suggested_product_ids: result.candidates.map((c) => c.id),
    ai_top_score: result.candidates[0]?.confidence ?? null,
    outcome: result.candidates.length ? (result.outcome === 'none' ? 'multiple' : result.outcome) : 'none',
    corrected_product_id: result.exactProductId,
  });
  await logAi(db, 'vision', conversationId, null, result.outcome, 0);
  if (result.candidates.length) {
    await db.from('conversations').update({ status: 'ai_handling' }).eq('id', conversationId).eq('ai_enabled', true);
  } else {
    await markNeedsHuman(db, conversationId, 'unsafe_image_match', 'Image match returned no safe product candidates.');
  }
  return result.candidates;
}

async function handleImageFollowUpTurn(
  db: SupabaseClient, conversationId: string, messageId: string | null, psid: string,
  imageContext: LastImageContext, text: string, memoryContext: string, behaviors: BehaviorMap,
): Promise<ProductCandidate[]> {
  const behavior = composeBehaviorContext(behaviors, 'messenger');
  const decision = decideImageContextFollowUp(imageContext, text);
  if (messageId) {
    await updateMessageMeta(db, messageId, {
      workflow: 'messenger_image_followup',
      reused_last_image_context: true,
      last_image_context: imageContext,
      candidates: decision.candidates,
      selected_product_id: decision.selectedProductId,
      reply_strategy: decision.replyStrategy,
      needs_human: decision.needsHuman,
      needs_human_reason: decision.needsHumanReason,
    });
  }
  // Gemini writes the reply from the decision's situation note + selected product.
  const history = await loadHistory(db, conversationId, messageId);
  const products = decision.selectedProductId
    ? decision.candidates.filter((c) => c.id === decision.selectedProductId)
    : decision.candidates;
  // Attach photos if the follow-up asked to SEE them ("نبي نشوفهم", "وريني الألوان").
  const imagePlan = await resolveTurnImages(db, conversationId, messageId, detectImageRequest(text), products);
  const sendImages = imagePlan.selection?.images ?? [];
  const situation = imagePlan.selection
    ? `${decision.situation} ${imageSendSituation({ count: imagePlan.selection.images.length, grouped: imagePlan.selection.grouped, more: imagePlan.selection.more })}`
    : imagePlan.noImage
      ? `${decision.situation} ${imageUnavailableSituation()}`
      : decision.situation;
  const composed = await composeCustomerReply(db, {
    systemPrompt: behavior.systemPrompt,
    history,
    message: text || 'سلام',
    candidates: products,
    contextNote: situationNote(memoryContext, situation),
  });
  const delivery = await deliverAndStore(db, conversationId, psid, composed.text, behaviorMetadata(behavior, {
    workflow: 'messenger_image_followup',
    model: composed.model,
    reused_last_image_context: true,
    selected_product_id: decision.selectedProductId,
    candidates: decision.candidates,
    last_image_context: imageContext,
    memory_used: !!memoryContext,
    reply_strategy: decision.replyStrategy,
    needs_human: decision.needsHuman,
    needs_human_reason: decision.needsHumanReason,
    image_request: detectImageRequest(text),
  }), messageId, sendImages);
  if (delivery.superseded) return decision.candidates;
  await logAi(db, 'chat', conversationId, null, 'image_followup', 0);
  if (decision.needsHuman) {
    await markNeedsHuman(db, conversationId, decision.needsHumanReason ?? 'admin_follow_up_required', `Image follow-up needs human: ${decision.replyStrategy}`);
  } else {
    await db.from('conversations').update({ status: 'ai_handling' }).eq('id', conversationId).eq('ai_enabled', true);
  }
  return decision.candidates;
}

async function handleTextTurn(
  db: SupabaseClient, conversationId: string, messageId: string | null, psid: string,
  text: string, memoryContext: string, behaviors: BehaviorMap,
): Promise<ProductCandidate[]> {
  const behavior = composeBehaviorContext(behaviors, 'messenger');

  // Admin-required (order/refund/exchange/complaint/payment/delivery): Gemini
  // writes a warm handoff in its own words, then we pause for a human.
  if (isAdminRequiredText(text)) {
    const reason = adminRequiredReason(text);
    const history = await loadHistory(db, conversationId, messageId);
    const composed = await composeCustomerReply(db, {
      systemPrompt: behavior.systemPrompt,
      history,
      message: text,
      contextNote: situationNote(memoryContext, adminRequiredSituation(reason)),
    });
    const delivery = await deliverAndStore(db, conversationId, psid, composed.text, behaviorMetadata(behavior, {
      workflow: 'messenger_admin_followup',
      model: composed.model,
      needs_human: true,
      needs_human_reason: reason,
      memory_used: !!memoryContext,
      reply_strategy: 'handoff_message',
    }), messageId);
    if (delivery.superseded) return [];
    await logAi(db, 'chat', conversationId, composed.model, reason, 0);
    await markNeedsHuman(db, conversationId, reason, `AI paused: ${reason}`);
    return [];
  }

  const hasUrl = /https?:\/\//i.test(text);
  // An image request ("نبي صور أطقم حمام") should also resolve catalog products
  // so we have photos to attach, not just price cues.
  const wantsImages = detectImageRequest(text);
  const isCatalogQuestion = !!text && (isProductQuestion(text) || hasUrl || wantsImages);

  // Retrieve real candidates for product/price/URL questions (price truth comes
  // ONLY from these — Gemini is told never to invent one).
  let candidates: ProductCandidate[] = [];
  if (isCatalogQuestion) {
    const r = await resolveProductsFromText(db, text, 5);
    candidates = r.hits;
  }

  // Product photos: only when the customer asked to SEE them. The backend picks
  // the actual image URLs (max 3, de-duped, family-grouped) — Gemini just writes
  // the caption. Falls back to recent candidates / attached products in context.
  const imagePlan = await resolveTurnImages(db, conversationId, messageId, wantsImages, candidates);
  const sendImages = imagePlan.selection?.images ?? [];
  const replyCandidates = imagePlan.selection ? imagePlan.selection.products : candidates;

  // Single composed path: Gemini writes the reply, grounded by any resolved
  // candidates, with the controlled read-only tools available for live lookups.
  // This is the same path the admin "AI suggest" button uses — no robotic
  // numbered-option template.
  const history = await loadHistory(db, conversationId, messageId);
  const situation = imagePlan.selection
    ? imageSendSituation({ count: imagePlan.selection.images.length, grouped: imagePlan.selection.grouped, more: imagePlan.selection.more })
    : imagePlan.noImage
      ? imageUnavailableSituation()
      : candidates.length
        ? 'The customer is asking about products. Use ONLY the catalog results provided; show at most 5 options and help them choose. If a price is missing, say it will be confirmed — never invent it.'
        : undefined;
  const composed = await composeCustomerReply(db, {
    systemPrompt: behavior.systemPrompt,
    history,
    message: text || 'سلام',
    candidates: replyCandidates,
    contextNote: situationNote(memoryContext, situation),
  });
  const delivery = await deliverAndStore(db, conversationId, psid, composed.text, behaviorMetadata(behavior, {
    workflow: 'messenger_text', model: composed.model, history_turns: history.length,
    gemini_tool_rounds: composed.rounds, gemini_tool_calls: composed.toolCalls,
    catalog_candidates_count: candidates.length, candidates: replyCandidates, memory_used: !!memoryContext,
    image_request: wantsImages,
  }), messageId, sendImages);
  if (delivery.superseded) return replyCandidates;
  await logAi(db, 'chat', conversationId, composed.model, null, 0);
  await db.from('conversations').update({ status: 'ai_handling' }).eq('id', conversationId).eq('ai_enabled', true);
  return replyCandidates;
}

/** Update per-customer memory after a turn: recent products, contact facts, summary. */
async function updateMemoryAfterTurn(
  db: SupabaseClient, customerId: string, cust: any, resolved: ProductCandidate[], conversationId: string, lastText: string,
): Promise<void> {
  const top = resolved[0];
  const addRecentProduct: RecentProduct | undefined = top
    ? { product_id: top.id, name: top.name, price: top.price, resolved_at: new Date().toISOString(), match_type: top.confidence >= 0.82 ? 'exact' : 'multiple' }
    : undefined;
  await updateCustomerMemory(db, customerId, {
    addRecentProduct,
    known_name: [cust?.first_name, cust?.last_name].filter(Boolean).join(' ') || undefined,
    known_phone: cust?.phone ?? undefined,
    known_address: [cust?.address, cust?.city].filter(Boolean).join(', ') || undefined,
    touchConversation: true,
  });
  // Best-effort rolling summary (after the reply was already sent).
  try {
    const history = await loadHistory(db, conversationId, null, 14);
    if (history.length >= 2) {
      const convo = history.map((h) => `${h.role === 'customer' ? 'Customer' : 'Assistant'}: ${h.text}`).join('\n');
      const r = await generateContent(
        `Summarize what we know about this customer for future replies in 1-2 short sentences (their needs, products discussed, any preferences). Conversation:\n${convo}`,
        { model: routerModel(), temperature: 0.2, maxOutputTokens: 200 },
      );
      const summary = r.text?.trim();
      if (summary) await updateCustomerMemory(db, customerId, { summary });
    }
  } catch { /* best-effort */ }
}

async function findRecentUnansweredImage(db: SupabaseClient, conversationId: string, currentMessageId: string | null): Promise<string | null> {
  const { data } = await db
    .from('messages').select('id, direction, attachments, created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(12);
  const rows = data ?? [];
  let lastOutboundAt: string | null = null;
  for (const m of rows) {
    if ((m as any).direction === 'outbound' && !lastOutboundAt) lastOutboundAt = (m as any).created_at;
    if ((m as any).direction !== 'inbound') continue;
    if ((m as any).id === currentMessageId) continue;
    const atts = ((m as any).attachments ?? []) as { type?: string; url?: string }[];
    const img = atts.find((a) => a?.type === 'image' && a?.url)?.url;
    if (!img) continue;
    if (lastOutboundAt && lastOutboundAt > (m as any).created_at) return null;
    return img;
  }
  return null;
}

async function findLastImageContext(db: SupabaseClient, conversationId: string, currentMessageId: string | null): Promise<LastImageContext | null> {
  const { data } = await db
    .from('messages').select('id, direction, attachments, ai_meta, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(40);
  const rows = data ?? [];
  const olderImageUrl = (idx: number): string | null => {
    for (let j = idx + 1; j < rows.length; j++) {
      const atts = ((rows[j] as any).attachments ?? []) as { type?: string; url?: string }[];
      const img = atts.find((a) => a?.type === 'image' && a?.url)?.url;
      if (img) return img;
    }
    return null;
  };
  for (let i = 0; i < rows.length; i++) {
    const m: any = rows[i];
    if (m.id === currentMessageId) continue;
    const meta = m.ai_meta && typeof m.ai_meta === 'object' ? m.ai_meta as Record<string, unknown> : {};
    const stored = normalizeLastImageContext(meta.last_image_context);
    if (stored) return stored;
    const candidates = Array.isArray((meta as any).candidates) ? (meta as any).candidates : [];
    const workflow = typeof meta.workflow === 'string' ? meta.workflow : '';
    if (candidates.length && (workflow.includes('messenger_image') || meta.selected_product_id || meta.confidence)) {
      return createLastImageContext({
        source: 'stored_message',
        imageUrl: olderImageUrl(i),
        imageMessageId: null,
        outcome: typeof meta.selected_product_id === 'string' ? 'exact' : 'multiple',
        exactProductId: typeof meta.selected_product_id === 'string' ? meta.selected_product_id : null,
        candidates,
        diagnostics: meta,
        createdAt: typeof m.created_at === 'string' ? m.created_at : null,
      });
    }
  }
  return null;
}

/**
 * Decide which product photos (if any) to attach this turn. Only runs when the
 * customer asked to SEE images. The candidate pool is, in priority order:
 *   1. products resolved/matched THIS turn,
 *   2. candidates from a recent AI reply / image context (so "نبي نشوفهم" after
 *      options, or "ابعثلي صورته" after an earlier match, reuses them),
 *   3. the most recent product(s) attached to the customer's memory.
 * Returns a selection (max 3, de-duped, family-grouped) or noImage=true when the
 * customer wants a photo but none is usable.
 */
async function resolveTurnImages(
  db: SupabaseClient, conversationId: string, messageId: string | null,
  wanted: boolean, turnCandidates: ProductCandidate[],
): Promise<{ selection: SendableSelection | null; noImage: boolean }> {
  if (!wanted) return { selection: null, noImage: false };
  let pool: ProductCandidate[] = (turnCandidates ?? []).filter(Boolean);
  if (!pool.length) pool = await findRecentCandidates(db, conversationId, messageId);
  if (!pool.length) pool = await recentMemoryProductCandidates(db, conversationId);
  if (!pool.length) return { selection: null, noImage: true };
  const selection = selectSendableImages(pool, MAX_AUTO_IMAGES);
  if (!selection.images.length) return { selection: null, noImage: true };
  return { selection, noImage: false };
}

/** Most recent product candidates carried by a prior reply (ai_meta). */
async function findRecentCandidates(db: SupabaseClient, conversationId: string, currentMessageId: string | null): Promise<ProductCandidate[]> {
  const { data } = await db
    .from('messages').select('id, ai_meta, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(20);
  for (const m of data ?? []) {
    if ((m as any).id === currentMessageId) continue;
    const meta = (m as any).ai_meta;
    if (!meta || typeof meta !== 'object') continue;
    const lic = normalizeLastImageContext((meta as any).last_image_context);
    if (lic?.candidates?.length) return lic.candidates;
    const c = (meta as any).candidates;
    if (Array.isArray(c) && c.length) return c as ProductCandidate[];
  }
  return [];
}

/** Active+priced products from the customer's recent memory (with catalog images). */
async function recentMemoryProductCandidates(db: SupabaseClient, conversationId: string): Promise<ProductCandidate[]> {
  const { data: convo } = await db.from('conversations').select('customer_id').eq('id', conversationId).maybeSingle();
  if (!convo?.customer_id) return [];
  const mem = await getCustomerMemory(db, convo.customer_id);
  const ids = (mem?.recent_products ?? []).map((r) => r.product_id).filter(Boolean).slice(0, 3);
  if (!ids.length) return [];
  const { data } = await db.from('products').select(PRODUCT_COLUMNS)
    .in('id', ids).eq('status', 'active').not('active_price', 'is', null);
  const rows = (data ?? []) as any[];
  // Preserve the memory's recency order.
  const byId = new Map(rows.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((p) => toCandidate(p, 0.6, 'attached product'));
}

async function markNeedsHuman(db: SupabaseClient, conversationId: string, reason: string, summary?: string): Promise<void> {
  await db.from('conversations').update({
    status: 'needs_human',
    ai_enabled: false,
    detected_intent: reason,
    context_summary: summary ? summary.slice(0, 240) : undefined,
  }).eq('id', conversationId);
  await db.from('activity_logs').insert({
    actor_type: 'system',
    action: 'needs_human_marked',
    entity_type: 'conversation',
    entity_id: conversationId,
    summary: summary ?? reason,
  });
}

async function fetchAndSaveCustomerProfile(db: SupabaseClient, customerId: string, psid: string) {
  const profile = await getUserProfile(psid);
  if (profile?.first_name || profile?.last_name) {
    await db.from('customers').update({
      first_name: profile.first_name ?? null,
      last_name: profile.last_name ?? null,
      display_name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null,
    }).eq('id', customerId);
  }
}

interface DeliveryResult {
  /** True only when Meta actually accepted the send. */
  delivered: boolean;
  /** True when a newer inbound arrived mid-turn, so this reply was abandoned. */
  superseded: boolean;
}

async function deliverAndStore(
  db: SupabaseClient, conversationId: string, psid: string, rawText: string,
  aiMeta: Record<string, unknown> = {}, triggerMessageId: string | null = null,
  images: { url: string; product_id?: string | null }[] = [],
): Promise<DeliveryResult> {
  // SUPERSEDE GUARD: if a newer customer message arrived while this turn was
  // being prepared (matching/Gemini take several seconds), abandon this reply
  // WITHOUT storing any outbound row. The newer message's own turn re-reads the
  // full unanswered batch (image + follow-up text together) and answers it in
  // ONE reply. This is what prevents an image_turn AND a follow-up text_turn
  // both replying to the same burst ("I see it" + "the price is…"), and it also
  // prevents a stale image send from firing after a newer message arrived.
  // Not storing an outbound is deliberate: it keeps the unanswered batch intact
  // for the superseding turn (an outbound row would split the batch).
  if (triggerMessageId) {
    const { data: latest } = await db
      .from('messages').select('id')
      .eq('conversation_id', conversationId).eq('direction', 'inbound')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (latest && (latest as any).id !== triggerMessageId) {
      await db.from('ai_events').insert({
        kind: 'chat', conversation_id: conversationId, model: null,
        detected_intent: 'superseded_by_newer_inbound', latency_ms: 0, success: true,
      }).then(() => {}, () => {});
      return { delivered: false, superseded: true };
    }
  }

  // Final outbound safety gate: strip any leaked tool/debug/system text.
  const clean = sanitizeCustomerTextDetailed(rawText);
  const text = clean.text;
  const safetyMeta = clean.changed ? { sanitized: true, sanitized_removed: clean.removed } : {};

  // Re-read AI state at the last moment to close the handoff/pause race.
  const { data: live } = await db.from('conversations').select('ai_enabled').eq('id', conversationId).maybeSingle();
  const aiStillOn = live?.ai_enabled !== false;

  // Backend controls the actual image URLs; cap to MAX_AUTO_IMAGES (no spam).
  const toSend = (images ?? []).slice(0, MAX_AUTO_IMAGES);

  let textDelivered = false;
  let deliveryError: string | null = null;
  const sentImages: { type: 'image'; url: string; product_id: string | null }[] = [];
  const failedImages: { url: string; error: string }[] = [];

  if (aiStillOn && psid && isMetaConfigured()) {
    // Caption first, then the photo(s) — so the customer reads context above the
    // images. A failed text send is recorded but does not stop image attempts.
    if (text) {
      try {
        await sendMessage(psid, text);
        textDelivered = true;
      } catch (e: any) {
        deliveryError = e?.message ?? 'send_failed';
        await db.from('integration_logs').insert({ integration: 'meta', direction: 'outbound', ok: false, error: deliveryError });
      }
    }
    for (const img of toSend) {
      try {
        await sendImageMessage(psid, img.url);
        sentImages.push({ type: 'image', url: img.url, product_id: img.product_id ?? null });
      } catch (e: any) {
        const err = e?.message ?? 'image_send_failed';
        failedImages.push({ url: img.url, error: err });
        await db.from('integration_logs').insert({ integration: 'meta', direction: 'outbound', ok: false, error: `image_send: ${err}` });
      }
    }
  }

  // Delivered if the caption OR at least one image actually reached Meta.
  const delivered = textDelivered || sentImages.length > 0;
  // Image-send diagnostics. Only successfully-sent images go into `attachments`
  // so the inbox never renders an image that failed to send. Intended URLs are
  // kept in ai_meta for admin/playground visibility.
  const imageMeta = toSend.length
    ? {
        image_send: {
          workflow: 'product_image_send',
          requested: toSend.length,
          intended: toSend.map((i) => i.url),
          product_ids: toSend.map((i) => i.product_id ?? null),
          sent: sentImages.length,
          failed: failedImages,
        },
      }
    : {};

  // Delivery state recorded consistently with manual sends: delivered_at is set
  // only on a confirmed Meta send; a failure stores delivery_error so the inbox
  // can show "failed" (never imply a failed/unsent reply reached the customer).
  await db.from('messages').insert({
    conversation_id: conversationId, direction: 'outbound', sender_type: 'ai', body: text,
    attachments: sentImages,
    ai_meta: { ...aiMeta, ...safetyMeta, ...imageMeta, delivered, ai_enabled_at_send: aiStillOn, ...(deliveryError ? { delivery_error: deliveryError } : {}) },
    is_internal_suggestion: !delivered,
    delivered_at: delivered ? new Date().toISOString() : null,
  });
  return { delivered, superseded: false };
}

async function updateMessageMeta(db: SupabaseClient, messageId: string, aiMeta: Record<string, unknown>) {
  await db.from('messages').update({ ai_meta: aiMeta }).eq('id', messageId);
}

async function logAi(db: SupabaseClient, kind: string, conversationId: string, model: string | null, intent: string | null, latencyMs: number) {
  await db.from('ai_events').insert({ kind, conversation_id: conversationId, model, detected_intent: intent, latency_ms: latencyMs, success: true });
}
