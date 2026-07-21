# Operations runbook

## Services

`docker compose up -d` starts four containers:

| Service | Role |
|---|---|
| `postgres` | All durable data |
| `app` | Next.js UI + API, and the Meta webhook endpoint |
| `worker` | Every background job (AI turns, delivery, publishing, comments, promotions, analytics, readiness) |
| `caddy` | TLS termination and public media serving |

The worker schedules its own recurring work. **No host cron is required** — the
only host job worth installing is the nightly backup.

## First deployment

```bash
cp .env.example .env            # fill in real values
docker compose build

# 1. Back up first if there is anything to lose
./scripts/backup.sh

# 2. Inspect what a migration would do — changes nothing
DATABASE_URL=... npm run db:preflight

# 3. Apply migrations
DATABASE_URL=... npm run db:migrate

# 4. Create the first owner (no default password exists anywhere)
node -e "require('bcryptjs').hash('a-strong-password',12).then(console.log)"
# put it in OWNER_PASSWORD_HASH, set OWNER_USERNAME, then:
npm run bootstrap:owner --prefix scripts

# 5. Start everything
docker compose up -d
```

Then open **Settings → Channels** and press *فحص الآن* to verify what is actually
connected.

## Upgrades

```bash
./scripts/backup.sh             # database + media, always
git pull
docker compose build
DATABASE_URL=... npm run db:preflight    # review the plan
DATABASE_URL=... npm run db:migrate
docker compose up -d
curl -s https://<app-domain>/api/health | jq
```

The migration runner is forward-only and idempotent. It takes an advisory lock,
so two concurrent deploys cannot race. On a database whose ledger is incomplete
it **probes** each unrecorded migration and backfills the ledger only when the
effects are already present — it never re-applies a migration blindly and never
rewrites history.

## Backups

Media is not rebuildable; it is backed up with the database.

```bash
./scripts/backup.sh                        # → backups/<timestamp>/{db.dump,media.tar.gz}
./scripts/backup.sh --db-only
./scripts/restore.sh backups/<ts> --yes    # destructive; --yes is mandatory
```

Install the nightly job from `deploy/crontab.example`.

## Monitoring

- `GET /api/health` — returns 503 unless the database really answers a query.
  It reports proven state: database reachability and whether the worker has
  touched a job in the last 10 minutes. It never claims a dependency works
  without testing it.
- **Settings → Activity** shows the admin audit log, failed/uncertain deliveries,
  dead jobs and integration errors.
- **Dashboard** surfaces conversations needing the team and operational problems.

### What to check when something looks wrong

| Symptom | Where to look |
|---|---|
| Customers not getting replies | Settings → Activity: dead jobs; is the `worker` container running? |
| A reply shows "غير مؤكد" (uncertain) | The provider call timed out; an admin decides whether to retry |
| Content stuck in `publishing` | The publication row's `last_error`; retry the failed platform only |
| Instagram actions failing | Settings → Channels — it names the missing permission or linkage |
| Prices look wrong | The product's price-history panel shows every change and its source |

## Worker behaviour

- Jobs are claimed with `FOR UPDATE SKIP LOCKED` plus a lease; a crashed
  worker's lease is reaped and the job returns to the queue.
- Failures retry with bounded exponential backoff and then become `dead` —
  visible, never silent.
- Retention sweeps run every six hours (processed events 30 days, completed jobs
  7 days, login attempts and expired sessions 14 days, integration logs 60 days).

## Catalog maintenance

```bash
npm run bootstrap:families --prefix scripts   # build/refresh product families
npm run embeddings --prefix scripts           # semantic search vectors
npm run fingerprints --prefix scripts         # image fingerprints for photo matching
```

CSV imports run from **Catalog → استيراد CSV** in the app; they update unlocked
fields automatically and can never overwrite an admin-locked field.

## Scaling notes

Sized for ~20–30 conversations and 10–20 content items per day with three
admins. More than one worker container can run safely — job claiming is
transactional. There is intentionally no Redis, no Kubernetes and no distributed
queue.
