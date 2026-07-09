# EH-SYSTEM1 — QA Checklist

Run after every production deployment.

---

## 1. Deploy smoke test

```bash
HOST=https://app.<your-domain>

# Health check — must return 200 with integration statuses
curl -s $HOST/api/health | jq

# Removed route — must return 404
curl -I $HOST/api/catalog-sync

# Meta webhook GET verification — must echo "test"
curl -s "$HOST/api/meta/webhook?hub.mode=subscribe&hub.verify_token=YOUR_META_VERIFY_TOKEN&hub.challenge=test"
```

---

## 2. Auth gate

```bash
# All of these must return 401 (not 200 or 307)
curl -I $HOST/api/ai/behaviors
curl -I $HOST/api/inbox/00000000-0000-0000-0000-000000000000
curl -I $HOST/api/campaigns
curl -I $HOST/api/products
```

```bash
# Page routes without a session — must redirect to /login (307)
curl -I $HOST/dashboard
curl -I $HOST/inbox
curl -I $HOST/products
```

---

## 3. Login

- [ ] Visit `/login` in the browser.
- [ ] Sign in with the env-configured admin credentials (ADMIN_EMAIL / ADMIN_PASSWORD_HASH).
- [ ] Successfully redirected to `/dashboard`.
- [ ] Sign out → redirected to `/login`.

---

## 4. Dashboard

- [ ] Dashboard loads without errors.
- [ ] Integration status shows Database / Gemini / Meta correctly (Connected or Not connected based on env vars).
- [ ] "Needs action" count reflects `needs_human` conversations.
- [ ] No reference to Orders or Catalog Sync anywhere on the page.

---

## 5. Messenger: text price question

- [ ] Send a text message to the Facebook Page with a product name or code.
- [ ] AI replies in Libyan Arabic (Darija) within ~10s.
- [ ] Reply contains the correct catalog price (from `products.active_price`).
- [ ] No template-like phrasing; response reads naturally.

---

## 6. Messenger: image + follow-up (core test)

- [ ] Send a product image to the Facebook Page.
- [ ] Within ~5–8 seconds, send "بكم هذا" as a follow-up.
- [ ] **Only one AI reply arrives** (not two). This verifies the supersede guard works.
- [ ] The single reply covers both the product identification and the price.

Repeat with a ~12-second delay (after image turn starts Gemini but before it delivers):
- [ ] Still only one AI reply.

---

## 6b. Product image sending

- [ ] After the AI identifies a product, send `ابعثلي صورته` → the AI sends **one** product photo + a short caption (name + price).
- [ ] Send `نبي صور أطقم حمام` → the AI sends **at most 3** relevant product photos (only products that have images), or asks one clarifying question if too broad. Never more than 3, never random products.
- [ ] After the AI shows options, send `نبي نشوفهم` → the AI sends photos of those previous options (max 3), not a new unrelated search.
- [ ] Send `شنو الألوان؟` for a product family with colour variants → photos sent and the caption explains they are the same style in different colours.
- [ ] Send `بكم؟` only (no image words) → **no** photo is sent, just the price reply.
- [ ] Ask for a photo of a product that has no image → the AI replies naturally that no photo is available (no broken image, no placeholder).
- [ ] With Meta disconnected: ask for a photo → no false "sent"; the message is internal/failed, error logged.

## 6c. Manual image send (inbox)

- [ ] Open a conversation with product candidates → each card shows a **Send image** button.
- [ ] Click it → the customer receives the product photo + caption; the message shows "sent".
- [ ] For a product with no image → the button is disabled (tooltip "No image").

## 7. Story reply

- [ ] Reply to one of the page's stories with "بكم؟".
- [ ] AI replies with the product matched from the story image and its price.

---

## 8. Burst messages

- [ ] Send 3 quick text messages in rapid succession (within 5 seconds).
- [ ] AI sends exactly **one** reply that addresses all three messages as context.

---

## 9. Pause / resume AI

- [ ] Open a conversation in Inbox.
- [ ] Toggle AI off (Pause AI).
- [ ] Have the customer send a message. No AI auto-reply fires.
- [ ] Toggle AI on (Resume AI).
- [ ] Have the customer send another message. AI replies automatically.

---

## 10. Manual reply

- [ ] Type a manual reply in the Inbox composer. Click Send.
- [ ] The message appears in the thread with a "sent" indicator.
- [ ] The customer receives the message in Messenger.
- [ ] If Meta credentials are bad/expired: the message shows a "failed" indicator (not "sent"). No duplicate send on retry.

---

## 11. AI Suggest

- [ ] Open a conversation. Click "AI Suggest".
- [ ] A suggestion appears in the composer (stored as `is_internal_suggestion = true`).
- [ ] The suggestion is in Libyan Arabic and matches the conversation context.
- [ ] The suggestion is **not** automatically sent (verify in the thread and in Messenger).

---

## 12. AI Playground

- [ ] Open `/ai-playground`.
- [ ] Enter the same product question as in test 5.
- [ ] Reply matches the style and content of the live auto-reply.
- [ ] Debug panel shows tool calls, candidates with confidence scores, memory used.

---

## 13. Products

- [ ] `/products` loads the catalog list.
- [ ] Add a new product via "+ Add product" with a price → product appears as active.
- [ ] Add a new product without a price → product appears as draft in Prices tab.
- [ ] Edit a product's price → `active_price` updates; `admin_locked_fields` includes the field.

---

## 14. Catalog Review

- [ ] `/catalog-match` loads with Possible/Approved/Rejected counts.
- [ ] Approve a pending match → product gains the scraper's images.
- [ ] Bulk approve works without errors.
- [ ] **No Sync tab or sync-triggering button** visible anywhere.

---

## 15. Campaign

- [ ] Create a campaign draft, attach a product, generate a caption.
- [ ] Caption is in Libyan Arabic.
- [ ] Schedule/publish → campaign posts to the Facebook page.
- [ ] Campaign status updates to `published`.

---

## 16. Mobile UI

- [ ] Open Inbox on a phone-size viewport (< 1024px).
- [ ] Thread fills the screen; composer is pinned at the bottom.
- [ ] Match options / customer info accessible without crowding the thread.
- [ ] Navigation works (hamburger or bottom nav).

---

## 17. Settings

- [ ] `/settings` shows correct integration health for Database / Gemini / Meta.
- [ ] Webhook URL is displayed correctly (uses `APP_BASE_URL`).
- [ ] No "Catalog Sync" section or sync-status display.
