# Troubleshooting

Start with **Settings → Activity** (audit log, failed deliveries, dead jobs,
integration errors) and `GET /api/health`.

## Customers are not getting replies

1. **Is the worker running?** `docker compose ps worker`. All AI replies are
   produced by the worker, not by the web request.
2. **Dead jobs?** Settings → Activity lists `customer_turn` jobs that exhausted
   their retries, with the real error.
3. **Is Gemini configured?** Settings → Channels reports it truthfully. Without
   `GEMINI_API_KEY` no automatic reply is generated at all.
4. **Was the conversation taken over?** A paused conversation shows "موظف
   مستلم"; press **استئناف الذكاء** to resume.

## A reply shows a delivery problem

| Badge | Meaning | What to do |
|---|---|---|
| `قيد الإرسال` | Queued, not yet sent | Normal for a few seconds |
| `أُرسل` | The provider accepted it | Nothing |
| `أُرسل جزئياً` | Caption sent, an image failed (or vice versa) | Retry the failed part from the banner |
| `فشل الإرسال` | The provider rejected it permanently | Read the error; often outside the 24-hour messaging window |
| `غير مؤكد` | The call timed out — it may or may not have arrived | **You** decide whether to retry; the system will not risk a duplicate |

## Content will not publish

- The item's page shows each platform's status and its `last_error`.
- `partially_published` → retry **only** the failed platform with the button on
  that row; the successful platform is never republished.
- Instagram errors are usually permissions or account linkage — Settings →
  Channels names the exact missing piece.
- A price drop's new price activates only after the first platform succeeds. If
  everything failed, no price changed.

## Prices look wrong

Open the product; the **price-history** panel shows every change with its source
(`manual`, `csv_import`, `promotion_start`, `promotion_end`) and who made it.

- A CSV import did not change a price → the field is admin-locked. That is
  intended: admin edits win forever.
- A promotion did not restore the old price → a newer manual or CSV price
  superseded it, which also is intended.

## Login problems

- **503 with "auth_not_configured"** → `SESSION_SECRET` is missing or shorter
  than 32 characters. The app deliberately refuses to serve rather than exposing
  the dashboard.
- **429 rate limited** → five failed attempts within ten minutes; wait or use a
  different account.
- **Locked out entirely** → re-run `npm run bootstrap:owner --prefix scripts`
  with a fresh `OWNER_PASSWORD_HASH`; it resets the owner's password.

## Instagram is not working

Settings → Channels runs real checks and tells you exactly which step is
missing: the Page connection, the linked Instagram business account, the
`META_IG_USER_ID` value (it prints the correct id), the webhook fields, or a
permission. Nothing is reported as connected without a passing check.

## Useful SQL

```sql
-- Jobs that gave up
select job_type, last_error, finished_at from jobs where status = 'dead' order by finished_at desc limit 20;

-- Deliveries needing a human decision
select id, kind, status, last_error from outbox_messages
 where status in ('failed','uncertain','dead') order by created_at desc limit 20;

-- Why a price is what it is
select old_price, new_price, source, effective_at from product_price_history
 where product_id = '<uuid>' order by effective_at desc;

-- Publication state for a content item
select platform, status, provider_post_id, last_error from content_publications
 where content_item_id = '<uuid>';
```

## Migration safety

Never edit an applied migration. Run `npm run db:preflight` to see the plan and
`./scripts/backup.sh` before applying. The runner backfills the ledger only when
a migration's effects are already present, so re-running is safe.
