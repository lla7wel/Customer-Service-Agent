-- =============================================================================
-- 0018 — Content Studio: content items, assets, publications, comments
-- =============================================================================
-- Campaigns become Content Studio. The old campaigns/campaign_* /facebook_posts
-- tables are PRESERVED as history (nothing dropped); their rows are surfaced in
-- Content Studio as archived historical content via the migration below.
--
-- content_items carries the explicit reliable state machine:
--   draft → generating → ready → approved → scheduled → publishing
--         → published | partially_published | failed → archived
--
-- content_publications is the per-platform unit of exactly-once publishing
-- (idempotency key + provider post id + attempts + truthful status).
--
-- content_comments stores every comment seen on app-published content plus the
-- automated reply decision and provider result.
--
-- Idempotent and forward-only.
-- =============================================================================

create table if not exists content_items (
  id                 uuid primary key default gen_random_uuid(),
  title              text,
  content_type       text not null default 'post' check (content_type in ('post','story')),
  platforms          text[] not null default '{}',        -- subset of {facebook,instagram}
  purpose            text not null default 'general' check (purpose in ('price_drop','general')),
  output_mode        text not null default 'original'
                     check (output_mode in ('original','carousel','combined')),
  image_text_mode    text not null default 'none'
                     check (image_text_mode in ('generated','manual','none')),
  image_text         text,
  caption            text,                                 -- shared FB+IG caption
  status             text not null default 'draft'
                     check (status in ('draft','generating','ready','approved','scheduled',
                                       'publishing','published','partially_published','failed','archived')),
  scheduled_for      timestamptz,                          -- stored UTC; entered Africa/Tripoli
  promotion_ends_at  timestamptz,                          -- optional promo end (price drops)
  comment_automation boolean not null default true,
  approved_by        uuid references admin_accounts(id) on delete set null,
  approved_at        timestamptz,
  created_by         uuid references admin_accounts(id) on delete set null,
  legacy_campaign_id uuid,                                 -- provenance for archived campaigns
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_content_items_status on content_items (status, updated_at desc);
create index if not exists idx_content_items_due
  on content_items (scheduled_for) where status = 'scheduled';
create unique index if not exists uq_content_items_legacy
  on content_items (legacy_campaign_id) where legacy_campaign_id is not null;
drop trigger if exists trg_content_items_updated on content_items;
create trigger trg_content_items_updated before update on content_items
  for each row execute function fn_set_updated_at();

create table if not exists content_products (
  id               uuid primary key default gen_random_uuid(),
  content_item_id  uuid not null references content_items(id) on delete cascade,
  product_id       uuid not null references products(id) on delete cascade,
  -- price_drop: the admin enters ONLY the new price; the old price comes from
  -- verified price history at render/publish time.
  new_price        numeric(12,2) check (new_price is null or new_price > 0),
  show_price       boolean not null default false,         -- general content: optionally show current price
  position         int not null default 0,
  unique (content_item_id, product_id)
);
create index if not exists idx_content_products_item on content_products (content_item_id, position);

create table if not exists content_assets (
  id               uuid primary key default gen_random_uuid(),
  content_item_id  uuid not null references content_items(id) on delete cascade,
  product_id       uuid references products(id) on delete set null,
  kind             text not null check (kind in ('uploaded','original','generated','composed')),
  storage_path     text,
  public_url       text,
  width            int,
  height           int,
  position         int not null default 0,
  overlay          jsonb not null default '{}',            -- deterministic text-overlay spec used
  source_model     text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_content_assets_item on content_assets (content_item_id, position);

create table if not exists content_publications (
  id               uuid primary key default gen_random_uuid(),
  content_item_id  uuid not null references content_items(id) on delete cascade,
  platform         text not null check (platform in ('facebook','instagram')),
  format           text not null check (format in ('feed','carousel','story')),
  status           text not null default 'pending'
                   check (status in ('pending','publishing','published','failed','uncertain','cancelled')),
  idempotency_key  text not null unique,
  provider_post_id text,
  permalink_url    text,
  -- Story frames / carousel children uploaded so far (resume without duplicates).
  provider_children jsonb not null default '[]',
  attempts         int not null default 0,
  max_attempts     int not null default 4,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (content_item_id, platform)
);
create index if not exists idx_content_publications_pending
  on content_publications (next_attempt_at) where status in ('pending','uncertain');
drop trigger if exists trg_content_publications_updated on content_publications;
create trigger trg_content_publications_updated before update on content_publications
  for each row execute function fn_set_updated_at();

create table if not exists content_comments (
  id                   uuid primary key default gen_random_uuid(),
  publication_id       uuid not null references content_publications(id) on delete cascade,
  provider_comment_id  text not null,
  parent_comment_id    text,
  author_name          text,
  author_external_id   text,
  body                 text,
  commented_at         timestamptz,
  decision             text check (decision in
                         ('reply_price','reply_dm','skip_own','skip_old','skip_disabled','human_attention')),
  decision_reason      text,
  reply_text           text,
  reply_status         text check (reply_status in ('pending','sent','failed','skipped')),
  reply_provider_id    text,
  reply_error          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (publication_id, provider_comment_id)
);
create index if not exists idx_content_comments_pub on content_comments (publication_id, created_at desc);
drop trigger if exists trg_content_comments_updated on content_comments;
create trigger trg_content_comments_updated before update on content_comments
  for each row execute function fn_set_updated_at();

-- Wire the deferred FKs from 0017 now that content_items exists.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_price_history_content_item') then
    alter table product_price_history
      add constraint fk_price_history_content_item
      foreign key (content_item_id) references content_items(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_promotions_content_item') then
    alter table promotions
      add constraint fk_promotions_content_item
      foreign key (content_item_id) references content_items(id) on delete set null;
  end if;
end $$;

-- Archive legacy campaigns into Content Studio as clearly-historical items.
insert into content_items (title, content_type, platforms, purpose, output_mode,
                           image_text_mode, caption, status, legacy_campaign_id, created_at)
select c.name,
       'post',
       array['facebook']::text[],
       case when c.discount_percent is not null and c.discount_percent > 0
            then 'price_drop' else 'general' end,
       'original',
       'none',
       c.generated_caption,
       'archived',
       c.id,
       c.created_at
  from campaigns c
 where not exists (select 1 from content_items ci where ci.legacy_campaign_id = c.id);

-- Carry the products of archived campaigns over for browsable history.
insert into content_products (content_item_id, product_id, position)
select ci.id, cp.product_id, cp.position
  from campaign_products cp
  join content_items ci on ci.legacy_campaign_id = cp.campaign_id
 where not exists (select 1 from content_products x
                    where x.content_item_id = ci.id and x.product_id = cp.product_id);
