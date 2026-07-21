# English Home Libya — Customer Service & Content Platform

The operations centre for a real home-furnishings retailer in Libya: it answers
customers on **Facebook Messenger and Instagram Direct** in Libyan Arabic,
grounded in a locked 4,700-product catalog, and it produces, schedules and
publishes the brand's Facebook/Instagram content — including automatic replies
to comments on the posts it published.

Everything runs on one small VPS with two external dependencies: the **Gemini
API** and **Meta's Graph API**.

> **Screenshots and sample data in this repository are synthetic.** No customer
> conversations, credentials, media dumps or business records are published here.

---

## What it does

**Customer service (Messenger + Instagram)**
- Answers product, price, size, colour, set, comparison and branch questions
  automatically in natural Libyan Arabic, whatever language the customer wrote in.
- Recognises products from customer photos (perceptual hash → learned admin
  corrections → fingerprints → vision description → keyword/semantic retrieval
  → visual re-rank), and sends **real catalog photos** on request (max three).
- Quotes prices **only** from the verified active price. It never invents a
  price, stock level, delivery time or policy.
- **Never creates, confirms or manages orders.** When real buying intent
  appears it sends one Libyan-Arabic handoff message pointing to WhatsApp,
  flags the conversation for the team, and keeps answering ordinary product
  questions until an admin explicitly presses **Take Over**.

**Catalog**
- Families, sellable variants and genuine related products, bootstrapped
  automatically from existing data; admin corrections are permanent.
- Versioned price history, promotions with automatic restoration, and per-field
  admin locks that CSV imports can never overwrite.
- Indexed full-catalog retrieval (PostgreSQL full-text + trigram + barcode +
  image fingerprint + semantic) with no silent row caps.

**Content Studio**
- Posts and Stories for Facebook, Instagram or both; original / carousel /
  combined output; price-drop or general purpose.
- Exact prices and Arabic phrases are rendered by a **deterministic typography
  layer** (resvg + rustybuzz shaping, bundled Tajawal font) — an image model is
  never trusted to spell a price. What you preview is what publishes.
- Approve immediately or schedule in **Africa/Tripoli** time. A scheduled price
  drop activates the new price only when a platform actually publishes.
- Automatic Libyan-Arabic comment replies **only on content this app published**.

**Operations**
- Durable PostgreSQL-backed jobs, transactional outbox, exactly-once publishing.
- Multi-admin accounts with database-backed revocable sessions and audit trail.
- Truthful readiness checks — a channel is never shown as connected without proof.

---

## Architecture

```
                    Meta (Messenger · Instagram · Pages)
                                  │  webhook (signature-verified)
                                  ▼
   Caddy ──► Next.js app ──► PostgreSQL ◄── worker (separate container)
     │        (UI + API)          ▲              │
     │                            │              ├─ debounced customer turns
     └─► /media (product &        │              ├─ outbox delivery
         content images)          │              ├─ content publishing
                                  │              ├─ comment automation
                              Gemini API         ├─ promotion expiry
                                                 └─ analytics + readiness
```

The webhook **only persists** verified events and acknowledges after the commit.
Everything else happens in the worker, claimed with `FOR UPDATE SKIP LOCKED`
leases. No host cron is required — the worker schedules its own recurring work.

| Area | Choice |
|---|---|
| Web / API | Next.js (App Router), Arabic RTL-first UI |
| Data | PostgreSQL + Kysely, forward-only idempotent migrations |
| Background | Standalone worker process, PostgreSQL job queue + outbox |
| AI | Gemini (text, vision, embeddings) with bounded, schema-validated tools |
| Media | Filesystem volume served by Caddy |
| Deploy | Docker Compose: `postgres`, `app`, `worker`, `caddy` |

---

## Reliability guarantees

Each of these is covered by an automated test:

| Guarantee | How |
|---|---|
| One AI reply per customer burst | Per-conversation debounced job + transactional supersede guard |
| No lost inbound events | Events persisted before the 200; database failure returns 503 so Meta retries |
| No duplicate provider sends | Transactional outbox with a conditional claim and idempotency key |
| Ambiguous sends never silently retried | Timeouts land in an `uncertain` state that only an admin may retry |
| No duplicate Facebook/Instagram posts | One publication row per (item, platform), conditional claim, resumable children |
| Truthful publication state | Parent status is always derived from all its publications |
| Prices only change when content goes live | Activation runs on the first successful platform publish |
| Promotions restore correctly | Expiry restores the prior price unless a newer manual/CSV price superseded it |
| Admin locks beat imports | Field-level lock map consulted by every automated writer |
| One order handoff, no spam | Handoff timestamp with a suppression window |
| Comments answered only on our own posts | Comments are fetched exclusively from our publication rows |

---

## Local development

**Requirements:** Node 22+, PostgreSQL 16+.

```bash
git clone https://github.com/lla7wel/Customer-Service-Agent.git
cd Customer-Service-Agent
npm install && npm install --prefix admin-app && npm install --prefix scripts

cp .env.example .env          # fill in DATABASE_URL and SESSION_SECRET

createdb eh_system
npm run db:migrate            # bootstrap + full migration chain

# Create the first owner account (no default password exists anywhere)
node -e "require('bcryptjs').hash('your-password',12).then(console.log)"
#   → put the hash in OWNER_PASSWORD_HASH, pick OWNER_USERNAME, then:
npm run bootstrap:owner --prefix scripts

npm run dev --prefix admin-app    # http://localhost:3000
npm run worker:dev                # in a second terminal
```

The app runs with integrations missing — every unconfigured channel shows an
explicit "not connected" state with the exact remediation instead of faking data.

### Useful commands

```bash
npm run db:preflight     # report pending migrations, change nothing
npm run test             # unit + integration (throwaway databases)
npm run test:e2e         # Playwright: desktop + 360px phone, Arabic RTL
npm run worker:build     # bundle the worker for the container
npm run bootstrap:families --prefix scripts   # build product families from catalog data

npm run test:ai-control --prefix scripts      # prompt compiler, provenance and boundaries
```

---

## Configuration

All configuration is environment variables — see [`.env.example`](.env.example).
Nothing is hard-coded and no secret is ever committed.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection |
| `SESSION_SECRET` | yes | Signs admin sessions (≥32 chars). **The app refuses to serve without it.** |
| `OWNER_USERNAME` / `OWNER_PASSWORD_HASH` | bootstrap | First owner account (bcrypt hash) |
| `MEDIA_ROOT` / `PUBLIC_MEDIA_BASE_URL` | media | Image storage + public base URL |
| `GEMINI_API_KEY` | AI | Text, vision and embedding calls |
| `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | Meta | Messenger + Page publishing |
| `META_IG_USER_ID` | Instagram | Instagram DMs, publishing and comments |

**Fail-closed by design:** without `SESSION_SECRET` the admin app returns 503
rather than exposing the dashboard. Local development may opt out explicitly
with `AUTH_DISABLED_DEV=true`, which is ignored in production builds.

---

## Deployment (Docker Compose)

```bash
cp .env.example .env      # fill in real values on the server
docker compose build
docker compose run --rm app node -e "require('/app/scripts/migrate')" || \
  DATABASE_URL=... npm run db:migrate      # run migrations first
docker compose up -d                       # postgres, app, worker, caddy
```

Compose starts four services: `postgres`, `app` (web/API), `worker` (all
background processing) and `caddy` (TLS + public media). See
[docs/OPERATIONS.md](docs/OPERATIONS.md) for the full runbook.

### Backup and restore

Media is **not** rebuildable — back it up with the database:

```bash
./scripts/backup.sh                     # database + media → backups/<timestamp>/
./scripts/backup.sh --db-only
./scripts/restore.sh backups/<ts> --yes # restores both (destructive; needs --yes)
```

Run a backup before every migration. `npm run db:preflight` reports exactly what
a migration would do without touching anything.

---

## Meta setup and readiness

Register **one** callback URL — `https://<your-app-domain>/api/meta/webhook` —
for both the Page and Instagram objects, with `META_VERIFY_TOKEN` as the verify
token.

Required permissions:

| Capability | Permissions |
|---|---|
| Messenger DMs | `pages_messaging` |
| Page publishing + comments | `pages_manage_posts`, `pages_read_engagement` |
| Instagram DMs | `instagram_basic`, `instagram_manage_messages` |
| Instagram publishing | `instagram_content_publish` |
| Instagram comments | `instagram_manage_comments` |
| Insights (optional) | `read_insights` |

**Settings → Channels** runs real checks against the Graph API and reports
exactly what is connected, what is missing and how to fix it. A channel is never
displayed as ready without a passing check, and reach/engagement metrics appear
only when the API actually returns them — never as fabricated zeros.

---

## Testing

```bash
npm run test        # unit + integration suite
npm run test:e2e    # Playwright, desktop + 360px phone
```

Integration tests create a throwaway PostgreSQL database, run the **real**
migration chain and tear it down. Provider credentials are stripped from the
test environment, so no test can reach a live account or a paid API.

Coverage includes migrations (fresh + upgrade-from-production), the job queue,
webhook durability and dedupe, outbox delivery states, exactly-once publishing,
price/promotion rules, CSV import locks, order-handoff behaviour, comment
automation, authentication and readiness truthfulness.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and data flow |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema and migration policy |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deployment, backup, monitoring runbook |
| [docs/AI_AND_MESSENGER.md](docs/AI_AND_MESSENGER.md) | Prompt architecture and conversation rules |
| [docs/CONTENT_STUDIO.md](docs/CONTENT_STUDIO.md) | Content creation, publishing, comments |
| [docs/CATALOG_AND_PRODUCTS.md](docs/CATALOG_AND_PRODUCTS.md) | Catalog, pricing, imports |
| [docs/SECURITY.md](docs/SECURITY.md) | Security posture and known limitations |

## Known limitations

Stated plainly rather than papered over:

- **No inventory system.** An active product with a verified price is treated as
  available. There is an inactive `availability provider` boundary for a future
  ERP integration.
- **No order management.** By design — WhatsApp is the handoff destination only.
- **Instagram requires account linkage** that cannot be configured from code; the
  readiness panel reports the exact missing step.
- **Provider insights** appear only with `read_insights` granted.
- Next.js currently bundles its own copy of `postcss` carrying a moderate
  build-time advisory; the direct dependency is patched and the nested copy is
  fixed upstream by Next, not by this repository.

## License

[MIT](LICENSE)
