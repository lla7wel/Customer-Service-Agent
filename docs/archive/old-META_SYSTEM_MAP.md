# EH-SYSTEM1 — Meta / Facebook System Map

All Meta Graph API access, webhook verification, and outbound send logic lives
in `integrations/meta/index.ts`. Nothing in the UI or pipelines calls the Graph
API directly.

---

## Webhook endpoint

There is **one canonical webhook URL**. Register only this in the Meta App Dashboard:

```
GET/POST  /api/meta/webhook
          admin-app/src/app/api/meta/webhook/route.ts
```

- Handles **Messenger messages** (the comments feature was removed in the AI rebuild).
- GET: echoes `hub.challenge` if `hub.verify_token` matches `META_VERIFY_TOKEN`.
- POST: verifies `X-Hub-Signature-256`, dispatches to `processMessengerEvents()`.

The former split routes and the Cloudflare Worker webhook variants have been
deleted. Only the unified Vercel route is production.

---

## Required environment variables

All in `docs/ENV.md` and `.env.example`. Set in both `EH-SYSTEM1/.env` and
`admin-app/.env.local`.

| Variable | Purpose |
|----------|---------|
| `META_PAGE_ID` | Facebook Page ID |
| `META_PAGE_ACCESS_TOKEN` | Long-lived page access token |
| `META_VERIFY_TOKEN` | Secret token for webhook handshake (you pick this) |
| `META_APP_SECRET` | App secret for `X-Hub-Signature-256` verification |

All four must be set for `metaStatus().configured` to return `true`. A missing
variable causes endpoints to return `503 integration_not_configured` rather than
failing silently.

---

## Outbound send behaviour

When Meta is configured (`metaStatus().configured === true`), the AI pipeline
sends Messenger replies automatically. No env flags gate sending. The single
control is:

- **`ai_enabled`** (per-conversation column) — when `false`, replies are stored
  as internal suggestions (`is_internal_suggestion = true`) and never sent. Admins
  can pause/resume this in the Inbox. The Messenger pipeline may also pause a
  conversation after sending a natural handoff message for order, payment,
  refund/exchange, complaint, delivery-detail, unsafe-image, or missing-price
  cases; this uses `status='needs_human'`, not the removed comments/escalation
  workflow.

---

## Customer profile fetch

When a new Messenger customer is ingested and `first_name` is not yet stored,
the pipeline calls `getUserProfile(psid)` and saves `first_name`, `last_name`,
and `display_name` to the `customers` table. This is best-effort — wrapped in
try/catch and does not block message processing.

---

## Graph API functions (all in `integrations/meta/index.ts`)

| Function | What it does |
|----------|-------------|
| `sendMessage(psid, text)` | Send a Messenger text message to a PSID |
| `publishPhoto(args)` | Publish a single photo post (or schedule it) |
| `publishCarousel(args)` | Upload photos then create a multi-photo feed post |
| `getUserProfile(psid)` | Fetch Messenger user name + profile pic |
| `verifySubscription(params)` | Webhook GET handshake — echo challenge |
| `verifyWebhookSignature(body, header)` | HMAC-SHA256 signature check |
| `parseMessengerWebhook(body)` | Normalize webhook body → MessengerEvent[] |

---

## How to register the webhook with Meta

1. In the Meta App Dashboard → Webhooks → Facebook Page, set the Callback URL to:
   ```
   https://<your-domain>/api/meta/webhook
   ```
2. Set the Verify Token to the value of `META_VERIFY_TOKEN` in your env.
3. Subscribe to `messages` (Messenger) events.
4. The GET handshake is handled automatically by the route.

---

## Webhook signature verification

Every inbound POST is verified with HMAC-SHA256 before any processing.
The raw body bytes (before JSON parse) are signed with `META_APP_SECRET`.
If verification fails the endpoint returns `401 Invalid signature`.

The implementation uses Web Crypto (`crypto.subtle`) with a timing-safe compare,
so it works in Node 18+ and Next.js without any SDK.
Source: `integrations/meta/index.ts` → `verifyWebhookSignature()`.
