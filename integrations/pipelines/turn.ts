/**
 * Durable conversation turn — exactly ONE AI reply per claimed customer batch.
 *
 * Replaces the old in-request messenger pipeline (EH-001/002/010/011):
 *   * the worker claims the turn job (FOR UPDATE SKIP LOCKED, per-conversation
 *     dedupe key) so two processes can never answer the same burst;
 *   * the ENTIRE unanswered burst is merged into one turn (no silent 20-cap);
 *   * the reply is persisted to messages + outbox_messages in one transaction
 *     BEFORE any provider call; delivery is the outbox job's responsibility;
 *   * a newer inbound arriving mid-turn abandons the reply and re-queues the
 *     turn so image + follow-up bursts are answered once, coherently;
 *   * order intent sends the single deterministic handoff, flags human
 *     attention, and leaves the AI able to answer product follow-ups until an
 *     admin presses Take Over.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { isGeminiConfigured } from '../gemini';
import {
  detectImageRequest, selectSendableImages, imageSendContext, imageUnavailableContext,
  isMetaSafeImageUrl, MAX_AUTO_IMAGES, type SendableSelection,
} from './product-image';
import { loadBehaviorsWith, type BehaviorMap } from '../ai-behaviors';
import { matchCustomerImage } from './image-match';
import { resolveProductsFromText } from './product-resolve';
import { composeCustomerReply } from './compose-reply';
import { decideAgentAction, isProductQuestion } from './agent-policy';
import {
  decideImageContextFollowUp, createLastImageContext, isImageContextFollowUp,
  isImageContextFresh, normalizeLastImageContext, type LastImageContext,
} from './context-followup';
import { classifyIntent, shouldSendHandoff, type IntentResult } from './intent';
import { loadBusinessFacts, businessFactsRuntime, buildOrderHandoffMessage, type BusinessFacts } from './business-facts';
import { sanitizeCustomerTextDetailed } from '../util/customer-text';
import {
  getCustomerMemory, updateCustomerMemory, buildMemoryContext, toCandidate,
  type ProductCandidate, type RecentProduct,
} from '../tools';
import { productSelect, activePriced } from '../tools/products';
import { enqueue } from '../jobs/queue';
import { batchWindowMs } from '../flags';

const json = (v: unknown) => JSON.stringify(v ?? null);

export interface TurnResult {
  outcome: 'replied' | 'skipped' | 'superseded' | 'handoff' | 'no_batch';
  reason?: string;
  messageId?: string;
  outboxIds?: string[];
}

export async function runCustomerTurn(db: Kysely<DB>, conversationId: string): Promise<TurnResult> {
  const convo = await db
    .selectFrom('conversations')
    .select(['id', 'ai_enabled', 'status', 'customer_id', 'channel', 'handoff_sent_at', 'human_attention'])
    .where('id', '=', conversationId)
    .executeTakeFirst();
  if (!convo) return { outcome: 'skipped', reason: 'conversation_missing' };
  if (!convo.ai_enabled) return { outcome: 'skipped', reason: 'admin_takeover' };
  if (!isGeminiConfigured()) return { outcome: 'skipped', reason: 'gemini_not_configured' };

  const channel = (convo.channel === 'instagram' ? 'instagram' : 'messenger') as 'messenger' | 'instagram';
  const cust = convo.customer_id
    ? await db
        .selectFrom('customers')
        .select(['external_id', 'first_name', 'last_name', 'phone', 'address', 'city'])
        .where('id', '=', convo.customer_id)
        .executeTakeFirst()
    : null;
  const recipientId = cust?.external_id ?? null;
  if (!recipientId) return { outcome: 'skipped', reason: 'no_recipient' };

  // ---- The unanswered burst: every inbound after the last outbound ----------
  const lastOut = await db
    .selectFrom('messages').select('created_at')
    .where('conversation_id', '=', conversationId).where('direction', '=', 'outbound')
    .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  let q = db
    .selectFrom('messages').select(['id', 'body', 'attachments', 'created_at'])
    .where('conversation_id', '=', conversationId).where('direction', '=', 'inbound')
    .orderBy('created_at', 'asc');
  if (lastOut?.created_at) q = q.where('created_at', '>', lastOut.created_at);
  const batch = await q.limit(200).execute();
  if (!batch.length) return { outcome: 'no_batch' };

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
  const facts = await loadBusinessFacts(db);
  const memory = convo.customer_id ? await getCustomerMemory(db, convo.customer_id) : null;
  const memoryContext = buildMemoryContext(memory);
  const intent = classifyIntent(text);

  // ---- Order intent: one deterministic handoff, human attention, no loop ----
  if (intent.intent === 'order' && !currentImage) {
    const productAlso = isProductQuestion(text);
    if (shouldSendHandoff(intent, convo.handoff_sent_at as any)) {
      const handoffText = buildOrderHandoffMessage(facts);
      const fin = await finalizeTurn(db, {
        conversationId, channel, recipientId, triggerMessageId,
        text: handoffText, images: [],
        aiMeta: { workflow: 'order_handoff', intent: intent.intent, deterministic: true },
        humanAttention: { flag: true, reason: 'order_intent' },
        handoffSent: true,
      });
      if (fin.superseded) return { outcome: 'superseded' };
      await recordTurnMemory(db, convo.customer_id, cust, [], conversationId, text);
      await logAiEvent(db, { kind: 'chat', conversationId, intent: 'order_handoff', success: true });
      return { outcome: 'handoff', messageId: fin.messageId, outboxIds: fin.outboxIds };
    }
    if (!productAlso) {
      // Handoff already sent recently and the message is pure order talk:
      // never loop the handoff and never collect order details. Flag and stay quiet.
      await setHumanAttention(db, conversationId, 'order_followup');
      await logAiEvent(db, { kind: 'chat', conversationId, intent: 'order_followup_silent', success: true });
      return { outcome: 'skipped', reason: 'handoff_recently_sent' };
    }
    // Order phrasing mixed with a product question → answer the product part below.
  }

  // ---- Sensitive cases: flag attention; acknowledge naturally ---------------
  if (intent.needsHumanAttention && intent.intent !== 'order' && !currentImage) {
    const history = await loadHistory(db, conversationId, triggerMessageId);
    const composed = await composeCustomerReply(db, {
      behaviors,
      task: 'handoff_reply',
      history,
      message: text,
      memoryContext,
      runtimeState: { flow: 'human_attention', reason: intent.intent, business_facts: businessFactsRuntime(facts) },
    });
    const fin = await finalizeTurn(db, {
      conversationId, channel, recipientId, triggerMessageId,
      text: composed.text, images: [],
      aiMeta: { workflow: 'human_attention_ack', intent: intent.intent, model: composed.model, prompt_trace_id: composed.promptTraceId },
      humanAttention: { flag: true, reason: intent.intent },
    });
    if (fin.superseded) return { outcome: 'superseded' };
    await recordTurnMemory(db, convo.customer_id, cust, [], conversationId, text);
    await logAiEvent(db, { kind: 'chat', conversationId, model: composed.model, intent: intent.intent, success: composed.ok });
    return { outcome: 'replied', messageId: fin.messageId, outboxIds: fin.outboxIds };
  }

  // ---- Normal product conversation ------------------------------------------
  let recentImage: string | null = null;
  if (!currentImage && (!text || isProductQuestion(text))) {
    recentImage = await findRecentUnansweredImage(db, conversationId, triggerMessageId);
  }
  // A remembered image context is only reused while it is FRESH (EH-035);
  // a stale one would answer about the wrong product.
  const rememberedImageContext = !currentImage && !recentImage && isImageContextFollowUp(text)
    ? await findLastImageContext(db, conversationId, triggerMessageId)
    : null;
  const lastImageContext = isImageContextFresh(rememberedImageContext) ? rememberedImageContext : null;
  const action = decideAgentAction({ hasCurrentImage: !!currentImage, hasRecentUnansweredImage: !!recentImage, text });

  let turn: PreparedReply;
  if (lastImageContext) {
    turn = await prepareImageFollowUpReply(db, conversationId, triggerMessageId, lastImageContext, text, memoryContext, behaviors, facts);
  } else if (action === 'image_turn' && (currentImage ?? recentImage)) {
    turn = await prepareImageReply(db, conversationId, triggerMessageId, (currentImage ?? recentImage)!, text, memoryContext, behaviors, facts);
  } else {
    turn = await prepareTextReply(db, conversationId, triggerMessageId, text, memoryContext, behaviors, facts, intent);
  }

  // The model may itself detect buying intent the regex missed.
  const modelHandoff = turn.orderHandoffRequested
    && shouldSendHandoff({ intent: 'order', needsHumanAttention: true, sendOrderHandoff: true }, convo.handoff_sent_at as any);
  const fin = await finalizeTurn(db, {
    conversationId, channel, recipientId, triggerMessageId,
    text: turn.text, images: turn.images,
    extraTexts: modelHandoff ? [buildOrderHandoffMessage(facts)] : [],
    aiMeta: turn.aiMeta,
    humanAttention: modelHandoff ? { flag: true, reason: 'order_intent' } : turn.humanAttention,
    handoffSent: !!modelHandoff,
  });
  if (fin.superseded) return { outcome: 'superseded' };
  await turn.afterCommit?.(fin.messageId ?? null);
  await recordTurnMemory(db, convo.customer_id, cust, turn.candidates, conversationId, text);
  await logAiEvent(db, {
    kind: turn.aiMeta.workflow === 'image_match' ? 'vision' : 'chat',
    conversationId, model: (turn.aiMeta.model as string) ?? null,
    intent: (turn.aiMeta.intent as string) ?? null, success: true,
  });
  return { outcome: 'replied', messageId: fin.messageId, outboxIds: fin.outboxIds };
}

/* ----------------------------- reply preparation --------------------------- */

interface PreparedReply {
  text: string;
  images: { url: string; product_id?: string | null }[];
  candidates: ProductCandidate[];
  aiMeta: Record<string, unknown>;
  humanAttention?: { flag: boolean; reason: string } | undefined;
  /** The model called requestOrderHandoff — server appends the official message. */
  orderHandoffRequested?: boolean;
  afterCommit?: (messageId: string | null) => Promise<void>;
}

async function prepareTextReply(
  db: Kysely<DB>, conversationId: string, triggerMessageId: string, text: string,
  memoryContext: string, behaviors: BehaviorMap, facts: BusinessFacts, intent: IntentResult,
): Promise<PreparedReply> {
  const hasUrl = /https?:\/\//i.test(text);
  const wantsImages = detectImageRequest(text);
  const isCatalogQuestion = !!text && (isProductQuestion(text) || hasUrl || wantsImages);

  let candidates: ProductCandidate[] = [];
  if (isCatalogQuestion) {
    const r = await resolveProductsFromText(db, text, 5);
    candidates = r.hits;
  }

  const imagePlan = await resolveTurnImages(db, conversationId, triggerMessageId, wantsImages, candidates);
  const sendImages = imagePlan.selection?.images ?? [];
  const replyCandidates = imagePlan.selection ? imagePlan.selection.products : candidates;

  // A price question that resolved to nothing quotable → human attention with
  // natural wording (the missing_price behavior guides the reply).
  const missingPriceCase = isCatalogQuestion && candidates.length === 0 && /(بكم|السعر|كم سعره|price|how much)/i.test(text);

  const history = await loadHistory(db, conversationId, triggerMessageId);
  const composed = await composeCustomerReply(db, {
    behaviors,
    history,
    message: text || 'سلام',
    candidates: replyCandidates,
    memoryContext,
    runtimeState: {
      flow: 'customer_reply',
      catalog_question: isCatalogQuestion,
      candidate_count: candidates.length,
      action: candidates.length ? 'answer_from_candidates' : 'answer_customer',
      business_facts: businessFactsRuntime(facts),
      ...(intent.intent === 'delivery_question' ? { delivery_question: true } : {}),
      ...(imagePlan.selection ? imageSendContext({ count: sendImages.length, grouped: imagePlan.selection.grouped, more: imagePlan.selection.more }) : {}),
      ...(imagePlan.noImage ? imageUnavailableContext() : {}),
    },
  });
  // Honor model-requested photos when the deterministic path planned none:
  // validate ids against the catalog and cap at three real images.
  let finalImages = sendImages;
  if (!finalImages.length && composed.actions.imageProductIds.length) {
    const rows: any[] = await activePriced(productSelect(db))
      .where('products.id', 'in', composed.actions.imageProductIds.slice(0, MAX_AUTO_IMAGES))
      .execute();
    const pool = rows.map((p) => toCandidate(p, 0.7, 'model requested photo'));
    finalImages = selectSendableImages(pool, MAX_AUTO_IMAGES).images;
  }
  const modelAttention = composed.actions.humanAttention.requested
    ? { flag: true, reason: composed.actions.humanAttention.reason ?? 'model_flagged' }
    : undefined;
  return {
    text: composed.text,
    images: finalImages,
    candidates: replyCandidates,
    aiMeta: {
      workflow: 'customer_text', model: composed.model, history_turns: history.length,
      gemini_tool_rounds: composed.rounds, gemini_tool_calls: composed.toolCalls,
      catalog_candidates_count: candidates.length, candidates: replyCandidates,
      memory_used: !!memoryContext, image_request: wantsImages, intent: intent.intent,
      prompt_trace_id: composed.promptTraceId,
      ...(composed.actions.orderHandoff.requested ? { model_requested_handoff: true } : {}),
    },
    humanAttention: missingPriceCase ? { flag: true, reason: 'missing_price' } : modelAttention,
    orderHandoffRequested: composed.actions.orderHandoff.requested,
  };
}

async function prepareImageReply(
  db: Kysely<DB>, conversationId: string, triggerMessageId: string, imageUrl: string,
  extraText: string, memoryContext: string, behaviors: BehaviorMap, facts: BusinessFacts,
): Promise<PreparedReply> {
  const result = await matchCustomerImage(db, {
    imageUrl, extraText, memoryContext, behaviors,
    baseDiagnostics: { workflow: 'dm_image' },
    searchLimit: 50,
  });
  const lastImageContext = createLastImageContext({
    source: 'messenger_image',
    imageUrl,
    imageMessageId: triggerMessageId,
    outcome: result.outcome,
    exactProductId: result.exactProductId,
    candidates: result.candidates,
    diagnostics: result.diagnostics,
  });
  await updateMessageMeta(db, triggerMessageId, { ...result.diagnostics, candidates: result.candidates, last_image_context: lastImageContext });

  const history = await loadHistory(db, conversationId, triggerMessageId);
  const imageSel = detectImageRequest(extraText) ? selectSendableImages(result.candidates, MAX_AUTO_IMAGES) : null;
  const sendImages = imageSel?.images ?? [];
  const composed = await composeCustomerReply(db, {
    behaviors,
    history,
    message: extraText || '',
    candidates: result.candidates,
    memoryContext,
    runtimeState: {
      flow: 'image_match', outcome: result.outcome,
      action: result.candidates.length ? 'present_candidates_and_confirm' : 'clarify_product',
      business_facts: businessFactsRuntime(facts),
      ...(sendImages.length ? imageSendContext({ count: sendImages.length, grouped: imageSel!.grouped, more: imageSel!.more }) : {}),
    },
  });
  return {
    text: composed.text,
    images: sendImages,
    candidates: result.candidates,
    aiMeta: {
      workflow: 'image_match', model: composed.model,
      selected_product_id: result.exactProductId,
      confidence: result.candidates[0]?.confidence ?? null,
      candidates: result.candidates, last_image_context: lastImageContext,
      memory_used: !!memoryContext, image_request: !!imageSel,
      prompt_trace_id: composed.promptTraceId,
    },
    humanAttention: result.candidates.length ? undefined : { flag: true, reason: 'unrecognized_image' },
    afterCommit: async () => {
      await db.insertInto('image_match_corrections').values({
        conversation_id: conversationId, message_id: triggerMessageId, customer_image_url: imageUrl,
        customer_image_hash: result.customerImageHash,
        ai_suggested_product_ids: result.candidates.map((c) => c.id),
        ai_top_score: result.candidates[0]?.confidence ?? null,
        outcome: result.candidates.length ? (result.outcome === 'none' ? 'multiple' : result.outcome) : 'none',
        corrected_product_id: result.exactProductId,
      }).execute();
    },
  };
}

async function prepareImageFollowUpReply(
  db: Kysely<DB>, conversationId: string, triggerMessageId: string,
  imageContext: LastImageContext, text: string, memoryContext: string,
  behaviors: BehaviorMap, facts: BusinessFacts,
): Promise<PreparedReply> {
  const decision = decideImageContextFollowUp(imageContext, text);
  await updateMessageMeta(db, triggerMessageId, {
    workflow: 'dm_image_followup',
    reused_last_image_context: true,
    last_image_context: imageContext,
    candidates: decision.candidates,
    selected_product_id: decision.selectedProductId,
    reply_strategy: decision.replyStrategy,
  });
  const history = await loadHistory(db, conversationId, triggerMessageId);
  const products = decision.selectedProductId
    ? decision.candidates.filter((c) => c.id === decision.selectedProductId)
    : decision.candidates;
  const imagePlan = await resolveTurnImages(db, conversationId, triggerMessageId, detectImageRequest(text), products);
  const sendImages = imagePlan.selection?.images ?? [];
  const composed = await composeCustomerReply(db, {
    behaviors,
    history,
    message: text || 'سلام',
    candidates: products,
    memoryContext,
    runtimeState: {
      ...decision.runtimeState,
      business_facts: businessFactsRuntime(facts),
      ...(imagePlan.selection ? imageSendContext({ count: sendImages.length, grouped: imagePlan.selection.grouped, more: imagePlan.selection.more }) : {}),
      ...(imagePlan.noImage ? imageUnavailableContext() : {}),
    },
  });
  return {
    text: composed.text,
    images: sendImages,
    candidates: decision.candidates,
    aiMeta: {
      workflow: 'image_followup', model: composed.model,
      reused_last_image_context: true,
      selected_product_id: decision.selectedProductId,
      candidates: decision.candidates,
      reply_strategy: decision.replyStrategy,
      memory_used: !!memoryContext, image_request: detectImageRequest(text),
      prompt_trace_id: composed.promptTraceId,
    },
    humanAttention: decision.needsHuman ? { flag: true, reason: decision.needsHumanReason ?? 'follow_up_needs_human' } : undefined,
  };
}

/* ------------------------------- finalization ------------------------------ */

interface FinalizeArgs {
  conversationId: string;
  channel: 'messenger' | 'instagram';
  recipientId: string;
  triggerMessageId: string;
  text: string;
  /** Additional standalone text messages (e.g. the order-handoff message). */
  extraTexts?: string[];
  images: { url: string; product_id?: string | null }[];
  aiMeta: Record<string, unknown>;
  humanAttention?: { flag: boolean; reason: string } | undefined;
  handoffSent?: boolean;
}

/**
 * Persist the reply durably (message row + outbox rows + conversation state)
 * in ONE transaction, then enqueue delivery. The supersede check runs INSIDE
 * the transaction so a burst can never get two replies.
 */
async function finalizeTurn(
  db: Kysely<DB>, args: FinalizeArgs,
): Promise<{ superseded: boolean; messageId?: string; outboxIds?: string[] }> {
  const clean = sanitizeCustomerTextDetailed(args.text);
  const text = clean.text;
  const safeImages = (args.images ?? [])
    .filter((i) => isMetaSafeImageUrl(i.url))
    .slice(0, MAX_AUTO_IMAGES);
  if (!text && !safeImages.length && !(args.extraTexts?.length)) return { superseded: false };

  return db.transaction().execute(async (trx) => {
    // Serialize finalization per conversation. Multiple workers may compose in
    // parallel after a retry/race, but only one is allowed to persist a reply.
    const live = await trx
      .selectFrom('conversations').select(['ai_enabled'])
      .where('id', '=', args.conversationId).forUpdate().executeTakeFirst();
    if (live?.ai_enabled === false) return { superseded: true };

    // Supersede guard (durable): the trigger must still be the newest inbound.
    const latest = await trx
      .selectFrom('messages').select('id')
      .where('conversation_id', '=', args.conversationId).where('direction', '=', 'inbound')
      .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    if (latest && latest.id !== args.triggerMessageId) {
      // The newer message's own turn (re-enqueued below) answers the full burst.
      await enqueue(trx, {
        jobType: 'customer_turn',
        dedupeKey: `turn:${args.conversationId}`,
        payload: { conversationId: args.conversationId, triggerMessageId: latest.id },
        runAt: new Date(Date.now() + batchWindowMs()),
        onDuplicate: 'push_run_at',
        maxAttempts: 3,
      });
      return { superseded: true };
    }

    const trigger = await trx.selectFrom('messages').select('created_at')
      .where('id', '=', args.triggerMessageId).executeTakeFirst();
    if (trigger) {
      const alreadyReplied = await trx.selectFrom('messages').select('id')
        .where('conversation_id', '=', args.conversationId)
        .where('direction', '=', 'outbound')
        .where('created_at', '>=', trigger.created_at)
        .executeTakeFirst();
      if (alreadyReplied) return { superseded: true };
    }

    // AI may have been paused while composing — honor it at the last moment.
    const message = await trx
      .insertInto('messages')
      .values({
        conversation_id: args.conversationId,
        direction: 'outbound',
        sender_type: 'ai',
        body: text || null,
        attachments: json([]),
        ai_meta: json({ ...args.aiMeta, ...(clean.changed ? { sanitized: true, sanitized_removed: clean.removed } : {}), intended_images: safeImages }),
        delivery_status: 'pending',
        is_internal_suggestion: false,
      })
      .returning('id')
      .executeTakeFirst();
    const messageId = message?.id;
    if (!messageId) throw new Error('failed to persist outbound message');

    const outboxIds: string[] = [];
    const texts = [text, ...(args.extraTexts ?? [])].filter(Boolean);
    for (let t = 0; t < texts.length; t++) {
      const row = await trx
        .insertInto('outbox_messages')
        .values({
          conversation_id: args.conversationId, message_id: messageId,
          channel: args.channel, recipient_id: args.recipientId,
          kind: 'text', body: texts[t],
          idempotency_key: t === 0 ? `msg:${messageId}:text` : `msg:${messageId}:text:${t}`,
          sender_type: 'ai',
        })
        .returning('id').executeTakeFirst();
      if (row) outboxIds.push(row.id);
    }
    for (let i = 0; i < safeImages.length; i++) {
      const img = safeImages[i];
      const row = await trx
        .insertInto('outbox_messages')
        .values({
          conversation_id: args.conversationId, message_id: messageId,
          channel: args.channel, recipient_id: args.recipientId,
          kind: 'image', image_url: img.url, product_id: img.product_id ?? null,
          idempotency_key: `msg:${messageId}:img:${i}`,
          sender_type: 'ai',
        })
        .returning('id').executeTakeFirst();
      if (row) outboxIds.push(row.id);
    }

    await trx
      .updateTable('conversations')
      .set({
        status: 'ai_handling',
        last_message_at: new Date().toISOString(),
        last_message_preview: (text || '[صورة]').slice(0, 120),
        ...(args.humanAttention?.flag
          ? { human_attention: true, human_attention_reason: args.humanAttention.reason, human_attention_at: new Date().toISOString() }
          : {}),
        ...(args.handoffSent ? { handoff_sent_at: new Date().toISOString() } : {}),
      })
      .where('id', '=', args.conversationId)
      .execute();

    for (const outboxId of outboxIds) {
      await enqueue(trx, { jobType: 'outbox_deliver', payload: { outboxId }, maxAttempts: 6, priority: 50 });
    }
    return { superseded: false, messageId, outboxIds };
  });
}

/* --------------------------------- helpers --------------------------------- */

export async function setHumanAttention(db: Kysely<DB>, conversationId: string, reason: string): Promise<void> {
  await db
    .updateTable('conversations')
    .set({ human_attention: true, human_attention_reason: reason, human_attention_at: new Date().toISOString() })
    .where('id', '=', conversationId)
    .execute();
}

async function loadHistory(
  db: Kysely<DB>, conversationId: string, excludeMessageId: string | null, limit = 24,
): Promise<{ role: 'customer' | 'assistant'; text: string }[]> {
  const data = await db
    .selectFrom('messages').select(['id', 'direction', 'body', 'created_at'])
    .where('conversation_id', '=', conversationId).orderBy('created_at', 'desc').limit(limit + 2).execute();
  const rows = data.filter((m: any) => m.id !== excludeMessageId && m.body && String(m.body).trim());
  rows.reverse();
  return rows.slice(-limit).map((m: any) => ({ role: m.direction === 'inbound' ? 'customer' : 'assistant', text: String(m.body) }));
}

async function findRecentUnansweredImage(db: Kysely<DB>, conversationId: string, currentMessageId: string | null): Promise<string | null> {
  const rows = await db
    .selectFrom('messages').select(['id', 'direction', 'attachments', 'created_at'])
    .where('conversation_id', '=', conversationId).orderBy('created_at', 'desc').limit(12).execute();
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

async function findLastImageContext(db: Kysely<DB>, conversationId: string, currentMessageId: string | null): Promise<LastImageContext | null> {
  const rows = await db
    .selectFrom('messages').select(['id', 'direction', 'attachments', 'ai_meta', 'created_at'])
    .where('conversation_id', '=', conversationId)
    .orderBy('created_at', 'desc')
    .limit(40).execute();
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
    const meta = m.ai_meta && typeof m.ai_meta === 'object' ? (m.ai_meta as Record<string, unknown>) : {};
    const stored = normalizeLastImageContext(meta.last_image_context);
    if (stored) return stored;
    const candidates = Array.isArray((meta as any).candidates) ? (meta as any).candidates : [];
    const workflow = typeof meta.workflow === 'string' ? meta.workflow : '';
    if (candidates.length && (workflow.includes('image') || meta.selected_product_id || meta.confidence)) {
      return createLastImageContext({
        source: 'stored_message',
        imageUrl: olderImageUrl(i),
        imageMessageId: null,
        outcome: typeof meta.selected_product_id === 'string' ? 'exact' : 'multiple',
        exactProductId: typeof meta.selected_product_id === 'string' ? (meta.selected_product_id as string) : null,
        candidates,
        diagnostics: meta,
        createdAt: typeof m.created_at === 'string' ? m.created_at : null,
      });
    }
  }
  return null;
}

async function resolveTurnImages(
  db: Kysely<DB>, conversationId: string, messageId: string | null,
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

async function findRecentCandidates(db: Kysely<DB>, conversationId: string, currentMessageId: string | null): Promise<ProductCandidate[]> {
  const data = await db
    .selectFrom('messages').select(['id', 'ai_meta', 'created_at'])
    .where('conversation_id', '=', conversationId)
    .orderBy('created_at', 'desc').limit(20).execute();
  for (const m of data) {
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

async function recentMemoryProductCandidates(db: Kysely<DB>, conversationId: string): Promise<ProductCandidate[]> {
  const convo = await db.selectFrom('conversations').select('customer_id').where('id', '=', conversationId).executeTakeFirst();
  if (!convo?.customer_id) return [];
  const mem = await getCustomerMemory(db, convo.customer_id);
  const ids = (mem?.recent_products ?? []).map((r) => r.product_id).filter(Boolean).slice(0, 3);
  if (!ids.length) return [];
  const rows: any[] = await activePriced(productSelect(db)).where('products.id', 'in', ids).execute();
  const byId = new Map(rows.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((p) => toCandidate(p, 0.6, 'attached product'));
}

async function recordTurnMemory(
  db: Kysely<DB>, customerId: string | null, cust: any, resolved: ProductCandidate[], conversationId: string, lastText: string,
): Promise<void> {
  if (!customerId) return;
  try {
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
  } catch { /* memory is best-effort; the reply is already durable */ }
}

async function updateMessageMeta(db: Kysely<DB>, messageId: string, aiMeta: Record<string, unknown>) {
  await db.updateTable('messages').set({ ai_meta: json(aiMeta) }).where('id', '=', messageId).execute();
}

async function logAiEvent(
  db: Kysely<DB>,
  args: { kind: string; conversationId: string; model?: string | null; intent?: string | null; success: boolean; latencyMs?: number; error?: string },
): Promise<void> {
  await db.insertInto('ai_events').values({
    kind: args.kind, conversation_id: args.conversationId, model: args.model ?? null,
    detected_intent: args.intent ?? null, latency_ms: args.latencyMs ?? null,
    success: args.success, error: args.error ?? null,
  }).execute().then(() => {}, () => {});
}
