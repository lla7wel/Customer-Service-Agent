# EH-SYSTEM1 — Environment Variables

Copy `.env.example` to:
- `EH-SYSTEM1/.env` — used by `scripts/` and `workers/`.
- `EH-SYSTEM1/admin-app/.env.local` — used by the Next.js app.

Everything can start **empty**: the app runs and shows "not connected" states.
Fill values in as you obtain them.

> Only `NEXT_PUBLIC_*` vars reach the browser. Everything else is server-only.
> **Never** expose `SUPABASE_SERVICE_ROLE_KEY`, `META_*` secrets, or
> `GEMINI_API_KEY` to the client, and never commit them.

## Supabase

| Var | Where | What |
|-----|-------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | app | Project URL (`https://xxxx.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | Anon/public key (browser + server, RLS-bound). |
| `SUPABASE_SERVICE_ROLE_KEY` | server/scripts | Service role key; **bypasses RLS**. Never in the browser. |
| `SUPABASE_URL` | scripts/workers | Same as the public URL (non-prefixed alias). |
| `SUPABASE_ANON_KEY` | scripts/workers | Same as the public anon key (alias). |
| `SUPABASE_STORAGE_BUCKET` | all | Bucket for images. Default `eh-media`. |

Get these from **Supabase → Project Settings → API**.

## Gemini (only AI provider)

| Var | What |
|-----|------|
| `GEMINI_API_KEY` | Google AI Studio API key (all tasks below use this one key). |
| `GEMINI_TEXT_MODEL` | Customer-service text + function-calling. Default `gemini-2.5-flash`. |
| `GEMINI_ROUTER_MODEL` | Intent/classification/routing/follow-up + memory summaries (cheapest). Default `gemini-2.5-flash-lite`. |
| `GEMINI_MARKETING_TEXT_MODEL` | Captions, Arabic headlines, design briefs (text, not image). Default `gemini-2.5-flash`. |
| `GEMINI_VISION_MODEL` | Describe/compare customer product photos. Default `gemini-2.5-flash` (pro vision measured 90s+ on this key → it never finished and image matching degraded; flash is ~3-6s and accurate). |
| `GEMINI_IMAGE_MODEL` | Strongest image generation/edit model — **image work only**. Default `gemini-3-pro-image-preview`. |
| `GEMINI_IMAGE_EDIT_MODEL` | Image edit model (defaults to `GEMINI_IMAGE_MODEL`). |
| `GEMINI_CAMPAIGN_IMAGE_MODEL` | Campaign/final creative image model (defaults to `GEMINI_IMAGE_MODEL`). |
| `GEMINI_IMAGE_FALLBACK_MODEL` | Used + logged + shown in admin if the primary is busy. Default `gemini-3.1-flash-image-preview`. |
| `GEMINI_IMAGE_LAST_FALLBACK_MODEL` | Last-resort image model. Default `gemini-2.5-flash-image`. |
| `GEMINI_EMBEDDING_MODEL` | Embeddings ONLY (semantic vector search). Default `gemini-embedding-001` (GA). |
| `GEMINI_EMBEDDING_DIM` | Embedding dimensionality (must match stored vectors). Default `768`. |

> **Routing rule:** the strong image model (`GEMINI_IMAGE_MODEL`) is used **only**
> for real image generation/editing — never for customer text, classification,
> captions, memory summaries, or routine tool calls. All defaults are verified
> available on the project key (Jun 2026).

Get the key from **Google AI Studio → Get API key**. The embedding model uses the
same key; run `scripts/generate-embeddings.ts` once to populate
`products.text_embedding` so semantic catalog search works (it degrades to
keyword + image search until then — never fake vectors).

## Runtime flags

| Var | What |
|-----|------|
| `ENABLE_MESSAGE_BATCHING` | Merge a burst of quick customer messages into ONE AI turn. Default on. |
| `MESSAGE_BATCH_WINDOW_MS` | Burst-merge window in ms. Default `5000` (5s). |

## Meta / Facebook

| Var | What |
|-----|------|
| `META_PAGE_ID` | Your Facebook Page id. |
| `META_PAGE_ACCESS_TOKEN` | Long-lived Page access token (messaging + posting). |
| `META_VERIFY_TOKEN` | A string **you choose**; Meta echoes it during webhook setup. |
| `META_APP_SECRET` | App secret; used to verify `X-Hub-Signature-256` on webhooks. |
| `META_GRAPH_VERSION` | Graph API version. Default `v21.0`. |

Get these from **developers.facebook.com → your App → Messenger / Webhooks /
App Settings**. See `docs/SETUP.md` for the webhook subscription steps.

## Cloudflare / workers (optional)

| Var | What |
|-----|------|
| `CLOUDFLARE_WEBHOOK_SECRET` | Shared secret between the app and the Cloudflare workers (cron trigger auth). |

## App config

| Var | What |
|-----|------|
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar` (Libyan Arabic, RTL) or `en`. Default `ar`. |
| `NEXT_PUBLIC_APP_NAME` | Display name. Default `EH-SYSTEM1`. |
| `APP_BASE_URL` | Public base URL of the deployed app (for webhook callback docs). |

## Scraper import (read-only)

| Var | What |
|-----|------|
| `SCRAPER_OUTPUT_DIR` | Path to scraper `data/output`. Default `../english-home-tr-scraper/data/output`. |
| `SCRAPER_IMAGES_DIR` | Path to scraper `data/images`. Default `../english-home-tr-scraper/data/images`. |

These point at the **separate** scraper project. The scripts only read from them.

## Which vars each surface needs

- **App boots with zero vars** (all integrations show "not connected").
- **Inbox/products/orders show real data** → Supabase vars + schema applied.
- **AI playground / auto-replies work** → `GEMINI_API_KEY`.
- **Webhooks + posting work** → `META_*` vars.
- **Import scripts run** → `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
