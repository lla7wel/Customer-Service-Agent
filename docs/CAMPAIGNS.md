# EH-SYSTEM1 — Campaigns

How Facebook marketing campaigns are built, priced, and published from the admin app.

---

## Campaign lifecycle

```
Draft → [add products] → [add assets] → [generate caption] → Scheduled | Published
                                                                ↑
                                             campaign-scheduler refreshes pricing
                                             and calls Meta Graph API on publish time
```

---

## Creating a campaign

1. **Campaigns → New** — enter a name, start/end dates, and optionally a discount percentage.
2. Save as draft.

---

## Attaching products

1. In the campaign editor, click "Add products".
2. Search by name, code, or category.
3. Attach products. Each attached product creates a `campaign_products` row.
4. Optional: set a `override_price` per product (for a specific campaign price, independent of the discount percentage).

`fn_refresh_product_pricing()` computes each product's `campaign_price` and `active_price` when the campaign is published. The function picks the winner when multiple campaigns overlap: highest `priority`, then latest `starts_at`. Products attached to the campaign get their `active_price` updated to the campaign price for the campaign's active window.

---

## Campaign assets

Each product in the campaign can have one or more images:
- **Upload** a product photo.
- **AI image generation** — click "Generate image" and describe what you want. Gemini (`GEMINI_IMAGE_MODEL`) generates a campaign-style image. If the primary model is rate-limited, the system automatically falls back to `GEMINI_IMAGE_FALLBACK_MODEL`, then `GEMINI_IMAGE_LAST_FALLBACK_MODEL`. The admin UI shows which model was used and flags if a fallback was used.

A unique constraint on `campaign_assets(campaign_id, product_id, kind) WHERE product_id IS NOT NULL` prevents duplicate asset rows when a product is re-attached.

---

## Generating captions

1. With products and assets attached, click "Generate caption".
2. Gemini (`GEMINI_MARKETING_TEXT_MODEL`) writes a short Libyan-Arabic caption using the product names, prices, and campaign context.
3. Edit the caption in the text field if needed.

The caption model is the **text** model — the image model does not generate text in images. The instruction to the image model explicitly suppresses Arabic text, logos, prices, and ornaments inside the image, leaving clean space for a text overlay added later.

---

## Scheduling and publishing

- **Schedule:** set a publish date/time. The campaign-scheduler cron (`workers/campaign-scheduler` or `/api/cron/campaign-scheduler`) checks every 5 minutes and publishes campaigns whose `starts_at` has arrived.
- **Publish now:** triggers the same flow immediately.

On publish:
1. `fn_refresh_product_pricing()` is called — `campaign_price` and `active_price` are updated for all attached products.
2. The Facebook post (photo or carousel) is created via the Meta Graph API.
3. A `facebook_posts` row is created.
4. Campaign `status` → `published`.
5. `activity_logs` and `integration_logs` record the result.

If Meta publish fails, the campaign status is set to `failed` and the error is in `integration_logs`.

---

## Comment auto-reply rules

**Removed.** There are no comment-reply rules on campaigns. The `campaigns.comment_reply_rules` column was dropped in migration 0012. The Facebook comments feature is not part of this system.

---

## Debugging campaign failures

1. Check `campaigns.status` — if `failed`, the Meta publish call failed.
2. Check `integration_logs WHERE integration='meta' AND direction='outbound'` — look for the campaign publish event and its error.
3. Check `activity_logs` for the scheduler run.
4. Verify `META_PAGE_ACCESS_TOKEN` has not expired and the page has posting permissions.
5. Check that `fn_refresh_product_pricing()` ran without error — pricing errors surface in `activity_logs`.

---

## Campaign pricing refresh (standalone)

To refresh campaign pricing without publishing:

```sql
select fn_refresh_product_pricing();
```

Or trigger the campaign scheduler: `POST /api/cron/campaign-scheduler` with `Authorization: Bearer <CRON_SECRET>` (the host crontab does this every 5 minutes).
