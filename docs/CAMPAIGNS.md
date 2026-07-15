# Campaigns

## Operator workflow

1. Create a draft with an internal name and objective.
2. Attach a product/source image.
3. Enter or edit the post caption.
4. Enter the exact text requested on the generated image, if any.
5. Select aspect ratio and target channel only when needed.
6. Generate, review the warnings, approve or regenerate, then publish/schedule.

The Campaign UI contains variables, not style prompts. Brand aesthetics, photography, composition, lighting, product preservation, and typography live in AI Control. A manually edited caption is preserved until the operator explicitly requests a new generated caption.

## Caption generation

An explicit Generate action loads current `campaign_caption` AI Control instructions, compiles verified campaign/product runtime data, and returns editable text. It never silently rewrites manual copy or invents price, discount, date, stock, or availability facts.

## Image generation and regeneration

Both actions load current AI Control at execution time and call `generateCampaignCreative()` with the objective, saved caption, exact image text, aspect/channel, verified products, and source image. The pipeline uses the centrally configured strongest compatible campaign image model and its ordered fallback chain.

Legacy campaign prompt columns and `campaign_assets.source_prompt` remain for historical compatibility, but new generation never reads them. New/updated AI assets store `source_prompt = null`, prompt trace, requested overlay text, review status, requested/actual model, and whether fallback occurred.

## Preservation and verification

The master creative direction tells the model to build the scene around the supplied product. Separate editable preservation guidance covers shape, color, pattern, material, proportions, stitching, handles, labels, construction, and included pieces.

After generation, a vision comparison reviews source identity and requested text. Results are probabilistic:

- product status: acceptable, warning, unacceptable, or unverifiable;
- overlay status: likely exact, mismatch, missing, unverifiable, or not requested;
- observed text and concerns;
- one automatic retry when fidelity is clearly unacceptable or below threshold.

The UI surfaces these statuses and never describes them as proof. Gemini renders image text itself; Arabic spelling and typography can still fail. Human approval remains mandatory before publication.

## Assets and publishing

Generated output is persisted to the media host as an unapproved review asset. Approval is explicit. Regeneration reuses campaign variables but recompiles current AI Control.

Scheduling and publication continue through `/api/cron/campaign-scheduler`, protected by `CRON_SECRET`. Publication refreshes campaign pricing and calls Meta Graph; activity/integration logs capture the result.

## Deprecated data

Columns such as caption/design/style prompt fields are retained in PostgreSQL so historical records are not destroyed. They are not active authoring controls and are not sources for new generation. Remove them only in a later migration after historical export and production evidence confirm safety.
