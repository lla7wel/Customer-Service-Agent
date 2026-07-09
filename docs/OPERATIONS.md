# EH-SYSTEM1 — Operations Guide

Day-to-day operator guide for the English Home Libya command center.

---

## Daily workflow

1. Open **Dashboard** — check integration status (Database / Gemini / Meta) and the "Needs action" count.
2. Open **Inbox** — the "Needs action" filter surfaces conversations that require human attention (`status = needs_human` or AI paused). Work through them.
3. Check **Campaigns** — any scheduled campaigns near their publish time?
4. Check **Catalog Review → Matches** — approve pending catalog matches so products get images.
5. Check **Catalog Review → Prices** — activate any priced-but-not-yet-active products.

---

## Inbox workflow

### Reading conversations

The inbox list sorts needs-human conversations first, then by last message time. Click a conversation to open the thread. The right rail shows:
- **AI Controls** — pause/resume toggle, AI status for this conversation.
- **Customer info** — name, channel, tags.
- **Customer memory** — what the AI remembers about this customer (recent products, preferences, known contact info).
- **Product candidates** — products the AI matched or you searched for.

### Pausing and resuming AI

- **Pause AI** (toggle in right rail or AI Controls panel): sets `ai_enabled = false` on the conversation. The AI stops generating replies. The inbox badge changes to show "AI paused".
- **Resume AI**: sets `ai_enabled = true`. The AI resumes auto-replying on the next customer message.

Conversations automatically land in needs-human status (and AI paused) when the AI detects: order requests, payment/refund/exchange/complaint questions, delivery details not in the catalog, unsafe image matches, or a missing-price product.

### Sending a manual reply

Type in the composer at the bottom of the thread and hit Send. The message is stored immediately and Meta send is attempted. A sent indicator appears when delivery is confirmed; a failed indicator appears (with the error in `ai_meta.delivery_error`) if Meta rejects the send. A failed send is never shown as delivered.

### Attaching a product

Click the product search in the right rail, search by name/code/keyword. Click a product to attach it to the conversation. This adds a `conversation_attachments` row so the AI and subsequent turns know what product you're discussing.

### AI Suggest

The "AI Suggest" button in the composer generates a suggested reply using the same Gemini pipeline as the auto-reply (same behavior, same tools, same temperature). The suggestion is stored as `is_internal_suggestion = true` — it is not sent. You can edit it in the composer before sending.

### Sending a product photo

Each product candidate card has a **Send image** button (a small image icon). Click it to send that product's catalog photo plus a short Libyan-Arabic caption to the customer via Messenger. The button is disabled when the product has no usable image. A sent/failed indicator appears on the resulting message — a failed send is never shown as delivered.

The AI also sends product photos on its own when a customer asks to see them (`ابعثلي صورته`, `وريني الألوان`, `نبي نشوفهم`). It sends at most 3 photos and only for products that have a public image. See `AI_AND_MESSENGER.md` → Product image sending.

### Correcting an image match

If the AI matched the wrong product for a customer image, click "Correct" on the candidate. Pick the right product. This stores a correction in `image_match_corrections` and a perceptual hash fingerprint in `product_fingerprints` so the same image hashes correctly in future.

---

## Catalog review workflow

### Catalog Match tab (`/catalog-match`)

Shows pending matches between scraper-discovered products and Libya catalog products. States: Possible → Approved / Rejected / No match.

- **Approve** a match: the scraper product's images are linked to the CSV catalog product.
- **Reject** a match: marks it as wrong so it is not re-suggested.
- **Bulk approve**: approves all high-confidence pending matches at once.
- **Image search**: search for a product by uploading or pasting an image URL.

### Image Review tab (`/image-review`)

Shows image-match correction history. Admin corrections feed fingerprint learning — the same image hash routes directly to the correct product on subsequent matches.

### Prices tab (`/price-review`)

Shows products with a price but not yet activated (`status != active`). Review each product and click Activate to make it customer-visible. Once active with a price, the AI can quote it to customers.

---

## Campaign workflow

1. **Campaigns → New** — create a draft with a name, date range, discount (optional), and target products.
2. **Attach products** — search and attach the products to feature.
3. **Upload or generate images** — upload a product photo or use AI image generation to create campaign creative.
4. **Generate caption** — one click generates a short Libyan-Arabic caption from the product context.
5. **Schedule or publish** — set a publish date/time (scheduled) or publish immediately. The campaign scheduler calls `fn_refresh_product_pricing()` before publishing, so `campaign_price` is always up-to-date.

---

## AI Control

`/ai-control` shows all `ai_behaviors` rows in two sections:
1. **Customer Service Behavior** — service style and tone.
2. **Campaign / Marketing AI** — caption tone, image guidance.

Changes take effect immediately (no redeploy). Hard safety rules (never invent a price, reply in Libyan Arabic only, never confirm orders alone, never leak internal tool names) are enforced in code — they cannot be overridden from AI Control.

---

## AI Playground

`/ai-playground` runs the exact Messenger pipeline and shows:
- **Customer reply** — the message the customer would receive.
- **Technical debug** — extracted signals (code/barcode/URL/hash), database candidates with confidence, tool calls, memory used, Gemini model used.

Use this to verify AI behavior before live deployment and to reproduce issues reported in production.

---

## How to know if something is broken

| Symptom | Where to look |
|---------|---------------|
| AI replies show "AI · Internal" (inbox badge) | No customer message was sent. Check `integration_logs` for Meta send errors. See `TROUBLESHOOTING.md`. |
| No AI reply at all | Check if AI is paused on the conversation. Check `ai_events` for errors. |
| Wrong product matched from image | Go to Image Review, correct the match. Fingerprint is saved for future. |
| Dashboard shows "Not connected" | An env var is missing. Check `.env` on the VPS and `docker compose up -d`. |
| Campaign not publishing | Check `activity_logs` and `integration_logs` for the campaign scheduler run. Verify Meta credentials. |
| Customer gets a price quote that is wrong | Check `products.active_price` for that product. The AI reads this column directly — if it is wrong, the catalog is wrong. |
| AI didn't send a photo when asked | The product likely has no public image. Check `product_images.public_url`; upload an image from the product page. Verify the URL is HTTPS. |
