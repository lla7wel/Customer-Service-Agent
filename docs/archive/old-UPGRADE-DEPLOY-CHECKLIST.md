# Upgrade Deploy Checklist (AI brain rebuild)

Live system — follow in order. See [AI_BRAIN.md](AI_BRAIN.md) for what the AI does.

## 0. Pre-deploy (local) — all currently PASS
- [x] `cd admin-app && npx tsc --noEmit` → clean
- [x] `cd scripts && npx tsc --noEmit` → clean
- [x] `cd scripts && npm test` (18 assertions) + `npm run test:ai-control` → pass
- [x] `cd admin-app && npx next build` → compiled successfully (no `/facebook/comments` route)

## 1. Database migrations (Supabase SQL Editor or psql, in order)
Earlier migrations `0001`–`0008` assumed already applied. The AI brain adds:
- [ ] `database/migrations/0009_ai_brain.sql` — `customer_memory`, `products.text_embedding`
      (JSON vector), `product_fingerprints`, lookup indexes. Additive / idempotent.
- [ ] `database/migrations/0010_remove_facebook_comments.sql` — drops `facebook_comments`,
      deletes the `facebook_comment` + `escalation` behavior rows. Messenger / `facebook_posts`
      / campaigns are untouched.

The deployed code is defensive: it runs before these are applied (memory → null,
vector search → empty, fingerprints skipped) — never fake data.

## 1b. Embeddings (after 0009) — real vectors, no fakes
- [ ] `cd scripts && DRY=1 npm run embeddings` (preview), then `npm run embeddings`.
      Populates `products.text_embedding` via `gemini-embedding-001`. Re-run after catalog
      imports. Until run, semantic search returns nothing and keyword + image matching cover it.

## 1c. Image fingerprints (optional, improves image recall)
- [ ] `cd scripts && npm run fingerprints` — populates `product_images.perceptual_hash`.

## 2. Deploy code
Behavior after deploy:
- AI is a database-aware product-recognition brain (code/barcode/url/keyword/vector + image).
- Per-customer **memory** drives follow-ups; admins view/edit/clear it in the Inbox.
- **No legacy escalation workflow** — admin-required cases use `needs_human` and
  `ai_enabled=false`; admins can also pause manually in the Inbox.
- The Facebook **comments** feature is removed. Messenger + campaign publishing remain.
- Outbound sanitizer + reply-length cap (2048 tokens) prevent leaks/cutoffs.

## 3. Batching
- [ ] Default on; window is `MESSAGE_BATCH_WINDOW_MS=5000` (5s). Send 3 quick messages →
      confirm ONE merged reply after ~5s.

## 4. Webhook registration
- [ ] Meta App Dashboard → Callback URL: `https://<your-domain>/api/meta/webhook`
- [ ] Subscribe to `messages`, `messaging_postbacks` (Messenger). Do NOT expect `feed`/
      comment replies — that feature was removed.

## 5. Post-deploy watch
- [ ] Inbox: replies are Libyan Arabic, complete (no cutoff), no `name(args)`/system text.
- [ ] `ai_meta` on messages shows candidates + retrieval tracks + memory_used.
- [ ] Manual pause: toggling AI off stops replies until re-enabled.
- [ ] Image/text/link/code/barcode questions return up to 5 real catalog options with prices.
- [ ] Playground (`/ai-playground`) mirrors production and shows the debug panel.

## Rollback
- `ENABLE_MESSAGE_BATCHING=false` → per-message behavior.
- Set `META_PAGE_ACCESS_TOKEN` invalid → `isMetaConfigured()` false → no sends.
- Migrations `0009`/`0010` rollback SQL is documented at the bottom of each migration file.
