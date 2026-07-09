# EH-SYSTEM1 — Catalog / import scripts

The **CSV catalog** (`english-home-tr-scraper/data/input/catalog.csv`) is the
main priced product catalog for English Home Libya. The **scraper** is only for
product discovery, images and source/reference metadata.

These scripts **only read** `../english-home-tr-scraper` — they never run, edit,
or delete anything in the scraper.

## Setup

```bash
cd EH-SYSTEM1/scripts
npm install
# Ensure EH-SYSTEM1/.env has:
#   SUPABASE_URL=...
#   SUPABASE_SERVICE_ROLE_KEY=...
#   (optional) SCRAPER_OUTPUT_DIR / SCRAPER_IMAGES_DIR / CATALOG_CSV_PATH overrides
```

## Commands

| Command | What it does | Writes? |
|---------|--------------|---------|
| `npm run validate` | Dry run: reports what the scraper import would do, checks image files exist. | No |
| `npm run catalog:csv` | **Main catalog import.** Imports every `catalog.csv` product as an **active, priced** product (English name + AR/EN keywords + L.D. price). Matches existing scraped products by canonical code/barcode and keeps their images; inserts CSV-only products (no images yet). Only fills prices that are **null** → never overwrites an admin price. `-- --dry` to preview. | Supabase only |
| `npm run import:products` | Scraper sync. **New** scraped-only products → inserted as `draft` (no price, no AR/EN name) for review. **Existing** products get scraper **source metadata + images only** — never price, status, name, barcode or category. | Supabase only |
| `npm run upload:images` | Uploads local images to the `eh-media` Storage bucket, fills `public_url`. | Supabase + Storage |
| `npm run match:images` | Dry run: suggests scraper images for active CSV products missing images using code family, barcode, dimensions, color, family, AR/EN keywords and Turkish source terms. `-- --apply --yes --limit=100` attaches high/medium matches and archives merged scraper duplicates. | No by default / Supabase only with `--apply --yes` |

First-time setup: `catalog:csv` → `import:products` → `upload:images`.
Normal repeat sync: `import:products` → `upload:images` (no CSV, no price changes).

`upload:images` accepts `LIMIT=200 npm run upload:images` to cap a run.
`match:images` is read-only unless both `--apply` and `--yes` are provided.

### Identity, language & source of truth

- **Canonical product_code** = leading zeros stripped, so the scraper's
  `000000010001821004` and the CSV's `10001821004` are the same product. Both
  `catalog:csv` and `import:products` normalize codes, so the scraper attaches to
  the CSV product instead of duplicating it.
- **Customer/admin-facing language is Arabic/English** (CSV `english_name`,
  `arabic_name`, keywords). The Turkish scraped name is kept only as
  `source_name` (reference) and is never shown to customers.
- A product is **customer-visible** only when `status = 'active'` AND it has a
  price AND an Arabic/English name. Scraped-only products with just a Turkish
  name stay in **Product Review** until an admin adds an AR/EN name + price.
- **Supabase/admin is the source of truth.** `catalog:csv` is the explicit
  setup/recovery action; it only fills missing prices. Future scraper syncs never
  overwrite `base_price`, `active_price`, `campaign_price`, `status`, names,
  barcode or category.

## Field mapping

| Source | `products` column |
|--------|-------------------|
| CSV `Product Name` | `english_name` (customer/admin-facing) |
| CSV `Arabic Keywords` / `English Keywords` | `arabic_keywords` / `search_keywords` |
| CSV `Price` | `base_price` / `active_price` (L.D.) |
| CSV `Product Code` / `Barcode` | `product_code` (canonical) / `barcode` |
| scraper `product_name` | `source_name` (Turkish — reference only) |
| scraper `images[]` | `product_images.local_path` → uploaded to Storage |
| scraper `product_url` / `category` | `website_url` / `category` (reference) |
| whole source record | `products.raw` |
