# EH-SYSTEM1 — Supabase Schema Map

Source of truth: `database/schema.sql`. Incremental changes: `database/migrations/`.
TypeScript row types: `integrations/supabase/types.ts`.

> RLS is **enabled on every table**. The Next.js admin app reads through the
> **service-role key** (bypasses RLS) so the admin always sees real data. Browser
> clients use the anon key (RLS-bound). Never expose the service-role key to the
> browser.

---

## Core messaging tables

### `customers`
One row per unique channel+PSID combination.

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `channel` | `messenger \| facebook_comment \| instagram \| manual` |
| `external_id` | Messenger PSID or equivalent |
| `display_name`, `first_name`, `last_name` | Profile data (fetched via Graph API) |
| `phone`, `address`, `city` | Collected during order flow |
| `is_blocked` | If true, inbound messages from this customer are silently dropped |
| `tags` | Admin-assigned string array |

**Writers:** `pipelines/messenger.ts` (upsert on every inbound).
**Readers:** inbox pages, conversation workspace.

---

### `conversations`
One per customer thread. A new conversation is opened if no open one exists.

| Column | Notes |
|--------|-------|
| `customer_id` | FK → customers |
| `channel` | Mirrors customer channel |
| `status` | Enum (see below) |
| `ai_enabled` | Boolean — the AI on/off toggle per conversation |
| `detected_intent` | Last Gemini-classified intent |
| `customer_language` | Gemini-detected language code |
| `last_message_at` / `last_message_preview` | Used for inbox sort + preview |
| `order_draft_id` | FK → orders (when an order draft is attached) |

**`conversation_status` enum values:**
`new`, `ai_handling`, `needs_human`, `human_active`, `waiting_for_customer`,
`order_draft`, `order_confirmed`, `pickup_requested`, `delivery_requested`,
`resolved`, `spam`, `blocked`, `waiting_for_order_confirmation`,
`completed`, `cancelled`, `waiting_for_customer_info`, `issue_refund_exchange`

**Writers:** `pipelines/messenger.ts`, `api/inbox/[conversationId]/route.ts`.
**Readers:** inbox pages, ConversationWorkspace component.

---

### `messages`
Every inbound and outbound message, including AI-generated suggestions.

| Column | Notes |
|--------|-------|
| `conversation_id` | FK → conversations |
| `direction` | `inbound \| outbound` |
| `sender_type` | `customer \| ai \| human \| system` |
| `body` | Text content (null for image-only) |
| `attachments` | JSONB array of `{ type, url }` objects |
| `ai_meta` | JSONB diagnostics blob (model, behavior keys, timing, workflow, etc.) |
| `is_internal_suggestion` | `true` = AI generated but NOT sent (Meta not configured, or AI paused) |
| `external_id` | Messenger mid — used for deduplication |

**Writers:** `pipelines/messenger.ts` (both inbound ingest and outbound store).
**Readers:** ConversationWorkspace, inbox API route.

---

### `escalations` (legacy compatibility)
Legacy table kept for old records only. The current Messenger pipeline does not
write automatic escalation rows. Current handoff state lives on `conversations`
as `status='needs_human'` plus `ai_enabled=false`, with the reason stored in
`detected_intent` / `context_summary` and outbound `messages.ai_meta`.

| Column | Notes |
|--------|-------|
| `conversation_id` | FK → conversations |
| `category` | Enum: `customer_requested_human \| complaint_refund_exchange \| abuse_bad_words \| order_confirmation \| ...` |
| `reason` | Free-text from Gemini intent classification |
| `suggested_action` | Gemini suggestion for the human agent |
| `resolved` | Admin marks true when handled |

**Writer:** none in the current pipeline.
**Reader:** inbox detail may show old rows as "legacy follow-up record".

---

## Product catalog tables

### `products`
The central product record. CSV products are the priced source of truth.
Scraper products have images but typically no price (they need catalog matching).

| Column | Notes |
|--------|-------|
| `product_code` | SKU / admin identifier |
| `barcode` | EAN/UPC |
| `libyan_display_name` | **Customer-facing name** (preferred) — Libyan/Levantine Arabic |
| `arabic_name` | Fallback Arabic name |
| `english_name` | English name |
| `source_name` | Original Turkish name from scraper (NEVER shown to customers) |
| `status` | `active \| draft \| archived \| out_of_stock` |
| `base_price` | Admin-set price in LYD |
| `campaign_price` | Cached discounted price (updated by scheduler) |
| `active_price` | Cached final price = campaign_price ?? base_price |
| `admin_locked_fields` | JSONB: `{ libyan_display_name: true, base_price: true, … }` |
| `search_keywords` / `arabic_keywords` | Arrays of search terms |
| `website_url` | English Home Libya website link |

**Admin-locked fields:** once an admin edits a field, it is recorded in
`admin_locked_fields`. Automated writers (scraper sync, CSV re-import) must
call `stripLockedFields()` before updating, so admin decisions are never
silently overwritten. Source: `integrations/product-locks.ts`.

**Writers:** `api/products/[productId]/route.ts`, import scripts, sync runner.
**Readers:** image-match pipeline, product-resolve pipeline, all product pages.

---

### `product_images`
One row per image per product. Multiple images allowed; one is `is_primary`.

| Column | Notes |
|--------|-------|
| `product_id` | FK → products |
| `public_url` | Full public URL in Supabase Storage |
| `storage_path` | Storage object path (for signed URLs / re-generation) |
| `is_primary` | One image per product should be primary |
| `position` | Display order |
| `perceptual_hash` | dHash fingerprint — drives image-similarity matching |

**Writers:** upload script, image-review route.
**Readers:** image-match pipeline (scans all hashes for near-duplicate detection).

---

## AI and automation tables

### `ai_behaviors`
Admin-configurable prompts + rules for each AI task. One row per `behavior_key`.

| Column | Notes |
|--------|-------|
| `behavior_key` | One of: `customer_service`, `reply_language`, `product_recommendation`, `image_matching`, `campaign_caption`, `campaign_image`, `missing_price`, `memory_context` (the `facebook_comment` + `escalation` rows were removed) |
| `title` | Human-readable label |
| `prompt` | The behavior's system prompt text |
| `rules` | Additional policy rules (appended to prompt) |
| `memory` | Background context the AI keeps in mind |
| `enabled` | Disabled rows are treated as absent (caller falls back to defaults) |

**Writers:** `api/ai/behaviors/route.ts` (admin edits via AI Control page).
**Readers:** `integrations/ai-behaviors.ts` (all live pipelines + playground).

---

### `ai_events`
One row per Gemini call, for latency tracking and analytics.

| Column | Notes |
|--------|-------|
| `kind` | `intent \| vision \| chat \| ...` |
| `conversation_id` / `related_id` | Context FK |
| `model` | Gemini model string used |
| `detected_intent` | Classification result |
| `latency_ms` | Gemini call latency |
| `success` | Boolean |

**Writer:** `pipelines/messenger.ts`.
**Reader:** analytics page.

---

### `image_match_corrections`
Admin corrections to image-match results — the system learns from these.

| Column | Notes |
|--------|-------|
| `conversation_id` / `message_id` | Source message |
| `customer_image_url` | URL of the image the customer sent |
| `customer_image_hash` | dHash of the customer image |
| `ai_suggested_product_ids` | Array of what the AI suggested |
| `corrected_product_id` | What the admin confirmed was correct |
| `outcome` | `exact \| multiple \| none` |

The next time a customer sends a near-identical image (Hamming distance ≤ threshold),
the pipeline matches it directly to the corrected product without calling Gemini.
Source: `pipelines/image-match.ts` → `findByCorrectionMemory()`.

**Writer:** `api/image-review/[correctionId]/route.ts`.
**Reader:** image-match pipeline, image-review page.

---

## Campaign tables

### `campaigns`
One row per marketing campaign.

| Column | Notes |
|--------|-------|
| `type` | `single_product_discount \| multi_product_carousel \| category_sale \| ...` |
| `status` | `draft \| scheduled \| publishing \| published \| paused \| archived \| failed` |
| `discount_percent` | Applied to product prices when campaign is active |
| `starts_at` / `ends_at` | Campaign window — scheduler uses these |
| `auto_publish` | If true, scheduler publishes at `starts_at` automatically |

---

### `campaign_assets`
Images attached to a campaign (uploaded, from product gallery, or AI-generated).

| Column | Notes |
|--------|-------|
| `campaign_id` | FK → campaigns |
| `public_url` | Storage URL |
| `position` | Display/post order |
| `approved` | Admin approval flag (migration 0008) |

---

### `facebook_posts`
Post drafts for a campaign. Created by `prepareCampaignPosts()`, published by `publishPost()`.

| Column | Notes |
|--------|-------|
| `campaign_id` | FK → campaigns |
| `fb_post_id` | Returned by Meta Graph API after successful publish |
| `status` | `draft \| published \| scheduled \| failed` |
| `asset_ids` | Ordered array of `campaign_assets.id` values |

---

> `facebook_comments` was dropped in the AI rebuild (migration
> `0010_remove_facebook_comments.sql`). The comments feature is gone; Messenger,
> `facebook_posts` and campaign publishing remain.

---

## AI brain tables (migration `0009_ai_brain.sql`)

### `customer_memory`
One row per customer — persistent AI memory used in every turn.

| Column | Notes |
|--------|-------|
| `customer_id` | FK → customers (unique) |
| `summary` | Rolling AI summary of the customer |
| `recent_products` | JSONB array of recently resolved products (newest first, ≤10) |
| `preferences` | JSONB key/value (e.g. preferred_color) |
| `known_facts` | text[] durable facts |
| `known_name` / `known_phone` / `known_address` | Captured contact info |

**Writer:** `pipelines/messenger.ts` (after each turn), inbox memory actions.
**Reader:** `pipelines/messenger.ts`, image-match, playground, inbox memory panel.

### `product_fingerprints`
Admin-confirmed customer-image hashes → product (the image-match learning loop).

| Column | Notes |
|--------|-------|
| `product_id` | FK → products |
| `hash_hex` | dHash of a confirmed customer image |
| `source` | `admin_correction` \| `upload` |
| `correction_id` | FK → image_match_corrections |

**Writer:** `tools/corrections.ts saveImageCorrection` (image-review + inbox correction).
**Reader:** `pipelines/image-match.ts` (learned-fingerprint match).

### `products.text_embedding`
Real semantic embedding (JSON float array) for vector search. NULL until
`scripts/generate-embeddings.ts` runs. No pgvector — cosine is computed in code.

---

## Catalog matching tables

### `catalog_match_suggestions`
One row per CSV-product-that-needs-an-image, with the best scraper candidate match.

| Column | Notes |
|--------|-------|
| `csv_product_id` | FK → products (the CSV/priced product) |
| `scraper_product_id` | FK → products (the scraper image-source product) |
| `score` | Numeric match confidence |
| `state` | `possible \| approved \| rejected \| no_match \| needs_review` |

State transitions are admin actions; `refreshSuggestions()` preserves `approved` /
`rejected` / `needs_review` rows across re-runs.

---

## Supporting tables

| Table | Purpose |
|-------|---------|
| `orders` | Order drafts extracted by AI from conversations |
| `order_items` | Line items within an order |
| `integration_logs` | Inbound/outbound Meta API error log (never for successes) |
| `activity_logs` | Audit trail for admin actions (human replies, corrections, memory edits, etc.) |
| `import_runs` | Tracks each CSV/scraper import run (counts, errors, timing) |

---

## Key Postgres functions/views

| Name | Purpose |
|------|---------|
| `fn_active_price(product_id)` | Computes the real active price from campaigns |
| `fn_refresh_product_pricing()` | Bulk-updates `active_price` / `campaign_price` on all products |
| `product_active_pricing` view | Real-time price view (not cached) |

`fn_refresh_product_pricing()` is called by the campaign scheduler on every tick
and by the campaign API routes after publish. Do not call it from user-facing
request paths — it updates every product row and can be slow.

---

## Migration history

| File | What it adds |
|------|-------------|
| `0001_init.sql` | All base tables from schema.sql |
| `0002_price_review_staging.sql` | Price staging workflow columns |
| `0003_catalog_match_suggestions.sql` | `catalog_match_suggestions` table + `CatalogMatchState` type |
| `0004_admin_locked_fields.sql` | `admin_locked_fields` JSONB column on products |
| `0005_ai_behaviors.sql` | `ai_behaviors` table (replaces per-behavior settings) |
| `0006_message_batching.sql` | Columns to support burst-debounce message batching |
| `0007_image_fingerprints.sql` | `perceptual_hash` column on `product_images` |
| `0008_campaign_asset_review.sql` | `approved` column on `campaign_assets` |
