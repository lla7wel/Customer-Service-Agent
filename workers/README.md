# EH-SYSTEM1 — Cloudflare Workers (optional)

The only production worker is `campaign-scheduler`. The webhook workers
(`messenger-webhook`, `facebook-comments-webhook`) have been deleted — the
unified Next.js route `/api/meta/webhook` is the sole production webhook.

Deploy `campaign-scheduler` only when you want the pricing-refresh cron off the
Next.js runtime.

| Worker | Replaces | Trigger |
|--------|----------|---------|
| `campaign-scheduler` | `/api/cron/campaign-scheduler` | Cron (every 5 min) + manual HTTP |

## Deploy

```bash
cd workers/campaign-scheduler
npm install
# Set each secret (never commit them):
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put CLOUDFLARE_WEBHOOK_SECRET
npx wrangler secret put META_PAGE_ACCESS_TOKEN
npx wrangler secret put META_PAGE_ID
npx wrangler deploy
```

The scheduler calls `runSchedulerTick()` from `integrations/pipelines/campaign.ts`,
the same function the Next.js cron route uses. One implementation, two runtimes.
