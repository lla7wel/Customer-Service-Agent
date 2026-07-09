-- =============================================================================
-- 0002 — Price-review staging
-- =============================================================================
-- Source-of-truth rule: the admin app owns prices. A scraped product with no
-- price must NOT be customer-visible until an admin reviews and prices it.
--
-- "Needs price review" is defined as: base_price IS NULL.
-- Customer-visible is defined as:     status = 'active' AND base_price IS NOT NULL.
--
-- This migration moves every existing priceless product out of the customer-
-- visible 'active' state into 'draft' (the staging state). The CSV catalog is
-- then imported by `scripts/import-csv-catalog.ts` (npm run catalog:csv), which
-- activates + prices every product present in catalog.csv. Scraped-only products
-- with no CSV (and no admin) price stay in 'draft' / Product Review until an
-- admin adds an Arabic/English name + price. Re-running this migration is safe
-- (it only touches still-priceless rows).
-- =============================================================================

update products
   set status = 'draft'
 where base_price is null
   and status = 'active';

-- Helpful partial index for the price-review queue.
create index if not exists idx_products_needs_price
  on products (updated_at desc)
  where base_price is null;
