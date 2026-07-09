# EH-SYSTEM1 — Production Guide

This is the **authoritative, current-state** document for the English Home Libya
control center after the production cleanup pass. Older docs in this folder
(REPO_MAP, PIPELINE_MAP, FRONTEND_MAP, etc.) are historical and may still mention
removed features — when they disagree with this file, this file wins.

The system is a **simple, one-person control center** for the English Home Libya
Facebook/Messenger page. Its core is a Messenger customer-service AI agent that
answers customers naturally in Libyan Arabic using the real Libya catalog and
prices.

---

## 1. What the system does

- Answers Messenger DMs and Facebook **story replies** in Libyan Arabic.
- Grounds every answer in the real catalog; **quotes a price only when the Libya
  catalog has one** (never invents, never trusts AI/customer/Turkish prices).
- Recognizes product photos (fingerprint → embedding → keyword → Gemini vision).
- Lets the admin run the inbox: read, reply, pause/resume AI, attach products,
  correct image matches, see delivery status.
- Builds Facebook marketing campaigns (draft → products → images → caption →
  schedule/publish).

---

## 2. Repository layout

| Path | Owns |
|---|---|
| `admin-app/` | Next.js admin/control center (pages, API routes, UI). |
| `integrations/` | Framework-agnostic runtime: Gemini, Meta, Supabase, Messenger pipeline, product matching, campaigns. |
| `database/` | Supabase schema + ordered migrations + seed. |
| `scripts/` | **Local-only** catalog import/enrichment tools (not run by the deployed app). |
| `workers/campaign-scheduler/` | Cloudflare Worker cron for campaign publishing. |
| `english-home-tr-scraper/` | **Separate** sibling project. Outside production — the app never depends on it. |

---

## 3. Local setup

```bash
# Admin app
cd admin-app
cp ../.env.example .env.local      # fill Supabase + Gemini + Meta values
npm install
npm run dev                        # http://localhost:3000

# Optional local catalog import scripts (NOT needed to run the app)
cd ../scripts
npm install
npm run catalog:csv                # import the Libya CSV catalog (price truth)
```

Required env lives in [`.env.example`](../.env.example) — Supabase, Gemini model
routing, Meta/Messenger, Cloudflare cron secret. The `SCRAPER_*` /
`CATALOG_CSV_PATH` vars are **only** for the optional local import scripts.

---

## 4. Deployment

- **Admin app** → Vercel (Next.js). Set every non-`SCRAPER_*` env var.
- **Cron** → Cloudflare Worker (`workers/campaign-scheduler`) OR call
  `/api/cron/campaign-scheduler` from any scheduler, protected by
  `CLOUDFLARE_WEBHOOK_SECRET`.
- **Database** → Supabase. Apply `database/schema.sql` once, then every
  `database/migrations/00NN_*.sql` in order via the Supabase SQL editor.

```bash
cd admin-app
npm run typecheck && npm run build      # must pass before deploy
```

---

## 5. Authentication (production-critical)

`admin-app/src/middleware.ts` gates **every** dashboard page and API route behind
a signed-in Supabase user. The only public exceptions:

- `/api/meta/webhook` — Meta's callback (verified by signature/verify-token).
- `/api/health` — status probe.
- `/api/cron/campaign-scheduler` — protected by `CLOUDFLARE_WEBHOOK_SECRET`.
- `/login` — the sign-in page.

Unauthenticated API calls get `401 JSON`; unauthenticated page loads redirect to
`/login`. Data is read via the Supabase service-role key (RLS-bypassing), so this
gate is the security boundary — do not remove it. Create admin users in Supabase
Auth (see `admin_users` table / SETUP.md).

---

## 6. Product catalog — source of truth

- The **Libya CSV/admin catalog is the only price authority.** `products.active_price`
  is what customers see; `base_price` is the CSV import price; `campaign_price`
  is set by `fn_refresh_product_pricing` when a campaign is active.
- The Turkish scraper only enriches **identity**: product code, barcode, English
  name, images, website URL. It **never** sets any price. It attaches to catalog
  rows via `catalog_match_suggestions` (admin-approved) or code/barcode match.
- `products.admin_locked_fields` records every admin-edited field; imports must
  never overwrite a locked field.
- **Missing price** → product stays `draft` and appears in `/price-review`. The
  AI may mention such a product but must say the price will be confirmed.
- **Manual add/edit**: `POST /api/products` (header button on `/products`) and
  `PATCH /api/products/[productId]`. A manual product with a price goes live
  immediately; without one it lands in price review. Every field set this way is
  locked.

---

## 7. AI behavior

- All AI is Gemini, routed by task (see `AI_BRAIN.md` for model routing).
- **Every customer-facing reply is composed by Gemini** via
  `integrations/pipelines/compose-reply.ts` (`composeCustomerReply`, temp 0.7,
  with the controlled read-only product tools). There are **no hard-coded option
  templates** — that was the old "robotic" path and it is gone.
- The Messenger auto-reply, the inbox **AI suggest** button, and the **AI
  Playground** all use this same path and the same `messenger` behavior, so they
  produce the same quality.
- Behavior/persona is editable live in **AI Control** (`ai_behaviors` table). Hard
  safety rules (never invent a price, reply only in Libyan Arabic, never confirm
  orders alone) are always enforced regardless of behavior edits.
- **Product matching priority**: image fingerprint/hash → embedding/vector →
  keyword/name/category → Gemini vision reasoning. If no real signal yields a
  candidate, the AI asks **one** natural clarifying question and routes to
  `needs_human` — it never shows arbitrary random products.

---

## 8. Messenger / Meta

- Webhook: `/api/meta/webhook` (GET verify, POST ingest). Signature-verified;
  duplicate webhooks de-duped by `messages.external_id`.
- Handles text DMs, image messages, and **story replies** — a reply to a story
  carries the story media URL, which the pipeline treats as the product image so
  a price question on a story reply routes to the image matcher.
- A burst of quick messages is batched into one AI turn
  (`ENABLE_MESSAGE_BATCHING`, `conversations.next_turn_at`).
- **Manual replies** record real delivery status: the message stores
  `delivered_at` on success or `ai_meta.delivery_error` on failure; the inbox
  shows a sent/failed indicator. The UI never implies a failed send succeeded.
- **Facebook comments are not part of this system** — no comment auto-reply
  workflow exists.

---

## 9. Campaigns

Draft → attach products → upload/generate images → generate a short Libyan-Arabic
caption → schedule/publish to the Facebook page. The scheduler tick refreshes
campaign pricing before publishing. Comment-reply rules were removed.

---

## 10. Admin usage (navigation)

`Dashboard · Inbox · Products · Catalog Review · Campaigns · AI Control · AI
Playground · Settings`. Inbox is the primary workflow; its **Needs action** filter
surfaces conversations that need a human.

---

## 11. What was removed / deprecated in this pass

| Removed | Why |
|---|---|
| Orders module (`/orders`, order-draft inbox actions, `orders`/`order_items` tables) | Out of scope for a CS-AI control center; order data lives in the conversation. Tables archived to `*_archive` before drop (migration 0012). |
| `/api/catalog-sync` + `lib/sync/runner.ts` + Catalog Sync page/tab | Spawned local OS processes from a web route — unsafe in production. Catalog import is now a local-only `scripts/` workflow. |
| Facebook comments workflow + `comment_reply_rules` | Not part of production scope (table dropped in migration 0010; column in 0012). |
| Hard-coded Arabic reply templates (`adminRequiredReply`, option-list builders in the pipeline) | Caused robotic auto-replies; replaced by Gemini composition. |
| Random product fallback in image matching | Surfaced confident-looking but irrelevant products. |
| `escalations`, `product_variants`, `ai_settings` tables | No active writer / fully replaced by `ai_behaviors`. |
| Logs & Analytics from nav | Pages remain but are de-emphasized; not core to the operator. |

---

## 12. QA checklist (post-deploy)

- [ ] `curl -I https://APP/api/ai/behaviors` → 401 (no session).
- [ ] Browser `/dashboard` without a session → redirect to `/login`.
- [ ] `curl https://APP/api/health` → 200; `/api/catalog-sync` → 404.
- [ ] Messenger DM price question → natural Libyan Arabic + real catalog price.
- [ ] Facebook story reply price question → recognizes product, replies naturally.
- [ ] Product image → matched product OR one clarifying question (no random list).
- [ ] Product with no Libya price → mentioned but no price quoted.
- [ ] Manual admin reply: success shows "sent"; forced Meta failure shows "failed".
- [ ] Pause/resume AI works; AI Playground output matches Messenger style.
- [ ] Add a product via `/products` → priced = active, unpriced = price review.
- [ ] Catalog Match approve/bulk-approve works; Campaign caption generates.
- [ ] Mobile inbox: thread fills screen, composer pinned, match options collapse.

---

## 13. Commands

```bash
cd admin-app && npm run typecheck     # 0 errors
cd admin-app && npm run build         # production build
cd scripts   && npm run typecheck     # 0 errors
cd scripts   && npm test              # pure-logic assertions
```
