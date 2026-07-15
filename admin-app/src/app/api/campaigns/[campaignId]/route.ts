/**
 * Per-campaign CRUD, AI generation, and publish actions.
 * GET = campaign detail; PATCH = update fields; DELETE = soft-archive.
 * POST /publish = push to Meta (calls publishCampaign in campaign pipeline).
 * POST actions provide caption and image generation through shared pipelines.
 * Called by: CampaignBuilder, PostComposer, CaptionPanel components.
 * Must not: bypass the send gate or skip pricing refresh after publish.
 */
import { NextRequest, NextResponse } from 'next/server';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { getDb } from '@integrations/db/client';
import { putObject, removeObject } from '@integrations/storage';
import { databaseStatus, geminiStatus } from '@integrations/status';
import { caption as genCaption } from '@integrations/gemini';
import { prepareCampaignPosts, publishPost, publishCampaign } from '@integrations/pipelines/campaign';
import { loadBehaviors } from '@/lib/ai-behaviors';
import { compilePrompt } from '@integrations/prompt-compiler';
import { generateCampaignCreative } from '@integrations/pipelines/campaign-creative';

export const runtime = 'nodejs';
// Image generation can take time; allow headroom so the platform doesn't kill
// the function mid-generation (the "takes forever and outputs nothing" bug).
// One primary attempt (~25s cap) + a working fallback (~30s) fits comfortably.
export const maxDuration = 240;
// Cap how many source images one request will edit so the request always
// finishes inside maxDuration. The UI can call again for the rest.
const MAX_EDITS_PER_REQUEST = 1;

const MAX_SOURCE_BYTES = 20 * 1024 * 1024; // 20MB cap — never download huge files
const SOURCE_FETCH_TIMEOUT_MS = 8_000;     // 8s — never hang on a slow source
/** Download an image URL → base64 + mime (timeout + size capped). */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mime: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_SOURCE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_SOURCE_BYTES) return null;
    return { data: buf.toString('base64'), mime: res.headers.get('content-type') || 'image/jpeg' };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/** Upload base64 image bytes to the campaign's media folder → {path, publicUrl}. */
async function uploadImageBytes(campaignId: string, base64: string, mime: string): Promise<{ path: string; publicUrl: string }> {
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const path = `campaigns/${campaignId}/edited-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await putObject(path, Buffer.from(base64, 'base64'));
  if (!up.ok) throw new Error(up.reason);
  return { path: up.data.path, publicUrl: up.data.publicUrl };
}

async function campaignProducts(db: NonNullable<ReturnType<typeof getDb>>, campaignId: string) {
  const rows = await db.selectFrom('campaign_products').innerJoin('products', 'products.id', 'campaign_products.product_id')
    .select(['products.id', 'products.product_code', 'products.libyan_display_name', 'products.arabic_name', 'products.english_name', 'products.source_name', 'products.category'])
    .where('campaign_products.campaign_id', '=', campaignId).limit(20).execute();
  return rows.map((product: any) => ({
    id: product.id,
    product_code: product.product_code ?? null,
    name: product.libyan_display_name || product.arabic_name || product.english_name || product.source_name || product.product_code,
    category: product.category ?? null,
  })).filter((product) => product.name);
}

/**
 * Campaign actions (JSON):
 *   generate_caption | attach_products{productIds} | detach_product{productId}
 *   delete_asset{assetId} | prepare_posts{mode,scheduledFor} | publish_post{postId}
 *   publish (legacy one-shot) | update{fields}
 */
export async function POST(req: NextRequest, props: { params: Promise<{ campaignId: string }> }) {
  const params = await props.params;
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'integration_not_configured', missing: databaseStatus().missing }, { status: 503 });
  }
  const id = params.campaignId;
  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  const campaign = await db.selectFrom('campaigns').selectAll().where('id', '=', id).executeTakeFirst();
  if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    switch (action) {
      case 'update': {
        const FIELDS = ['name', 'type', 'discount_percent', 'starts_at', 'ends_at', 'auto_publish', 'generated_caption', 'objective', 'image_text', 'aspect_ratio', 'target_channel'];
        const upd: Record<string, unknown> = {};
        for (const k of FIELDS) if (k in body) upd[k] = body[k];
        if (Object.keys(upd).length) await db.updateTable('campaigns').set(upd as any).where('id', '=', id).execute();
        return NextResponse.json({ ok: true });
      }

      case 'generate_caption': {
        if (!geminiStatus().configured) return NextResponse.json({ error: 'integration_not_configured', missing: ['GEMINI_API_KEY'] }, { status: 503 });
        const cps = await db
          .selectFrom('campaign_products')
          .select(['product_id'])
          .select((eb) => [
            jsonObjectFrom(
              eb.selectFrom('products')
                .select(['product_code', 'libyan_display_name', 'arabic_name', 'english_name', 'source_name', 'active_price', 'category', 'arabic_keywords'])
                .whereRef('products.id', '=', 'campaign_products.product_id'),
            ).as('products'),
          ])
          .where('campaign_id', '=', id)
          .limit(20)
          .execute();
        const products = cps.map((cp: any) => ({
          id: cp.product_id,
          name: cp.products
            ? cp.products.libyan_display_name || cp.products.arabic_name || cp.products.english_name || cp.products.source_name || cp.products.product_code
            : null,
          price: cp.products?.active_price ?? null,
          category: cp.products?.category ?? null,
        })).filter((product) => product.name);
        const behaviors = await loadBehaviors();
        const envelope = compilePrompt(behaviors, 'campaign_caption', {
          campaign_objective: body.objective || campaign.objective || campaign.name,
          verified_products: products,
          verified_discount_percent: campaign.discount_percent,
        });
        const result = await genCaption({
          prompt: envelope.runtimeData,
          systemPrompt: envelope.effectiveSystemInstruction,
          temperature: envelope.generationSettings.temperature,
        });
        if (!result.ok) return NextResponse.json({ error: 'integration_not_configured', missing: result.missing }, { status: 503 });
        await db.updateTable('campaigns').set({ generated_caption: result.text }).where('id', '=', id).execute();
        await db.insertInto('ai_events').values({
          kind: 'caption',
          related_id: id,
          model: result.model,
          latency_ms: result.latencyMs,
          success: true,
          prompt_summary: JSON.stringify({
            workflow: 'campaign_caption',
            campaign_id: id,
            products_count: products.length,
            prompt_trace_id: envelope.traceId,
            behavior_keys: envelope.contributors.map((c) => c.behaviorKey),
          }),
          output_summary: result.text.slice(0, 240),
        }).execute();
        await db.insertInto('activity_logs').values({ actor_type: 'ai', action: 'campaign_generated', entity_type: 'campaign', entity_id: id, summary: 'Caption generated' }).execute();
        return NextResponse.json({ ok: true, caption: result.text });
      }

      case 'attach_products': {
        const productIds: string[] = body.productIds ?? [];
        if (!productIds.length) return NextResponse.json({ error: 'no_products' }, { status: 400 });
        // link products
        await db.insertInto('campaign_products')
          .values(productIds.map((pid, i) => ({ campaign_id: id, product_id: pid, position: i })))
          .onConflict((oc) => oc.columns(['campaign_id', 'product_id']).doUpdateSet({ position: (eb) => eb.ref('excluded.position') }))
          .execute();
        // create original_product_image assets from each product's primary image
        const imgs = await db
          .selectFrom('product_images')
          .select(['product_id', 'public_url', 'is_primary', 'position'])
          .where('product_id', 'in', productIds)
          .where('public_url', 'is not', null)
          .execute();
        const primaryByProduct = new Map<string, string>();
        for (const im of imgs) {
          const cur = primaryByProduct.get(im.product_id);
          if (!cur || im.is_primary) primaryByProduct.set(im.product_id, im.public_url!);
        }
        const countRow = await db.selectFrom('campaign_assets').select((eb) => eb.fn.countAll().as('n')).where('campaign_id', '=', id).executeTakeFirst();
        let pos = Number(countRow?.n ?? 0);
        const assetRows = [...primaryByProduct.entries()].map(([pid, url]) => ({
          campaign_id: id, product_id: pid, kind: 'original_product_image' as const, public_url: url, position: pos++,
        }));
        // Insert-ignore so re-attaching the same product is idempotent (unique
        // index on (campaign_id, product_id, kind) from migration 0012).
        if (assetRows.length) {
          await db.insertInto('campaign_assets').values(assetRows).onConflict((oc) => oc.doNothing()).execute();
        }
        return NextResponse.json({ ok: true, linked: productIds.length, assets: assetRows.length });
      }

      case 'generate_edits': {
        if (!geminiStatus().configured) return NextResponse.json({ error: 'integration_not_configured', missing: ['GEMINI_API_KEY'] }, { status: 503 });
        if (!campaign.objective?.trim()) return NextResponse.json({ error: 'campaign_objective_required' }, { status: 400 });
        const behaviors = await loadBehaviors();
        const products = await campaignProducts(db, id);
        const assetsAll = await db
          .selectFrom('campaign_assets').select(['id', 'public_url', 'product_id', 'kind', 'source_asset_id'])
          .where('campaign_id', '=', id).where('public_url', 'is not', null).execute();
        const completedSourceIds = new Set(assetsAll.filter((a) => a.kind === 'ai_edited_image' && a.source_asset_id).map((a) => a.source_asset_id));
        let sources = assetsAll.filter((a: any) => a.kind !== 'ai_edited_image' && a.kind !== 'final_post_image' && !completedSourceIds.has(a.id));
        if (Array.isArray(body.assetIds) && body.assetIds.length) sources = sources.filter((a: any) => body.assetIds.includes(a.id));
        if (!sources.length) return NextResponse.json({ error: 'no_source_images' }, { status: 400 });
        // Process at most MAX_EDITS_PER_REQUEST so the request finishes within
        // maxDuration; report how many remain so the UI can continue.
        const totalSources = sources.length;
        const remaining = Math.max(0, totalSources - MAX_EDITS_PER_REQUEST);
        sources = sources.slice(0, MAX_EDITS_PER_REQUEST);

        const countRow = await db.selectFrom('campaign_assets').select((eb) => eb.fn.countAll().as('n')).where('campaign_id', '=', id).executeTakeFirst();
        let pos = Number(countRow?.n ?? 0);
        const created: any[] = [];
        const errors: string[] = [];
        const modelsUsed = new Set<string>();
        let requestedModel: string | null = null;
        let fallbackUsed = false;
        // Wall-clock guard: stop starting NEW edits ~20s before the function
        // limit so a slow run never gets killed mid-write. Unprocessed sources
        // are reported as `remaining` so the UI can continue.
        const startedAt = Date.now();
        const TIME_BUDGET_MS = (maxDuration - 20) * 1000;
        let skippedForTime = 0;
        for (const src of sources) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) { skippedForTime++; continue; }
          try {
            const img = await fetchImageAsBase64((src as any).public_url);
            if (!img) throw new Error('source_download_failed');
            const sourceProducts = (src as any).product_id ? products.filter((product) => product.id === (src as any).product_id) : products;
            const res = await generateCampaignCreative({
              behaviors, sourceImageBase64: img.data, sourceMimeType: img.mime,
              objective: campaign.objective || '', caption: campaign.generated_caption || '', imageText: campaign.image_text || '',
              aspectRatio: campaign.aspect_ratio || '1:1', targetChannel: campaign.target_channel || 'facebook_instagram', products: sourceProducts,
            });
            modelsUsed.add(res.model);
            requestedModel = res.requestedModel;
            if (res.fallbackUsed) fallbackUsed = true;
            const up = await uploadImageBytes(id, res.image.data, res.image.mimeType);
            const asset = await db.insertInto('campaign_assets').values({
              campaign_id: id, product_id: (src as any).product_id ?? null, kind: 'ai_edited_image',
              storage_path: up.path, public_url: up.publicUrl, source_prompt: null,
              source_asset_id: (src as any).id, approved: false, position: pos++,
              prompt_trace_id: res.promptTraceId, requested_overlay_text: campaign.image_text || null,
              overlay_text_status: res.verification.overlay_text_status,
              product_fidelity_status: res.verification.product_status,
              verification: JSON.stringify({ ...res.verification, verification_model: res.verificationModel, regenerated_for_fidelity: res.regeneratedForFidelity }),
              requested_model: res.requestedModel, actual_model: res.model, fallback_used: res.fallbackUsed,
            }).returning(['id', 'public_url', 'source_asset_id']).executeTakeFirstOrThrow();
            created.push({ ...asset, verification: res.verification, promptTraceId: res.promptTraceId });
          } catch (e: any) { errors.push(`${(src as any).id}: ${e.message}`); }
        }
        if (created.length === 0) {
          const detail = errors.length ? errors.join('; ') : 'Gemini returned no image output.';
          await db.insertInto('ai_events').values({
            kind: 'image_edit',
            related_id: id,
            success: false,
            error: detail.slice(0, 500),
            output_summary: 'No edited images generated',
          }).execute();
          await db.insertInto('activity_logs').values({
            actor_type: 'ai',
            action: 'campaign_image_edit_failed',
            entity_type: 'campaign',
            entity_id: id,
            summary: `No edited images generated: ${detail.slice(0, 180)}`,
          }).execute();
          return NextResponse.json({
            error: 'image_edit_failed',
            detail,
            errors,
            hint: 'Check that GEMINI_IMAGE_MODEL is an image-generation/edit model enabled for this Gemini API key.',
          }, { status: 502 });
        }
        const modelLabel = [...modelsUsed].join(', ');
        const fbNote = fallbackUsed ? ` (fallback from ${requestedModel})` : '';
        await db.insertInto('ai_events').values({ kind: 'image_edit', related_id: id, success: true, output_summary: `Generated ${created.length} edited image(s) via ${modelLabel}${fbNote}${errors.length ? `; ${errors.length} failed` : ''}` }).execute();
        await db.insertInto('activity_logs').values({ actor_type: 'ai', action: 'campaign_image_edit_generated', entity_type: 'campaign', entity_id: id, summary: `Generated ${created.length} edited image(s) via ${modelLabel}${fbNote}${errors.length ? `; ${errors.length} failed` : ''}` }).execute();
        return NextResponse.json({ ok: true, created, errors, model: modelLabel, requestedModel, fallbackUsed, remaining: remaining + skippedForTime, totalSources });
      }

      case 'regenerate_edit': {
        if (!geminiStatus().configured) return NextResponse.json({ error: 'integration_not_configured', missing: ['GEMINI_API_KEY'] }, { status: 503 });
        const a = await db.selectFrom('campaign_assets').select(['id', 'source_asset_id', 'product_id']).where('id', '=', body.assetId).where('campaign_id', '=', id).executeTakeFirst();
        if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 });
        let srcUrl: string | null = null;
        if ((a as any).source_asset_id) {
          const s = await db.selectFrom('campaign_assets').select('public_url').where('id', '=', (a as any).source_asset_id).executeTakeFirst();
          srcUrl = s?.public_url ?? null;
        }
        if (!srcUrl) return NextResponse.json({ error: 'no_source' }, { status: 400 });
        const img = await fetchImageAsBase64(srcUrl);
        if (!img) return NextResponse.json({ error: 'source_download_failed' }, { status: 502 });
        const behaviors = await loadBehaviors();
        const products = await campaignProducts(db, id);
        const sourceProducts = a.product_id ? products.filter((product) => product.id === a.product_id) : products;
        const res = await generateCampaignCreative({ behaviors, sourceImageBase64: img.data, sourceMimeType: img.mime, objective: campaign.objective || campaign.name, caption: campaign.generated_caption || '', imageText: campaign.image_text || '', aspectRatio: campaign.aspect_ratio || '1:1', targetChannel: campaign.target_channel || 'facebook_instagram', products: sourceProducts });
        const up = await uploadImageBytes(id, res.image.data, res.image.mimeType);
        await db.updateTable('campaign_assets').set({ storage_path: up.path, public_url: up.publicUrl, approved: false, source_prompt: null, prompt_trace_id: res.promptTraceId, requested_overlay_text: campaign.image_text || null, overlay_text_status: res.verification.overlay_text_status, product_fidelity_status: res.verification.product_status, verification: JSON.stringify({ ...res.verification, verification_model: res.verificationModel, regenerated_for_fidelity: res.regeneratedForFidelity }), requested_model: res.requestedModel, actual_model: res.model, fallback_used: res.fallbackUsed }).where('id', '=', (a as any).id).execute();
        return NextResponse.json({ ok: true, public_url: up.publicUrl, model: res.model, requestedModel: res.requestedModel, fallbackUsed: res.fallbackUsed, verification: res.verification, promptTraceId: res.promptTraceId });
      }

      case 'approve_asset': {
        if (!body.assetId) return NextResponse.json({ error: 'no_asset' }, { status: 400 });
        await db.updateTable('campaign_assets').set({ approved: true }).where('id', '=', body.assetId).where('campaign_id', '=', id).execute();
        return NextResponse.json({ ok: true });
      }

      case 'reject_asset': {
        if (!body.assetId) return NextResponse.json({ error: 'no_asset' }, { status: 400 });
        const a = await db.selectFrom('campaign_assets').select('storage_path').where('id', '=', body.assetId).where('campaign_id', '=', id).executeTakeFirst();
        if (a?.storage_path) { try { await removeObject(a.storage_path); } catch { /* best effort */ } }
        await db.deleteFrom('campaign_assets').where('id', '=', body.assetId).where('campaign_id', '=', id).execute();
        return NextResponse.json({ ok: true });
      }

      case 'delete_asset': {
        if (!body.assetId) return NextResponse.json({ error: 'no_asset' }, { status: 400 });
        await db.deleteFrom('campaign_assets').where('id', '=', body.assetId).where('campaign_id', '=', id).execute();
        return NextResponse.json({ ok: true });
      }

      case 'prepare_posts': {
        const mode = body.mode === 'multiple' ? 'multiple' : 'single';
        const r = await prepareCampaignPosts(db, id, mode, body.scheduledFor || null);
        if (!r.ok) return NextResponse.json({ error: r.error || 'failed' }, { status: 400 });
        if (body.scheduledFor) await db.updateTable('campaigns').set({ status: 'scheduled', scheduled_for: body.scheduledFor }).where('id', '=', id).execute();
        await db.insertInto('activity_logs').values({ actor_type: 'human', action: 'campaign_generated', entity_type: 'campaign', entity_id: id, summary: `Prepared ${r.created} ${mode} post(s)` }).execute();
        return NextResponse.json({ ok: true, created: r.created, mode });
      }

      case 'publish_post': {
        const r = await publishPost(db, body.postId);
        if (r.ok) {
          await db.updateTable('campaigns').set({ status: 'published' }).where('id', '=', id).execute();
          return NextResponse.json({ ok: true, fb_post_id: r.fbPostId });
        }
        if (r.code === 'not_configured') return NextResponse.json({ error: 'integration_not_configured', integration: 'meta', missing: r.missing }, { status: 503 });
        if (r.code === 'no_images') return NextResponse.json({ error: 'no_images', detail: r.error }, { status: 400 });
        return NextResponse.json({ error: r.error || 'publish_failed' }, { status: 502 });
      }

      case 'publish': {
        const r = await publishCampaign(db, id);
        if (r.ok) return NextResponse.json({ ok: true, fb_post_id: r.fbPostId });
        if (r.code === 'not_configured') return NextResponse.json({ error: 'integration_not_configured', integration: 'meta', missing: r.missing }, { status: 503 });
        if (r.code === 'no_images') return NextResponse.json({ error: 'no_images', detail: r.error }, { status: 400 });
        return NextResponse.json({ error: r.error || 'publish_failed' }, { status: 502 });
      }

      default:
        return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'server_error' }, { status: 500 });
  }
}
