-- Cutover helper: repoint stored public image URLs at the self-hosted media
-- domain. storage_path keys are unchanged (products/CODE/NN.jpg), so this is
-- a pure host swap. Run once with your media base URL:
--
--   psql -v media_base="'https://media.example.com'" -f database/rewrite-media-urls.sql

update product_images
set public_url = :media_base || '/' || storage_path
where storage_path is not null;

update campaign_assets
set public_url = :media_base || '/' || storage_path
where storage_path is not null;
