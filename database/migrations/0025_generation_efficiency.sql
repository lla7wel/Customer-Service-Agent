-- =============================================================================
-- 0025 — Reclassify historical non-actionable creative-review uncertainty
-- =============================================================================
-- Older runs treated source-invisible attributes (for example hidden packaging)
-- and verifier disagreement as product failures. Those rows triggered a red
-- alert even when every visible product/text/price/brand check passed. Keep the
-- complete raw verification JSON and every generated asset; only clear warning
-- summaries whose entries are exclusively non-actionable uncertainty.
-- =============================================================================

with non_actionable as (
  select r.id
  from content_generation_runs r
  where r.status = 'completed'
    and r.quality_status = 'warning'
    and jsonb_typeof(r.warnings) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements_text(r.warnings) as warning(value)
      where warning.value not ilike '%could not be verified%'
        and warning.value not ilike '%unverifiable%'
        and warning.value not ilike '%independent creative verifiers%'
        and warning.value <> 'Product fidelity could not be fully verified.'
    )
)
update content_generation_runs r
set quality_status = 'verified',
    warnings = '[]'::jsonb,
    updated_at = now()
from non_actionable n
where r.id = n.id;

update content_items item
set last_error = null,
    updated_at = now()
from content_generation_runs run
where item.selected_generation_run_id = run.id
  and run.status = 'completed'
  and run.quality_status = 'verified'
  and item.status in ('ready', 'approved', 'scheduled')
  and item.last_error is not null
  and (
    item.last_error ilike '%could not be verified%'
    or item.last_error ilike '%unverifiable%'
    or item.last_error ilike '%independent creative verifiers%'
    or item.last_error = 'Product fidelity could not be fully verified.'
  );
