import { NextRequest, NextResponse } from 'next/server';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { getDb } from '@integrations/db/client';
import { putObject } from '@integrations/storage';
import { databaseStatus, metaStatus, geminiStatus } from '@integrations/status';
import { resolveProductsFromText } from '@integrations/pipelines/product-resolve';
import { resolveProducts } from '@integrations/pipelines/resolver';
import { composeCustomerReply } from '@integrations/pipelines/compose-reply';
import { isProductQuestion } from '@integrations/pipelines/agent-policy';
import { dhashFromUrl } from '@integrations/util/image-hash';
import { sendMessage, sendImageMessage, isMetaConfigured } from '@integrations/meta';
import { isMetaSafeImageUrl } from '@integrations/pipelines/product-image';
import { behaviorMetadata, composeBehaviorContext, loadBehaviors } from '@/lib/ai-behaviors';
import { sanitizeCustomerText } from '@integrations/util/customer-text';
import { customerProductName, primaryProductImageUrl } from '@integrations/util/product-display';
import { hydrateMessagesWithCandidates } from '@/lib/product-candidates';
import { saveImageCorrection, getCustomerMemory, updateCustomerMemory, clearCustomerMemory } from '@integrations/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Manual replies can run the image/match pipeline; keep headroom (calls are capped).
export const maxDuration = 60;

/** Live thread fetch for polling (no manual refresh needed in the Inbox). */
export async function GET(_req: NextRequest, { params }: { params: { conversationId: string } }) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'integration_not_configured' }, { status: 503 });
  const id = params.conversationId;
  const [msgs, convo] = await Promise.all([
    db.selectFrom('messages')
      .select(['id', 'direction', 'sender_type', 'body', 'ai_meta', 'attachments', 'is_internal_suggestion', 'delivered_at', 'created_at'])
      .where('conversation_id', '=', id)
      .orderBy('created_at', 'asc')
      .limit(300)
      .execute(),
    db.selectFrom('conversations').select(['ai_enabled', 'status']).where('id', '=', id).executeTakeFirst(),
  ]);
  const messages = await hydrateMessagesWithCandidates(db, msgs);
  return NextResponse.json({
    messages,
    ai_enabled: convo?.ai_enabled ?? true,
    status: convo?.status ?? null,
  });
}

/**
 * Inbox actions for one conversation:
 *   send_human_message | suggest_reply | pause_ai | resume_ai | mark_resolved
 * Every action degrades to 503 { error, missing } when its integration is off.
 */
export async function POST(req: NextRequest, { params }: { params: { conversationId: string } }) {
  const id = params.conversationId;
  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;
  const db = getDb();

  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', integration: 'database', missing: databaseStatus().missing },
      { status: 503 },
    );
  }

  try {
    switch (action) {
      case 'pause_ai':
        {
          const cur = await db.selectFrom('conversations').select(['ai_enabled', 'status']).where('id', '=', id).executeTakeFirst();
          const changed = cur?.ai_enabled !== false || cur?.status !== 'human_active';
          if (changed) {
            await db.updateTable('conversations').set({ ai_enabled: false, status: 'human_active' }).where('id', '=', id).execute();
            await logActivity(db, 'ai_paused', id);
          }
        }
        return NextResponse.json({ ok: true });

      case 'resume_ai':
        {
          const cur = await db.selectFrom('conversations').select(['ai_enabled', 'status']).where('id', '=', id).executeTakeFirst();
          const changed = cur?.ai_enabled !== true || cur?.status !== 'ai_handling';
          if (changed) {
            await db.updateTable('conversations').set({ ai_enabled: true, status: 'ai_handling' }).where('id', '=', id).execute();
            await logActivity(db, 'ai_resumed', id);
          }
        }
        return NextResponse.json({ ok: true });

      case 'mark_resolved':
        await db.updateTable('conversations').set({ status: 'resolved' }).where('id', '=', id).execute();
        await logActivity(db, 'conversation_resolved', id);
        return NextResponse.json({ ok: true });

      case 'correct_image_match': {
        // Admin links a customer image to the CORRECT product. Stored with the
        // image fingerprint so future matching learns from it.
        const productId = body?.productId as string | undefined;
        const messageId = (body?.messageId as string | undefined) ?? null;
        if (!productId) return NextResponse.json({ error: 'missing_product' }, { status: 400 });

        // Find an existing correction row (by message, else latest for the convo).
        let row: any = null;
        if (messageId) {
          row = await db.selectFrom('image_match_corrections').select(['id', 'customer_image_url', 'customer_image_hash']).where('message_id', '=', messageId).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
        }
        if (!row) {
          row = await db.selectFrom('image_match_corrections').select(['id', 'customer_image_url', 'customer_image_hash']).where('conversation_id', '=', id).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
        }

        // Ensure we have the customer image fingerprint (compute if missing).
        let hash: string | null = row?.customer_image_hash ?? null;
        let imageUrl: string | null = row?.customer_image_url ?? null;
        if (!imageUrl && messageId) {
          const m = await db.selectFrom('messages').select('attachments').where('id', '=', messageId).executeTakeFirst();
          imageUrl = (((m?.attachments ?? []) as any[])).find((a) => a?.type === 'image' && a?.url)?.url ?? null;
        }
        if (!hash && imageUrl) hash = await dhashFromUrl(imageUrl);

        // Save the correction AND feed the fingerprint into future matching.
        await saveImageCorrection(db, {
          correctionId: row?.id ?? null,
          conversationId: id,
          messageId,
          correctedProductId: productId,
          customerImageUrl: imageUrl,
          customerImageHash: hash,
        });
        const product = await db
          .selectFrom('products')
          .select(['id', 'product_code', 'libyan_display_name', 'arabic_name', 'english_name', 'source_name', 'arabic_keywords'])
          .where('id', '=', productId)
          .executeTakeFirst();
        await logActivity(db, 'image_match_corrected', id, `Linked image to ${product ? customerProductName(product) : 'selected product'}`);
        return NextResponse.json({ ok: true, learned: !!hash });
      }

      case 'get_memory': {
        const convo = await db.selectFrom('conversations').select('customer_id').where('id', '=', id).executeTakeFirst();
        if (!convo?.customer_id) return NextResponse.json({ memory: null });
        const memory = await getCustomerMemory(db, convo.customer_id);
        return NextResponse.json({ memory });
      }

      case 'update_memory': {
        const convo = await db.selectFrom('conversations').select('customer_id').where('id', '=', id).executeTakeFirst();
        if (!convo?.customer_id) return NextResponse.json({ error: 'no_customer' }, { status: 400 });
        const cap = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2000) : undefined);
        const r = await updateCustomerMemory(db, convo.customer_id, {
          summary: 'summary' in body ? cap(body.summary) ?? null : undefined,
          known_name: 'known_name' in body ? cap(body.known_name) ?? null : undefined,
          known_phone: 'known_phone' in body ? cap(body.known_phone) ?? null : undefined,
          known_address: 'known_address' in body ? cap(body.known_address) ?? null : undefined,
          known_facts: Array.isArray(body.known_facts) ? body.known_facts.map(String).slice(0, 30) : undefined,
          preferences: body.preferences && typeof body.preferences === 'object' ? body.preferences : undefined,
        });
        if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
        await logActivity(db, 'customer_memory_updated', id);
        return NextResponse.json({ ok: true });
      }

      case 'clear_memory': {
        const convo = await db.selectFrom('conversations').select('customer_id').where('id', '=', id).executeTakeFirst();
        if (!convo?.customer_id) return NextResponse.json({ error: 'no_customer' }, { status: 400 });
        const r = await clearCustomerMemory(db, convo.customer_id);
        if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 500 });
        await logActivity(db, 'customer_memory_cleared', id);
        return NextResponse.json({ ok: true });
      }

      // --- Attach a product to this conversation/customer --------------------
      // Stored in customer_memory.recent_products, which the AI pipeline ALREADY
      // reads for follow-ups ("بكم؟" / "نفس اللي قبل"), so the attachment becomes
      // real AI context. Also recorded in conversation_attachments when present.
      case 'attach_product': {
        const productId = String(body.productId ?? body.product_id ?? '');
        if (!productId) return NextResponse.json({ error: 'no_product' }, { status: 400 });
        const convo = await db.selectFrom('conversations').select('customer_id').where('id', '=', id).executeTakeFirst();
        const p = await db
          .selectFrom('products')
          .select(['id', 'product_code', 'barcode', 'libyan_display_name', 'arabic_name', 'english_name', 'source_name', 'active_price', 'status', 'website_url'])
          .select((eb) => [
            jsonArrayFrom(
              eb.selectFrom('product_images').select(['public_url', 'is_primary', 'position'])
                .whereRef('product_images.product_id', '=', 'products.id').orderBy('position', 'asc'),
            ).as('product_images'),
          ])
          .where('id', '=', productId).executeTakeFirst();
        if (!p) return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
        const imgs = ((p as any).product_images ?? []) as any[];
        const image = (imgs.find((i) => i.is_primary) ?? imgs[0])?.public_url ?? null;
        const card = {
          id: (p as any).id,
          product_code: (p as any).product_code ?? null,
          barcode: (p as any).barcode ?? null,
          name: customerProductName(p as any),
          price: (p as any).active_price ?? null,
          image,
          website_url: (p as any).website_url ?? null,
          status: (p as any).status ?? null,
        };
        if (convo?.customer_id) {
          await updateCustomerMemory(db, convo.customer_id, {
            addRecentProduct: {
              product_id: card.id, name: card.name, price: card.price,
              resolved_at: new Date().toISOString(), match_type: 'exact',
            },
          });
        }
        // Best-effort dedicated row.
        await db.insertInto('conversation_attachments').values({
          conversation_id: id, customer_id: convo?.customer_id ?? null, type: 'product',
          product_id: card.id, metadata: JSON.stringify({ name: card.name, price: card.price }), created_by: 'admin',
        }).execute().then(() => {}, () => {});
        await logActivity(db, 'inbox_attach_product', id, `Attached ${card.name}`);
        return NextResponse.json({ ok: true, product: card });
      }

      // --- Remove an attached product (from AI context) ----------------------
      case 'remove_product': {
        const productId = String(body.productId ?? body.product_id ?? '');
        if (!productId) return NextResponse.json({ error: 'no_product' }, { status: 400 });
        const convo = await db.selectFrom('conversations').select('customer_id').where('id', '=', id).executeTakeFirst();
        if (convo?.customer_id) {
          const mem = await getCustomerMemory(db, convo.customer_id);
          const recent = (mem?.recent_products ?? []).filter((r) => r.product_id !== productId);
          await updateCustomerMemory(db, convo.customer_id, { recent_products: recent });
        }
        await db.deleteFrom('conversation_attachments')
          .where('conversation_id', '=', id).where('type', '=', 'product').where('product_id', '=', productId)
          .execute().then(() => {}, () => {});
        await logActivity(db, 'inbox_remove_product', id);
        return NextResponse.json({ ok: true });
      }

      // --- Upload an image, store it, and find matching catalog products -----
      // Uses the SAME canonical resolver / image pipeline as the customer side.
      case 'image_search': {
        if (!geminiStatus().configured) {
          return NextResponse.json({ error: 'integration_not_configured', integration: 'gemini', missing: ['GEMINI_API_KEY'] }, { status: 503 });
        }
        const dataUrl = String(body.image?.data ?? body.imageBase64 ?? '');
        const mime = String(body.image?.mime ?? body.mime ?? 'image/jpeg');
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        if (!base64) return NextResponse.json({ error: 'no_image' }, { status: 400 });
        const convo = await db.selectFrom('conversations').select('customer_id').where('id', '=', id).executeTakeFirst();
        // Persist the uploaded image to storage (timeline + reference context).
        let imageUrl: string | null = null;
        try {
          const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
          const path = `inbox/${id}/admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const up = await putObject(path, Buffer.from(base64, 'base64'));
          if (up.ok) imageUrl = up.data.publicUrl;
        } catch { /* storage optional — matching still runs on bytes */ }
        const memory = convo?.customer_id ? await getCustomerMemory(db, convo.customer_id) : null;
        const result = await resolveProducts(db, {
          imageBase64: base64, mimeType: mime, mode: 'admin', limit: 8,
          memoryContext: memory ? `customer memory present` : undefined,
        });
        // Record the uploaded image in the timeline (internal note).
        if (imageUrl) {
          await db.insertInto('messages').values({
            conversation_id: id, direction: 'outbound', sender_type: 'system',
            body: null, is_internal_suggestion: true,
            attachments: JSON.stringify([{ type: 'image', url: imageUrl, source: 'admin_upload' }]),
          }).execute().then(() => {}, () => {});
        }
        await logActivity(db, 'inbox_image_search', id, `Found ${result.candidates.length} candidate(s)`);
        return NextResponse.json({
          ok: true, image_url: imageUrl,
          outcome: result.outcome, candidates: result.candidates,
          debug: { source: result.source, diagnostics: result.diagnostics, timing_ms: result.timingMs },
        });
      }

      case 'send_human_message': {
        // Final outbound safety gate (strips any leaked tool/debug/system text,
        // e.g. from an AI-suggested draft the admin sent as-is).
        const text = sanitizeCustomerText(body?.text as string).trim();
        if (!text) return NextResponse.json({ error: 'empty_message' }, { status: 400 });

        // Resolve the Messenger recipient up front so we know if delivery is even
        // possible before claiming the reply was sent.
        const convo = await db
          .selectFrom('conversations').select(['customer_id', 'channel']).where('id', '=', id).executeTakeFirst();
        let recipientPsid: string | null = null;
        if (isMetaConfigured() && convo?.customer_id) {
          const cust = await db
            .selectFrom('customers').select(['external_id', 'channel']).where('id', '=', convo.customer_id).executeTakeFirst();
          if (cust?.external_id && cust.channel === 'messenger') recipientPsid = cust.external_id;
        }

        // Store the outbound human message (delivered_at stays null until Meta
        // confirms) and pause the AI.
        const inserted = await db.insertInto('messages').values({
          conversation_id: id,
          direction: 'outbound',
          sender_type: 'human',
          body: text,
          ai_meta: JSON.stringify({ meta_connected: isMetaConfigured() }),
        }).returning('id').executeTakeFirst();
        const sentMessageId = inserted?.id ?? null;

        await db
          .updateTable('conversations')
          .set({
            ai_enabled: false,
            status: 'human_active',
            last_human_reply_at: new Date().toISOString(),
            last_message_at: new Date().toISOString(),
            last_message_preview: text.slice(0, 120),
          })
          .where('id', '=', id).execute();
        await logActivity(db, 'human_message', id, text.slice(0, 120));

        // Attempt delivery, THEN record the real result on the stored message so
        // the UI can show sent vs. failed (never imply a failed send succeeded).
        let delivered = false;
        let deliveryError: string | null = null;
        if (recipientPsid) {
          try {
            await sendMessage(recipientPsid, text);
            delivered = true;
          } catch (e: any) {
            deliveryError = e?.message ?? 'send_failed';
            await logIntegration(db, 'meta', 'outbound', deliveryError ?? undefined);
          }
        }
        if (sentMessageId) {
          if (delivered) {
            await db.updateTable('messages').set({ delivered_at: new Date().toISOString() }).where('id', '=', sentMessageId).execute();
          } else if (deliveryError) {
            await db.updateTable('messages')
              .set({ ai_meta: JSON.stringify({ meta_connected: isMetaConfigured(), delivery_error: deliveryError }) })
              .where('id', '=', sentMessageId).execute();
          }
        }
        return NextResponse.json({ ok: true, delivered, meta_connected: isMetaConfigured(), delivery_error: deliveryError });
      }

      // --- Manually send a product's photo to the customer ------------------
      // Lightweight assist: sends the product's primary catalog image (+ a short
      // caption) via the same Meta image helper the AI pipeline uses. Delivery
      // state is recorded honestly (delivered_at only on a confirmed send).
      case 'send_product_image': {
        const productId = String(body.productId ?? body.product_id ?? '');
        if (!productId) return NextResponse.json({ error: 'no_product' }, { status: 400 });
        const p = await db
          .selectFrom('products')
          .select(['id', 'product_code', 'libyan_display_name', 'arabic_name', 'english_name', 'source_name', 'category', 'arabic_keywords', 'active_price', 'status', 'website_url'])
          .select((eb) => [
            jsonArrayFrom(
              eb.selectFrom('product_images').select(['public_url', 'storage_path', 'is_primary', 'position'])
                .whereRef('product_images.product_id', '=', 'products.id').orderBy('position', 'asc'),
            ).as('product_images'),
          ])
          .where('id', '=', productId).executeTakeFirst();
        if (!p) return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
        const imageUrl = primaryProductImageUrl(p as any);
        if (!imageUrl || !isMetaSafeImageUrl(imageUrl)) {
          return NextResponse.json({ error: 'no_image' }, { status: 400 });
        }
        const name = customerProductName(p as any);
        const price = (p as any).active_price as number | null;
        // Caption: admin override (sanitized) or a simple Libyan-Arabic name+price.
        const caption = (sanitizeCustomerText(String(body.caption ?? '')).trim())
          || `${name}${price != null ? ` — ${price} د.ل` : ''}`;

        // Resolve the Messenger recipient.
        const convo = await db.selectFrom('conversations').select(['customer_id', 'channel']).where('id', '=', id).executeTakeFirst();
        let recipientPsid: string | null = null;
        if (isMetaConfigured() && convo?.customer_id) {
          const cust = await db.selectFrom('customers').select(['external_id', 'channel']).where('id', '=', convo.customer_id).executeTakeFirst();
          if (cust?.external_id && cust.channel === 'messenger') recipientPsid = cust.external_id;
        }

        // Store first (attachments/delivered_at filled in after a confirmed send).
        const inserted = await db.insertInto('messages').values({
          conversation_id: id, direction: 'outbound', sender_type: 'human', body: caption,
          ai_meta: JSON.stringify({ meta_connected: isMetaConfigured(), workflow: 'manual_product_image_send', product_id: productId, image_url: imageUrl }),
        }).returning('id').executeTakeFirst();
        const sentMessageId = inserted?.id ?? null;

        let delivered = false;
        let deliveryError: string | null = null;
        if (recipientPsid) {
          try {
            if (caption) await sendMessage(recipientPsid, caption);
            await sendImageMessage(recipientPsid, imageUrl);
            delivered = true;
          } catch (e: any) {
            deliveryError = e?.message ?? 'send_failed';
            await logIntegration(db, 'meta', 'outbound', `image_send: ${deliveryError}`);
          }
        }
        if (sentMessageId) {
          if (delivered) {
            await db.updateTable('messages').set({
              attachments: JSON.stringify([{ type: 'image', url: imageUrl, product_id: productId }]),
              delivered_at: new Date().toISOString(),
            }).where('id', '=', sentMessageId).execute();
          } else if (deliveryError) {
            await db.updateTable('messages').set({
              ai_meta: JSON.stringify({ meta_connected: isMetaConfigured(), workflow: 'manual_product_image_send', product_id: productId, image_url: imageUrl, delivery_error: deliveryError }),
            }).where('id', '=', sentMessageId).execute();
          }
        }
        await db.updateTable('conversations').set({
          last_message_at: new Date().toISOString(),
          last_message_preview: `🖼️ ${name}`.slice(0, 120),
        }).where('id', '=', id).execute();
        await logActivity(db, 'product_image_sent', id, name);
        return NextResponse.json({ ok: true, delivered, meta_connected: isMetaConfigured(), delivery_error: deliveryError });
      }

      case 'suggest_reply': {
        if (!geminiStatus().configured) {
          return NextResponse.json(
            { error: 'integration_not_configured', integration: 'gemini', missing: ['GEMINI_API_KEY'] },
            { status: 503 },
          );
        }
        // Build minimal history + the admin-configured customer-service behavior.
        const [msgs, behaviors] = await Promise.all([
          db.selectFrom('messages').select(['direction', 'sender_type', 'body']).where('conversation_id', '=', id).orderBy('created_at', 'asc').limit(20).execute(),
          loadBehaviors(),
        ]);
        // Use the SAME behavior + composition path as the live Messenger
        // auto-reply, so the suggested draft matches what the AI would send.
        const behavior = composeBehaviorContext(behaviors, 'messenger');
        const history = msgs
          .filter((m: any) => m.body)
          .map((m: any) => ({ role: (m.direction === 'inbound' ? 'customer' : 'assistant') as 'customer' | 'assistant', text: m.body as string }));
        const last = [...history].reverse().find((h) => h.role === 'customer');
        const lastText = last?.text || '';
        // Ground with real catalog candidates when the last message is a product question.
        let candidates: any[] = [];
        if (lastText && (isProductQuestion(lastText) || /https?:\/\//i.test(lastText))) {
          const r = await resolveProductsFromText(db, lastText, 5).catch(() => null);
          candidates = r?.hits ?? [];
        }
        const composed = await composeCustomerReply(db, {
          systemPrompt: behavior.systemPrompt,
          history: history.slice(0, -1),
          message: lastText,
          candidates,
        });
        // Store as an INTERNAL suggestion (not sent to the customer).
        await db.insertInto('messages').values({
          conversation_id: id,
          direction: 'outbound',
          sender_type: 'ai',
          body: composed.text,
          ai_meta: JSON.stringify(behaviorMetadata(behavior, {
            model: composed.model,
            workflow: 'inbox_suggest_reply',
            live_surface: 'inbox',
            gemini_tool_calls: composed.toolCalls,
            candidates,
          })),
          is_internal_suggestion: true,
        }).execute();
        return NextResponse.json({ ok: true, text: composed.text });
      }

      default:
        return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'server_error' }, { status: 500 });
  }
}

async function logActivity(db: any, action: string, conversationId: string, summary?: string) {
  await db.insertInto('activity_logs').values({
    actor_type: 'human',
    action,
    entity_type: 'conversation',
    entity_id: conversationId,
    summary: summary ?? null,
  }).execute();
}

async function logIntegration(db: any, integration: string, direction: string, error?: string) {
  await db.insertInto('integration_logs').values({ integration, direction, ok: false, error: error ?? null }).execute();
}
