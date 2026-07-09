# VPS setup — from zero to production

One small VPS runs everything: Postgres, the Next.js app, and Caddy
(HTTPS + media serving). Tested sizing: Hetzner CX22 (2 vCPU / 4 GB / 40 GB)
— about €5/month.

## 1. Provision

- Ubuntu 24.04 LTS, SSH key auth.
- DNS: point `app.<domain>` and `media.<domain>` A records at the VPS IP.

```bash
apt update && apt upgrade -y
apt install -y ufw curl git
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
#   APP_DOMAIN / MEDIA_DOMAIN / APP_BASE_URL / PUBLIC_MEDIA_BASE_URL
#   CRON_SECRET         openssl rand -hex 24
#   GEMINI_API_KEY, META_* values
docker compose up -d --build
```

## 3. Database schema

```bash
docker compose exec -T postgres psql -U eh -d eh_system < database/schema.sql
for f in database/migrations/0*.sql; do
  docker compose exec -T postgres psql -U eh -d eh_system -v ON_ERROR_STOP=1 < "$f"
done
```

> `schema.sql` predates the Supabase→Postgres migration and references an
> `auth` schema; apply `database/migrations/0013_self_hosted.sql` first on a
> fresh database (it creates the required shims), or use the consolidated
> schema noted there.

## 4. Catalog import (from the local machine that has the scraper data)

```bash
# On the workstation, with DATABASE_URL pointing at the VPS through an SSH tunnel:
ssh -N -L 15432:localhost:5432 root@<vps> &
export DATABASE_URL=postgres://eh:<password>@localhost:15432/eh_system
cd scripts
npm run import:products && npm run catalog:csv
# Media: rsync the scraper images, then run the copy script ON the VPS,
# or mount MEDIA_ROOT locally and rsync /srv/eh-media afterwards.
npm run fingerprints && npm run embeddings && npm run validate
```

## 5. Cron + backups

```bash
crontab -e   # paste deploy/crontab.example (edit paths/secret)
./deploy/backup.sh   # run once; verify a .sql.gz lands in /srv/backups
# Rehearse a restore:
zcat /srv/backups/eh_system-*.sql.gz | docker compose exec -T postgres psql -U eh -d eh_system_restore_test
```

## 6. Meta webhook

developers.facebook.com → your app → Messenger → Webhooks:

- Callback URL: `https://app.<domain>/api/meta/webhook`
- Verify token: the `META_VERIFY_TOKEN` value
- Re-subscribe the page to `messages` + `messaging_postbacks` — Meta disables
  subscriptions after prolonged delivery failures, so this step is mandatory
  after downtime.

## 7. Smoke tests

```bash
HOST=https://app.<domain>
curl -s $HOST/api/health | jq            # database/gemini/meta/cron all configured
curl -I $HOST/api/ai/behaviors           # 401 (auth gate works)
curl -s "$HOST/api/meta/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=test"   # echoes test
curl -I $HOST/dashboard                  # 307 → /login
curl -I https://media.<domain>/products/<code>/00.jpg   # 200 with immutable cache header
```

Then message the page from a personal account and watch `docker compose logs -f app`.
