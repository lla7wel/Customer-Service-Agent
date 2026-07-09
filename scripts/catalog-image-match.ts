/**
 * Dry-run/apply catalog image matching.
 *
 * Default mode is read-only:
 *   npm run match:images
 *
 * Apply requires an explicit confirmation flag:
 *   npm run match:images -- --apply --yes --limit=100
 */
import './_lib';
import { requireDb } from '../integrations/db/client';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import {
  bestCatalogMatch,
  displayProductName,
  isAutoAttachableScore,
  prepareMatchProduct,
  summarizeCatalogMatches,
  type MatchCandidate,
  type MatchConfidenceLevel,
  type PreparedMatchProduct,
} from '../integrations/catalog-match';

interface CsvTarget {
  id: string;
  english_name: string | null;
  arabic_name: string | null;
  libyan_display_name: string | null;
  product_code: string | null;
  barcode: string | null;
  category: string | null;
  search_keywords: string[] | null;
  arabic_keywords: string[] | null;
  base_price: number | null;
  raw?: unknown;
}

interface Candidate extends MatchCandidate {
  id: string;
  source_name: string | null;
  product_code: string | null;
  barcode: string | null;
  category: string | null;
  image: string | null;
  image_count: number;
  raw?: unknown;
}

interface Options {
  apply: boolean;
  yes: boolean;
  limit: number;
  minLevel: 'high' | 'medium';
  sample: number;
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  const getValue = (name: string) => {
    const direct = args.find((x) => x.startsWith(`${name}=`));
    if (direct) return direct.slice(name.length + 1);
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const confidence = getValue('--confidence');
  return {
    apply: args.includes('--apply'),
    yes: args.includes('--yes'),
    limit: Math.max(1, Number(getValue('--limit') ?? '250')),
    minLevel: confidence === 'high' ? 'high' : 'medium',
    sample: Math.max(1, Number(getValue('--sample') ?? '10')),
  };
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

function appendRawEvent(raw: unknown, key: string, event: Record<string, unknown>) {
  const obj = asRecord(raw);
  const existing = Array.isArray(obj[key]) ? (obj[key] as unknown[]) : [];
  return { ...obj, [key]: [event, ...existing].slice(0, 30) };
}

function shouldAttach(level: MatchConfidenceLevel, minLevel: 'high' | 'medium') {
  if (level === 'high') return true;
  return minLevel === 'medium' && level === 'medium';
}

async function loadTargets(db: ReturnType<typeof requireDb>): Promise<CsvTarget[]> {
  return (await db
    .selectFrom('products')
    .select(['id', 'english_name', 'arabic_name', 'libyan_display_name', 'product_code', 'barcode', 'category', 'search_keywords', 'arabic_keywords', 'base_price', 'raw'])
    .where('source', '=', 'csv')
    .where('status', '=', 'active')
    .where('base_price', 'is not', null)
    .where('primary_image_id', 'is', null)
    .orderBy('updated_at', 'desc')
    .execute()) as unknown as CsvTarget[];
}

async function loadCandidates(db: ReturnType<typeof requireDb>): Promise<Candidate[]> {
  const data = await db
    .selectFrom('products')
    .select(['id', 'source_name', 'product_code', 'barcode', 'category', 'raw'])
    .select((eb) => [
      jsonArrayFrom(
        eb.selectFrom('product_images').select(['public_url', 'is_primary', 'position'])
          .whereRef('product_images.product_id', '=', 'products.id').orderBy('position', 'asc'),
      ).as('product_images'),
    ])
    .where('source', '=', 'scraper')
    .where('status', '!=', 'archived')
    .where('base_price', 'is', null)
    .execute();
  const rows: Candidate[] = [];
  for (const p of data as any[]) {
    const imgs = p.product_images ?? [];
    if (imgs.length === 0) continue;
    const primary = imgs.find((i: any) => i.is_primary) ?? imgs.find((i: any) => i.public_url) ?? imgs[0];
    rows.push({
      id: p.id,
      source_name: p.source_name,
      product_code: p.product_code ?? null,
      barcode: p.barcode ?? null,
      category: p.category,
      image: primary?.public_url ?? null,
      image_count: imgs.length,
      raw: p.raw,
    });
  }
  return rows;
}

async function attachImages(db: ReturnType<typeof requireDb>, args: {
  csvProductId: string;
  scraperProductId: string;
  level: MatchConfidenceLevel;
  confidence: number;
  reason: string;
}) {
  const csv = await db
    .selectFrom('products')
    .select(['id', 'source', 'status', 'base_price', 'primary_image_id', 'raw'])
    .where('id', '=', args.csvProductId)
    .executeTakeFirst();
  if (!csv) throw new Error('csv_not_found');
  if (csv.source !== 'csv' || csv.status !== 'active' || csv.base_price == null) {
    throw new Error('target_is_not_active_priced_csv_product');
  }
  if (csv.primary_image_id) return { moved: 0, skipped: 'csv_already_has_primary_image' };

  const scraper = await db
    .selectFrom('products')
    .select(['id', 'source', 'status', 'source_name', 'product_code', 'raw'])
    .where('id', '=', args.scraperProductId)
    .executeTakeFirst();
  if (!scraper) throw new Error('scraper_not_found');
  if (scraper.source !== 'scraper' || scraper.status === 'archived') {
    throw new Error('source_is_not_open_scraper_review_product');
  }

  const imgs = await db
    .selectFrom('product_images')
    .select(['id', 'position', 'is_primary', 'public_url'])
    .where('product_id', '=', args.scraperProductId)
    .orderBy('position', 'asc')
    .execute();
  if (imgs.length === 0) throw new Error('no_images_on_source');

  await db.updateTable('product_images').set({ product_id: args.csvProductId }).where('product_id', '=', args.scraperProductId).execute();

  const primary = imgs.find((i) => i.public_url) ?? imgs[0];
  const attachedAt = new Date().toISOString();
  await db
    .updateTable('products')
    .set({
      primary_image_id: primary.id,
      raw: JSON.stringify(appendRawEvent(csv.raw, 'catalog_match_attached', {
        scraper_product_id: args.scraperProductId,
        scraper_product_code: scraper.product_code,
        scraper_source_name: scraper.source_name,
        image_count: imgs.length,
        confidence: args.confidence,
        confidence_level: args.level,
        reason: args.reason,
        attached_at: attachedAt,
        mode: 'script_auto_attach',
      })),
    })
    .where('id', '=', args.csvProductId).execute();

  await db
    .updateTable('products')
    .set({
      status: 'archived',
      primary_image_id: null,
      raw: JSON.stringify({
        ...asRecord(scraper.raw),
        catalog_match_merged_into: {
          csv_product_id: args.csvProductId,
          image_count: imgs.length,
          confidence: args.confidence,
          confidence_level: args.level,
          reason: args.reason,
          merged_at: attachedAt,
          mode: 'script_auto_attach',
        },
      }),
    })
    .where('id', '=', args.scraperProductId).execute();

  await db.insertInto('activity_logs').values({
    actor_type: 'system',
    action: 'catalog_image_match_auto_attached',
    entity_type: 'product',
    entity_id: args.csvProductId,
    summary: `Auto-attached ${imgs.length} scraped images from ${args.scraperProductId} to CSV product ${args.csvProductId}`,
    meta: JSON.stringify({
      csv_product_id: args.csvProductId,
      scraper_product_id: args.scraperProductId,
      image_count: imgs.length,
      confidence: args.confidence,
      confidence_level: args.level,
      reason: args.reason,
      duplicate_archived: true,
    }),
  }).execute();

  return { moved: imgs.length, skipped: null };
}

async function main() {
  const opts = parseOptions();
  if (opts.apply && !opts.yes) {
    throw new Error('Refusing to apply without --yes. Run dry-run first, then use --apply --yes.');
  }

  console.log('EH-SYSTEM — catalog image match');
  console.log(opts.apply ? 'Mode: APPLY' : 'Mode: DRY RUN');
  console.log(`Confidence: ${opts.minLevel}+`);
  console.log(`Limit: ${opts.limit}\n`);

  const db = requireDb();
  const [targetsRaw, candidatesRaw] = await Promise.all([loadTargets(db), loadCandidates(db)]);
  const targets = targetsRaw.map((p) => prepareMatchProduct(p));
  const candidates = candidatesRaw.map((p) => prepareMatchProduct(p));
  const summary = summarizeCatalogMatches(targets as PreparedMatchProduct[], candidates, opts.sample);

  console.log(`CSV products checked:        ${summary.checked}`);
  console.log(`Suggestions generated:       ${summary.suggestionsGenerated}`);
  console.log(`High confidence matches:     ${summary.highConfidence}`);
  console.log(`Medium confidence matches:   ${summary.mediumConfidence}`);
  console.log(`Low confidence matches:      ${summary.lowConfidence}`);
  console.log(`No confidence matches:       ${summary.noConfidence}`);
  console.log(`Would auto-attach products:  ${summary.wouldAutoAttachProducts}`);
  console.log(`Would auto-attach images:    ${summary.wouldAutoAttachImages}`);
  console.log(`Would send to review:        ${summary.wouldSendToReview}`);

  const scored = targets
    .map((target) => ({ target, suggestion: bestCatalogMatch(target, candidates) }))
    .filter((x): x is { target: PreparedMatchProduct<CsvTarget>; suggestion: NonNullable<ReturnType<typeof bestCatalogMatch>> } => !!x.suggestion);

  function printSamples(level: MatchConfidenceLevel) {
    const rows = scored.filter((x) => x.suggestion.level === level).slice(0, opts.sample);
    if (!rows.length) return;
    console.log(`\nSample ${level} matches:`);
    for (const row of rows) {
      console.log(`- [${row.suggestion.confidence}%] ${displayProductName(row.target.item)}`);
      console.log(`  -> ${row.suggestion.source_name ?? row.suggestion.scraper_product_id} (${row.suggestion.image_count} images)`);
      console.log(`  ${row.suggestion.reason}`);
    }
  }

  printSamples('high');
  printSamples('medium');
  printSamples('low');

  const usedScraperIds = new Set<string>();
  const selected: Array<{ target: PreparedMatchProduct<CsvTarget>; suggestion: NonNullable<ReturnType<typeof bestCatalogMatch>> }> = [];
  const attachable = scored
    .filter(({ suggestion }) => shouldAttach(suggestion.level, opts.minLevel) && isAutoAttachableScore(suggestion, opts.minLevel))
    .sort((a, b) => b.suggestion.confidence - a.suggestion.confidence);
  for (const { target, suggestion } of attachable) {
    if (usedScraperIds.has(suggestion.scraper_product_id)) continue;
    usedScraperIds.add(suggestion.scraper_product_id);
    selected.push({ target, suggestion });
    if (selected.length >= opts.limit) break;
  }

  console.log(`\nSelected for this batch:     ${selected.length}`);
  console.log(`Selected image rows:         ${selected.reduce((sum, x) => sum + x.suggestion.image_count, 0)}`);

  if (selected.length) {
    console.log('\nSample auto-attach candidates:');
    for (const item of selected.slice(0, opts.sample)) {
      console.log(`- [${item.suggestion.level} ${item.suggestion.confidence}%] ${displayProductName(item.target.item)}`);
      console.log(`  -> ${item.suggestion.source_name ?? item.suggestion.scraper_product_id} (${item.suggestion.image_count} images)`);
      console.log(`  ${item.suggestion.reason}`);
    }
  }

  if (!opts.apply) {
    console.log('\nDry-run only. No database rows were changed.');
    return;
  }

  let attachedProducts = 0;
  let attachedImages = 0;
  let duplicatesArchived = 0;
  const errors: Array<{ csv: string; scraper: string; error: string }> = [];

  for (const item of selected) {
    try {
      const result = await attachImages(db, {
        csvProductId: item.target.item.id,
        scraperProductId: item.suggestion.scraper_product_id,
        level: item.suggestion.level,
        confidence: item.suggestion.confidence,
        reason: item.suggestion.reason,
      });
      if (result.moved > 0) {
        attachedProducts++;
        attachedImages += result.moved;
        duplicatesArchived++;
      }
      console.log(`Attached ${displayProductName(item.target.item)} <- ${item.suggestion.source_name ?? item.suggestion.scraper_product_id}`);
    } catch (e: any) {
      errors.push({
        csv: item.target.item.id,
        scraper: item.suggestion.scraper_product_id,
        error: e?.message ?? 'unknown',
      });
    }
  }

  console.log('\nApply complete.');
  console.log(`Attached products:           ${attachedProducts}`);
  console.log(`Attached images:             ${attachedImages}`);
  console.log(`Duplicates archived:         ${duplicatesArchived}`);
  console.log(`Errors:                      ${errors.length}`);
  if (errors.length) {
    console.log('\nFirst errors:');
    for (const e of errors.slice(0, 10)) console.log(`- ${e.csv} <- ${e.scraper}: ${e.error}`);
  }
}

main().catch((e) => {
  console.error(`\n✗ Catalog image match failed: ${e.message}`);
  process.exit(1);
});
