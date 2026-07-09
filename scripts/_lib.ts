/**
 * Shared helpers for the import scripts. Loads EH-SYSTEM1/.env, resolves the
 * (read-only) scraper paths, and maps a scraper product record to a DB row.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Load EH-SYSTEM1/.env regardless of the cwd the script is run from.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../.env') });
config(); // also pick up a local .env if present (no override of the above)

export function scraperOutputDir(): string {
  return process.env.SCRAPER_OUTPUT_DIR || path.resolve(here, '../../english-home-tr-scraper/data/output');
}

/** The scraper repo root (images paths in the JSON are relative to this). */
export function scraperRoot(): string {
  const out = scraperOutputDir();
  // .../data/output -> repo root is two levels up.
  return path.resolve(out, '..', '..');
}

export function productsJsonPath(): string {
  return path.join(scraperOutputDir(), 'products-with-images.json');
}

/** The trusted initial price source (one-time bootstrap only, never normal sync). */
export function catalogCsvPath(): string {
  return (
    process.env.CATALOG_CSV_PATH ||
    path.resolve(here, '../../english-home-tr-scraper/data/input/catalog.csv')
  );
}

/** Minimal RFC4180-ish CSV parser (handles quoted fields, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface CatalogRow {
  product_code: string; // exactly as in CSV (string; may have/lack leading zeros)
  barcode: string;
  product_name: string;
  price: number | null;
  website_url: string;
  arabic_keywords: string[];
  english_keywords: string[];
  search_text: string;
}

/** Normalize a product code for matching (strip leading zeros). */
export function normalizeCode(code: string | null | undefined): string {
  return (code ?? '').trim().replace(/^0+/, '');
}

function splitKeywords(s: string | undefined): string[] {
  return (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Read + parse catalog.csv into typed rows. Column order is fixed by the file. */
export function readCatalogCsv(): CatalogRow[] {
  const p = catalogCsvPath();
  if (!fs.existsSync(p)) {
    throw new Error(`catalog.csv not found at ${p}. Set CATALOG_CSV_PATH.`);
  }
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  // Columns: Product Code, Barcode, Product Name, Price, Website URL, Image URL,
  //          Arabic Keywords, Needs Size/Color, English Keywords,
  //          Variant Requirement, Search Text
  const out: CatalogRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const priceRaw = parseFloat((r[3] ?? '').trim());
    out.push({
      product_code: r[0].trim(),
      barcode: (r[1] ?? '').trim(),
      product_name: (r[2] ?? '').trim(),
      price: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null,
      website_url: (r[4] ?? '').trim(),
      arabic_keywords: splitKeywords(r[6]),
      english_keywords: splitKeywords(r[8]),
      search_text: (r[10] ?? '').trim(),
    });
  }
  return out;
}

export interface ScraperProduct {
  product_name: string;
  product_code: string;
  barcode?: string;
  product_url?: string;
  category?: string;
  local_image_folder?: string;
  images?: string[];
  scraped_at?: string;
}

export function readScraperProducts(): ScraperProduct[] {
  const p = productsJsonPath();
  if (!fs.existsSync(p)) {
    throw new Error(
      `Scraper output not found at ${p}. Set SCRAPER_OUTPUT_DIR or run the scraper first. (This script never runs or edits the scraper.)`,
    );
  }
  const raw = fs.readFileSync(p, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('products-with-images.json is not an array.');
  return data as ScraperProduct[];
}

/**
 * SOURCE/REFERENCE fields a scraper sync may refresh on an EXISTING product.
 * Deliberately excludes everything customer/admin-facing or admin-owned:
 *   - no price (base/active/campaign), no `status`  → never un-publish or reprice
 *   - no `source` flag        → never flip a CSV-backed product back to 'scraper'
 *   - no `barcode`/`category` → those are CSV catalog identity/fields
 *   - no english/arabic names → customer-facing catalog language stays Arabic/English
 * The Turkish scraped name is kept only as `source_name` (reference metadata).
 */
export function mapSourceMetadata(p: ScraperProduct, importRunId: string | null) {
  return {
    source_name: p.product_name ?? null, // Turkish — reference only
    website_url: p.product_url ?? null,
    import_run_id: importRunId,
    raw: JSON.stringify(p), // jsonb — node-pg needs explicit JSON encoding
  };
}

/**
 * Full row for a NEW scraped-only product. Code is normalized (canonical, no
 * leading zeros) so it shares identity with the CSV catalog. Starts as 'draft'
 * with no price and NO Arabic/English name → it is NOT customer-visible until an
 * admin reviews it (adds Arabic/English name + price) in Price/Product Review.
 */
export function mapNewProductRow(p: ScraperProduct, importRunId: string | null) {
  return {
    product_code: normalizeCode(p.product_code),
    barcode: p.barcode ?? null,
    category: p.category ?? null, // Turkish source category (reference)
    ...mapSourceMetadata(p, importRunId),
    source: 'scraper',
    status: 'draft' as const, // needs review before going live
    availability: 'assume_available' as const,
  };
}

/** Resolve an image's absolute path on disk from its scraper-relative path. */
export function resolveImageAbsPath(relPath: string): string {
  return path.isAbsolute(relPath) ? relPath : path.join(scraperRoot(), relPath);
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
