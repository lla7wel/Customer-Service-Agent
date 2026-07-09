# Deployment

The platform self-hosts on a single VPS with Docker Compose (Postgres 16 +
Next.js standalone + Caddy). The full zero-to-production runbook — domain,
TLS, database, catalog import, Meta webhook, cron, backups, smoke tests —
lives at **[deploy/setup-vps.md](deploy/setup-vps.md)**.

Quick reference:

```bash
cp .env.example .env        # fill in secrets (see the runbook)
docker compose up -d --build
```
