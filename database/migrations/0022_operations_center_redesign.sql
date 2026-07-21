-- =============================================================================
-- 0022 — Operations Center redesign: durable creative revisions + Brand Kit
-- =============================================================================
-- Forward-only and non-destructive. Existing content/assets remain available.
-- Source media and publishable output are made explicit so an upload can never
-- accidentally become a carousel child.
-- =============================================================================

alter table content_items add column if not exists creative_treatment text not null default 'ai_scene';
alter table content_items add column if not exists multi_product_layout text not null default 'carousel';
alter table content_items add column if not exists aspect_ratio text not null default '4:5';
alter table content_items add column if not exists config_revision int not null default 1;
alter table content_items add column if not exists image_text_approved boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'content_items_creative_treatment_check') then
    alter table content_items add constraint content_items_creative_treatment_check
      check (creative_treatment in ('ai_scene','use_original'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_items_multi_product_layout_check') then
    alter table content_items add constraint content_items_multi_product_layout_check
      check (multi_product_layout in ('carousel','composition'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_items_aspect_ratio_check') then
    alter table content_items add constraint content_items_aspect_ratio_check
      check (aspect_ratio in ('4:5','9:16'));
  end if;
end $$;

create table if not exists content_generation_runs (
  id                 uuid primary key default gen_random_uuid(),
  content_item_id    uuid not null references content_items(id) on delete cascade,
  status             text not null default 'queued'
                     check (status in ('queued','running','completed','failed')),
  stage              text not null default 'queued'
                     check (stage in ('queued','analyzing','creating','verifying_product','verifying_text','finished','failed')),
  config_revision    int not null,
  config_fingerprint text not null,
  requested_model    text,
  source_model       text,
  attempt_count      int not null default 0,
  prompt_trace_id    text,
  verification       jsonb not null default '{}',
  warnings           jsonb not null default '[]',
  quality_status     text not null default 'pending'
                     check (quality_status in ('pending','verified','warning','failed')),
  last_error         text,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_by         uuid references admin_accounts(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_content_generation_runs_item
  on content_generation_runs (content_item_id, created_at desc);
create index if not exists idx_content_generation_runs_status
  on content_generation_runs (status, created_at);
drop trigger if exists trg_content_generation_runs_updated on content_generation_runs;
create trigger trg_content_generation_runs_updated before update on content_generation_runs
  for each row execute function fn_set_updated_at();

alter table content_assets add column if not exists asset_role text not null default 'output';
alter table content_assets add column if not exists generation_run_id uuid references content_generation_runs(id) on delete set null;
alter table content_assets add column if not exists config_revision int;
alter table content_assets add column if not exists selected_for_publish boolean not null default false;
alter table content_assets add column if not exists aspect_ratio text;
alter table content_assets add column if not exists verification jsonb not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'content_assets_asset_role_check') then
    alter table content_assets add constraint content_assets_asset_role_check
      check (asset_role in ('source','output'));
  end if;
end $$;

-- Uploaded media is a source reference. Existing generated/composed/original
-- output stays publishable for historical failed/partial items.
update content_assets set asset_role = 'source', selected_for_publish = false
 where kind = 'uploaded' and asset_role <> 'source';
update content_assets set asset_role = 'output', selected_for_publish = true,
       config_revision = coalesce(config_revision, 1)
 where kind in ('original','generated','composed') and asset_role = 'output';
create index if not exists idx_content_assets_selected
  on content_assets (content_item_id, position) where selected_for_publish = true and asset_role = 'output';

alter table content_items add column if not exists selected_generation_run_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_content_items_selected_generation') then
    alter table content_items add constraint fk_content_items_selected_generation
      foreign key (selected_generation_run_id) references content_generation_runs(id) on delete set null;
  end if;
end $$;

create table if not exists brand_kit (
  id               int primary key default 1 check (id = 1),
  wordmark         text not null default 'ENGLISH HOME LIBYA',
  logo_storage_path text,
  logo_public_url  text,
  primary_color    text not null default '#123553',
  accent_color     text not null default '#A8916B',
  updated_by       uuid references admin_accounts(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
insert into brand_kit (id) values (1) on conflict (id) do nothing;
drop trigger if exists trg_brand_kit_updated on brand_kit;
create trigger trg_brand_kit_updated before update on brand_kit
  for each row execute function fn_set_updated_at();

-- The old square default was an implementation accident. Existing stories are
-- corrected to 9:16; new posts default to the approved 4:5 format.
update content_items set aspect_ratio = case when content_type = 'story' then '9:16' else '4:5' end;
