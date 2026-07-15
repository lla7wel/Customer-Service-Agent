# Database

The source for a fresh database is `database/schema.sql`; deployed databases advance through ordered files in `database/migrations/`. TypeScript access uses Kysely types in `integrations/db/types.ts` and row helpers in `integrations/db/rows.ts`.

PostgreSQL is reachable only inside the Docker network. Admin authorization is the jose middleware/session boundary; Supabase RLS and browser database clients are not part of the current architecture.

## Principal data

| Area | Tables |
|---|---|
| Messaging | `customers`, `conversations`, `messages`, `conversation_labels`, `conversation_attachments` |
| Catalog | `products`, `product_images`, `product_fingerprints`, `image_match_corrections`, `catalog_match_suggestions`, `product_import_runs` |
| Marketing | `campaigns`, `campaign_products`, `campaign_assets`, `facebook_posts` |
| AI/operations | `ai_behaviors`, `customer_memory`, `ai_events`, `activity_logs`, `integration_logs` |

`products.active_price` is customer price truth. The pricing function chooses the active campaign winner and otherwise uses base price. AI tools expose only eligible verified product facts.

## AI Control

`ai_behaviors` stores each editable section in `prompt`, `rules`, and `memory`, plus `enabled`. Existing administrator-authored rows are never replaced by migration 0014. Missing new keys are inserted with defaults; conflict handling preserves live content.

## Campaign variables and evidence

Migration 0014 adds `campaigns.objective`, `image_text`, `aspect_ratio`, and `target_channel`. It adds asset evidence fields: `prompt_trace_id`, `requested_overlay_text`, `overlay_text_status`, `product_fidelity_status`, `verification`, `requested_model`, `actual_model`, and `fallback_used`.

Legacy campaign/style prompt columns and `campaign_assets.source_prompt` remain intact but are deprecated and ignored for new generation/regeneration.

## Migration history

| Migration | Purpose |
|---|---|
| 0001–0004 | Initial platform, pricing review, catalog matching, admin field locks |
| 0005–0009 | AI behaviors, batching, fingerprints, campaign review, memory/embeddings |
| 0010–0013 | Remove comments, add attachments/indexes, production cleanup, detach Supabase RLS |
| 0014 | Central AI Control sections, campaign variables, generation/verification evidence |

0014 is forward-only and data-preserving. It does not drop historical columns or overwrite existing behavior keys.

## Deployment rule

Never edit an applied migration. Before applying a new one: create `pg_dump`, run `gzip -t`, restore to a scratch database, apply the migration there with `ON_ERROR_STOP`, then apply once to production. Record the deployed Git commit and retain the pre-migration application image/commit for rollback.

Do not manually edit message/audit records, derived `active_price`, or AI behavior rows. Use the authenticated admin workflows.
