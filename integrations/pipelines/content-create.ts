/**
 * Durable Content Studio creative generation.
 *
 * Source media is immutable reference material. Every explicit Generate action
 * creates a content_generation_runs revision and one or more OUTPUT assets.
 * Earlier runs/files remain intact. Only the selected, current-revision output
 * can be published.
 */
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { putObject, readOwnMedia } from '../storage';
import { fetchImageSafely } from '../util/safe-fetch';
import { loadBehaviorsWith } from '../ai-behaviors';
import { compilePrompt } from '../prompt-compiler';
import {
  campaignImageModel, editImage, generateContent, isGeminiConfigured,
  marketingTextModel, verifyCampaignImage, type CampaignImageVerification,
} from '../gemini';
import { previousVerifiedPrice } from '../catalog/pricing';
import { customerProductName, primaryProductImageUrl } from '../util/product-display';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

type ReferenceImage = { data: string; mimeType: string; label: string; productId: string | null; url: string };

// Gemini 2.5 Flash counts internal thinking tokens against maxOutputTokens.
// Small ceilings (the old 80/400 values) left only a word or one partial line
// for the visible answer even when the model followed the prompt correctly.
export const MARKETING_PHRASE_MAX_TOKENS = 800;
export const MARKETING_CAPTION_MAX_TOKENS = 1200;
export const MARKETING_THINKING_BUDGET = 0;

async function loadItemProducts(db: Kysely<DB>, contentItemId: string) {
  return db
    .selectFrom('content_products as cp')
    .innerJoin('products as p', 'p.id', 'cp.product_id')
    .select((eb) => [
      'cp.product_id', 'cp.new_price', 'cp.show_price', 'cp.position',
      'p.product_code', 'p.libyan_display_name', 'p.arabic_name', 'p.english_name', 'p.source_name',
      'p.category', 'p.active_price', 'p.arabic_keywords',
      jsonArrayFrom(
        eb.selectFrom('product_images')
          .select(['public_url', 'storage_path', 'is_primary', 'position'])
          .whereRef('product_images.product_id', '=', 'p.id')
          .orderBy('position', 'asc'),
      ).as('product_images'),
    ])
    .where('cp.content_item_id', '=', contentItemId)
    .orderBy('cp.position', 'asc')
    .execute();
}

function stripModelWrapper(value: string): string {
  return value
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\s*(?:العبارة|الكابشن|caption|phrase)\s*[:：-]\s*/i, '')
    .trim();
}

/** Keep the complete short phrase instead of silently throwing away line two. */
export function cleanGeneratedPhrase(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const lines = stripModelWrapper(value)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .slice(0, 2);
  const phrase = lines.join('\n').replace(/^["'«]+|["'»]+$/g, '').trim();
  if (!phrase) return null;
  // The editor/API accept 200 characters. Stop on a word boundary so Arabic is
  // never left visibly cut off if a provider ignores the requested brevity.
  if (phrase.length <= 180) return phrase;
  const shortened = phrase.slice(0, 180).replace(/\s+\S*$/u, '').trim();
  return shortened || phrase.slice(0, 180).trim();
}

export function cleanGeneratedCaption(value: string | null | undefined, purpose: string): string | null {
  if (!value?.trim()) return null;
  let caption = stripModelWrapper(value).replace(/^["'«]+|["'»]+$/g, '').trim();
  if (!caption) return null;
  // A restrained emoji is part of the requested social voice. Add one only
  // when the model omitted every emoji; never rewrite the generated wording.
  if (!/\p{Extended_Pictographic}/u.test(caption)) {
    const lines = caption.split(/\r?\n/);
    lines[0] = `${lines[0]} ${purpose === 'price_drop' ? '🔥' : '✨'}`;
    caption = lines.join('\n');
  }
  if (caption.length <= 2200) return caption;
  return caption.slice(0, 2200).replace(/\s+\S*$/u, '').trim();
}

export async function generatePhrase(db: Kysely<DB>, productNames: string[], purpose = 'general'): Promise<string | null> {
  if (!isGeminiConfigured()) return null;
  const behaviors = await loadBehaviorsWith(db);
  const envelope = compilePrompt(behaviors, 'campaign_caption', {
    task: 'short_on_image_phrase',
    purpose,
    instruction: purpose === 'price_drop'
      ? 'Write exactly ONE punchy, natural Libyan-Arabic sale headline of 2–10 words. It may use one fitting emoji. Do not include a price, hashtag, quotation marks, label, explanation, or alternative. Return the complete phrase only; it may use at most two short lines.'
      : 'Write exactly ONE warm, natural Libyan-Arabic product phrase of 2–10 words. It may use one fitting emoji. Do not include a price, hashtag, quotation marks, label, explanation, or alternative. Return the complete phrase only; it may use at most two short lines.',
    products: productNames,
  });
  const r = await generateContent(envelope.runtimeData, {
    model: marketingTextModel(), systemInstruction: envelope.effectiveSystemInstruction,
    temperature: 0.82, maxOutputTokens: MARKETING_PHRASE_MAX_TOKENS,
    thinkingBudget: MARKETING_THINKING_BUDGET,
  });
  return cleanGeneratedPhrase(r.text);
}

export async function generateCaption(db: Kysely<DB>, args: {
  productNames: string[];
  purpose: string;
  prices?: { name: string; oldPrice: number | null; newPrice: number }[];
}): Promise<string | null> {
  if (!isGeminiConfigured()) return null;
  const behaviors = await loadBehaviorsWith(db);
  const envelope = compilePrompt(behaviors, 'campaign_caption', {
    task: 'content_studio_caption', purpose: args.purpose, products: args.productNames,
    verified_prices: args.prices ?? [],
    instruction: args.purpose === 'price_drop'
      ? 'Write one complete, energetic Libyan-Arabic social caption in 3–6 short readable lines. State each supplied old and new price exactly, use 1–3 relevant natural emojis, and finish with a soft WhatsApp call to action without inventing a number. Use only supplied facts. No invented discount percentage, offer deadline, stock claim, product feature, or policy. Return the caption only and never cut a sentence.'
      : 'Write one complete, warm Libyan-Arabic social caption in 3–6 short readable lines. Use 1–3 relevant natural emojis and a light conversational call to action. Use only supplied facts and prices. No invented offer, date, stock claim, product feature, or policy. Return the caption only and never cut a sentence.',
  });
  const r = await generateContent(envelope.runtimeData, {
    model: marketingTextModel(), systemInstruction: envelope.effectiveSystemInstruction,
    temperature: 0.75, maxOutputTokens: MARKETING_CAPTION_MAX_TOKENS,
    thinkingBudget: MARKETING_THINKING_BUDGET,
  });
  return cleanGeneratedCaption(r.text, args.purpose);
}

function mimeFor(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

async function loadReference(url: string, label: string, productId: string | null): Promise<ReferenceImage | null> {
  const own = await readOwnMedia(url);
  const fetched = own ? { ok: true as const, data: own } : await fetchImageSafely(url);
  if (!fetched.ok) return null;
  return { data: fetched.data.toString('base64'), mimeType: mimeFor(fetched.data), label, productId, url };
}

export function contentConfigFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

export async function generationFingerprint(db: Kysely<DB>, contentItemId: string): Promise<string> {
  const item = await db.selectFrom('content_items').select([
    'content_type', 'platforms', 'purpose', 'creative_treatment', 'multi_product_layout',
    'aspect_ratio', 'image_text_mode', 'image_text', 'caption', 'config_revision',
  ]).where('id', '=', contentItemId).executeTakeFirst();
  const products = await db.selectFrom('content_products').select([
    'product_id', 'new_price', 'show_price', 'position',
  ]).where('content_item_id', '=', contentItemId).orderBy('position').execute();
  const sources = await db.selectFrom('content_assets').select(['id', 'public_url', 'position'])
    .where('content_item_id', '=', contentItemId).where('asset_role', '=', 'source').orderBy('position').execute();
  return contentConfigFingerprint({ item, products, sources });
}

export function generationNeedsRetry(v: CampaignImageVerification, hasPhrase: boolean, hasPrice: boolean, hasBrand: boolean): boolean {
  const identityChecks = Object.values(v.identity_checks ?? {});
  return v.product_status !== 'acceptable' || v.product_fidelity < 0.9
    || identityChecks.length !== 5 || identityChecks.some((status) => status !== 'match')
    || (hasPhrase && v.overlay_text_status !== 'likely_exact')
    || (hasPrice && v.price_text_status !== 'likely_exact')
    || (hasBrand && v.brand_mark_status !== 'likely_exact');
}

export function generationVerificationWarnings(v: CampaignImageVerification, hasPhrase: boolean, hasPrice: boolean): string[] {
  const out = [...(v.concerns ?? [])];
  const identityChecks = Object.entries(v.identity_checks ?? {});
  if (v.product_status !== 'acceptable' || v.product_fidelity < 0.9 || identityChecks.length !== 5 || identityChecks.some(([, status]) => status !== 'match')) out.push('Product fidelity could not be fully verified.');
  for (const [attribute, status] of identityChecks) {
    if (status !== 'match') out.push(`Product identity check failed: ${attribute.replaceAll('_', ' ')} (${status}).`);
  }
  if (hasPhrase && v.overlay_text_status !== 'likely_exact') out.push('Arabic image text could not be verified as exact.');
  if (hasPrice && v.price_text_status !== 'likely_exact') out.push('Price text could not be verified as exact.');
  if (v.brand_mark_status && !['likely_exact', 'not_requested'].includes(v.brand_mark_status)) out.push('Brand mark could not be verified.');
  return [...new Set(out)].slice(0, 12);
}

export function exactCreativePriceText(prices: Array<{ name: string; oldPrice: number | null; newPrice: number }>): string[] {
  const includeName = prices.length > 1;
  return prices.map((price) => {
    const prefix = includeName ? `${price.name}: ` : '';
    return price.oldPrice != null
      ? `${prefix}قبل ${price.oldPrice} LYD | بعد ${price.newPrice} LYD`
      : `${prefix}${price.newPrice} LYD`;
  });
}

export function creativeDirectionForPurpose(purpose: string): Record<string, unknown> {
  if (purpose === 'price_drop') {
    return {
      visual_mode: 'high-impact premium retail promotion',
      palette: 'English Home navy, vivid sale red, warm ivory, with only subtle sand accents',
      product_scale: 'The exact product is the dominant hero and occupies roughly 45–65% of the frame.',
      price_hierarchy: [
        'Show the Arabic label قبل above the old price.',
        'Render the old numeric price in navy with one clean red diagonal strike-through.',
        'Show the Arabic label بعد above the new price.',
        'Render the new numeric price in red at least twice the visual size of the old price.',
        'Keep LYD beside each numeric value and reproduce every supplied value exactly.',
      ],
      composition: 'Use confident sale blocks, cards, ribbons, or restrained brush accents inspired by polished regional retail advertising. Keep generous safe margins and a clear top brand zone. This must read immediately as a real price-drop advertisement, not as a calm generic editorial post.',
      call_to_action: 'A small navy CTA pill may say exactly اطلبه على واتساب. Do not add a phone number unless runtime data supplies one.',
      prohibited: 'No beige cream-strip template, no tiny prices, no weak low-contrast typography, no decorative text crowding, and no invented percentage, deadline, benefit icon, feature, or product detail.',
    };
  }
  return {
    visual_mode: 'premium editorial product advertising',
    palette: 'warm ivory and navy with restrained sand or olive accents chosen to suit the product',
    composition: 'Create a realistic English Home lifestyle scene with the product as the unmistakable hero, elegant negative space, and strong readable hierarchy.',
    prohibited: 'No invented product detail, fake promotion, busy discount graphics, or generic cream-strip template.',
  };
}

/** Worker handler for one durable generation revision. */
export async function processContentGeneration(db: Kysely<DB>, runId: string): Promise<void> {
  const run = await db.selectFrom('content_generation_runs').selectAll().where('id', '=', runId).executeTakeFirst();
  if (!run || run.status === 'completed') return;
  const item = await db.selectFrom('content_items').selectAll().where('id', '=', run.content_item_id).executeTakeFirst();
  if (!item) throw new Error('content item not found');
  if (run.config_revision !== item.config_revision) {
    await db.updateTable('content_generation_runs').set({ status: 'failed', stage: 'failed', quality_status: 'failed', last_error: 'Configuration changed before generation started.', finished_at: new Date().toISOString() }).where('id', '=', runId).execute();
    throw new Error('content configuration changed');
  }

  await db.updateTable('content_generation_runs').set({ status: 'running', stage: 'analyzing', started_at: new Date().toISOString(), requested_model: campaignImageModel(), last_error: null }).where('id', '=', runId).execute();
  try {
    const products = await loadItemProducts(db, item.id);
    const uploads = await db.selectFrom('content_assets').select(['id', 'public_url', 'position'])
      .where('content_item_id', '=', item.id).where('asset_role', '=', 'source').orderBy('position').execute();
    if (!products.length && !uploads.length) throw new Error('Select a product or upload a source image first.');
    if (item.purpose === 'price_drop' && !products.length) throw new Error('A price drop requires a selected product.');

    const names = products.map((p) => customerProductName(p as any));
    let phrase = item.image_text;
    if (item.image_text_mode === 'generated' && !phrase) {
      phrase = await generatePhrase(db, names, item.purpose);
      if (phrase) await db.updateTable('content_items').set({ image_text: phrase }).where('id', '=', item.id).execute();
    }
    if (item.image_text_mode !== 'none' && !phrase?.trim()) throw new Error('Generate or enter the image phrase before creating the visual.');

    const prices: Array<{ productId: string; name: string; oldPrice: number | null; newPrice: number }> = [];
    for (const p of products) {
      if (item.purpose === 'price_drop') {
        if (p.new_price == null) throw new Error(`Missing new price for ${customerProductName(p as any)}.`);
        prices.push({ productId: p.product_id, name: customerProductName(p as any), oldPrice: await previousVerifiedPrice(db, p.product_id), newPrice: Number(p.new_price) });
      } else if (p.show_price && p.active_price != null) {
        prices.push({ productId: p.product_id, name: customerProductName(p as any), oldPrice: null, newPrice: Number(p.active_price) });
      }
    }

    let caption = item.caption;
    if (!caption) {
      caption = await generateCaption(db, { productNames: names, purpose: item.purpose, prices });
      if (caption) await db.updateTable('content_items').set({ caption }).where('id', '=', item.id).execute();
    }

    const references: ReferenceImage[] = [];
    for (const p of products) {
      const url = primaryProductImageUrl(p as any);
      if (!url) continue;
      const ref = await loadReference(url, `${customerProductName(p as any)} — code ${p.product_code}`, p.product_id);
      if (ref) references.push(ref);
    }
    for (const upload of uploads) {
      if (!upload.public_url) continue;
      const ref = await loadReference(upload.public_url, 'Admin-uploaded product identity reference', null);
      if (ref) references.push(ref);
    }
    if (!references.length) throw new Error('No usable source images were found.');

    const brand = await db.selectFrom('brand_kit').selectAll().where('id', '=', 1).executeTakeFirst();
    if (brand?.logo_public_url) {
      const logo = await loadReference(brand.logo_public_url, 'OFFICIAL BRAND LOGO — reproduce exactly', null);
      if (logo) references.push(logo);
    }

    const logo = references.find((x) => x.label === 'OFFICIAL BRAND LOGO — reproduce exactly');
    const creativeReferences = references.filter((r) => r !== logo);
    if (item.multi_product_layout === 'composition' && creativeReferences.length > 4) {
      throw new Error('One Composition supports up to four product/source references.');
    }
    const groups: ReferenceImage[][] = item.multi_product_layout === 'composition'
      ? [[...creativeReferences.slice(0, 4), ...(logo ? [logo] : [])]]
      : creativeReferences.map((r) => {
          return logo ? [r, logo] : [r];
        });
    if (!groups.length) throw new Error('No source groups could be created.');

    const behaviors = await loadBehaviorsWith(db);
    const made: Array<{ bytes: Buffer; mimeType: string; model: string; verification: CampaignImageVerification; warnings: string[]; trace: string; productId: string | null }> = [];
    await db.updateTable('content_generation_runs').set({ stage: 'creating' }).where('id', '=', runId).execute();

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      const groupProductIds = group.map((r) => r.productId).filter(Boolean) as string[];
      const groupPrices = prices.filter((p) => !groupProductIds.length || groupProductIds.includes(p.productId));
      let feedback: string[] = [];
      let final: { image: { mimeType: string; data: string }; model: string; verification: CampaignImageVerification; trace: string } | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        await db.updateTable('content_generation_runs').set({ attempt_count: groupIndex * 3 + attempt, stage: 'creating' }).where('id', '=', runId).execute();
        const exactPriceText = exactCreativePriceText(groupPrices);
        const exactCallToAction = item.purpose === 'price_drop' ? 'اطلبه على واتساب' : null;
        const creativeDirection = creativeDirectionForPurpose(item.purpose);
        const envelope = compilePrompt(behaviors, 'campaign_image', {
          task: 'content_studio_professional_visual',
          purpose: item.purpose,
          treatment: item.creative_treatment,
          aspect_ratio: item.aspect_ratio,
          image_size: '2K',
          products: products.filter((p) => !groupProductIds.length || groupProductIds.includes(p.product_id)).map((p) => ({ id: p.product_id, code: p.product_code, name: customerProductName(p as any), category: p.category })),
          exact_arabic_phrase: item.image_text_mode === 'none' ? null : phrase,
          exact_price_text: exactPriceText,
          exact_call_to_action: exactCallToAction,
          creative_direction: creativeDirection,
          brand: brand?.logo_public_url ? 'Use the supplied official logo reference exactly.' : `Render the restrained text wordmark exactly: ${brand?.wordmark || 'ENGLISH HOME LIBYA'}`,
          instruction: item.creative_treatment === 'use_original'
            ? `Preserve the original photograph and product exactly. Improve only crop, lighting, layout, and commercial finish. Follow the supplied purpose-specific creative_direction exactly and integrate all exact supplied text professionally.${item.purpose === 'price_drop' ? ' Build a bold, high-impact navy/red price-drop layout comparable to premium regional retail sale advertising; do not fall back to a calm editorial template.' : ''}`
            : `This is an image-editing task. The first supplied image is the PRIMARY PRODUCT IMAGE: retain its actual product pixels and visible identity wherever possible while replacing or extending only the surrounding scene. Change the scene, never the product. Preserve identical silhouette and geometry, dimensions, color, material, transparency, printed artwork and labels, packaging, closures, handles, caps, attachments, and exact number and placement of included pieces or reeds. Do not redraw, redesign, simplify, substitute, or invent any product detail. Follow the supplied purpose-specific creative_direction exactly. Integrate only the exact supplied Arabic phrase, exact price text, and branding with strong hierarchy and safe margins. Do not add a product name unless it is explicitly included in exact text.${item.purpose === 'price_drop' ? ' This must be a bold, conversion-focused English Home price-drop advertisement in navy, vivid red, and ivory—visually comparable to polished regional retail sale campaigns, not calm beige lifestyle editorial.' : ' Create premium, photorealistic English Home lifestyle advertising photography around the unchanged product.'}`,
          correction_feedback: feedback,
        });
        const generated = await editImage({
          prompt: envelope.runtimeData,
          systemPrompt: envelope.effectiveSystemInstruction,
          baseImageBase64: group[0].data,
          mimeType: group[0].mimeType,
          referenceImages: group.slice(1).map((r) => ({ data: r.data, mimeType: r.mimeType, label: r.label })),
          aspectRatio: item.aspect_ratio,
          imageSize: '2K',
          strictModel: true,
          temperature: envelope.generationSettings.temperature,
        });
        if (!generated.ok || !generated.images[0]) throw new Error('Gemini image generation unavailable.');

        await db.updateTable('content_generation_runs').set({ stage: 'verifying_product', source_model: generated.model, prompt_trace_id: envelope.traceId }).where('id', '=', runId).execute();
        const verifyEnvelope = compilePrompt(behaviors, 'campaign_image_verify', {
          requested_phrase: item.image_text_mode === 'none' ? null : phrase,
          requested_prices: exactPriceText,
          requested_call_to_action: exactCallToAction,
          requested_brand: brand?.logo_public_url ? 'official supplied logo' : (brand?.wordmark || 'ENGLISH HOME LIBYA'),
          products: products.filter((p) => !groupProductIds.length || groupProductIds.includes(p.product_id)).map((p) => ({ id: p.product_id, code: p.product_code, name: customerProductName(p as any) })),
          instruction: 'Compare every supplied product reference side by side with the generated visual. Audit every required identity field separately. Product beauty or category similarity is irrelevant. Read the Arabic phrase, requested call to action, every price, and the brand mark character by character. The requested call to action is allowed text, not an unrequested addition. Report every mismatch, obstruction, crop, or uncertainty conservatively.',
        });
        await db.updateTable('content_generation_runs').set({ stage: 'verifying_text' }).where('id', '=', runId).execute();
        const checked = await verifyCampaignImage({
          systemPrompt: verifyEnvelope.effectiveSystemInstruction,
          runtimeData: verifyEnvelope.runtimeData,
          sourceImageBase64: group[0].data,
          sourceMimeType: group[0].mimeType,
          sourceImages: group.slice(1).map((r) => ({ data: r.data, mimeType: r.mimeType, label: r.label })),
          generatedImageBase64: generated.images[0].data,
          generatedMimeType: generated.images[0].mimeType,
        });
        const verification: CampaignImageVerification = checked.ok ? checked.result : {
          product_fidelity: 0, product_status: 'unverifiable', overlay_text_status: 'unverifiable',
          price_text_status: 'unverifiable', brand_mark_status: 'unverifiable', observed_text: null,
          concerns: ['Verification model unavailable.'],
          identity_checks: {
            silhouette_and_geometry: 'unverifiable', color_material_and_transparency: 'unverifiable',
            pattern_artwork_and_labels: 'unverifiable', included_components_and_count: 'unverifiable',
            packaging_and_closures: 'unverifiable',
          },
        };
        final = { image: generated.images[0], model: generated.model, verification, trace: envelope.traceId };
        if (!generationNeedsRetry(verification, item.image_text_mode !== 'none', exactPriceText.length > 0, true) || attempt === 3) break;
        feedback = [
          'The prior result failed automated quality review. Correct these problems while preserving everything else:',
          ...generationVerificationWarnings(verification, item.image_text_mode !== 'none', exactPriceText.length > 0),
        ];
      }
      if (!final) throw new Error('Image model returned no final visual.');
      made.push({
        bytes: Buffer.from(final.image.data, 'base64'), mimeType: final.image.mimeType, model: final.model, verification: final.verification,
        warnings: generationVerificationWarnings(final.verification, item.image_text_mode !== 'none', groupPrices.length > 0),
        trace: final.trace, productId: groupProductIds.length === 1 ? groupProductIds[0] : null,
      });
    }

    if (!made.length) throw new Error('No visual was produced.');
    let position = 0;
    for (const visual of made) {
      const extension = visual.mimeType.includes('webp') ? 'webp' : visual.mimeType.includes('jpeg') || visual.mimeType.includes('jpg') ? 'jpg' : 'png';
      const objectPath = `content/${item.id}/runs/${runId}/${position}.${extension}`;
      const stored = await putObject(objectPath, visual.bytes);
      if (!stored.ok) throw new Error(`Storage failed: ${stored.reason}`);
      const values = {
        content_item_id: item.id, product_id: visual.productId, kind: 'generated', asset_role: 'output',
        generation_run_id: runId, config_revision: item.config_revision, selected_for_publish: false,
        storage_path: stored.data.path, public_url: stored.data.publicUrl,
        width: item.aspect_ratio === '9:16' ? 1536 : 1856,
        height: item.aspect_ratio === '9:16' ? 2752 : 2304,
        aspect_ratio: item.aspect_ratio, position: position++, source_model: visual.model,
        overlay: JSON.stringify({ phrase, prices, call_to_action: item.purpose === 'price_drop' ? 'اطلبه على واتساب' : null, brand: brand?.wordmark || 'ENGLISH HOME LIBYA', rendered_by_model: true }),
        verification: JSON.stringify(visual.verification),
      } as const;
      const existing = await db.selectFrom('content_assets').select('id')
        .where('generation_run_id', '=', runId).where('position', '=', position - 1).executeTakeFirst();
      if (existing) await db.updateTable('content_assets').set(values as any).where('id', '=', existing.id).execute();
      else await db.insertInto('content_assets').values(values as any).execute();
    }

    const warnings = [...new Set(made.flatMap((x) => x.warnings))];
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('content_assets').set({ selected_for_publish: false })
        .where('content_item_id', '=', item.id).where('asset_role', '=', 'output').execute();
      await trx.updateTable('content_assets').set({ selected_for_publish: true })
        .where('generation_run_id', '=', runId).where('asset_role', '=', 'output').execute();
      await trx.updateTable('content_generation_runs').set({
        status: 'completed', stage: 'finished', quality_status: warnings.length ? 'warning' : 'verified',
        warnings: JSON.stringify(warnings), verification: JSON.stringify(made.map((x) => x.verification)),
        source_model: made[0].model, prompt_trace_id: made[0].trace,
        finished_at: new Date().toISOString(), last_error: null,
      }).where('id', '=', runId).execute();
      await trx.updateTable('content_items').set({
        status: 'ready', selected_generation_run_id: runId,
        output_mode: item.multi_product_layout === 'composition' ? 'combined' : (made.length > 1 ? 'carousel' : 'original'),
        last_error: warnings.length ? warnings.join('; ').slice(0, 500) : null,
      }).where('id', '=', item.id).execute();
    });
  } catch (error: any) {
    const message = String(error?.message ?? 'generation failed').slice(0, 1000);
    await db.updateTable('content_generation_runs').set({ status: 'failed', stage: 'failed', quality_status: 'failed', last_error: message, finished_at: new Date().toISOString() }).where('id', '=', runId).execute();
    await db.updateTable('content_items').set({ status: 'failed', last_error: message }).where('id', '=', item.id).execute();
    throw error;
  }
}
