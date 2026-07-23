# VPS setup — from zero to production

One small VPS runs everything: PostgreSQL, the Next.js app, the worker, and
Caddy (HTTPS + media serving). Tested sizing: 2 vCPU / 4 GB / 40 GB, about
€5/month, on Ubuntu 24.04.

## 1. Provision

- Ubuntu 24.04 LTS, SSH key auth.
- DNS: point `app.<domain>` and `media.<domain>` A records at the VPS IP.

```bash
apt update && apt upgrade -y
apt install -y ufw curl git rsync postgresql-client
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
curl -fsSL https://get.docker.com | sh
```

## 2. Configure

```bash
mkdir -p /srv/eh-platform && cd /srv/eh-platform
git clone <your-repo-url> .
cp .env.example .env
```

Fill in `.env`:

| Variable | How |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `SESSION_SECRET` | `openssl rand -hex 32` — **required**; the app refuses to serve without it |
| `APP_DOMAIN`, `MEDIA_DOMAIN` | your two hostnames |
| `APP_BASE_URL`, `PUBLIC_MEDIA_BASE_URL` | `https://` + those hostnames |
| `GEMINI_API_KEY` | Google AI Studio |
| `META_*` | Meta app credentials (see the root README) |

## 3. Start

```bash
docker compose build
docker compose up -d postgres          # database first

# Apply migrations from the host (psql client installed above)
export DATABASE_URL="postgres://eh:<POSTGRES_PASSWORD>@127.0.0.1:5432/eh_system"
docker compose exec -T postgres psql -U eh -d eh_system -c 'select 1' >/dev/null
npm ci && npm run db:preflight          # review the plan
npm run db:migrate

# Create the first owner account (no default password exists)
node -e "require('bcryptjs').hash('a-strong-password',12).then(console.log)"
# put the hash in OWNER_PASSWORD_HASH and set OWNER_USERNAME in .env, then:
npm ci --prefix scripts && npm run bootstrap:owner --prefix scripts

docker compose up -d                    # app + worker + caddy
```

Caddy provisions Let's Encrypt certificates automatically. Meta requires public
HTTPS for the webhook and for every image URL, which is why both hostnames must
resolve before this step.

## 4. Catalog data

Import the catalog from the app: **Catalog → استيراد CSV**. The import updates
unlocked fields automatically and can never overwrite an admin-locked field.

Optional enrichment, run from `scripts/`:

```bash
npm run bootstrap:families --prefix scripts   # group variants into families
npm run embeddings --prefix scripts           # semantic search vectors
npm run fingerprints --prefix scripts         # image fingerprints for photo matching
```

## 5. Connect Meta

Register **one** callback URL for both the Page and Instagram objects:

```
https://app.<domain>/api/meta/webhook
```

with `META_VERIFY_TOKEN` as the verify token, subscribing `messages`,
`messaging_postbacks`, `feed` and (for Instagram) `comments`.

Grant `pages_read_engagement` and `read_insights` to enable real Page/Instagram
reach, views, and engagement on the owner dashboard. The authorizing person must
have the Page's Analyze task. Link the Instagram professional account to the Page
before setting the detected `META_IG_USER_ID`.

Then open **Settings → Channels** in the app and press *فحص الآن*. It runs real
checks and tells you exactly what is connected and what is missing.

## 6. Backups

```bash
cp deploy/crontab.example /etc/cron.d/eh-platform && chmod 644 /etc/cron.d/eh-platform
./scripts/backup.sh        # verify it works once by hand
```

Only the nightly backup needs cron — content scheduling, comment automation,
promotions and analytics all run inside the `worker` container.

## 7. Verify

```bash
curl -s https://app.<domain>/api/health | jq   # 503 until the database answers
docker compose ps                              # postgres, app, worker, caddy up
docker compose logs -f worker | head -20       # "[worker] … starting"
```

## Upgrades

```bash
cd /srv/eh-platform
./scripts/backup.sh
git pull
docker compose build
npm run db:preflight && npm run db:migrate
docker compose up -d
```
