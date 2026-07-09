-- =============================================================================
-- 0004 — Admin-locked fields (enforced "admin edits win forever")
-- =============================================================================
-- The catalog truth rule: once an admin edits a customer-facing field, no future
-- scraper sync, CSV re-import, automatic matching or AI suggestion may silently
-- overwrite it. Until now this was convention-only (writers were careful). This
-- column makes it explicit and enforceable:
--
--   products.admin_locked_fields = { "base_price": true, "arabic_name": true, ... }
--
-- Whenever an admin edits a field in the app, its key is set to true here. Sync /
-- match / AI writers consult this map and skip any locked key. See
-- integrations/product-locks.ts for the shared helpers that read/write it.
--
-- Additive + idempotent: safe to re-run.
-- =============================================================================

alter table products
  add column if not exists admin_locked_fields jsonb not null default '{}';

comment on column products.admin_locked_fields is
  'Map of field-name → true for fields an admin has edited. Sync/match/AI writers must not overwrite locked fields.';
