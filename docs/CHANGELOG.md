# EH-SYSTEM1 — Changelog

Major system changes in reverse chronological order.

---

## 2026-07-15 — Central AI Control and campaign creative hardening

- Added a typed provider-neutral prompt compiler with exact AI Control text,
  task-scoped sections, structured runtime JSON, immutable policy/schema/tool
  boundaries, provenance, token estimate and prompt trace.
- Removed hidden configurable behavior from Gemini adapters and Messenger
  situation notes. Missing required configuration now fails visibly.
- Rebuilt AI Control as a complete prompt workbench with the production compiler preview.
- Simplified Campaign authoring to objective, caption, exact image text,
  source/product, and aspect/channel variables. Legacy prompt data is preserved
  but ignored by new generation and regeneration.
- Unified production and Playground campaign generation, retained the strongest
  image-model fallback chain, recorded requested/actual models, and added
  probabilistic product/text review with one low-fidelity retry.
- Added migration 0014 without overwriting existing behavior content or dropping historical data.

---

## 2026-07 — Full infrastructure ownership (Supabase/Vercel/Cloudflare → one VPS)

The platform went down when its free-tier database provider paused the
project. Rather than paying to restore a rented stack, the entire system was
migrated to owned infrastructure:

- **Database:** supabase-js/PostgREST → PostgreSQL 16 + Kysely with
  codegen'd types (typed queries end-to-end; the `(row as any)` casts at the
  DB boundary are gone). Schema stays plain SQL; migration 0013 drops the
  Supabase-era RLS/policies.
- **Auth:** Supabase Auth → env credentials + jose HS256 session cookie
  (single admin), verified in edge middleware.
- **Storage:** Supabase Storage → files on the VPS served by Caddy at
  `media.<domain>` with immutable caching; same `storage_path` keys.
- **Hosting:** Vercel → Next.js standalone in Docker behind Caddy
  (auto-HTTPS). Upgraded Next 14 → 16 (Turbopack), React 19, Tailwind 4.
- **Cron:** Cloudflare Worker → host crontab hitting the same route.
- **Backups:** nightly `pg_dump` + prune + optional offsite (rclone) —
  the database is the only non-rebuildable state.

External dependencies after the migration: Gemini API and Meta Graph. Verified
with the existing 34-assertion suite, 8 new DB behavioral smoke tests, and a
full authenticated page sweep against the standalone build.

## 2026-06-13 — Product image sending

- **The Messenger AI can now send real catalog product photos** when a customer asks to see them (`ابعثلي صورته`, `وريني الألوان`, `نبي نشوفهم`, `عندك صور للحمام؟`). New module `integrations/pipelines/product-image.ts` + `sendImageMessage()` in `integrations/meta/index.ts`.
- **Intent-gated:** `detectImageRequest()` — a price/availability question alone never sends images.
- **Backend controls the URLs;** Gemini composes only the caption. **Max 3 images** per turn, de-duped by product and URL, colour variants grouped.
- **Safe URLs only:** `isMetaSafeImageUrl()` requires public HTTPS (no local paths, no localhost, no `http://`). Only active + priced products are auto-sent.
- **Honest delivery state:** only successfully-sent images go into `messages.attachments`; failures recorded in `ai_meta.image_send` and `integration_logs`. `delivered_at` set only on a confirmed send.
- **Respects the supersede guard + batching** — image sends never duplicate or fire stale after a newer inbound message.
- **Manual Inbox action** `send_product_image` + a "Send image" button on every product candidate card.
- **AI Playground** now shows `image_request` and `would_send_images` (never sends). **AI Suggest** never auto-sends images.
- 7 new pure-logic tests (34 total).

---

## 2026-06-12 — Final production hardening pass

- **Supersede guard:** `deliverAndStore()` in `messenger.ts` now re-checks the latest inbound message ID before sending. If a newer message arrived while the AI turn was processing (matching + Gemini takes ~10s), the in-flight reply is abandoned without storing any outbound row. The unanswered batch remains intact for the superseding turn, which sends one combined reply. Eliminates the image + "بكم؟" double-reply race condition.
- **Delivery state:** AI auto-replies now stamp `messages.delivered_at` on confirmed Meta send (consistent with manual replies). Failed sends store `ai_meta.delivery_error`.
- **Dead i18n keys removed:** `nav_catalog_sync` key removed from EN and AR dictionaries.
- **Stale comment fixed:** `catalog-review/page.tsx` comment corrected (3 tabs, not 4).
- **Typecheck / build / tests:** all passing. Deployed to Vercel production.

---

## 2026-06-11 — Production cleanup and simplification (migration 0012)

### Removed features
- **Orders module** — `/orders` page, `create_order_draft` / `ai_draft_order` / `confirm_order` inbox API actions, `orders` and `order_items` tables. Data archived to `orders_archive` / `order_items_archive` before drop.
- **Catalog Sync** — `/api/catalog-sync` route, `lib/sync/runner.ts`, Catalog Sync page and Sync tab. Catalog import is now local-only via `scripts/`.
- **Facebook comments workflow** — `comment_reply_rules` column on `campaigns`, all code references.
- **Hard-coded Arabic reply templates** — `adminRequiredReply()`, string-concatenated option builders in `context-followup.ts`. All customer-visible text is now composed by Gemini.
- **Random product fallback** in `image-match.ts` — when no signal yields candidates, the AI asks a clarifying question instead of presenting arbitrary products.
- **Tables dropped:** `escalations`, `product_variants`, `ai_settings`.
- **Column dropped:** `conversations.order_draft_id`.

### Added
- Auth middleware gate (`admin-app/src/middleware.ts`) protecting all `/dashboard/*` and `/api/*` routes.
- Positive price validation on `POST /api/products` and `PATCH /api/products/[id]`.
- `campaign_assets` unique constraint on `(campaign_id, product_id, kind)` — prevents duplicate assets on re-attach.
- Partial index on `products(active_price) WHERE status='active' AND active_price IS NOT NULL` — speeds up customer-visible product queries.

### Fixes
- Analytics page removed references to dropped `orders`/`order_items` tables.
- `deliver_at` stamped on human manual replies.
- `router.refresh()` removed from `ConversationWorkspace` — no more inbox flickering.
- AI Suggest uses the same `messenger` behavior task as auto-reply.
- Inbox `suggest_reply` aligned with Messenger auto-reply quality.

---

## 2026-05 — Frontend redesign

- Dark-theme redesign with mobile-first inbox layout.
- Chat-first mobile layout: thread fills screen, composer pinned bottom, right-rail panels accessible via drawer on small screens.
- Dashboard redesigned around operational workflow.
- `router.refresh()` calls replaced with local-state polling using `AbortController`.
- Right rail restructured: AI Controls / Customer Memory / Customer Info / Product Candidates.

---

## 2026-04 — AI brain rebuild (migration 0009)

- Gemini model routing centralized in `integrations/gemini/client.ts`.
- `customer_memory` table — per-customer persistent memory, loaded into every turn.
- `products.text_embedding` — semantic vector embeddings via `gemini-embedding-001`.
- `product_fingerprints` — perceptual hash learning from admin corrections.
- Image-match pipeline rebuilt: 8-step hybrid pipeline, no random fallback.
- `compose-reply.ts` — single canonical customer-reply path at temperature 0.7.
- `ai_behaviors` table replaces `ai_settings`.
- Hard safety rules enforced in every customer-facing prompt.
- AI Playground rebuilt with real-pipeline trace and debug panel.

---

## 2026-03 — Facebook comments removal (migration 0010)

- `facebook_comments` table dropped.
- Comment auto-reply behavior rows removed from `ai_behaviors`.
- `/facebook/comments` page deleted.
- Messenger and campaign publishing unaffected.

---

## Known future work

- `conversation_status` enum still contains order-era values (`order_draft`, `order_confirmed`, `waiting_for_order_confirmation`). These are inert (never written) but cannot be cleanly dropped in Postgres without a migration that re-creates the enum. Cosmetic — no functional impact.
- `products.raw` column stores full scraper JSON blobs. Not read at runtime. Can be dropped in a future maintenance migration after verifying no external tools depend on it.
- Vector search uses JSONB float arrays + app-level cosine (no pgvector). Sufficient at current catalog size. Can be upgraded to pgvector + HNSW when scale requires it — no API contract change.

## Platform upgrade — Instagram, Content Studio, durable processing

**Customer service**
- Instagram Direct added as a first-class channel alongside Messenger.
- Order intent now sends **one** WhatsApp handoff message, flags the
  conversation for the team, and lets the assistant keep answering ordinary
  product questions until an admin presses Take Over. The system never creates,
  confirms or manages orders.
- Explicit Take Over / Resume AI controls; resuming keeps the full context.

**Reliability**
- Webhook now persists events before acknowledging; a database outage returns
  503 so Meta retries instead of losing the message.
- Durable PostgreSQL job queue and transactional outbox replace in-memory
  debouncing and in-request sending: one reply per burst, no duplicate sends,
  and ambiguous outcomes surfaced rather than silently retried.
- Exactly-once Facebook/Instagram publishing with resumable multi-step flows.

**Catalog**
- Product families, variants and relations with permanent admin corrections.
- Versioned price history and a promotion model that restores prices correctly
  and never overwrites a later manual or CSV price.
- CSV import applies unlocked fields automatically and honours admin locks.
- Full-catalog indexed retrieval; the previous 1k/2k/5k/8k scan caps are gone.

**Content Studio** replaces Campaigns: posts and Stories, price-drop and general
purposes, deterministic Arabic typography for exact prices, Africa/Tripoli
scheduling, and automatic comment replies limited to content this app published.

**Security**
- Multi-admin accounts with revocable database-backed sessions, login rate
  limiting and a per-admin audit log.
- Authentication now fails closed without `SESSION_SECRET`.
- SSRF-safe image fetching, upload validation, secret scanning in CI.

**Removed:** the scraper as an active feature, campaign/catalog/image/price
review queues, and the cron endpoint. Historical campaign data is retained and
surfaced in Content Studio as archived items; catalog images were not deleted.
