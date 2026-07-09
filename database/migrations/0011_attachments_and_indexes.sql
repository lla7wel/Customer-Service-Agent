-- =============================================================================
-- 0011_attachments_and_indexes.sql — admin attachments + lookup/perf indexes
-- =============================================================================
-- ADDITIVE + SAFE + IDEMPOTENT. Drops nothing. Every object is created
-- IF NOT EXISTS so it is harmless to re-run.
--
-- NOTE: the runtime Inbox attach feature does NOT hard-depend on the
-- conversation_attachments table — it also records attached products into
-- customer_memory.recent_products (which the AI pipeline already reads) and
-- attached images as message rows, so it works even before this migration is
-- applied. This table gives a clean, queryable audit/source-of-truth and is the
-- preferred store once applied. Apply via the Supabase SQL editor.
--
-- Adds:
--   1. conversation_attachments — admin-attached products/images per conversation.
--   2. product_images perf indexes — exact public_url lookup + perceptual_hash scan.
-- =============================================================================

-- 1. Admin attachments (products/images on a conversation/customer) ------------
create table if not exists conversation_attachments (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  customer_id      uuid references customers(id) on delete set null,
  type             text not null check (type in ('product', 'image')),
  product_id       uuid references products(id) on delete set null,
  image_url        text,
  metadata         jsonb not null default '{}',
  created_by       text,                 -- admin email / 'admin'
  created_at       timestamptz not null default now()
);
create index if not exists idx_conv_attach_conv on conversation_attachments(conversation_id, created_at desc);
create index if not exists idx_conv_attach_customer on conversation_attachments(customer_id);
create index if not exists idx_conv_attach_product on conversation_attachments(product_id);

-- 2. product_images lookup/scan indexes ---------------------------------------
-- Exact image-URL → product lookup (matcher step 1, findProductImageByUrl).
create index if not exists idx_product_images_public_url
  on product_images(public_url) where public_url is not null;
-- dHash near-duplicate scan reads only rows whose perceptual_hash is set.
create index if not exists idx_product_images_phash
  on product_images(perceptual_hash) where perceptual_hash is not null;

-- Rollback (manual):
--   drop table if exists conversation_attachments;
--   drop index if exists idx_product_images_public_url;
--   drop index if exists idx_product_images_phash;
