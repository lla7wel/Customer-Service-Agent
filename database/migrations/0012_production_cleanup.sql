-- =============================================================================
-- 0012_production_cleanup.sql — production simplification cleanup
-- =============================================================================
-- DESTRUCTIVE but scoped. Removes the Orders module, legacy escalations,
-- unused product_variants, the legacy ai_settings table, and the Facebook
-- comment-rules column. Adds two safety/perf constraints.
--
-- Run AFTER deploying the code that no longer references these objects
-- (orders/order_items inbox actions, escalations reads, comment_reply_rules).
-- Apply via the Supabase SQL editor. Wrapped in a single transaction so a
-- failure rolls back cleanly.
--
-- SAFETY: orders + order_items are copied into *_archive tables before being
-- dropped, so nothing is lost. The archive tables can be exported and dropped
-- later once you are satisfied.
-- =============================================================================

begin;

-- 1. Archive orders + order_items before dropping (data preservation) ---------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'orders') then
    execute 'create table if not exists orders_archive as table orders';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'order_items') then
    execute 'create table if not exists order_items_archive as table order_items';
  end if;
end $$;

-- 2. Migrate any conversations off the order-only statuses --------------------
--    (the order_draft/order_confirmed enum values stay defined but unused —
--    Postgres cannot cleanly drop an enum value, and an unused value is inert).
update conversations set status = 'needs_human'
  where status in ('order_draft', 'order_confirmed');

-- 3. Drop the conversations.order_draft_id column (cascades its FK) -----------
alter table conversations drop column if exists order_draft_id;

-- 4. Drop the Orders module tables (order_items first for FK order) -----------
drop table if exists order_items cascade;
drop table if exists orders cascade;

-- 5. Drop legacy escalations (no active writer; UI read removed) --------------
drop table if exists escalations cascade;

-- 6. Drop unused product_variants (schema/FK only, never written) -------------
drop table if exists product_variants cascade;

-- 7. Drop legacy ai_settings (fully replaced by ai_behaviors) -----------------
drop table if exists ai_settings cascade;

-- 8. Remove the Facebook comment-rules column from campaigns ------------------
alter table campaigns drop column if exists comment_reply_rules;

-- 9. Prevent duplicate campaign assets on re-attach --------------------------
--    Dedupe existing product-linked assets (keep the earliest per
--    campaign/product/kind), skipping any row referenced as a source by an
--    AI-edited asset, then add a partial unique index (nulls = AI assets are
--    intentionally allowed to repeat).
delete from campaign_assets a
  using campaign_assets b
  where a.product_id is not null
    and a.product_id = b.product_id
    and a.campaign_id = b.campaign_id
    and a.kind = b.kind
    and a.created_at > b.created_at
    and a.id not in (select source_asset_id from campaign_assets where source_asset_id is not null);

create unique index if not exists uq_campaign_assets_campaign_product_kind
  on campaign_assets (campaign_id, product_id, kind)
  where product_id is not null;

-- 10. Speed up customer-facing active/priced product queries -----------------
create index if not exists idx_products_active_priced
  on products (active_price)
  where status = 'active' and active_price is not null;

commit;

-- =============================================================================
-- OPTIONAL (run separately, only after verifying it holds nothing you need):
--   The products.raw JSONB holds scraper-import provenance and is not read at
--   runtime. It is intentionally LEFT IN PLACE here. To drop it later:
--     select count(*) from products where raw <> '{}'::jsonb;   -- inspect first
--     alter table products drop column if exists raw;
--
-- ROLLBACK (manual): orders/order_items data survives in *_archive. Recreate
-- the dropped tables from an earlier schema.sql and restore from the archives
-- only alongside a code revert.
-- =============================================================================
