# EH-SYSTEM1 — Deployment Guide

## 1. Vercel project setup

The Next.js app lives in `admin-app/` and imports shared code from `../integrations/`.

In the Vercel dashboard (Project → Settings → General):
- **Root Directory:** `admin-app`
- **Include source files outside of the Root Directory in the Build Step:** enabled

This is required so Vercel bundles `../integrations` when building. Without it the build fails with missing `@integrations/*` aliases.

Framework preset: **Next.js** (auto-detected; pinned in `admin-app/vercel.json`).

## 2. Environment variables

Set all of the following in Vercel → Settings → Environment Variables (Production scope).

### Supabase

| Var | Notes |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key (RLS-bound) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — **server-only, never expose to browser** |
| `SUPABASE_URL` | Same as public URL (non-prefixed alias, used by workers/scripts) |
| `SUPABASE_ANON_KEY` | Same as anon key (non-prefixed alias) |
| `SUPABASE_STORAGE_BUCKET` | Image bucket name. Default: `eh-media` |

Get from: Supabase → Project Settings → API.

### Gemini

| Var | Notes |
|-----|-------|
| `GEMINI_API_KEY` | Google AI Studio API key — **server-only, never expose** |
| `GEMINI_TEXT_MODEL` | Customer-service text + function calling. Default: `gemini-2.5-flash` |
| `GEMINI_ROUTER_MODEL` | Intent / routing / memory summaries (cheapest). Default: `gemini-2.5-flash-lite` |
| `GEMINI_MARKETING_TEXT_MODEL` | Captions, Arabic headlines. Default: `gemini-2.5-flash` |
| `GEMINI_VISION_MODEL` | Describe customer product photos. Default: `gemini-2.5-flash` |
| `GEMINI_IMAGE_MODEL` | Image generation/editing only. Default: `gemini-3-pro-image-preview` |
| `GEMINI_IMAGE_EDIT_MODEL` | Image edit model (defaults to `GEMINI_IMAGE_MODEL`) |
| `GEMINI_CAMPAIGN_IMAGE_MODEL` | Campaign creative image (defaults to `GEMINI_IMAGE_MODEL`) |
| `GEMINI_IMAGE_FALLBACK_MODEL` | Fallback if primary image model is rate-limited. Default: `gemini-3.1-flash-image-preview` |
| `GEMINI_IMAGE_LAST_FALLBACK_MODEL` | Last-resort image model. Default: `gemini-2.5-flash-image` |
| `GEMINI_EMBEDDING_MODEL` | Semantic vector embeddings only. Default: `gemini-embedding-001` |
| `GEMINI_EMBEDDING_DIM` | Embedding dimensions (must match stored vectors). Default: `768` |

> The strong image model is used **only** for image generation/editing — never for customer text, classification, captions, or memory summaries.

Get from: Google AI Studio → Get API key.

### Meta / Facebook

| Var | Notes |
|-----|-------|
| `META_PAGE_ID` | Facebook Page ID |
| `META_PAGE_ACCESS_TOKEN` | Long-lived Page access token — **server-only, never expose** |
| `META_VERIFY_TOKEN` | A string you choose; Meta echoes it during webhook handshake |
| `META_APP_SECRET` | App secret for `X-Hub-Signature-256` verification — **server-only** |
| `META_GRAPH_VERSION` | Graph API version. Default: `v21.0` |

Get from: developers.facebook.com → your App → Messenger / Webhooks / App Settings.

### Runtime flags

| Var | Notes |
|-----|-------|
| `ENABLE_MESSAGE_BATCHING` | Merge burst messages into one AI turn. Default: `true` |
| `MESSAGE_BATCH_WINDOW_MS` | Burst-merge window in ms. Default: `5000` |

### App config

| Var | Notes |
|-----|-------|
| `APP_BASE_URL` | Public URL of the deployed app (e.g. `https://admin-app-red-one.vercel.app`) |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar` (Libyan Arabic, RTL) or `en`. Default: `ar` |
| `NEXT_PUBLIC_APP_NAME` | Display name. Default: `EH-SYSTEM1` |

### Cloudflare / workers (optional)

| Var | Notes |
|-----|-------|
| `CLOUDFLARE_WEBHOOK_SECRET` | Shared secret for the `/api/cron/campaign-scheduler` auth check |

### Scraper import (local scripts only — not used by production app)

| Var | Notes |
|-----|-------|
| `SCRAPER_OUTPUT_DIR` | Path to scraper `data/output`. Default: `../english-home-tr-scraper/data/output` |
| `SCRAPER_IMAGES_DIR` | Path to scraper `data/images`. Default: `../english-home-tr-scraper/data/images` |
| `CATALOG_CSV_PATH` | Path to the Libya catalog CSV. Default: `../english-home-tr-scraper/data/input/catalog.csv` |

These go in `EH-SYSTEM1/.env` for local script runs. Never set them in Vercel.

---

## 3. Database migrations

Apply all migrations **in order** via the Supabase SQL editor (or `psql`). All are idempotent — safe to re-run.

```
database/migrations/0001_init.sql
database/migrations/0002_price_review_staging.sql
database/migrations/0003_catalog_match_suggestions.sql
database/migrations/0004_admin_locked_fields.sql
database/migrations/0005_ai_behaviors.sql
database/migrations/0006_message_batching.sql
database/migrations/0007_image_fingerprints.sql
database/migrations/0008_campaign_asset_review.sql
database/migrations/0009_ai_brain.sql
database/migrations/0010_remove_facebook_comments.sql
database/migrations/0011_attachments_and_indexes.sql
database/migrations/0012_production_cleanup.sql
```

After 0009 is applied, populate vector embeddings (semantic search):

```bash
cd scripts
npm install
DRY=1 npm run embeddings    # preview
npm run embeddings          # write to products.text_embedding
```

Requires `GEMINI_API_KEY` and `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `EH-SYSTEM1/.env`.

---

## 4. First admin user

1. Supabase → Authentication → Users → Add user (email + password).
2. Copy the user's UUID.
3. In the SQL editor:
   ```sql
   insert into admin_users (id, email, full_name, role)
   values ('<auth-user-uuid>', 'you@example.com', 'Owner', 'admin');
   ```
4. Sign in at `/login`.

---

## 5. Deploy

```bash
# From repo root (not admin-app/)
npx vercel --prod --yes
```

The root `.vercel/project.json` links to the Vercel project. The project's Root Directory setting in Vercel (`admin-app/`) ensures the build finds the Next.js app.

After deploy:
- Set `APP_BASE_URL` to the production URL in Vercel env vars if it changed.
- Redeploy once if `APP_BASE_URL` changed so Settings shows the correct webhook URL.

---

## 6. Meta webhook setup

After deploying:

1. **Callback URL:** `https://YOUR_PROD_URL/api/meta/webhook`
2. **Verify Token:** the value of `META_VERIFY_TOKEN`
3. **Subscribed fields:** `messages`, `messaging_postbacks`

Do **not** subscribe `feed` or `comments` — the Facebook comments feature has been removed.

---

## 7. Post-deploy smoke tests

```bash
HOST=https://admin-app-red-one.vercel.app

# Health check
curl -s $HOST/api/health | jq

# Auth gate — must return 401 (not 200)
curl -I $HOST/api/ai/behaviors

# Webhook GET verification — must echo "test"
curl -s "$HOST/api/meta/webhook?hub.mode=subscribe&hub.verify_token=YOUR_META_VERIFY_TOKEN&hub.challenge=test"

# Removed route — must return 404
curl -I $HOST/api/catalog-sync

# Page gate — must redirect to /login
curl -I $HOST/dashboard
```

---

## 8. Rollback

- **Code rollback:** promote a previous Vercel deployment in the Vercel dashboard.
- **Messenger send stop:** unset `META_PAGE_ACCESS_TOKEN` in Vercel env vars — `metaStatus().configured` returns false and no sends fire. Redeploy.
- **Order data:** archived in `orders_archive` / `order_items_archive` tables in Supabase (written by migration 0012 before dropping the source tables).

---

## 9. Cloudflare campaign-scheduler (optional)

If you want the campaign pricing-refresh cron off the Next.js runtime:

```bash
cd workers/campaign-scheduler
npm install
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put CLOUDFLARE_WEBHOOK_SECRET
npx wrangler secret put META_PAGE_ACCESS_TOKEN
npx wrangler secret put META_PAGE_ID
npx wrangler deploy
```

The worker calls the same `runSchedulerTick()` as the Next.js route — no logic duplication.
