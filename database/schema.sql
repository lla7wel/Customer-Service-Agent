-- =============================================================================
-- EH-SYSTEM1 — Supabase / Postgres schema
-- =============================================================================
-- English Home Libya admin & control center.
--
-- Run this whole file once in the Supabase SQL editor (or psql) on a fresh
-- project. It is idempotent-ish: it uses CREATE TYPE / CREATE TABLE guards so
-- re-running is safe-ish, but prefer the migrations/ folder for incremental
-- changes after the first deploy.
--
-- Design notes (full rationale in docs/ARCHITECTURE.md):
--   * UUID primary keys (gen_random_uuid) everywhere.
--   * Status fields are Postgres ENUMs so bad values are rejected at the DB.
--   * RLS is ENABLED on every table. v0 ships a single "admin" role: any
--     authenticated user gets full access. The service_role key (scripts +
--     server) bypasses RLS automatically. Per-role policies can be layered on
--     later without schema changes.
--   * Pricing: campaign discounts override base price. The source of truth is
--     the `product_active_pricing` view + `fn_active_price()`; products also
--     carry CACHED campaign_price/active_price columns that the campaign
--     scheduler refreshes for fast reads. See the PRICING section below.
-- =============================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists pg_trgm;        -- fuzzy product search

-- -----------------------------------------------------------------------------
-- ENUM TYPES
-- -----------------------------------------------------------------------------
do $$ begin
  create type admin_role as enum ('admin');         -- v0: single role. Extendable.
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel as enum ('messenger', 'facebook_comment', 'instagram', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Who/what produced an outbound message (or labelled an inbound one).
  create type message_sender_type as enum ('customer', 'ai', 'human', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Full conversation lifecycle from the brief.
  create type conversation_status as enum (
    'new',
    'ai_handling',
    'needs_human',
    'human_active',
    'waiting_for_customer',
    'order_draft',
    'order_confirmed',
    'pickup_requested',
    'delivery_requested',
    'resolved',
    'spam',
    'blocked',
    'waiting_for_order_confirmation',
    'completed',
    'cancelled',
    'waiting_for_customer_info',
    'issue_refund_exchange'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- Coarse bucket for escalations. The exact reason is LLM-classified free text
  -- stored alongside; this enum is only for filtering/analytics.
  create type escalation_category as enum (
    'customer_requested_human',
    'product_not_found',
    'order_confirmation',
    'complaint_refund_exchange',
    'abuse_bad_words',
    'image_match_failed',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_status as enum ('active', 'draft', 'archived', 'out_of_stock');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Per the brief: assume available if it exists in the DB; admin can override.
  create type availability_assumption as enum ('assume_available', 'confirmed_available', 'unavailable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum (
    'waiting_for_customer_info',
    'waiting_for_order_confirmation',
    'completed',
    'cancelled',
    'issue_refund_exchange'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type fulfillment_method as enum ('pickup', 'delivery', 'undecided');
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_type as enum (
    'single_product_discount',
    'multi_product_carousel',
    'category_sale',
    'flash_sale',
    'clearance',
    'seasonal'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_status as enum ('draft', 'scheduled', 'publishing', 'published', 'paused', 'archived', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_asset_kind as enum ('original_product_image', 'uploaded_image', 'ai_edited_image', 'ai_generated_image', 'final_post_image');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fb_post_type as enum ('image', 'carousel', 'text');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fb_post_status as enum ('draft', 'scheduled', 'publishing', 'published', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type import_run_status as enum ('running', 'completed', 'completed_with_errors', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type image_match_outcome as enum ('exact', 'multiple', 'none', 'corrected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type integration_kind as enum ('supabase', 'gemini', 'meta', 'cloudflare');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- updated_at trigger helper
-- -----------------------------------------------------------------------------
create or replace function fn_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

-- =============================================================================
-- 1. ADMIN / IDENTITY
-- =============================================================================
-- Mirrors Supabase auth.users (id = auth uid). v0 single admin role.
create table if not exists admin_users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text unique not null,
  full_name     text,
  role          admin_role not null default 'admin',
  preferred_locale text not null default 'ar',     -- 'ar' | 'en'
  is_active     boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_admin_users_updated on admin_users;
create trigger trg_admin_users_updated before update on admin_users
  for each row execute function fn_set_updated_at();

-- =============================================================================
-- 2. CUSTOMERS
-- =============================================================================
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  -- Platform-scoped identity (Messenger PSID, FB user id, etc.)
  channel         channel not null default 'messenger',
  external_id     text,                              -- PSID / FB id / phone
  display_name    text,
  first_name      text,
  last_name       text,
  profile_pic_url text,
  locale_guess    text,                              -- detected language of the customer
  phone           text,
  address         text,
  city            text,
  notes           text,
  is_blocked      boolean not null default false,
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (channel, external_id)
);
drop trigger if exists trg_customers_updated on customers;
create trigger trg_customers_updated before update on customers
  for each row execute function fn_set_updated_at();

-- =============================================================================
-- 3. CONVERSATIONS
-- =============================================================================
create table if not exists conversations (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid references customers(id) on delete set null,
  channel             channel not null default 'messenger',
  status              conversation_status not null default 'new',
  -- AI control: when false the AI is PAUSED and will not auto-reply.
  ai_enabled          boolean not null default true,
  -- LLM-detected intent for the latest turn (free text, e.g. "price_inquiry").
  detected_intent     text,
  -- Short operational summary the admin can read at a glance.
  context_summary     text,
  -- The customer's preferred/likely language (AI still replies in Libyan Arabic).
  customer_language   text,
  assigned_admin_id   uuid references admin_users(id) on delete set null,
  -- Denormalized helpers for the inbox list (kept fresh by app/triggers).
  last_message_at         timestamptz,
  last_message_preview    text,
  last_human_reply_at     timestamptz,
  last_customer_message_at timestamptz,
  unread_count        int not null default 0,
  -- Pointer to the live order draft for this conversation, if any.
  order_draft_id      uuid,                          -- FK added after orders table
  is_spam             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
drop trigger if exists trg_conversations_updated on conversations;
create trigger trg_conversations_updated before update on conversations
  for each row execute function fn_set_updated_at();
create index if not exists idx_conversations_status on conversations(status);
create index if not exists idx_conversations_last_msg on conversations(last_message_at desc);
create index if not exists idx_conversations_customer on conversations(customer_id);

-- =============================================================================
-- 4. MESSAGES
-- =============================================================================
create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  direction        message_direction not null,
  sender_type      message_sender_type not null,
  sender_admin_id  uuid references admin_users(id) on delete set null,
  body             text,
  -- Attachments: array of {type:'image'|'file', url, storage_path, width, height}
  attachments      jsonb not null default '[]',
  -- Per-message AI metadata (intent, confidence, matched product ids, etc.)
  ai_meta          jsonb not null default '{}',
  -- For outbound AI suggestions that were NOT sent (internal suggestions).
  is_internal_suggestion boolean not null default false,
  -- Platform message id (idempotency for webhooks).
  external_id      text,
  delivered_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);
-- Idempotency for webhook re-delivery: a platform message id is unique when present.
create unique index if not exists uq_messages_external on messages(external_id) where external_id is not null;

-- =============================================================================
-- 5. CONVERSATION LABELS  (free-form tags / saved filters per conversation)
-- =============================================================================
create table if not exists conversation_labels (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  label            text not null,
  color            text,                              -- optional UI hint
  created_by       uuid references admin_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (conversation_id, label)
);
create index if not exists idx_conv_labels_conv on conversation_labels(conversation_id);

-- =============================================================================
-- 6. ESCALATIONS  (LLM-classified; no fixed templates)
-- =============================================================================
create table if not exists escalations (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  category         escalation_category not null default 'other',
  -- The LLM's free-text reason (the brief: "LLM classifies, no fixed templates").
  reason           text,
  -- Optional structured context the AI extracted (product ids, order id, etc.)
  context          jsonb not null default '{}',
  suggested_action text,
  resolved         boolean not null default false,
  resolved_by      uuid references admin_users(id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_escalations_open on escalations(resolved, created_at desc);
create index if not exists idx_escalations_conv on escalations(conversation_id);

-- =============================================================================
-- 7. PRODUCTS
-- =============================================================================
-- Source of truth = this table. Filled from: scraper import, manual admin edits.
-- Fields cover both current scraper output and the future product model.
create table if not exists products (
  id                      uuid primary key default gen_random_uuid(),
  product_code            text unique not null,       -- scraper product_code (stock code)
  barcode                 text,
  -- Names: the scraper gives a Turkish product_name; English/Arabic are enriched.
  source_name             text,                        -- raw scraper product_name (TR)
  english_name            text,
  arabic_name             text,
  libyan_display_name     text,                        -- what customers actually see
  category                text,
  subcategory             text,
  -- Pricing (Libyan dinar). base_price is the regular price.
  base_price              numeric(12,2),
  -- CACHED campaign values, refreshed by the campaign scheduler / triggers.
  -- Source of truth is the product_active_pricing view (see PRICING section).
  campaign_price          numeric(12,2),
  active_price            numeric(12,2),               -- = campaign_price if on sale else base_price
  active_campaign_id      uuid,                        -- FK added after campaigns table
  website_url             text,                        -- scraper product_url (reference only)
  status                  product_status not null default 'active',
  availability            availability_assumption not null default 'assume_available',
  -- Search assistance for image/text matching.
  search_keywords         text[] not null default '{}',
  arabic_keywords         text[] not null default '{}',
  primary_image_id        uuid,                        -- FK added after product_images
  -- Provenance.
  import_run_id           uuid,                        -- FK added after product_import_runs
  source                  text not null default 'scraper', -- 'scraper' | 'csv' | 'manual'
  raw                     jsonb not null default '{}', -- full raw scraper record
  -- Map of field-name → true for fields an admin has edited. Sync/match/AI
  -- writers must skip locked fields ("admin edits win forever"). See
  -- integrations/product-locks.ts. Added in migration 0004.
  admin_locked_fields     jsonb not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated before update on products
  for each row execute function fn_set_updated_at();
create index if not exists idx_products_status on products(status);
create index if not exists idx_products_category on products(category);
create index if not exists idx_products_name_trgm on products using gin (
  (coalesce(libyan_display_name,'') || ' ' || coalesce(arabic_name,'') || ' ' ||
   coalesce(english_name,'') || ' ' || coalesce(source_name,'')) gin_trgm_ops
);
create index if not exists idx_products_keywords on products using gin (search_keywords);
create index if not exists idx_products_arkeywords on products using gin (arabic_keywords);

-- =============================================================================
-- 8. PRODUCT IMAGES
-- =============================================================================
create table if not exists product_images (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  -- Local path from the scraper output (reference until uploaded).
  local_path        text,
  -- Supabase Storage object path once uploaded (bucket: eh-media).
  storage_path      text,
  public_url        text,
  position          int not null default 0,
  is_primary        boolean not null default false,
  width             int,
  height            int,
  -- Optional embedding/hash for image recognition (filled by the vision pipeline).
  perceptual_hash   text,
  embedding         jsonb,                             -- vector stored as json for v0
  created_at        timestamptz not null default now()
);
create index if not exists idx_product_images_product on product_images(product_id, position);
create unique index if not exists uq_primary_image_per_product
  on product_images(product_id) where is_primary;

-- Now wire products.primary_image_id ➜ product_images
alter table products
  drop constraint if exists fk_products_primary_image;
alter table products
  add constraint fk_products_primary_image
  foreign key (primary_image_id) references product_images(id) on delete set null;

-- =============================================================================
-- 9. PRODUCT VARIANTS  (size/color SKUs under one product code family)
-- =============================================================================
create table if not exists product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  variant_code  text,                                  -- e.g. the trailing SKU digits
  barcode       text,
  color         text,
  size          text,
  attributes    jsonb not null default '{}',
  base_price    numeric(12,2),
  active_price  numeric(12,2),
  availability  availability_assumption not null default 'assume_available',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, variant_code)
);
drop trigger if exists trg_variants_updated on product_variants;
create trigger trg_variants_updated before update on product_variants
  for each row execute function fn_set_updated_at();

-- =============================================================================
-- 10. PRODUCT IMPORT RUNS  (audit of each scraper import)
-- =============================================================================
create table if not exists product_import_runs (
  id              uuid primary key default gen_random_uuid(),
  source          text not null default 'scraper',
  source_file     text,                                -- e.g. products-with-images.json
  status          import_run_status not null default 'running',
  total_records   int not null default 0,
  created_count   int not null default 0,
  updated_count   int not null default 0,
  skipped_count   int not null default 0,
  error_count     int not null default 0,
  errors          jsonb not null default '[]',
  started_by      uuid references admin_users(id) on delete set null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index if not exists idx_import_runs_started on product_import_runs(started_at desc);

alter table products
  drop constraint if exists fk_products_import_run;
alter table products
  add constraint fk_products_import_run
  foreign key (import_run_id) references product_import_runs(id) on delete set null;

-- =============================================================================
-- 11. IMAGE MATCH CORRECTIONS  (human-in-the-loop; improves future matching)
-- =============================================================================
create table if not exists image_match_corrections (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid references conversations(id) on delete set null,
  message_id        uuid references messages(id) on delete set null,
  -- The customer image that was matched.
  customer_image_url   text,
  customer_image_path  text,
  customer_image_hash  text,
  -- What the AI proposed vs. what the human said is correct.
  ai_suggested_product_ids uuid[] not null default '{}',
  ai_top_score      numeric,
  outcome           image_match_outcome not null default 'corrected',
  corrected_product_id uuid references products(id) on delete set null,
  corrected_by      uuid references admin_users(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_img_corr_product on image_match_corrections(corrected_product_id);
create index if not exists idx_img_corr_hash on image_match_corrections(customer_image_hash);

-- =============================================================================
-- 11b. CATALOG MATCH SUGGESTIONS  (persistent CSV↔scraper image-match review)
-- =============================================================================
-- One row per CSV product missing an image: the current best scraper suggestion
-- plus a review `state`. Refresh upserts 'possible'/'no_match'; admin actions set
-- 'approved'/'rejected'/'no_match'/'needs_review'. See migration 0003 and
-- integrations/catalog-match.ts. Admin decisions are preserved across refreshes.
create table if not exists catalog_match_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  csv_product_id      uuid not null references products(id) on delete cascade,
  scraper_product_id  uuid references products(id) on delete set null,
  score               numeric,
  confidence          text,                                 -- 'high'|'medium'|'low'|'none'
  evidence            jsonb not null default '{}',
  state               text not null default 'possible',     -- possible|approved|rejected|no_match|needs_review
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

-- =============================================================================
-- 12. ORDERS  (internal DRAFTS — never placed on the EH Turkey website)
-- =============================================================================
create table if not exists orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      bigint generated always as identity,  -- human-friendly ref
  conversation_id   uuid references conversations(id) on delete set null,
  customer_id       uuid references customers(id) on delete set null,
  status            order_status not null default 'waiting_for_customer_info',
  fulfillment       fulfillment_method not null default 'undecided',
  -- Collected order info (the brief's required fields).
  customer_name     text,
  phone             text,
  address           text,
  city              text,
  delivery_notes    text,
  subtotal          numeric(12,2) not null default 0,
  discount_total    numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,
  currency          text not null default 'LYD',
  -- Free-form issue/refund/exchange context if status = issue_refund_exchange.
  issue_notes       text,
  created_by        uuid references admin_users(id) on delete set null,  -- null = AI
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
drop trigger if exists trg_orders_updated on orders;
create trigger trg_orders_updated before update on orders
  for each row execute function fn_set_updated_at();
create index if not exists idx_orders_status on orders(status, created_at desc);
create index if not exists idx_orders_conversation on orders(conversation_id);

-- Wire conversations.order_draft_id ➜ orders
alter table conversations
  drop constraint if exists fk_conversations_order_draft;
alter table conversations
  add constraint fk_conversations_order_draft
  foreign key (order_draft_id) references orders(id) on delete set null;

-- =============================================================================
-- 13. ORDER ITEMS
-- =============================================================================
create table if not exists order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  variant_id    uuid references product_variants(id) on delete set null,
  -- Snapshot fields so the draft is stable even if the product changes later.
  product_code  text,
  name_snapshot text,
  unit_price    numeric(12,2) not null default 0,     -- the active_price at add time
  base_price_snapshot numeric(12,2),
  campaign_id   uuid,                                  -- which campaign set the price (if any)
  quantity      int not null default 1 check (quantity > 0),
  line_total    numeric(12,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_order_items_order on order_items(order_id);

-- =============================================================================
-- 14. CAMPAIGNS
-- =============================================================================
create table if not exists campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  type              campaign_type not null default 'single_product_discount',
  status            campaign_status not null default 'draft',
  -- Single discount applied to all products in the campaign (the brief).
  discount_percent  numeric(5,2) check (discount_percent >= 0 and discount_percent <= 100),
  starts_at         timestamptz,
  ends_at           timestamptz,
  -- Overlap resolution: higher priority wins; tie-break = latest starts_at.
  priority          int not null default 0,
  caption_tone      text,                              -- e.g. "friendly", "urgent"
  design_prompt     text,                              -- AI image-edit instructions
  caption_prompt    text,                              -- AI caption instructions
  generated_caption text,                              -- last AI caption (Arabic/Libyan)
  comment_reply_rules text,                            -- free-text rules for FB comment AI
  publish_mode      text not null default 'manual',    -- 'manual' | 'now' | 'scheduled'
  scheduled_for     timestamptz,
  auto_publish      boolean not null default false,
  created_by        uuid references admin_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
drop trigger if exists trg_campaigns_updated on campaigns;
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function fn_set_updated_at();
create index if not exists idx_campaigns_status on campaigns(status);
create index if not exists idx_campaigns_window on campaigns(starts_at, ends_at);

-- Wire products.active_campaign_id ➜ campaigns
alter table products
  drop constraint if exists fk_products_active_campaign;
alter table products
  add constraint fk_products_active_campaign
  foreign key (active_campaign_id) references campaigns(id) on delete set null;

-- =============================================================================
-- 15. CAMPAIGN PRODUCTS  (m:n + optional per-product price override)
-- =============================================================================
create table if not exists campaign_products (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  product_id      uuid not null references products(id) on delete cascade,
  -- If set, this overrides discount_percent for THIS product in THIS campaign.
  override_price  numeric(12,2),
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  unique (campaign_id, product_id)
);
create index if not exists idx_campaign_products_campaign on campaign_products(campaign_id);
create index if not exists idx_campaign_products_product on campaign_products(product_id);

-- =============================================================================
-- 16. CAMPAIGN ASSETS  (images: original / uploaded / AI-edited / final)
-- =============================================================================
create table if not exists campaign_assets (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  product_id      uuid references products(id) on delete set null,
  kind            campaign_asset_kind not null,
  storage_path    text,
  public_url      text,
  source_prompt   text,                                -- prompt used for AI edits
  caption         text,
  position        int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_campaign_assets_campaign on campaign_assets(campaign_id, position);

-- =============================================================================
-- 17. FACEBOOK POSTS
-- =============================================================================
create table if not exists facebook_posts (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references campaigns(id) on delete set null,
  type            fb_post_type not null default 'image',
  status          fb_post_status not null default 'draft',
  caption         text,
  -- Asset ids in display order (carousel).
  asset_ids       uuid[] not null default '{}',
  -- Meta Graph ids after publishing.
  fb_post_id      text,
  permalink_url   text,
  scheduled_for   timestamptz,
  published_at    timestamptz,
  error           text,
  created_by      uuid references admin_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_fb_posts_updated on facebook_posts;
create trigger trg_fb_posts_updated before update on facebook_posts
  for each row execute function fn_set_updated_at();
create index if not exists idx_fb_posts_status on facebook_posts(status, scheduled_for);

-- =============================================================================
-- 18. (removed) FACEBOOK COMMENTS — the comments feature was removed. See
--     database/migrations/0010_remove_facebook_comments.sql. Messenger, campaign
--     publishing and facebook_posts are unaffected.
-- =============================================================================

-- =============================================================================
-- 18b. AI BRAIN — customer memory, product embeddings, correction fingerprints
--      (also in database/migrations/0009_ai_brain.sql). No pgvector required;
--      embeddings are JSON float arrays compared in code.
-- =============================================================================
-- Per-customer persistent AI memory.
create table if not exists customer_memory (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references customers(id) on delete cascade,
  summary              text,
  recent_products      jsonb not null default '[]',
  preferences          jsonb not null default '{}',
  known_facts          text[] not null default '{}',
  known_name           text,
  known_phone          text,
  known_address        text,
  last_conversation_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (customer_id)
);
create index if not exists idx_customer_memory_customer on customer_memory(customer_id);
create index if not exists idx_customer_memory_last_convo on customer_memory(last_conversation_at desc);

-- Real semantic embedding for products (JSON float array; populated by
-- scripts/generate-embeddings.ts). NULL until generated → vector search skips it.
alter table products add column if not exists text_embedding jsonb;

-- Admin-correction image fingerprints (the learning loop).
create table if not exists product_fingerprints (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  hash_hex        text not null,
  source          text not null default 'admin_correction',
  correction_id   uuid references image_match_corrections(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_product_fingerprints_product on product_fingerprints(product_id);
create index if not exists idx_product_fingerprints_hash on product_fingerprints(hash_hex);

-- Deterministic lookup indexes for the controlled AI tools.
create index if not exists idx_products_website_url on products(website_url) where website_url is not null;

-- =============================================================================
-- 19. AI SETTINGS  (single live row of editable prompts/rules)
-- =============================================================================
-- Prompt changes go live immediately. We keep one "active" row + history via
-- updated_at; the app reads the active row on every AI call.
create table if not exists ai_settings (
  id                      uuid primary key default gen_random_uuid(),
  is_active               boolean not null default true,
  system_prompt           text,                        -- master persona / rules
  reply_language_rule     text not null default
    'Always reply to customers in Libyan Arabic, regardless of the language they wrote in.',
  product_recommendation_rules text,
  escalation_rules        text,
  campaign_caption_tone   text default 'friendly, professional, Libyan Arabic',
  comment_reply_rules     text,
  -- Model overrides (else env defaults are used).
  text_model              text,
  vision_model            text,
  image_model             text,
  temperature             numeric(3,2) default 0.7,
  updated_by              uuid references admin_users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
drop trigger if exists trg_ai_settings_updated on ai_settings;
create trigger trg_ai_settings_updated before update on ai_settings
  for each row execute function fn_set_updated_at();
create unique index if not exists uq_ai_settings_active on ai_settings(is_active) where is_active;

-- Per-behavior AI configuration (prompt + rules + memory). ai_settings keeps
-- model overrides + temperature + master system_prompt; ai_behaviors carries the
-- editable content for each behavior. See migration 0005. Each Gemini call loads
-- its behavior so admin edits apply immediately.
create table if not exists ai_behaviors (
  id            uuid primary key default gen_random_uuid(),
  behavior_key  text unique not null,   -- customer_service, image_matching, escalation, ...
  title         text not null,
  prompt        text,
  rules         text,
  memory        text,
  enabled       boolean not null default true,
  updated_by    uuid references admin_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_ai_behaviors_updated on ai_behaviors;
create trigger trg_ai_behaviors_updated before update on ai_behaviors
  for each row execute function fn_set_updated_at();

-- =============================================================================
-- 20. AI EVENTS  (every Gemini call: chat, intent, vision, caption, etc.)
-- =============================================================================
create table if not exists ai_events (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,                       -- 'chat'|'intent'|'vision'|'caption'|'comment'|'image_edit'|'playground'
  conversation_id uuid references conversations(id) on delete set null,
  related_id      uuid,                                -- message/comment/campaign id
  model           text,
  prompt_summary  text,
  -- Useful operational output only (NOT hidden chain-of-thought).
  output_summary  text,
  detected_intent text,
  confidence      numeric,
  latency_ms      int,
  token_input     int,
  token_output    int,
  success         boolean not null default true,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ai_events_created on ai_events(created_at desc);
create index if not exists idx_ai_events_kind on ai_events(kind);
create index if not exists idx_ai_events_errors on ai_events(success) where not success;

-- =============================================================================
-- 21. ACTIVITY LOGS  (human-readable feed across the system)
-- =============================================================================
create table if not exists activity_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_type    text not null default 'system',        -- 'human'|'ai'|'system'
  actor_id      uuid references admin_users(id) on delete set null,
  action        text not null,                         -- 'human_message'|'order_edit'|'product_match'|'campaign_generated'|'fb_post'|'fb_comment_reply'...
  entity_type   text,                                  -- 'conversation'|'order'|'product'|'campaign'|'facebook_post'...
  entity_id     uuid,
  summary       text,
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists idx_activity_created on activity_logs(created_at desc);
create index if not exists idx_activity_entity on activity_logs(entity_type, entity_id);

-- =============================================================================
-- 22. INTEGRATION LOGS  (raw inbound/outbound integration traffic + errors)
-- =============================================================================
create table if not exists integration_logs (
  id            uuid primary key default gen_random_uuid(),
  integration   integration_kind not null,
  direction     text not null default 'inbound',       -- 'inbound'|'outbound'
  endpoint      text,
  status_code   int,
  ok            boolean not null default true,
  request       jsonb,
  response      jsonb,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_integration_logs_created on integration_logs(created_at desc);
create index if not exists idx_integration_logs_errors on integration_logs(ok) where not ok;

-- =============================================================================
-- PRICING  (campaign discounts override base price)
-- =============================================================================
-- Rule (documented in docs/ARCHITECTURE.md#pricing):
--   active_price = campaign price IF the product is in a currently-active
--                  campaign, ELSE base_price.
--   campaign price = campaign_products.override_price
--                    ELSE round(base_price * (1 - discount_percent/100), 2).
-- Overlap: if a product is in >1 active campaign, the winner is the one with
-- the highest `priority`; ties break on the latest `starts_at`. This lets the
-- admin force priority while defaulting to "latest active campaign wins".

create or replace function fn_now() returns timestamptz language sql stable as $$ select now() $$;

-- For each product, the single winning active campaign (if any) + computed price.
create or replace view product_active_pricing as
with active as (
  select
    cp.product_id,
    c.id          as campaign_id,
    c.priority,
    c.starts_at,
    p.base_price,
    case
      when cp.override_price is not null then cp.override_price
      when c.discount_percent is not null and p.base_price is not null
        then round(p.base_price * (1 - c.discount_percent / 100.0), 2)
      else null
    end as computed_campaign_price,
    row_number() over (
      partition by cp.product_id
      order by c.priority desc, c.starts_at desc nulls last
    ) as rn
  from campaign_products cp
  join campaigns c on c.id = cp.campaign_id
  join products  p on p.id = cp.product_id
  where c.status in ('published', 'publishing', 'scheduled')
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at   is null or c.ends_at   >= now())
)
select
  p.id as product_id,
  p.base_price,
  a.campaign_id            as active_campaign_id,
  a.computed_campaign_price as campaign_price,
  coalesce(a.computed_campaign_price, p.base_price) as active_price
from products p
left join active a on a.product_id = p.id and a.rn = 1;

-- Convenience scalar function used by the app/order draft creation.
create or replace function fn_active_price(p_product_id uuid)
returns numeric language sql stable as $$
  select active_price from product_active_pricing where product_id = p_product_id;
$$;

-- Refresh the CACHED columns on products from the view. The campaign scheduler
-- worker calls this (or the app calls it after campaign edits).
create or replace function fn_refresh_product_pricing() returns void language plpgsql as $$
begin
  update products p
  set campaign_price     = v.campaign_price,
      active_price       = v.active_price,
      active_campaign_id = v.active_campaign_id
  from product_active_pricing v
  where v.product_id = p.id
    and (p.campaign_price is distinct from v.campaign_price
      or p.active_price   is distinct from v.active_price
      or p.active_campaign_id is distinct from v.active_campaign_id);
end; $$;

-- =============================================================================
-- ROW LEVEL SECURITY  (v0: single admin role — any authenticated user = admin)
-- =============================================================================
-- service_role (scripts + server) bypasses RLS automatically. These policies
-- govern the browser/anon+auth client. Tighten per-role later without schema
-- changes.
do $$
declare t text;
begin
  foreach t in array array[
    'admin_users','customers','customer_memory','conversations','messages','conversation_labels',
    'escalations','products','product_images','product_variants','product_fingerprints',
    'product_import_runs','image_match_corrections','orders','order_items',
    'campaigns','campaign_products','campaign_assets','facebook_posts',
    'ai_settings','ai_events','activity_logs','integration_logs'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_admin_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true);',
      t || '_admin_all', t);
  end loop;
end $$;

-- =============================================================================
-- DONE. Seed prompts + bucket reminder live in database/seed/.
-- After running this file:
--   1) Create a Storage bucket named `eh-media` (public read) in Supabase.
--   2) Run database/seed/seed.sql for the default AI settings row.
--   3) Create your admin user (docs/SETUP.md) and insert into admin_users.
-- =============================================================================
