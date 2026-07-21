# Content Studio

Content Studio produces, schedules and publishes English Home Libya's Facebook
and Instagram content, and answers the comments that content receives.

## The workflow

1. **Source** — choose post or Story, target platforms, then select catalog
   products or upload one or more source-reference images. Upload and Catalog
   are equal first choices. A price drop requires a catalog product.
2. **Purpose** — choose only `general` or `price_drop`; choose carousel or one
   composition when there are multiple products, then AI lifestyle scene or
   Use Original. A price drop asks only for the new price.
3. **Copy and generate** — generate one editable Libyan-Arabic phrase and one
   editable caption. The phrase must be accepted or edited before generation.
   Generation is a durable worker job with visible progress.
4. **Preview and publish** — inspect the exact 4:5 or 9:16 output revision,
   verification results and warnings; select the publishable revision, then
   explicitly approve now or schedule in Africa/Tripoli time.

There are no Reels. Stories render at 9:16; feed content uses platform-appropriate
ratios. Multiple Story assets publish as distinct story frames.

## Creative generation and verification

Final creatives are real 2K reference-image generations from the pinned
`gemini-3-pro-image` model. Catalog and upload images are identity references,
not publishable outputs. The model is instructed to preserve product shape,
colour, material, pattern and included pieces while creating a commercially
photographed, product-family-aware scene. It also renders the approved Arabic
phrase, verified prices and the Brand Kit logo or fallback wordmark.

Each output is checked for product fidelity, exact requested phrase, exact
prices and the expected brand mark. A failed check causes up to two targeted
correction attempts. Verification is probabilistic, so a remaining mismatch is
stored as a visible warning and is never labelled verified. An admin may publish
that revision only after explicitly acknowledging the warning.

Every Generate action creates a new preserved revision. A configuration change
makes older outputs stale. Approval requires one selected current-revision
output; source uploads and unrelated output revisions are impossible to publish.
Storage failure cannot mark an item ready.

## Price drops

- The admin enters **only the new price**.
- The "before" price comes from verified price history
  (`previousVerifiedPrice`), never from a stale content image or an old
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
