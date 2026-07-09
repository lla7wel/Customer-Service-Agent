-- =============================================================================
-- 0009_ai_brain.sql — AI product-recognition brain (memory + embeddings + learning)
-- =============================================================================
-- ADDITIVE + SAFE. No data is dropped; every column/table is created IF NOT
-- EXISTS so this is idempotent and harmless to re-run. Applying it BEFORE the
-- code ships is fine; the code degrades gracefully if it has not been applied
-- yet (memory reads return null, vector search returns [], fingerprint scan is
-- skipped). No pgvector extension is required — embeddings are stored as JSON
-- float arrays and compared in code (consistent with the existing dHash scan),
-- so this runs on any standard Postgres / Supabase project.
--
-- Adds:
--   1. customer_memory          — per-customer persistent AI memory.
--   2. products.text_embedding  — real semantic embedding (JSON float array).
--   3. product_fingerprints     — admin-correction image fingerprints (learning).
--   4. lookup indexes           — website_url + normalized code/barcode for O(log n)
--                                 exact lookups used by the controlled AI tools.
-- =============================================================================

-- 1. Per-customer AI memory ---------------------------------------------------
create table if not exists customer_memory (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references customers(id) on delete cascade,
  summary              text,                               -- rolling AI summary of who this customer is
  recent_products      jsonb not null default '[]',        -- [{product_id,name,price,resolved_at,match_type}] newest first, max 10
  preferences          jsonb not null default '{}',        -- {preferred_color: "blue", ...}
  known_facts          text[] not null default '{}',       -- freeform durable facts
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

-- 2. Product semantic text embedding (real, from Gemini embedding model) -------
-- Stored as JSON float array so no pgvector extension is required. Populated by
-- scripts/generate-embeddings.ts. NULL until generated → vector search simply
-- skips that product (never a fake/zero vector).
alter table products add column if not exists text_embedding jsonb;

-- 3. Admin-correction fingerprints (the learning loop) ------------------------
-- When an admin confirms the correct product for a customer image, its dHash is
-- stored here. Future near-identical customer images match instantly. This makes
-- the same mistake progressively less likely over time.
create table if not exists product_fingerprints (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  hash_hex        text not null,                          -- 16-char dHash of a confirmed customer image
  source          text not null default 'admin_correction', -- 'admin_correction' | 'upload'
  correction_id   uuid references image_match_corrections(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_product_fingerprints_product on product_fingerprints(product_id);
create index if not exists idx_product_fingerprints_hash on product_fingerprints(hash_hex);

-- 4. Deterministic lookup indexes for the controlled AI tools -----------------
-- website_url exact lookup (findProductByUrl).
create index if not exists idx_products_website_url on products(website_url) where website_url is not null;
-- normalized product_code lookup (findProductByCode): lower + strip non-alnum.
create index if not exists idx_products_code_norm
  on products (lower(regexp_replace(coalesce(product_code,''), '[^a-zA-Z0-9]', '', 'g')))
  where product_code is not null;
-- normalized barcode lookup (findProductByBarcode): digits only.
create index if not exists idx_products_barcode_norm
  on products (regexp_replace(coalesce(barcode,''), '\D', '', 'g'))
  where barcode is not null;

-- =============================================================================
-- ROLLBACK (manual):
--   drop table if exists customer_memory;
--   drop table if exists product_fingerprints;
--   alter table products drop column if exists text_embedding;
--   drop index if exists idx_products_website_url;
--   drop index if exists idx_products_code_norm;
--   drop index if exists idx_products_barcode_norm;
-- =============================================================================
