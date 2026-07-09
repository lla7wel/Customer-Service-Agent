-- =============================================================================
-- 0003 — Catalog match suggestions (persistent match/review state)
-- =============================================================================
-- Until now, image-match suggestions were recomputed live on every page load and
-- the only persisted facts were buried in products.raw
-- (catalog_match_attached / catalog_match_rejected). That made the review states
-- the admin needs — possible / approved / rejected / no-safe-match / needs-review
-- — invisible and unqueryable.
--
-- This table is the persistent backbone: ONE row per CSV product that is missing
-- an image (unique csv_product_id), holding the current best scraper suggestion,
-- its score/confidence/evidence, and a review `state`. The matcher refresh
-- (POST /api/catalog-match/refresh) upserts 'possible'/'no_match' rows; admin
-- actions set 'approved' / 'rejected' / 'no_match' / 'needs_review'. Admin
-- decisions are preserved by refresh (admin edits win forever).
--
-- Additive + idempotent.
-- =============================================================================

create table if not exists catalog_match_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  -- The active/priced CSV product that needs an image.
  csv_product_id      uuid not null references products(id) on delete cascade,
  -- The scraper product whose images we'd attach (null for a 'no_match' row).
  scraper_product_id  uuid references products(id) on delete set null,
  score               numeric,                              -- raw matcher score
  confidence          text,                                 -- 'high'|'medium'|'low'|'none'
  evidence            jsonb not null default '{}',          -- matcher signals/shared/reason
  state               text not null default 'possible',     -- see below
  reviewed_by         uuid references admin_users(id) on delete set null,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (csv_product_id),
  constraint chk_cms_state check (state in
    ('possible','approved','rejected','no_match','needs_review')),
  constraint chk_cms_confidence check (confidence is null or confidence in
    ('high','medium','low','none'))
);

create index if not exists idx_cms_state on catalog_match_suggestions(state, confidence);
create index if not exists idx_cms_scraper on catalog_match_suggestions(scraper_product_id);

drop trigger if exists trg_cms_updated on catalog_match_suggestions;
create trigger trg_cms_updated before update on catalog_match_suggestions
  for each row execute function fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill from the existing products.raw history so the new state filters are
-- populated immediately (approved first, then rejected; unique csv wins once).
-- ---------------------------------------------------------------------------
insert into catalog_match_suggestions
  (csv_product_id, scraper_product_id, state, confidence, evidence, reviewed_at)
select p.id,
       nullif(att->>'scraper_product_id','')::uuid,
       'approved',
       'high',
       jsonb_build_object('backfill', true, 'source', 'raw.catalog_match_attached'),
       nullif(att->>'attached_at','')::timestamptz
from products p
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(p.raw->'catalog_match_attached') = 'array'
       then p.raw->'catalog_match_attached' else '[]'::jsonb end) as att
where p.source = 'csv'
  and nullif(att->>'scraper_product_id','') is not null
on conflict (csv_product_id) do nothing;

insert into catalog_match_suggestions
  (csv_product_id, scraper_product_id, state, evidence, reviewed_at)
select p.id,
       nullif(rej->>'scraper_product_id','')::uuid,
       'rejected',
       jsonb_build_object('backfill', true, 'source', 'raw.catalog_match_rejected',
                          'reason', rej->>'reason'),
       nullif(rej->>'rejected_at','')::timestamptz
from products p
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(p.raw->'catalog_match_rejected') = 'array'
       then p.raw->'catalog_match_rejected' else '[]'::jsonb end) as rej
where p.source = 'csv'
  and nullif(rej->>'scraper_product_id','') is not null
on conflict (csv_product_id) do nothing;
