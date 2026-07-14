# VPS setup — from zero to production

One small VPS runs everything: Postgres, the Next.js app, and Caddy
(HTTPS + media serving). Tested sizing: Hetzner CX23 (2 vCPU / 4 GB / 40 GB)
— about €5/month. This runbook was last exercised end-to-end on a fresh
Ubuntu 24.04 box; every command below is the one that actually ran.

## 1. Provision

- Ubuntu 24.04 LTS, SSH key auth.
- DNS: point `app.<domain>` and `media.<domain>` A records at the VPS IP.

```bash
apt update && apt upgrade -y
apt install -y ufw curl git rsync
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
# Docker
curl -fsSL https://get.docker.com | sh
```

## 2. Deploy

```bash
mkdir -p /srv/eh-platform && cd /srv/eh-platform
git clone <your-repo-url> .
cp .env.example .env
# Fill in .env:
#   POSTGRES_PASSWORD   openssl rand -hex 24
#   SESSION_SECRET      openssl rand -hex 32
#   ADMIN_EMAIL / ADMIN_PASSWORD_HASH
#     node -e "require('bcryptjs').hash(process.argv[1],12).then(console.log)" 'your-password'
#     (run from admin-app/, where bcryptjs is installed)
#   APP_DOMAIN / MEDIA_DOMAIN / APP_BASE_URL / PUBLIC_MEDIA_BASE_URL
#   CRON_SECRET         openssl rand -hex 24
#   GEMINI_API_KEY, META_* values

# Publish postgres + app on the host loopback (cron tick and server-side
# scripts need them; nothing is exposed publicly):
cat > docker-compose.override.yml <<'EOF'
services:
  postgres:
    ports:
      - "127.0.0.1:5432:5432"
  app:
    ports:
      - "127.0.0.1:3000:3000"
EOF

docker compose up -d --build
```

## 3. Database schema

Bootstrap order matters on a fresh database: `0013_self_hosted.sql` first (it
creates the `auth` shim that `schema.sql` still expects), then `schema.sql`,
then every migration in order (0013 is idempotent and re-runs harmlessly).

```bash
cd /srv/eh-platform
docker compose exec -T postgres psql -U eh -d eh_system -v ON_ERROR_STOP=1 < database/migrations/0013_self_hosted.sql
docker compose exec -T postgres psql -U eh -d eh_system -v ON_ERROR_STOP=1 < database/schema.sql
for f in database/migrations/0*.sql; do
  docker compose exec -T postgres psql -U eh -d eh_system -v ON_ERROR_STOP=1 < "$f"
done
```

## 4. Catalog import

Run the import scripts **on the VPS** — per-row latency through an SSH tunnel
makes the tunneled variant ~50× slower (hours instead of minutes).

```bash
# On the VPS: node 22 + script deps
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
cd /srv/eh-platform && npm ci --ignore-scripts && cd scripts && npm ci

# From the workstation: ship the scraper data (images are the big part)
rsync -a --partial <scraper>/data/images/ root@<vps>:/srv/scraper-images/
scp <scraper>/data/output/products-with-images.json root@<vps>:/srv/scraper-data/output/
scp <scraper>/data/input/catalog.csv root@<vps>:/srv/scraper-data/input/

# On the VPS: scripts/.env (loaded after the repo-root .env; values already set
# there — notably MEDIA_ROOT — must be overridden on the command line instead)
cat > /srv/eh-platform/scripts/.env <<EOF
DATABASE_URL=postgres://eh:<POSTGRES_PASSWORD>@127.0.0.1:5432/eh_system
SCRAPER_OUTPUT_DIR=/srv/scraper-data/output
SCRAPER_IMAGES_DIR=/srv/scraper-images
CATALOG_CSV_PATH=/srv/scraper-data/input/catalog.csv
EOF
chmod 600 /srv/eh-platform/scripts/.env

cd /srv/eh-platform/scripts
npm run import:products && npm run catalog:csv
# MEDIA_ROOT must point at the docker volume; the repo-root .env value
# (/srv/eh-media) is the in-container path and wins over scripts/.env:
MEDIA_ROOT=/var/lib/docker/volumes/eh-platform_media/_data npm run upload:images
chown -R 100:101 /var/lib/docker/volumes/eh-platform_media/_data   # app uid:gid
npm run fingerprints && npm run embeddings && npm run validate
```

## 5. Cron + backups

```bash
cp deploy/crontab.example /etc/cron.d/eh-platform && chmod 644 /etc/cron.d/eh-platform
# Manual tick — expect {"ok":true,...}:
curl -fsS -m 30 -X POST -H "Authorization: Bearer $(grep -m1 ^CRON_SECRET= /srv/eh-platform/.env | cut -d= -f2)" http://127.0.0.1:3000/api/cron/campaign-scheduler
./deploy/backup.sh   # run once; verify a .sql.gz lands in /srv/backups
# Rehearse a restore:
zcat /srv/backups/eh_system-*.sql.gz | docker compose exec -T postgres psql -U eh -d eh_system_restore_test
```

## 6. Meta webhook

The page-level subscription usually survives downtime; the app-level callback
URL is what must be re-pointed. Both are scriptable — no dashboard needed:

```bash
# Re-point the app subscription (Meta verifies the callback synchronously,
# so the stack must already be serving HTTPS). The verify token may contain
# URL-special characters — always --data-urlencode it.
curl -X POST "https://graph.facebook.com/v21.0/<APP_ID>/subscriptions" \
  --data-urlencode "access_token=<APP_ID>|<APP_SECRET>" \
  --data-urlencode "object=page" \
  --data-urlencode "callback_url=https://app.<domain>/api/meta/webhook" \
  --data-urlencode "verify_token=<META_VERIFY_TOKEN>" \
  --data-urlencode "fields=messages,messaging_postbacks"

# Re-subscribe the page (mandatory after prolonged delivery failures):
curl -X POST "https://graph.facebook.com/v21.0/me/subscribed_apps" \
  --data-urlencode "subscribed_fields=messages,messaging_postbacks" \
  --data-urlencode "access_token=<PAGE_ACCESS_TOKEN>"
```

## 7. Smoke tests

```bash
HOST=https://app.<domain>
curl -s $HOST/api/health | jq            # database/gemini/meta/cron all configured
curl -I $HOST/api/ai/behaviors           # 401 (auth gate works)
curl -sG $HOST/api/meta/webhook --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=<token>" --data-urlencode "hub.challenge=test"   # echoes test
curl -I $HOST/dashboard                  # 307 → /login
curl -I https://media.<domain>/products/<code>/00.jpg   # 200 with immutable cache header
```

Then message the page from a personal account and watch `docker compose logs -f app`.
