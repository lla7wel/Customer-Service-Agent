# EH-SYSTEM1 — Editing Guide

Use this guide before editing any file. Files are grouped by risk level.

---

## CRITICAL — Do not edit without a full plan

These files contain live-customer business logic that is shared across multiple
entry points. A mistake here silently breaks both the Next.js app and the
Cloudflare workers.

| File | Why critical |
|------|-------------|
| `integrations/pipelines/messenger.ts` | The entire Messenger agent loop. Changes here affect every inbound customer message. |
| `integrations/pipelines/image-match.ts` | The canonical image → product matcher. Both the live pipeline and the Playground call this exact function. |
| `integrations/pipelines/product-resolve.ts` | Text/URL → catalog resolver (code/barcode/url/keyword/vector) used in every product-question reply. |
| `integrations/pipelines/agent-policy.ts` | Decides image turn vs. text turn (no escalation). Pure logic but high impact. |
| `integrations/tools/` | Controlled DB tools (product lookups, vector search, memory, correction learning). The AI's only catalog access. |
| `integrations/pipelines/campaign.ts` | Campaign publish + pricing refresh. Writes to Meta and triggers `fn_refresh_product_pricing`. |
| `integrations/gemini/index.ts` | All AI functions incl. `chatReplyWithTools` + `embedText`. Changing prompts, token limits, or temperature affects every customer reply. |
| `integrations/gemini/client.ts` | Low-level Gemini HTTP client. Do not touch unless the API contract changes. |
| `integrations/meta/index.ts` | All Meta Graph API calls. A bug here can corrupt sends or fail webhook verification. |
| `integrations/ai-behaviors.ts` | Behavior loader + prompt composer used by all pipelines. |
| `integrations/product-locks.ts` | Admin-lock enforcement. A bug silently lets automated writers overwrite admin decisions. |
| `integrations/flags.ts` | Runtime flags. Only batching flags remain; do not add gating logic here. |
| `database/schema.sql` | Full schema. Never edit in production — use `database/migrations/` instead. |
| `database/migrations/*.sql` | Applied migrations. Do not modify an already-applied migration. |

---

## HIGH RISK — Edit carefully; test end-to-end before deploying

These files don't touch customers directly but affect data integrity or security.

| File | Risk |
|------|------|
| `admin-app/src/app/api/meta/webhook/route.ts` | CANONICAL webhook entry. Changing signature verification or routing drops messages or opens the endpoint. |
| `admin-app/src/app/api/products/[productId]/price/route.ts` | Activates products into the live catalog. Wrong logic makes unready products customer-visible. |
| `admin-app/src/app/api/products/[productId]/route.ts` | Product CRUD with admin-lock writes. |
| `admin-app/src/app/api/campaigns/[campaignId]/route.ts` | Campaign publish. Calls Meta Graph API. |
| `admin-app/src/app/api/cron/campaign-scheduler/route.ts` | Runs the pricing refresh + auto-publish. Has auth check — do not remove it. |
| `admin-app/src/lib/catalog-match-store.ts` | Manages match workflow state. Admin decisions (approved/rejected) are persisted here. |
| `integrations/supabase/admin-client.ts` | Service-role client. Never move its import into a client component. |
| `integrations/util/customer-text.ts` | Outbound safety sanitizer. Weakening it lets system text leak to customers. |

---

## MEDIUM RISK — Edit with normal care; logic matters

| File | Notes |
|------|-------|
| `admin-app/src/app/api/catalog-match/approve/route.ts` | Writes approved state to catalog_match_suggestions. |
| `admin-app/src/app/api/catalog-match/refresh/route.ts` | Re-runs the matcher — can be slow on large catalogs. |
| `admin-app/src/app/api/ai/behaviors/route.ts` | Admin CRUD for live behavior prompts. |
| `admin-app/src/app/api/ai/playground/route.ts` | Playground calls Gemini live; watch token costs. |
| `admin-app/src/app/api/image-review/[correctionId]/route.ts` | Writes corrections that train image matching going forward. |
| `admin-app/src/lib/ai-behaviors.ts` | Service-role behavior loader used by all admin pages. |
| `admin-app/src/lib/readiness.ts` | Go-live checklist logic. |
| `admin-app/src/lib/catalog-match-store.ts` | Match workflow store. |
| `integrations/catalog-match.ts` | Pure scoring engine. Changing score weights affects match quality across all products. |
| `integrations/util/image-hash.ts` | dHash + Hamming distance. Changing thresholds (`NEAR_DUPLICATE_MAX`, `SIMILAR_MAX`) changes what counts as "same image". |
| `integrations/util/base64.ts` | Image downloader for the vision pipeline. |
| `integrations/status.ts` | Integration health. Missing var → 503 everywhere; spurious configured → sends go live unexpectedly. |

---

## LOWER RISK — Safer to edit; mostly display and utilities

These files contain display logic, UI layout, or pure utilities with no
irreversible side effects.

| File | Notes |
|------|-------|
| `admin-app/src/components/ui.tsx` | Shared primitive components — changes affect every page visually. |
| `admin-app/src/components/Sidebar.tsx` / `Topbar.tsx` / `MobileNav.tsx` | Layout and navigation. |
| `admin-app/src/components/dashboard/SystemStatus.tsx` | Display-only. |
| `admin-app/src/components/inbox/ConversationWorkspace.tsx` | Client component — calls inbox API route. Keep API calls as-is. |
| `admin-app/src/components/catalog/CatalogMatch.tsx` | Match review UI — calls catalog-match API routes. |
| `admin-app/src/components/campaigns/CampaignBuilder.tsx` | Campaign form — calls campaign API routes. |
| `admin-app/src/lib/data.ts` | Generic `fetchRows()` helper. Very stable. |
| `admin-app/src/lib/format.ts` | Date/currency formatters. Safe. |
| `admin-app/src/lib/nav.ts` | Sidebar navigation items. Safe. |
| `admin-app/src/lib/status-tone.ts` | Status → colour mapping. Safe. |
| `admin-app/src/lib/theme.ts` / `theme-server.ts` | Theme helpers. Safe. |
| `admin-app/src/lib/i18n/` | Translations and locale config. Safe. |
| `admin-app/src/lib/product-candidates.ts` | UI row-shaping utilities. Safe. |
| `integrations/env.ts` | Env reader. Very stable — only change if adding a new env source. |
| `integrations/util/product-display.ts` | Name/image display helpers. Safe, but `customerProductName()` is called everywhere — check all callers if you change priority order. |

---

## SAFE — Read-only or documentation

| File | Notes |
|------|-------|
| `docs/*.md` | Documentation only. |
| `admin-app/src/app/(dashboard)/analytics/page.tsx` | Read-only data display. |
| `admin-app/src/app/(dashboard)/logs/page.tsx` | Read-only log viewer. |
| `admin-app/src/app/(dashboard)/settings/page.tsx` | Display only (env status + webhook URL). |
| `admin-app/src/components/inbox/CustomerMemoryPanel.tsx` | View/edit/clear per-customer AI memory. |
| `scripts/*.ts` | Local one-shot scripts, never deployed to production. |

---

## Key invariants — never break these

1. **Admin-lock contract.** Any automated writer (scraper sync, CSV import, AI
   suggestion) MUST call `stripLockedFields()` from `integrations/product-locks.ts`
   before updating a product. Admin UI writes MUST call `withLocks()`. Never bypass.

2. **Service-role key is server-only.** `integrations/supabase/admin-client.ts`
   and `admin-app/src/lib/supabase/db.ts` MUST NOT be imported into any file
   marked `'use client'` or served to the browser. The key bypasses RLS.

3. **Outbound sends are automatic when Meta is configured.** No env flag gates
   sending. If Meta is configured (`metaStatus().configured`) and AI is still on
   for the conversation (`ai_enabled`), the pipeline sends. Do not add new gating
   flags without approving the schema and contract change.

4. **Only active+priced products reach customers.** Every DB query in the
   pipelines filters `status = 'active'` AND `active_price IS NOT NULL`. Never
   remove these filters.

5. **The CANONICAL webhook is `/api/meta/webhook`.** This is the only production
   webhook route. The split routes and Cloudflare webhook workers have been
   deleted. Do not recreate them.

6. **`source_name` (Turkish) is never customer-facing.** Product display helpers
   (`customerProductName()`) prefer `libyan_display_name` → `arabic_name` →
   `english_name`. Never pass `source_name` to any customer-facing string.

7. **The `LIBYAN_RULE` in `integrations/gemini/index.ts` is appended last.**
   It enforces Libyan Arabic output and cannot be overridden by any behavior
   prompt. Do not remove or reorder it.

---

---

## Production deployment roadmap

The 13 phases below are the recommended order for taking EH-SYSTEM1 from a
clean install to a fully live AI commerce assistant. Each phase is independent
and reversible before the next phase begins.

### Phase 1 — Infrastructure baseline
- Provision Supabase project (Postgres + Auth + Storage)
- Run `database/schema.sql` then all numbered migrations in order
- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Deploy admin-app to Vercel; confirm `/api/health` returns all-configured for Supabase

### Phase 2 — Gemini AI
- Create a Google AI Studio key, set `GEMINI_API_KEY`
- Open AI Playground in admin: run a test caption to confirm the API responds
- Confirm `/api/health` returns Gemini configured

### Phase 3 — Catalog import (CSV products)
- Run `scripts/import-csv.ts` with your source CSV
- Verify product count in Settings → Catalog row
- No active products yet — all should be `status = pending`

### Phase 4 — Product pricing and activation
- In Settings → Catalog, review pending products
- Set `base_price` (and optionally `active_price`) on each product
- Save → product moves to `status = active` and becomes customer-visible
- Confirm readiness checklist: "No active product without price" passes

### Phase 5 — AI behaviors configuration
- In `/ai-control` (2 sections), tune **Customer Service** (`customer_service`,
  `product_recommendation`, store info `memory_context`) and **Campaign / Marketing**
  (`campaign_caption`, `campaign_image`).
- Everything else (reply language, missing-price guardrail, image matching, tools,
  CSV truth) is system-controlled in code and not shown as editable boxes.

### Phase 6 — Product images and image matching
- Upload product images via Settings → Catalog → Images
- Run `scripts/match-images.ts` to compute perceptual hashes and generate
  `catalog_match_suggestions` for each product
- Review suggestions in Settings → Catalog Match; approve or reject each

### Phase 7 — Meta / Facebook connection
- Create a Meta App (Business type) in Meta for Developers
- Generate a long-lived Page Access Token, note the App Secret and App ID
- Set `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`
- Choose a random `META_VERIFY_TOKEN` and set it in both env and the Meta App

### Phase 8 — Webhook registration
- Set `APP_BASE_URL` to your Vercel production URL (e.g. `https://your-app.vercel.app`)
- In the Meta App Dashboard → Webhooks → Facebook Page, register:
  ```
  Callback URL:   https://your-app.vercel.app/api/meta/webhook
  Verify Token:   <your META_VERIFY_TOKEN>
  ```
- Subscribe to `messages`, `messaging_postbacks` events
- Confirm the GET handshake succeeds (Meta shows a green checkmark)

### Phase 9 — Apply migrations + embeddings
- Apply `0009_ai_brain.sql` then `0010_remove_facebook_comments.sql`.
- Run `cd scripts && npm run embeddings` to populate `products.text_embedding`.
- Run `cd scripts && npm run fingerprints` (optional) for image recall.

### Phase 10 — Test Messenger (live sends)
- Send a Messenger message (text, code, barcode, link, or image) from a test account.
- Confirm it appears in `/inbox`; customer row gets its name from the Meta profile fetch.
- With Meta configured and `ai_enabled = true` (default), the AI answers automatically.
- Customer memory builds up; check the memory panel in the conversation.

### Phase 11 — Verify the AI pause control
- `ai_enabled` per-conversation is the control that silences the AI.
- There is no legacy escalation workflow. Admin-required cases are marked
  `needs_human` and pause AI, and admins can also toggle AI off manually in the
  Inbox. Replies are stored as internal suggestions only while AI is paused or
  Gemini is unconfigured.

### Phase 12 — Campaign publishing
- Create a campaign in the admin (Campaigns → New)
- Use the AI Playground to generate a caption
- Schedule or publish to the Page immediately
- Confirm the facebook_posts row is created and the post appears on the Page

### Phase 13 — Cron scheduler (optional)
- Deploy `workers/campaign-scheduler/` to Cloudflare Workers, OR
- Use the Vercel Cron at `/api/cron/campaign-scheduler` with a `CRON_SECRET`
- The scheduler: refreshes `active_price` on all products, auto-publishes due posts
- Set `CLOUDFLARE_WEBHOOK_SECRET` (or `CRON_SECRET`) and verify the cron logs

---

## How to find what calls a file

```bash
# Find all files that import from a given module:
grep -r "from.*pipelines/messenger" admin-app/src integrations workers

# Find all files that import a specific function:
grep -r "matchCustomerImage" admin-app/src integrations workers
```

## Before deploying any change

Run `scripts/upgrade-tests.ts` for a pre-deploy smoke test. See `scripts/README.md`.
