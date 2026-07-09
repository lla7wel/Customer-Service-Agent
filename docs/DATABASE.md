# EH-SYSTEM1 — Database

**Schema source of truth:** `database/schema.sql`
**TypeScript types:** `integrations/supabase/types.ts`
**Migrations:** `database/migrations/0001` – `0012` (apply in order)

RLS is enabled on every table. The admin app reads via the service-role key (bypasses RLS). Browser clients use the anon key (RLS-bound). The `middleware.ts` auth gate is the real security boundary — never bypass it.

---

## Active tables

### Messaging

| Table | Purpose |
|-------|---------|
| `customers` | One row per unique Messenger PSID. Holds profile data, `is_blocked` flag, tags. |
| `conversations` | One per customer thread. Holds `ai_enabled`, `status`, `detected_intent`, `last_message_at`, `next_turn_at` (batching deadline). |
| `messages` | Every inbound and outbound message. `direction` (inbound/outbound), `sender_type` (customer/ai/human), `external_id` (Messenger mid, unique for dedup), `delivered_at` (set on confirmed Meta send), `is_internal_suggestion` (true = not sent), `ai_meta` (diagnostics, delivery_error). |
| `conversation_labels` | Admin-assigned labels per conversation. |
| `conversation_attachments` | Products attached to a conversation by admin or AI. |

**`conversation_status` enum:** `new`, `ai_handling`, `needs_human`, `human_active`, `waiting_for_customer`, `resolved`, `spam`, `blocked`, `waiting_for_customer_info`, `issue_refund_exchange`, plus legacy order-era values that remain in the enum definition but are never written (`order_draft`, `order_confirmed`, `waiting_for_order_confirmation`, `pickup_requested`, `delivery_requested`, `completed`, `cancelled`).

### Products

| Table | Purpose |
|-------|---------|
| `products` | Main catalog. Key columns: `product_code`, `barcode`, `english_name`, `arabic_name`, `libyan_display_name`, `base_price`, `active_price`, `campaign_price`, `active_campaign_id`, `status` (active/draft/needs_review), `text_embedding` (semantic vector as JSONB float array), `admin_locked_fields` (JSONB — fields an admin has set manually; import scripts must not overwrite). |
| `product_images` | One or more images per product. `public_url` (Supabase Storage), `perceptual_hash` (dHash for fingerprinting), `is_primary`. |
| `product_fingerprints` | Learned perceptual hashes from admin image corrections. Feed into future image matching. |
| `image_match_corrections` | Audit log of admin corrections (customer image → wrong match → correct product). |
| `product_import_runs` | Audit log of each catalog import run (script, row count, timestamp). |
| `catalog_match_suggestions` | Pending/reviewed matches between scraper products and CSV catalog products. States: `possible`, `approved`, `rejected`, `no_match`. |

### Campaigns and marketing

| Table | Purpose |
|-------|---------|
| `campaigns` | Campaign metadata: name, dates, discount, status (draft/scheduled/publishing/published/failed). |
| `campaign_products` | Products attached to a campaign, with optional `override_price`. |
| `campaign_assets` | Images (uploaded or AI-generated) for a campaign. Unique constraint on `(campaign_id, product_id, kind) WHERE product_id IS NOT NULL` prevents duplicate assets. |
| `facebook_posts` | Log of Facebook posts created from campaigns. |

### AI and system

| Table | Purpose |
|-------|---------|
| `ai_behaviors` | Live-editable Gemini behavior configurations. Loaded fresh on every AI call. Changes apply immediately without redeployment. |
| `customer_memory` | Per-customer persistent memory: rolling summary, recent products, known name/phone/address, preferences. |
| `ai_events` | Structured log of every Gemini call: kind, model, latency, success, intent, tokens. |
| `activity_logs` | Human-readable activity feed: messages sent, products matched, campaigns generated. |
| `integration_logs` | Low-level integration events: Meta sends/failures, Gemini errors, Supabase errors. |
| `admin_users` | One row per admin (linked to Supabase Auth user UUID). Role: `admin`. |

---

## Archive tables (data preserved, not active)

| Table | Created by | Contains |
|-------|-----------|---------|
| `orders_archive` | Migration 0012 | Snapshot of `orders` before the table was dropped |
| `order_items_archive` | Migration 0012 | Snapshot of `order_items` before the table was dropped |

These can be exported and dropped in a future maintenance window once you are satisfied the data is not needed.

---

## Dropped tables (removed in migration history)

| Table | Removed | Reason |
|-------|---------|--------|
| `orders` | 0012 | Orders module removed; data in `orders_archive` |
| `order_items` | 0012 | Same |
| `escalations` | 0012 | No active writer since pipeline was rewritten; UI read removed |
| `product_variants` | 0012 | FK-only schema artifact, never written |
| `ai_settings` | 0012 | Fully replaced by `ai_behaviors` |
| `facebook_comments` | 0010 | Comments feature removed |

---

## Migration history

| Migration | What it does |
|-----------|-------------|
| `0001_init` | Full initial schema |
| `0002_price_review_staging` | Price staging and activation flow |
| `0003_catalog_match_suggestions` | Scraper↔CSV match workflow |
| `0004_admin_locked_fields` | `admin_locked_fields` JSONB on products |
| `0005_ai_behaviors` | `ai_behaviors` table (replaces `ai_settings`) |
| `0006_message_batching` | `conversations.next_turn_at` for burst debouncing |
| `0007_image_fingerprints` | `product_fingerprints`, `perceptual_hash` on `product_images` |
| `0008_campaign_asset_review` | Campaign asset review workflow |
| `0009_ai_brain` | `customer_memory`, `products.text_embedding`, `product_fingerprints`, lookup indexes |
| `0010_remove_facebook_comments` | Drops `facebook_comments`, removes obsolete behavior rows |
| `0011_attachments_and_indexes` | `conversation_attachments` table + performance indexes |
| `0012_production_cleanup` | Archives+drops orders, drops escalations/product_variants/ai_settings, drops `conversations.order_draft_id`, drops `campaigns.comment_reply_rules`, adds unique constraint on campaign_assets, adds active/priced product index |

---

## Pricing model

`active_price` is the only price shown to customers. It is computed and cached by `fn_refresh_product_pricing()`:

1. Find active campaigns containing the product.
2. Pick the winner: highest `priority`, tie-break by latest `starts_at`.
3. `campaign_price = override_price` from `campaign_products`, or `round(base_price * (1 - discount_percent/100), 2)`.
4. `active_price = coalesce(campaign_price, base_price)`.

The function is called by the campaign scheduler before publishing and after campaign edits. `campaign_price` and `active_campaign_id` are cached on the product row so inbox/product list reads are fast.

**Source of truth:** the Libya CSV catalog sets `base_price`. The admin may override via `/api/products/[id]/price`. Overrides are locked (`admin_locked_fields`) so import scripts cannot overwrite them.

---

## What not to manually edit in Supabase

- **`products.active_price`** — set by import scripts and `fn_refresh_product_pricing`. Manual edits bypass the lock and campaign-override logic.
- **`ai_behaviors`** — edit via `/ai-control` in the admin app, not directly in Supabase. The app validates the schema.
- **`messages`** — audit log; do not edit or delete rows.
- **`ai_events` / `activity_logs` / `integration_logs`** — append-only audit tables.
- **Applied migrations** — never modify a file in `database/migrations/` that has already been run. Write a new migration instead.
- **`database/schema.sql`** — represents the baseline schema. Modify only via migrations.
