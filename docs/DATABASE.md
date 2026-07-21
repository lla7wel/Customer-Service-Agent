# Database

PostgreSQL 16, accessed through Kysely. Types in `integrations/db/types.ts` are
generated from the live schema (`npm run db:codegen`).

## Migration policy

**Forward-only and idempotent.** An applied migration is never edited — a new
one is added instead.

`scripts/migrate.ts` is the only supported way to change the schema:

```bash
npm run db:preflight   # report the plan, change nothing
npm run db:migrate     # apply
```

It takes a PostgreSQL advisory lock (concurrent deploys cannot race) and then:

- **Fresh database** → `bootstrap.sql` + `schema.sql` + every migration in
  order, each recorded in `schema_migrations`.
- **Existing database** → for every migration not in the ledger it runs a
  read-only **probe** to check whether the effects are already present.
  Present → the ledger row is backfilled (`backfilled = true`). Absent → the
  file is applied in a transaction and recorded.

This repairs the historical state where only 4 of 14 migrations had recorded
themselves, without re-applying anything or rewriting history. Both paths are
covered by integration tests, including an upgrade from a fixture that
reproduces the production ledger gap.

Always run `./scripts/backup.sh` first. Media is backed up with the database
because it cannot be rebuilt.

## Schema map

**Identity and access**
`admin_accounts`, `admin_sessions` (token hashes only), `admin_audit_log`,
`login_attempts`.

**Conversations**
`customers` (channel-scoped identity), `conversations` (one active per customer,
enforced by a partial unique index), `messages` (truthful `delivery_status`),
`customer_memory`, `conversation_attachments`.

**Durable processing**
`inbound_events` (provider-deduped), `jobs` (leased, one live job per dedupe
key), `outbox_messages` (idempotency key, truthful send state).

**Catalog**
`products` (with `admin_locked_fields`, `search_tsv`, `family_id`),
`product_images`, `product_families`, `product_relations`,
`product_price_history`, `promotions` (one open per product),
`product_import_runs`, `product_field_changes`, `product_fingerprints`,
`image_match_corrections`.

**Content Studio**
`content_items`, `content_products`, `content_assets`, `content_publications`
(one per item+platform), `content_comments` (one decision per provider comment).

**Configuration and operations**
`business_facts`, `ai_behaviors`, `ai_behavior_versions`, `ai_events`,
`provider_readiness`, `analytics_daily`, `activity_logs`, `integration_logs`.

Legacy `campaigns`, `campaign_products`, `campaign_assets` and `facebook_posts`
are **retained as history**; migration 0018 surfaces them in Content Studio as
archived items. Nothing was deleted.

## Invariants enforced in the database

| Invariant | Mechanism |
|---|---|
| One active conversation per customer | Partial unique index |
| One live job per dedupe key | Partial unique index |
| One open promotion per product | Partial unique index |
| One publication per (content item, platform) | Unique constraint |
| One decision per (publication, provider comment) | Unique constraint |
| Provider event redelivery is a no-op | Unique index on (provider, topic, key) |
| Outbox idempotency | Unique `idempotency_key` |

## Retention

The worker sweeps every six hours: processed `inbound_events` after 30 days,
completed `jobs` after 7, `login_attempts` and expired `admin_sessions` after
14, `integration_logs` after 60. Customer conversations, catalog data, media and
publication history are **not** swept.
