-- =============================================================================
-- 0017 — Catalog truth: families, relations, price history, promotions,
--        business facts, full-catalog retrieval
-- =============================================================================
-- The catalog becomes the durable customer-facing source of truth:
--   * product_families group genuine variations (sizes/colors/set pieces);
--   * product_relations link variants / set members / complementary items,
--     with admin corrections permanently overriding automatic decisions;
--   * every price change is versioned in product_price_history;
--   * promotions replace the old campaign-price model: a temporary promotion
--     restores the correct prior price automatically and never overwrites a
--     later manual/CSV price; overlaps are prevented by a partial unique index;
--   * business_facts stores branches/hours/contacts as structured, editable
--     settings instead of prompt prose;
--   * a maintained tsvector + existing trigram/keyword indexes give indexed
--     full-catalog retrieval (no silent 5k/8k caps — EH-014);
--   * field-level CSV import change log (product_field_changes).
--
-- Idempotent and forward-only. Nothing is deleted.
-- =============================================================================

-- 1. Families and variants ----------------------------------------------------
create table if not exists product_families (
  id          uuid primary key default gen_random_uuid(),
  family_key  text unique,                  -- normalized grouping key (auto bootstrap)
  name        text not null,
  name_ar     text,
  kind        text not null default 'auto' check (kind in ('auto','admin')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_product_families_updated on product_families;
create trigger trg_product_families_updated before update on product_families
  for each row execute function fn_set_updated_at();

alter table products add column if not exists family_id uuid references product_families(id) on delete set null;
-- An admin-corrected family assignment must never be overwritten by the
-- automatic grouper.
alter table products add column if not exists family_locked boolean not null default false;
alter table products add column if not exists variant_label text;          -- e.g. 'أبيض · 160×220'
alter table products add column if not exists variant_attributes jsonb not null default '{}';
create index if not exists idx_products_family on products (family_id);

create table if not exists product_relations (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products(id) on delete cascade,
  related_product_id  uuid not null references products(id) on delete cascade,
  relation_type       text not null check (relation_type in ('variant','set_member','complementary','similar')),
  source              text not null default 'auto' check (source in ('auto','admin')),
  -- locked=true (admin decision) survives automatic regeneration.
  locked              boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (product_id, related_product_id, relation_type),
  check (product_id <> related_product_id)
);
create index if not exists idx_product_relations_product on product_relations (product_id);

-- 2. Price history ------------------------------------------------------------
create table if not exists product_price_history (
  id               bigint generated always as identity primary key,
  product_id       uuid not null references products(id) on delete cascade,
  old_price        numeric(12,2),
  new_price        numeric(12,2),
  source           text not null check (source in
                     ('manual','csv_import','promotion_start','promotion_end','migration')),
  changed_by       uuid references admin_accounts(id) on delete set null,
  content_item_id  uuid,                     -- linked price-drop content (FK added in 0018)
  import_run_id    uuid references product_import_runs(id) on delete set null,
  note             text,
  effective_at     timestamptz not null default now()
);
create index if not exists idx_price_history_product
  on product_price_history (product_id, effective_at desc);

-- Baseline: current verified prices become the first history entries, so a
-- price-drop visual always has a real "before" price to show.
insert into product_price_history (product_id, old_price, new_price, source, note)
select p.id, null, p.base_price, 'migration', 'baseline from existing catalog price'
  from products p
 where p.base_price is not null
   and not exists (select 1 from product_price_history h where h.product_id = p.id);

-- 3. Promotions ---------------------------------------------------------------
create table if not exists promotions (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id) on delete cascade,
  content_item_id  uuid,                     -- FK added in 0018
  promo_price      numeric(12,2) not null check (promo_price > 0),
  previous_price   numeric(12,2) not null,
  starts_at        timestamptz,
  ends_at          timestamptz,              -- null = permanent price drop
  status           text not null default 'pending'
                   check (status in ('pending','active','ended','cancelled')),
  created_by       uuid references admin_accounts(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Overlapping promotions for one product are prevented, not silently merged.
create unique index if not exists uq_promotions_one_open_per_product
  on promotions (product_id) where status in ('pending','active');
create index if not exists idx_promotions_due
  on promotions (ends_at) where status = 'active' and ends_at is not null;
drop trigger if exists trg_promotions_updated on promotions;
create trigger trg_promotions_updated before update on promotions
  for each row execute function fn_set_updated_at();

-- 4. Business facts -----------------------------------------------------------
create table if not exists business_facts (
  key         text primary key,
  value       jsonb not null,
  label_ar    text,
  label_en    text,
  updated_by  uuid references admin_accounts(id) on delete set null,
  updated_at  timestamptz not null default now()
);

insert into business_facts (key, value, label_ar, label_en) values
  ('branches', jsonb_build_array(
     'طرابلس – السياحية، مقابل مركز حمودة',
     'طرابلس – حي الأندلس، مقابل ليبيا تويز',
     'مصراتة – شارع طرابلس، مقابل بوشعالة ER'
   ), 'الفروع', 'Branches'),
  ('working_hours', to_jsonb('من 10:00 صباحاً إلى 10:30 مساءً'::text), 'ساعات العمل', 'Working hours'),
  ('phone', to_jsonb('0923322008'::text), 'الهاتف', 'Phone'),
  ('delivery_available', to_jsonb(true), 'التوصيل متوفر', 'Delivery available'),
  ('pickup_available', to_jsonb(true), 'الاستلام من الفرع متوفر', 'Branch pickup available'),
  ('order_whatsapp_url', to_jsonb('https://wh.ms/218923322008'::text), 'واتساب الطلبات', 'Order WhatsApp'),
  ('order_whatsapp_benghazi', to_jsonb('0924565511'::text), 'واتساب فرع بنغازي', 'Benghazi branch WhatsApp')
on conflict (key) do nothing;

-- 5. Indexed full-catalog retrieval -------------------------------------------
alter table products add column if not exists search_tsv tsvector;

create or replace function fn_products_search_tsv() returns trigger as $$
begin
  new.search_tsv :=
    to_tsvector('simple',
      coalesce(new.libyan_display_name, '') || ' ' ||
      coalesce(new.arabic_name, '')        || ' ' ||
      coalesce(new.english_name, '')       || ' ' ||
      coalesce(new.source_name, '')        || ' ' ||
      coalesce(new.product_code, '')       || ' ' ||
      coalesce(new.barcode, '')            || ' ' ||
      coalesce(array_to_string(new.search_keywords, ' '), '') || ' ' ||
      coalesce(array_to_string(new.arabic_keywords, ' '), ''));
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_products_search_tsv on products;
create trigger trg_products_search_tsv before insert or update on products
  for each row execute function fn_products_search_tsv();

-- Backfill existing rows (fires the trigger via a no-op update only where needed).
update products set updated_at = updated_at where search_tsv is null;

create index if not exists idx_products_search_tsv on products using gin (search_tsv);
create index if not exists idx_products_barcode on products (barcode) where barcode is not null;

-- 6. CSV import field-level change log ----------------------------------------
create table if not exists product_field_changes (
  id             bigint generated always as identity primary key,
  product_id     uuid not null references products(id) on delete cascade,
  import_run_id  uuid references product_import_runs(id) on delete set null,
  field          text not null,
  old_value      text,
  new_value      text,
  source         text not null default 'csv_import',
  changed_by     uuid references admin_accounts(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_product_field_changes_product
  on product_field_changes (product_id, created_at desc);
create index if not exists idx_product_field_changes_run
  on product_field_changes (import_run_id);
