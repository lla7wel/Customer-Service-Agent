# EH-SYSTEM1 — Troubleshooting

---

## AI · Internal (no customer delivery)

**Symptom:** AI reply shows "AI · Internal" badge in inbox — the AI generated a reply but the customer received nothing.

**Meaning:** `messages.is_internal_suggestion = true` — Meta send was not attempted or failed.

**Causes and fixes:**

1. **Meta not configured** — one or more of `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_VERIFY_TOKEN`, `META_APP_SECRET` is missing from env.
   - Check the server env (`.env` on the VPS). Add missing vars and `docker compose up -d`.

2. **Page access token expired** — Meta Page access tokens expire after 60 days without a Business account.
   - Go to developers.facebook.com → your App → Messenger → Generate token.
   - Update `META_PAGE_ACCESS_TOKEN` in `.env` and restart the app container.

3. **AI paused on conversation** — `conversations.ai_enabled = false`.
   - Check the AI Controls toggle in the conversation. Resume if needed.

4. **Supersede guard fired** — intentional, not a bug. A newer inbound message arrived while this turn was processing. The turn abandoned its reply to let the superseding turn send one combined response.
   - Verify with: `SELECT * FROM ai_events WHERE detected_intent = 'superseded_by_newer_inbound' ORDER BY created_at DESC LIMIT 10;`

**Diagnostic SQL:**
```sql
-- Most recent undelivered AI messages with errors
SELECT created_at, body, ai_meta->>'delivery_error' AS error
FROM messages
WHERE direction = 'outbound'
  AND is_internal_suggestion = true
  AND ai_meta->>'delivery_error' IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

---

## Meta send failed (manual reply)

**Symptom:** Manual reply shows "failed" indicator in inbox.

**Check:**
```sql
SELECT ai_meta->>'delivery_error', delivered_at, created_at
FROM messages
WHERE direction = 'outbound'
  AND sender_type = 'human'
  AND delivered_at IS NULL
ORDER BY created_at DESC
LIMIT 10;
```

Also check `integration_logs WHERE integration = 'meta' AND ok = false`.

**Fixes:** same as AI · Internal above (token expiry, missing env var).

---

## Gemini error

**Symptom:** AI reply says something about not understanding, or conversation goes to `needs_human` unexpectedly.

**Check:**
```sql
SELECT * FROM ai_events
WHERE success = false
ORDER BY created_at DESC
LIMIT 20;

SELECT * FROM integration_logs
WHERE integration = 'gemini' AND ok = false
ORDER BY created_at DESC
LIMIT 20;
```

**Common causes:**
- `GEMINI_API_KEY` expired or rate-limited.
- Image model rate-limited (normal for `gemini-3-pro-image-preview` — system falls back automatically, but if all three models in the chain fail, the image reply fails).
- A specific product in the turn caused a tool call loop.
- AI Control is incomplete. A `PromptConfigurationError` names the missing or
  empty required behavior section; fix it in `/ai-control`. Do not add a code fallback.

## AI Control preview or execution fails

Confirm migration 0014 was applied and all required behavior keys exist. An
enabled required row must contain prompt, rules, or memory text. A disabled row
is intentionally excluded. Preview and production use the same compiler, so a
preview error also protects production from hidden or stale fallbacks.

## Campaign image warning

`product_fidelity_status` and `overlay_text_status` are probabilistic vision
reviews. `unverifiable`, `warning`, `mismatch`, or `missing` requires human
review or regeneration. The image model renders Arabic text itself and may
misspell it. Never treat a score as proof.

Regeneration always loads current AI Control. `campaign_assets.source_prompt`
is historical and should remain null on newly generated assets.

---

## Database connection error

**Symptom:** Dashboard shows "Not connected" for Database, or API routes return 503.

**Check:**
- Is `DATABASE_URL` set and reachable? (`docker compose exec postgres pg_isready`)
- Did the postgres container restart with a wrong password? Check `docker compose logs postgres`.

---

## Product not found by AI

**Symptom:** Customer asks about a product by name/code and AI replies asking a clarifying question, or says it can't find it.

**Check:**
1. Is the product in the database? `SELECT * FROM products WHERE product_code = '...' OR english_name ILIKE '%...%';`
2. Is it active and priced? `WHERE status = 'active' AND active_price IS NOT NULL`
3. Does it have an Arabic name? `arabic_name IS NOT NULL`
4. Is the embedding populated? `text_embedding IS NOT NULL` — if not, run `cd scripts && npm run embeddings`.

---

## Product image not sent (customer asked for a photo)

**Symptom:** Customer asked to see a photo (`ابعثلي صورته`, `وريني الألوان`) but received text only.

**Causes and checks:**

1. **Product has no public image.** Only products with a Meta-safe HTTPS image are sent.
   ```sql
   SELECT p.id, p.english_name, pi.public_url, pi.storage_path
   FROM products p
   LEFT JOIN product_images pi ON pi.product_id = p.id
   WHERE p.id = '<product-id>';
   ```
   If `public_url` is null and `storage_path` is set, run `cd scripts && npm run upload:images`. If both are null, upload an image from the product page.

2. **Image URL not HTTPS / not public.** Meta fetches the URL server-side; `http://`, localhost, and local file paths are rejected by `isMetaSafeImageUrl()`. Confirm `PUBLIC_MEDIA_BASE_URL` is the public https media host and the file exists under `MEDIA_ROOT`.

3. **Image send failed at Meta.** Check the diagnostics:
   ```sql
   SELECT created_at, body, ai_meta->'image_send' AS image_send
   FROM messages
   WHERE direction = 'outbound' AND ai_meta ? 'image_send'
   ORDER BY created_at DESC LIMIT 20;

   SELECT created_at, error FROM integration_logs
   WHERE integration = 'meta' AND error LIKE 'image_send%'
   ORDER BY created_at DESC LIMIT 20;
   ```
   `ai_meta.image_send.failed` lists the URLs and errors. Common cause: the URL is not publicly reachable by Meta, or the token expired.

4. **Image intent not detected.** Very indirect phrasing may not match `detectImageRequest()`. Check the AI Playground: paste the message; `debug.input_signals.image_request` shows whether intent was detected and `debug.outcome.would_send_images` shows what would be sent.

5. **Draft/unpriced product.** Only active + priced products are auto-sent as photos. Activate the product in `/price-review`.

## Image match returns wrong product

**Symptom:** Customer sends a product image and the AI responds about the wrong product.

**Fix:**
1. In the Inbox, find the conversation, click "Correct" on the wrong candidate.
2. Pick the correct product.
3. This saves a fingerprint in `product_fingerprints`. The same image will route correctly next time.

Also check:
- Does the correct product have images in `product_images`? If not, upload images via the product page.
- Is the product in Catalog Match (pending approval)?

---

## Duplicate reply (two AI messages sent)

**Symptom:** Customer receives two AI replies for one message. This should not happen with the supersede guard active.

**Check if supersede guard is running:**
```sql
SELECT * FROM ai_events
WHERE detected_intent = 'superseded_by_newer_inbound'
ORDER BY created_at DESC LIMIT 10;
```

If no rows: the supersede guard may not be firing. Verify `MESSAGE_BATCH_WINDOW_MS` is set and batching is enabled (`ENABLE_MESSAGE_BATCHING = true`).

If duplicate pairs still appear: check `messages.external_id` — two rows with different `external_id` but similar content and timestamps indicates a webhook retry. This is normal and is deduplicated by the `UNIQUE` constraint on `messages.external_id`.

---

## Login not working

**Symptom:** `/login` form submits but you are not logged in.

**Check:**
1. Do `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` / `SESSION_SECRET` exist in the server env?
2. Was the hash generated with bcrypt? `node -e "require('bcryptjs').hash(process.argv[1],12).then(console.log)" 'your-password'`
3. Locked out? Update the env hash and restart the app container.

```sql
SELECT id, email, role FROM admin_users;
```

---

## Build failed

**Symptom:** `docker compose build` fails with "cannot find module '@integrations/...'" or similar.

**Check:**
- The Docker build context must be the repo root (admin-app imports ../integrations).
- "Include source files outside of the Root Directory in the Build Step" = enabled.

**Symptom:** App deploys but shows "Not connected" for everything.

**Check:**
- All required env vars are set in `.env` (compose validates the critical ones at startup).
- `APP_BASE_URL` matches the actual production domain.

---

## Migration issue

**Symptom:** App crashes or queries fail after a migration.

**Rules:**
- Never modify a migration file that has already been applied. Write a new migration.
- All migrations are in `database/migrations/` numbered `0001`–`0014`. Apply in order.
- Migration 0012 (`production_cleanup`) is destructive but scoped — it archives orders before dropping.

**Check which migrations have been applied:**
```sql
-- If you have a migrations_log table, check it.
-- Otherwise, check for the presence of tables added by each migration:
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_memory') AS m0009,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversation_attachments') AS m0011,
       NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') AS m0012;
```

---

## Campaign not publishing

**Check:**
1. `SELECT status, updated_at FROM campaigns WHERE id = '...';`
2. `SELECT * FROM integration_logs WHERE integration = 'meta' AND ok = false ORDER BY created_at DESC LIMIT 10;`
3. Is `META_PAGE_ACCESS_TOKEN` still valid?
4. Did `fn_refresh_product_pricing()` run? `SELECT * FROM activity_logs WHERE action ILIKE '%pricing%' ORDER BY created_at DESC LIMIT 5;`

---

## Useful SQL queries

```sql
-- Active conversations needing human attention
SELECT id, status, ai_enabled, last_message_at
FROM conversations
WHERE status = 'needs_human' OR (ai_enabled = false AND status != 'resolved')
ORDER BY last_message_at DESC;

-- Recent AI events with errors
SELECT kind, model, detected_intent, latency_ms, created_at
FROM ai_events
WHERE success = false
ORDER BY created_at DESC
LIMIT 20;

-- Products visible to customers (active + priced)
SELECT count(*) FROM products
WHERE status = 'active' AND active_price IS NOT NULL;

-- Products missing images
SELECT id, english_name, status, active_price
FROM products
WHERE status = 'active'
  AND NOT EXISTS (SELECT 1 FROM product_images WHERE product_id = products.id)
ORDER BY english_name;

-- Campaigns failing to publish
SELECT id, name, status, starts_at, ends_at
FROM campaigns
WHERE status = 'failed'
ORDER BY updated_at DESC;

-- Integration logs (last 30 minutes)
SELECT integration, direction, ok, error_code, created_at
FROM integration_logs
WHERE created_at > now() - interval '30 minutes'
ORDER BY created_at DESC;
```
