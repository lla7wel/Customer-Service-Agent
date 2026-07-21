# Architecture

A pragmatic modular monolith plus one worker — sized for ~20–30 conversations
and 10–20 content items per day, three admins, and a 4,700-product catalog.
No Redis, no Kubernetes, no distributed queue.

## Runtime

```
                    Meta (Messenger · Instagram · Pages)
                                  │  webhook (HMAC-verified)
                                  ▼
   Caddy ──► Next.js app ──► PostgreSQL ◄── worker (separate container)
     │        (UI + API)          ▲              │
     │                            │              ├─ ingest_event
     └─► /media (product &        │              ├─ customer_turn (debounced)
         content images)          │              ├─ outbox_deliver
                                  │              ├─ content_publish
                              Gemini API         ├─ comments_poll
                                                 ├─ promotion_tick
                                                 ├─ analytics_refresh
                                                 └─ readiness_check
```

## The durability contract

The webhook does exactly two things: verify the signature, and persist each
event **with its ingest job in one transaction**. Only then does it return 200.
If the database is unavailable it returns 503 so Meta retries — an acknowledged
event is never lost.

Everything else happens in the worker:

1. `ingest_event` → upsert customer, resolve the single active conversation,
   store the message (provider-mid deduped), and enqueue a **debounced**
   `customer_turn` keyed on the conversation. A newer message pushes the same
   job forward rather than creating a second one.
2. `customer_turn` → merge the entire unanswered burst, run matching and the
   model, then persist the reply **and** its outbox rows **and** the conversation
   state in one transaction. Nothing has been sent yet.
3. `outbox_deliver` → the only code that calls the provider send API. It claims
   the row conditionally, sends once, and records the truthful outcome.

```
inbound_events ──► jobs ──► messages + outbox_messages ──► provider
   (durable)      (leased)      (one transaction)          (once)
```

### Why replies cannot duplicate

- One live turn job per conversation (partial unique index on the dedupe key).
- The turn re-checks, **inside the transaction**, that its trigger is still the
  newest inbound; if not it abandons the reply and re-queues.
- Each outbox row transitions `pending → sending` with a conditional UPDATE, so
  two workers cannot both send it.
- An ambiguous outcome (timeout) becomes `uncertain` and is **never** retried
  automatically — only an admin may decide.

### Why posts cannot duplicate

One `content_publications` row per `(item, platform)` with an idempotency key
and a conditional claim. Multi-step flows persist their child media ids, so a
resumed attempt re-uses them. The parent item's status is always derived from
all its publications.

## Module map

| Path | Responsibility |
|---|---|
| `admin-app/` | Next.js UI and authenticated APIs |
| `integrations/jobs/` | Durable queue: enqueue, claim, retry, reap |
| `integrations/pipelines/` | ingest, turn, outbox, content-create, content-publish, comments, analytics |
| `integrations/providers/` | Meta adapters: graph client, messaging, publishing, readiness |
| `integrations/catalog/` | Pricing engine, CSV import, families |
| `integrations/content/` | Deterministic Arabic typography and composition |
| `integrations/tools/` | Read-only tools exposed to the model |
| `integrations/db/` | Kysely client and generated types |
| `worker/` | The background process |
| `database/migrations/` | Forward-only, idempotent migrations |
| `tests/` | unit, integration, e2e |

## Data ownership

- **Admins** own prices, names, status, families and relations. Their edits lock
  the field forever.
- **CSV imports** own unlocked fields.
- **The AI** owns nothing. It reads through validated tools and may only
  *request* actions the server then decides.

## Failure behaviour

| Failure | Result |
|---|---|
| Database down at webhook time | 503 → Meta retries → nothing lost |
| Gemini slow or failing | Bounded timeout per call; turn fails and retries; never hangs a request |
| Provider send fails transiently | Outbox retries with backoff |
| Provider send ambiguous | `uncertain`, surfaced to an admin, never auto-retried |
| Worker crashes mid-job | Lease expires, job returns to the queue |
| Job exhausts retries | `dead` and visible in Settings → Activity |
| One platform fails to publish | `partially_published`; retry targets that platform only |
