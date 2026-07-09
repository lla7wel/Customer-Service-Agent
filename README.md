# EH-SYSTEM1 — English Home Libya Command Center

A production admin and customer-service control center for **English Home Libya**.

The core is a Messenger AI agent that answers customers in Libyan Arabic using the real Libya catalog and prices. The admin app wraps that agent with inbox management, a product database, image matching, marketing campaigns, and AI configuration — all in one interface operated by one person.

**Production:** https://admin-app-red-one.vercel.app

---

## What it does

- Answers Messenger DMs and Facebook story replies automatically in Libyan Arabic.
- Quotes prices only from the Libya catalog — never invents or estimates.
- Recognizes product photos via fingerprint, embedding, keyword, and Gemini vision.
- **Sends real product photos** when a customer asks to see them (max 3 per turn, no spam).
- Lets the admin manage the inbox: read, reply, pause/resume AI, attach products, send product photos, correct image matches.
- Builds and publishes Facebook marketing campaigns.

## What it is not (removed / not included)

- **No ordering / checkout.** Not connected to the Turkey website. Order data is not stored.
- **No Catalog Sync web UI / no in-app scraper.** The scraper (`../english-home-tr-scraper`) is a separate, offline-only tool — this app never runs it. Catalog import is local-only (`scripts/`).
- **No Facebook comment auto-reply.** Only Messenger DMs and story replies.
- These features were intentionally removed and must not be reintroduced. See [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

---

## Modules

| Page | Purpose |
|------|---------|
| Dashboard | Operational overview and integration status |
| Inbox | Customer conversations — read, reply, pause AI, attach products |
| Products | Full product catalog with manual add/edit |
| Catalog Review | Catalog matching, image review, price activation |
| Campaigns | Facebook campaign builder — draft, images, caption, publish |
| AI Control | Live-editable Gemini behavior configuration |
| AI Playground | Test the exact Messenger pipeline before going live |
| Settings | Integration health, webhook URL, theme, language |

---

## Local setup

```bash
cd admin-app
cp ../.env.example .env.local      # fill in Supabase + Gemini + Meta values
npm install
npm run dev                        # http://localhost:3000
```

The app runs with zero credentials — every integration shows **Not connected** until you fill the env vars. See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full setup.

---

## Repository layout

```
EH-SYSTEM1/
├── admin-app/          Next.js 14 App Router — UI + API routes
├── integrations/       Framework-agnostic runtime: Gemini, Meta, Supabase, Messenger pipeline
├── database/           Supabase schema, migrations (0001–0012), seed
├── scripts/            Local-only catalog import tools (never deployed)
├── workers/            Optional Cloudflare Worker for campaign-scheduler cron
└── docs/               All documentation
```

---

## Production safety

- `SUPABASE_SERVICE_ROLE_KEY` must **never** have a `NEXT_PUBLIC_` prefix and must never reach the browser.
- The `middleware.ts` auth gate is the security boundary for all admin routes — do not remove it. All `/dashboard/*` and `/api/*` routes require a signed-in admin, except the Meta webhook, health check, and cron route.
- The Meta webhook is protected by `X-Hub-Signature-256` signature verification.
- The cron route is protected by `CLOUDFLARE_WEBHOOK_SECRET`.
- AI **never invents prices** (reads `active_price` only) and **never confirms orders** alone (hands off to a human).
- Product photos sent to customers are public HTTPS URLs only — no local paths, no broken URLs.
- This repository contains **no secrets**; env vars are documented by name only in [`DEPLOYMENT.md`](DEPLOYMENT.md). Never commit `.env` or `.env.local`.

---

## Screenshots

_Add screenshots of the Dashboard, Inbox, and AI Playground here when publishing._

---

## Documentation

See [`docs/README.md`](docs/README.md) for the full documentation index.
