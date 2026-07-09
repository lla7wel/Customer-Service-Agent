# EH-SYSTEM1 — Setup Guide

Step-by-step to go from empty to fully connected. You can stop after any step;
the app keeps running with "not connected" states for whatever you skip.

## 0. Prerequisites

- Node.js 18+ (20+ recommended) and npm.
- A Supabase account (free tier is fine).
- A Google AI Studio API key (for Gemini).
- A Facebook App + Page (for Messenger + Page posting).

## 1. Run the app (no credentials needed)

```bash
cd EH-SYSTEM1
cp .env.example .env
cp .env.example admin-app/.env.local
cd admin-app
npm install
npm run dev
# open http://localhost:3000
```

You'll see the dashboard with integration status all showing **Not connected**.
That's expected.

## 2. Supabase (database + auth + storage)

1. Create a new project at https://supabase.com.
2. **SQL editor → New query →** paste the contents of
   `database/schema.sql` and run it. Then run `database/seed/seed.sql`.
3. **Storage → New bucket →** name it `eh-media`, set it **public** (read).
4. **Project Settings → API →** copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server/scripts only!)
5. Restart `npm run dev`. The dashboard's Supabase status flips to **Connected**.

### Create the first admin user

1. **Authentication → Users → Add user** (email + password). Copy the user's
   UUID.
2. In the SQL editor:
   ```sql
   insert into admin_users (id, email, full_name, role)
   values ('<auth-user-uuid>', 'you@example.com', 'Owner', 'admin');
   ```
3. Sign in at `/login` with that email/password.

## 3. Import the catalog

The **CSV catalog** (`../english-home-tr-scraper/data/input/catalog.csv`) is the
main priced catalog; the **scraper** adds images + source metadata. Both scripts
are read-only on the scraper.

```bash
cd EH-SYSTEM1/scripts
npm install
# 1) Scraper output → products + product_images rows (new = draft/no-price):
npm run import:products
# 2) Main catalog: import every CSV product as active + priced (AR/EN + L.D.):
npm run catalog:csv          # add `-- --dry` to preview first
# 3) Upload local images to Supabase Storage and fill public_url:
npm run upload:images
```

Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `EH-SYSTEM1/.env`.
After this, `/products` lists the priced catalog, CSV-only products show as
"missing images", and scraped-only products wait in **Product Review**. The same
flow runs from the in-app **Catalog Sync** page. See `scripts/README.md` for the
identity/language/source-of-truth rules.

## 4. Gemini (AI)

1. Get a key at https://aistudio.google.com/app/apikey.
2. Set `GEMINI_API_KEY` in both `.env` and `admin-app/.env.local`.
3. Open `/ai-playground` — the real-workflow tester. Type a customer message,
   code, barcode, link, or upload an image and see the exact customer reply plus a
   technical debug panel (signals, candidates, tool calls, memory).
4. Edit customer-service + campaign behavior at `/ai-control` (applies immediately).
5. (After migration `0009`) run `cd scripts && npm run embeddings` to enable
   semantic vector search. The default embedding model is `gemini-embedding-001`.

## 5. Meta / Facebook

### 5a. Credentials

In your Facebook App (developers.facebook.com):
- Add the **Messenger** and **Webhooks** products.
- Generate a **Page access token** for your Page → `META_PAGE_ACCESS_TOKEN`.
- Note your **Page ID** → `META_PAGE_ID`, and **App Secret** → `META_APP_SECRET`.
- Choose any string for `META_VERIFY_TOKEN` (e.g. a random UUID).

### 5b. Webhook callback URL

Point Meta at the single unified Next.js route:

```
https://<APP_BASE_URL>/api/meta/webhook
```

This URL handles Messenger messages (the comments feature was removed).
For local testing, expose your dev server (e.g. `ngrok http 3000`) and use that
HTTPS URL as the base.

In **App → Webhooks**:
1. **Callback URL** = `https://<your-domain>/api/meta/webhook`
2. **Verify token** = your `META_VERIFY_TOKEN`. Meta sends a `GET` with
   `hub.challenge`; the route echoes it back (verifies automatically).
3. **Subscribe** the Page to fields: `messages`, `messaging_postbacks` (Messenger).

### 5c. Verify

- Send your Page a DM → it appears in `/inbox` and the AI answers automatically.
- The dashboard's Meta status flips to **Connected**.

## 6. Campaign scheduler Worker (optional)

Only if you want the campaign cron job off the Next.js app:

```bash
cd EH-SYSTEM1/workers/campaign-scheduler
npm install
npx wrangler deploy           # set secrets with: npx wrangler secret put CLOUDFLARE_WEBHOOK_SECRET (etc.)
```

The scheduler runs on a cron trigger; see its `wrangler.toml`. See `docs/ARCHITECTURE.md`.

## 7. Done

Dashboard should show **Connected** for Supabase, Gemini, and Meta. The system
is live: the AI handles Messenger DMs in Libyan Arabic (database-aware product
recognition + customer memory), drafts orders, and you can build + publish campaigns.

## Troubleshooting

- **"Missing env var" on a page** → that integration's vars aren't set; see
  `docs/ENV.md`.
- **Supabase queries empty** → schema not applied, or you imported nothing yet.
- **Webhook won't verify** → `META_VERIFY_TOKEN` mismatch, or callback URL not
  HTTPS/public.
- **Import script stops immediately** → `SUPABASE_SERVICE_ROLE_KEY` missing in
  `EH-SYSTEM1/.env`.
