# EH-SYSTEM1 — Catalog and Products

---

## Price truth

**The Libya CSV catalog is the only price authority.**

- `products.base_price` — set by `scripts/catalog:csv` import, or by admin override via `/api/products/[id]/price`.
- `products.active_price` — the price customers see. Equals `base_price` when no campaign is active, or `campaign_price` when a campaign overrides it.
- `products.campaign_price` — cached by `fn_refresh_product_pricing()` when a campaign is active.

**Never trust:** Turkish scraper prices, AI-extracted prices, or customer-stated prices. The pipeline hard-guards this — Gemini reads `active_price` from the database via the `getProductPrice` tool and never invents one.

---

## Product fields

| Column | Source | Notes |
|--------|--------|-------|
| `product_code` | CSV / scraper (canonical) | Leading zeros stripped for dedup |
| `barcode` | CSV / scraper | |
| `english_name` | CSV | Customer/admin-facing |
| `arabic_name` | CSV | Customer/admin-facing |
| `libyan_display_name` | CSV / admin | Used by `customerProductName()` first |
| `source_name` | Scraper | Turkish name — reference only, never shown to customers |
| `base_price` | CSV / admin | Libya Dinar (LYD) |
| `active_price` | Computed | `base_price` or `campaign_price` |
| `status` | Import / admin | `active` = customer-visible; `draft` = hidden pending review |
| `text_embedding` | Script | 768-dim Gemini embedding for semantic search (JSONB float array) |
| `admin_locked_fields` | App | JSONB set of field names that import scripts must not overwrite |
| `raw` | Scraper | Full JSON import record — not read at runtime; kept for provenance |
| `website_url` | Scraper | Turkish product URL — identity/recognition signal |

A product is **customer-visible** only when `status = 'active' AND active_price IS NOT NULL`. The AI never surfaces draft or unpriced products to customers.

---

## Turkish scraper identity

The scraper (`../english-home-tr-scraper`) is a separate project. This app never runs it. The scraper provides:
- Product code, barcode, English name, website URL, images, category.

These are **identity signals** — they help match and recognize products. They do not override prices, status, or Arabic names.

When a scraper product is imported:
- If a catalog product with the same canonical code/barcode already exists, the scraper row attaches its images and source metadata to it.
- If no catalog match exists, the scraper row creates a `draft` product with no price, no Arabic name — it appears in **Catalog Review → Prices** for the admin to complete.

---

## Import scripts (local only)

Run from `EH-SYSTEM1/scripts/`. None of these are deployed or triggered from the web app.

| Command | What it does |
|---------|-------------|
| `npm run catalog:csv` | **Main catalog import.** Imports the Libya CSV as active, priced products. Fills `english_name`, `arabic_name`, `arabic_keywords`, `base_price`, `active_price`. Respects `admin_locked_fields` — never overwrites an admin-set price. |
| `npm run import:products` | Scraper sync. New scraped products → inserted as `draft`. Existing products → source metadata + images updated only. Never overwrites price, status, names, barcode, or category. |
| `npm run upload:images` | Uploads local scraper images to Supabase Storage (`eh-media` bucket), fills `product_images.public_url`. |
| `npm run embeddings` | Generates semantic vector embeddings for all products and stores in `products.text_embedding`. Run after catalog imports. |
| `npm run match:images` | Dry-run: suggests scraper images for catalog products missing images. Use `--apply --yes` to attach. |
| `npm run validate` | Dry run of product import — shows what would happen without writing. |

**First-time setup order:** `catalog:csv` → `import:products` → `upload:images` → `embeddings`.

**Repeat sync order** (no new CSV, just scraper updates): `import:products` → `upload:images`.

---

## Product matching in AI

When the AI receives a customer inquiry, it resolves the product through `resolveProductsFromText()`:

1. URL → exact `website_url`, then code/barcode from URL path.
2. Exact product code or barcode typed in the message.
3. Keyword search (Arabic + English + Turkish names, `arabic_keywords`, `search_keywords`).
4. Semantic vector search (embedding of the query against `products.text_embedding`).

For image messages, `matchCustomerImage()` runs a separate 8-step pipeline (see `AI_AND_MESSENGER.md`).

---

## Catalog match workflow

`/catalog-match` — matches scraper-discovered products to the Libya catalog.

1. Automatic matching runs when scraper products are imported (`import:products`).
2. High-confidence matches land in **Possible** state.
3. Admin reviews: **Approve** (links scraper images to catalog product), **Reject**, or marks as **No match**.
4. **Bulk approve** approves all high-confidence pending matches at once.

Once approved, the catalog product gains the scraper's images and is visible in Image Review.

---

## Image review and fingerprint learning

`/image-review` — when the AI matched the wrong product from a customer image:

1. Admin opens Image Review, sees the correction history.
2. Alternatively, directly in the Inbox conversation, click "Correct" on a wrong candidate.
3. Pick the correct product.

This creates:
- An `image_match_corrections` row (audit log).
- A `product_fingerprints` row with the customer image's perceptual hash.

Next time the same image (or a near-duplicate) arrives, step 3 of the image-match pipeline finds it via the fingerprint and returns the correct product directly — no Gemini call needed.

---

## Missing price handling

A product with `active_price = NULL` stays `draft` and appears in **Catalog Review → Prices** for activation.

The AI may discover such a product during a customer query. The hard safety rule: **never quote a price for a missing-price product**. Gemini is told to say the price will be confirmed by the team and to route the conversation to `needs_human`.

To activate a product: open `/price-review`, enter the LYD price, and click Activate. The product becomes `active` with the price and is immediately customer-visible.

---

## Manual product add and edit

**Add a product:** click "+ Add product" on `/products`. Fill name, code, barcode, category, price, status.

**Edit a product:** open a product from `/products`, edit any field, save.

Any field set via the admin UI is marked in `admin_locked_fields`. Import scripts check this field before writing and skip locked columns. Admin-set prices and names are never overwritten by a subsequent `catalog:csv` or `import:products` run.

---

## Product images for customer sending

When the AI (or admin) sends a product photo to a customer, the image URL must be **publicly fetchable over HTTPS** — Meta downloads it server-side.

- The image is chosen by `primaryProductImageUrl()`: prefers `is_primary`, then lowest `position`, then the first valid image. It uses `product_images.public_url`, falling back to the public Storage URL derived from `storage_path`.
- `isMetaSafeImageUrl()` rejects anything that is not HTTPS, plus localhost and local file paths — these are never sent to a customer.
- For images to be sendable, run `npm run upload:images` so `public_url` is populated, and keep the `eh-media` Storage bucket **public (read)**.
- Only `status = 'active'` products with a price are auto-sent as photos. Draft/unpriced products are not auto-sent.

See `AI_AND_MESSENGER.md` → Product image sending for the full behaviour.

## Admin lock fields

`products.admin_locked_fields` is a JSONB array of column names: e.g. `["base_price", "english_name"]`.

`integrations/product-locks.ts` — `withLocks(product, update)` strips locked fields from any update. `stripLockedFields(fields, locked)` removes locked keys from a set of proposed changes.

Import scripts call these helpers before writing. API routes call them too. The result: admin decisions are sticky.
