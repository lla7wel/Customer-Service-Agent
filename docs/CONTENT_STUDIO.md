# Content Studio

Content Studio produces, schedules and publishes English Home Libya's Facebook
and Instagram content, and answers the comments that content receives.

## The workflow

1. **Create** — post or Story, Facebook / Instagram / both.
2. **Choose products and/or upload images.** A price drop requires products.
3. **Output mode**
   - `original` — publish the selected assets, fitted to the platform ratio.
   - `carousel` — one generated visual per product.
   - `combined` — one composed visual containing the selected products.
4. **Purpose** — `price_drop` or `general`.
5. **Image text** — generate one editable Libyan-Arabic phrase, write it
   yourself, or publish with no text.
6. **Caption** — one shared caption used for both platforms.
7. **Preview** — exactly what will be published.
8. **Approve** — publish now, or schedule at an Africa/Tripoli time.

There are no Reels. Stories render at 9:16; feed content uses platform-appropriate
ratios. Multiple Story assets publish as distinct story frames.

## Why prices are not drawn by an image model

Image models cannot reliably spell Arabic text or exact numerals. Every price
and phrase is therefore rendered by a **deterministic composition layer**
(`integrations/content/compose.ts`):

- the layout is built as SVG from verified data,
- rasterised by **resvg**, which uses rustybuzz for correct Arabic shaping and
  right-to-left ordering,
- composited over the base image.

The same input always produces the same pixels, so the admin preview is a
guarantee, not an approximation. The bundled font is **Tajawal** (SIL OFL 1.1,
`integrations/content/fonts/`).

An AI model may still be used for visual direction and for suggesting the
editable phrase and caption — never for the final text layer.

## Price drops

- The admin enters **only the new price**.
- The "before" price comes from verified price history
  (`previousVerifiedPrice`), never from a stale campaign image or an old
  conversation.
- A **permanent** drop (no end date) becomes the new base price.
- A **temporary** promotion carries an end date; when it expires the prior price
  is restored automatically — unless a later manual or CSV price already
  superseded it, in which case the newer price wins.
- Overlapping promotions on one product are impossible: a partial unique index
  enforces one open promotion per product, and approval reports the conflict.

**Price activation is tied to publication.** The new price goes live only when
the first selected platform publishes successfully. If one platform succeeds and
another fails, the price stays live, the item shows `partially_published`, and
only the failed platform can be retried. If every platform fails, no price changes.

## Publishing states

```
draft → generating → ready → approved → publishing → published
                                     ↘ scheduled  ↗
                                                   ↘ partially_published
                                                   ↘ failed
                                                        → archived
```

The parent status is always **derived** from all of the item's publications —
it is never optimistically set. Each `(item, platform)` pair has exactly one
publication row with an idempotency key and a conditional claim, so a retry, a
page reload or two concurrent workers can never create a duplicate post.

Multi-step provider flows (Instagram containers, Facebook carousel children)
persist the child ids they created in `provider_children`, so a resumed attempt
re-uses them instead of uploading duplicates.

## Comment automation

Comments are fetched **only** from `content_publications` rows that this app
published and that carry a provider post id. An older or manually created post
is therefore unreachable by construction.

For each new top-level comment:

| Situation | Reply |
|---|---|
| Exactly one linked product with a verified active price, no sensitive topic | The exact price plus a DM invitation |
| Multiple products, unclear identity, or missing price | Concise DM invitation only — never a guessed price |
| Order, complaint, payment or delivery topic | DM invitation **and** flagged for human attention |
| Our own comment | Recorded and skipped |
| Older than the publication, or older than 7 days | Recorded and skipped |

Every comment, decision, reply, provider status and failure is visible in the
item's page. A comment is decided exactly once — the `(publication, provider
comment id)` uniqueness makes loops and duplicate replies impossible.
Automation runs by default and can be disabled per item.

## Scheduling

Times are entered in **Africa/Tripoli** and stored as UTC. The worker's
`promotion_tick` job moves due scheduled items into publishing; no host cron is
involved.
