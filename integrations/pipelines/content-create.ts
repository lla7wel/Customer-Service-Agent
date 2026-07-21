/**
 * Content Studio asset generation.
 *
 * Modes:
 *   original  → each selected asset/product photo, fitted to the platform
 *               ratio, with the deterministic overlay when the purpose needs
 *               one (price drop always shows verified prices);
 *   carousel  → one composed visual per selected product;
 *   combined  → one collage containing the selected products.
 *
 * The Libyan-Arabic phrase and caption come from Gemini ONCE as editable
 * suggestions; exact prices/text are always rendered deterministically by the
 * composition layer — an image model never spells them.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { Jimp, JimpMime } from 'jimp';
import { composeVisual, ASPECT_SIZES, type AspectPreset } from '../content/compose';
import { putObject, removeObject, readOwnMedia } from '../storage';
import { fetchImageSafely } from '../util/safe-fetch';
import { loadBehaviorsWith } from '../ai-behaviors';
import { compilePrompt } from '../prompt-compiler';
import { generateContent, marketingTextModel, isGeminiConfigured } from '../gemini';
import { previousVerifiedPrice } from '../catalog/pricing';
import { customerProductName, primaryProductImageUrl } from '../util/product-display';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

export interface GenerationResult {
  ok: boolean;
  assets: number;
  phrase: string | null;
  caption: string | null;
  problems: string[];
}

async function loadItemProducts(db: Kysely<DB>, contentItemId: string) {
  return db
    .selectFrom('content_products as cp')
    .innerJoin('products as p', 'p.id', 'cp.product_id')
    .select((eb) => [
      'cp.product_id', 'cp.new_price', 'cp.show_price', 'cp.position',
      'p.product_code', 'p.libyan_display_name', 'p.arabic_name', 'p.english_name', 'p.source_name',
      'p.active_price', 'p.arabic_keywords',
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

/** One concise editable Libyan-Arabic phrase for the selected products. */
export async function generatePhrase(db: Kysely<DB>, productNames: string[]): Promise<string | null> {
  if (!isGeminiConfigured()) return null;
  try {
    const behaviors = await loadBehaviorsWith(db);
    const envelope = compilePrompt(behaviors, 'campaign_caption', {
      task: 'short_on_image_phrase',
      instruction: 'Write exactly ONE short warm Libyan-Arabic phrase (max 8 words) for a product visual. No prices, no hashtags, no emojis, no quotes — just the phrase.',
      products: productNames,
    });
    const r = await generateContent(envelope.runtimeData, {
      model: marketingTextModel(),
      systemInstruction: envelope.effectiveSystemInstruction,
      temperature: 0.9,
      maxOutputTokens: 100,
    });
    const line = r.text?.trim().split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? null;
    return line ? line.replace(/^["'«]+|["'»]+$/g, '').slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** Editable shared caption (same text for Facebook and Instagram). */
export async function generateCaption(db: Kysely<DB>, args: {
  productNames: string[]; purpose: string; prices?: { name: string; oldPrice: number | null; newPrice: number }[];
}): Promise<string | null> {
  if (!isGeminiConfigured()) return null;
  try {
    const behaviors = await loadBehaviorsWith(db);
    const envelope = compilePrompt(behaviors, 'campaign_caption', {
      task: 'post_caption',
      purpose: args.purpose,
      products: args.productNames,
      verified_prices: args.prices ?? [],
      instruction: 'Write a warm, concise Libyan-Arabic caption (2–4 short lines). Use ONLY the verified prices supplied, if any. No invented offers, dates or policies.',
    });
    const r = await generateContent(envelope.runtimeData, {
      model: marketingTextModel(),
      systemInstruction: envelope.effectiveSystemInstruction,
      temperature: 0.85,
      maxOutputTokens: 400,
    });
    return r.text?.trim().slice(0, 1800) ?? null;
  } catch {
    return null;
  }
}

async function loadBaseImage(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  // Our own media is read from disk; anything else goes through the SSRF-safe
  // fetcher.
  const own = await readOwnMedia(url);
  if (own) return own;
  const fetched = await fetchImageSafely(url);
  return fetched.ok ? fetched.data : null;
}

/** Deterministic collage of up to four product photos (combined mode). */
async function buildCollage(buffers: Buffer[], aspect: AspectPreset): Promise<Buffer> {
  const { width, height } = ASPECT_SIZES[aspect];
  const canvas = new Jimp({ width, height, color: 0xf5efe4ff });
  const n = Math.min(buffers.length, 4);
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  if (n === 1) cells.push({ x: 0, y: 0, w: width, h: height });
  else if (n === 2) {
    cells.push({ x: 0, y: 0, w: Math.floor(width / 2), h: height });
    cells.push({ x: Math.floor(width / 2), y: 0, w: Math.ceil(width / 2), h: height });
  } else {
    const hw = Math.floor(width / 2);
    const hh = Math.floor(height / 2);
    cells.push({ x: 0, y: 0, w: hw, h: n === 3 ? height : hh });
    cells.push({ x: hw, y: 0, w: width - hw, h: hh });
    cells.push({ x: hw, y: hh, w: width - hw, h: height - hh });
    if (n === 4) {
      cells[0] = { x: 0, y: 0, w: hw, h: hh };
      cells.push({ x: 0, y: hh, w: hw, h: height - hh });
    }
  }
  for (let i = 0; i < n; i++) {
    const img = await Jimp.read(buffers[i]);
    img.cover({ w: cells[i].w - 4, h: cells[i].h - 4 });
    canvas.composite(img, cells[i].x + 2, cells[i].y + 2);
  }
  return canvas.getBuffer(JimpMime.jpeg, { quality: 92 });
}

/**
 * Generate the item's publishable assets from its configuration. Existing
 * generated/composed assets are replaced; uploaded originals are kept.
 */
export async function generateContentAssets(db: Kysely<DB>, contentItemId: string): Promise<GenerationResult> {
  const item = await db.selectFrom('content_items').selectAll().where('id', '=', contentItemId).executeTakeFirst();
  if (!item) return { ok: false, assets: 0, phrase: null, caption: null, problems: ['content item not found'] };

  const problems: string[] = [];
  const products = await loadItemProducts(db, contentItemId);
  const uploads = await db.selectFrom('content_assets')
    .select(['id', 'public_url', 'storage_path'])
    .where('content_item_id', '=', contentItemId)
    .where('kind', '=', 'uploaded')
    .orderBy('position', 'asc')
    .execute();

  if (!products.length && !uploads.length) {
    return { ok: false, assets: 0, phrase: null, caption: null, problems: ['select at least one product or upload an image'] };
  }
  if (item.purpose === 'price_drop' && !products.length) {
    return { ok: false, assets: 0, phrase: null, caption: null, problems: ['a price drop requires selected products'] };
  }

  const aspect: AspectPreset = item.content_type === 'story' ? 'story' : 'feed_square';
  const productNames = products.map((p) => customerProductName(p as any));

  // Phrase: generated once when requested and not manually set.
  let phrase: string | null = item.image_text ?? null;
  if (item.image_text_mode === 'generated' && !phrase) {
    phrase = await generatePhrase(db, productNames);
    if (phrase) await db.updateTable('content_items').set({ image_text: phrase }).where('id', '=', contentItemId).execute();
  }
  const overlayPhrase = item.image_text_mode === 'none' ? null : phrase;

  // Verified price data (price drop: previous price from history, never stale).
  const priceByProduct = new Map<string, { oldPrice: number | null; newPrice: number | null; show: boolean }>();
  for (const p of products) {
    if (item.purpose === 'price_drop' && p.new_price != null) {
      const prev = await previousVerifiedPrice(db, p.product_id);
      priceByProduct.set(p.product_id, { oldPrice: prev, newPrice: Number(p.new_price), show: true });
    } else if (p.show_price && p.active_price != null) {
      priceByProduct.set(p.product_id, { oldPrice: null, newPrice: Number(p.active_price), show: true });
    } else {
      priceByProduct.set(p.product_id, { oldPrice: null, newPrice: null, show: false });
    }
  }

  // Replace previous generated output (uploads are preserved). The FILES are
  // removed with their rows so regeneration cannot orphan media (EH-028).
  const superseded = await db.selectFrom('content_assets')
    .select(['id', 'storage_path'])
    .where('content_item_id', '=', contentItemId)
    .where('kind', 'in', ['original', 'generated', 'composed'])
    .execute();
  await db.deleteFrom('content_assets')
    .where('content_item_id', '=', contentItemId)
    .where('kind', 'in', ['original', 'generated', 'composed'])
    .execute();
  for (const asset of superseded) {
    if (asset.storage_path) await removeObject(asset.storage_path).catch(() => {});
  }

  const madeAssets: { productId: string | null; jpeg: Buffer; overlay: unknown }[] = [];

  if (item.output_mode === 'combined') {
    const buffers: Buffer[] = [];
    for (const p of products.slice(0, 4)) {
      const buf = await loadBaseImage(primaryProductImageUrl(p as any));
      if (buf) buffers.push(buf);
    }
    for (const u of uploads.slice(0, 4 - buffers.length)) {
      const buf = await loadBaseImage(u.public_url);
      if (buf) buffers.push(buf);
    }
    if (!buffers.length) return { ok: false, assets: 0, phrase, caption: item.caption, problems: ['no usable images for the combined visual'] };
    const collage = await buildCollage(buffers, aspect);
    const single = products.length === 1 ? priceByProduct.get(products[0].product_id) : null;
    const composed = await composeVisual({
      baseImage: collage, aspect,
      phrase: overlayPhrase,
      oldPrice: single?.show ? single.oldPrice : null,
      newPrice: single?.show ? single.newPrice : null,
    });
    madeAssets.push({ productId: null, jpeg: composed.jpeg, overlay: composed.overlay });
  } else if (item.output_mode === 'carousel') {
    for (const p of products) {
      const buf = await loadBaseImage(primaryProductImageUrl(p as any));
      if (!buf) { problems.push(`no image for ${customerProductName(p as any)}`); continue; }
      const prices = priceByProduct.get(p.product_id);
      const composed = await composeVisual({
        baseImage: buf, aspect,
        phrase: overlayPhrase,
        oldPrice: prices?.show ? prices.oldPrice : null,
        newPrice: prices?.show ? prices.newPrice : null,
      });
      madeAssets.push({ productId: p.product_id, jpeg: composed.jpeg, overlay: composed.overlay });
    }
  } else {
    // original: uploaded assets first, else product photos — fitted + overlaid
    // when the purpose needs prices/text; plain refit otherwise.
    const sources: { productId: string | null; url: string | null }[] = uploads.length
      ? uploads.map((u) => ({ productId: null, url: u.public_url }))
      : products.map((p) => ({ productId: p.product_id, url: primaryProductImageUrl(p as any) }));
    for (const src of sources) {
      const buf = await loadBaseImage(src.url);
      if (!buf) { problems.push('an image could not be loaded'); continue; }
      const prices = src.productId ? priceByProduct.get(src.productId) : (products.length === 1 ? priceByProduct.get(products[0].product_id) : null);
      const needsOverlay = (prices?.show ?? false) || !!overlayPhrase;
      const composed = await composeVisual({
        baseImage: buf, aspect,
        phrase: needsOverlay ? overlayPhrase : null,
        oldPrice: needsOverlay && prices?.show ? prices.oldPrice : null,
        newPrice: needsOverlay && prices?.show ? prices.newPrice : null,
        brandLine: needsOverlay,
      });
      madeAssets.push({ productId: src.productId, jpeg: composed.jpeg, overlay: composed.overlay });
    }
  }

  if (!madeAssets.length) {
    return { ok: false, assets: 0, phrase, caption: item.caption, problems: problems.length ? problems : ['no assets could be generated'] };
  }

  let position = 0;
  for (const asset of madeAssets) {
    const objectPath = `content/${contentItemId}/${Date.now()}-${position}.jpg`;
    const stored = await putObject(objectPath, asset.jpeg);
    if (!stored.ok) { problems.push(`storage failed: ${stored.reason}`); continue; }
    const { width, height } = ASPECT_SIZES[aspect];
    await db.insertInto('content_assets').values({
      content_item_id: contentItemId,
      product_id: asset.productId,
      kind: 'composed',
      storage_path: stored.data.path,
      public_url: stored.data.publicUrl,
      width, height,
      position: position++,
      overlay: JSON.stringify(asset.overlay ?? {}),
    }).execute();
  }

  // Caption suggestion once, if empty.
  let caption = item.caption ?? null;
  if (!caption) {
    caption = await generateCaption(db, {
      productNames,
      purpose: item.purpose,
      prices: products
        .filter((p) => priceByProduct.get(p.product_id)?.show)
        .map((p) => ({
          name: customerProductName(p as any),
          oldPrice: priceByProduct.get(p.product_id)!.oldPrice,
          newPrice: priceByProduct.get(p.product_id)!.newPrice!,
        })),
    });
    if (caption) await db.updateTable('content_items').set({ caption }).where('id', '=', contentItemId).execute();
  }

  await db.updateTable('content_items')
    .set({ status: 'ready', last_error: problems.length ? problems.join('; ').slice(0, 500) : null })
    .where('id', '=', contentItemId)
    .execute();

  return { ok: true, assets: position, phrase, caption, problems };
}
