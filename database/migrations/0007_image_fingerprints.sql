-- 0007_image_fingerprints.sql
-- Real image matching: perceptual-hash (dHash) fingerprints for product images +
-- learned customer-image corrections.
--
-- product_images.perceptual_hash already exists (was unused) — we now populate it
-- via scripts/generate-image-fingerprints.ts and compare a customer photo's dHash
-- against it (Hamming distance) at reply time, alongside code/barcode/URL/keyword
-- and Gemini-vision signals.
--
-- Additive/safe: only indexes + a backfill-friendly column comment. No data change.

-- Fast "does this product image have a fingerprint" filtering + equality lookups.
create index if not exists idx_product_images_phash
  on public.product_images (perceptual_hash)
  where perceptual_hash is not null;

-- Correction learning: find past corrections by their stored customer-image hash.
create index if not exists idx_img_corrections_customer_hash
  on public.image_match_corrections (customer_image_hash)
  where customer_image_hash is not null;

-- Corrections that resolved to a product are the learning signal.
create index if not exists idx_img_corrections_corrected_product
  on public.image_match_corrections (corrected_product_id)
  where corrected_product_id is not null;

insert into public.schema_migrations (version)
values ('0007_image_fingerprints')
on conflict (version) do nothing;
