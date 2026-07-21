# Catalog, pricing and imports

The catalog is the durable source of customer-facing truth. Everything the
assistant says about a product comes from here.

## Price truth

There are exactly **two** authoritative price sources:

1. **Manual admin edits** (Catalog → product → price)
2. **CSV imports**

The AI never writes a price. Every change is versioned in
`product_price_history` with its source, the admin who made it and any linked
content item.

### Precedence

- An admin edit **locks** `base_price`; no later CSV import can overwrite it.
- A later manual price permanently supersedes an open promotion.
- A later CSV price retargets an open promotion's restore value, so expiry
  restores to the newer price rather than an outdated one.
- Overlapping promotions on one product are impossible (partial unique index).

### Promotions

A price-drop content item carries only the **new** price; the "before" price is
read from verified history at render and publish time.

- **Permanent** drop (no end date) → becomes the new base price.
- **Temporary** promotion (end date) → the active price changes; when it expires
  the prior verified price is restored automatically, unless a newer manual or
  CSV price already superseded it.

Activation happens only when a platform actually publishes. A completely failed
publish never changes a price. See [CONTENT_STUDIO.md](CONTENT_STUDIO.md).

## Availability

There is **no inventory or ERP system**. An active product with a verified
active price is treated as available and the assistant may say so confidently.
Stock quantities, reservations and delivery timing are never invented.

`integrations/catalog/` contains an availability-provider boundary for a future
ERP integration. It is intentionally inactive; its behaviour today is simply
"active + priced = available".

## Field locks

`products.admin_locked_fields` is a map of `field → true`. Once an admin edits a
field it is locked, and every automated writer routes its updates through
`stripLockedFields` so it can never silently overwrite an admin decision.

Lockable fields: display names, category, subcategory, `base_price`, status,
availability, keywords and primary image.

## CSV import

Uploaded from **Catalog → استيراد CSV**. The worker applies it:

- unlocked fields update **automatically** — there is no approval queue;
- locked fields are skipped and counted in the run summary;
- prices route through the pricing engine (history + promotion precedence);
- every field change is recorded in `product_field_changes` for the run;
- each product is applied in its own transaction, so one bad row cannot abort
  the import;
- duplicate product codes inside one file are rejected (first wins) and reported;
- **existing catalog images are never touched.**

Expected columns:

```
Product Code, Barcode, Product Name, Price, Website URL, Image URL,
Arabic Keywords, Needs Size/Color, English Keywords, Variant Requirement, Search Text
```

Product codes are canonicalised (leading zeros stripped) so CSV rows and older
records resolve to the same product. A row with no price is imported as `draft`
and stays invisible to customers.

The run summary reports created / updated / price-updated / locked-skipped /
unchanged / errors truthfully.

## Families, variants and relations

- **Families** group genuine variations — the same product in different sizes,
  colours or set configurations. They are bootstrapped automatically from
  existing names (`npm run bootstrap:families --prefix scripts`), conservatively:
  only within a category, and only when the stripped base name is meaningful.
- **Variant labels** capture what distinguishes a member (`160×220 · white`).
- **Relations** are explicit links: `variant`, `set_member`, `complementary`,
  `similar`.

**Admin corrections are permanent.** Setting a family sets `family_locked`, and
an admin-created relation is `locked` — the automatic grouper never overrides
either. There is no review queue for automatic suggestions.

This is what lets the assistant answer "عندكم مفارش؟" with a few compact
families and their verified price ranges, instead of dumping the catalog or
presenting unrelated products as variants.

## Retrieval

No arbitrary row caps — every strategy covers the whole catalog:

| Strategy | Mechanism |
|---|---|
| Full-text | Maintained `tsvector` over names, code, barcode and keyword arrays (GIN) |
| Fuzzy names | Trigram index |
| Exact identity | Product code, barcode, website URL indexes |
| Image | Perceptual dHash over **all** fingerprints, keyset-paged |
| Semantic | Embedding cosine over **all** embedded products, keyset-paged |

## The scraper

The scraper is **not** part of this system. There is no import, sync, matching
or review pipeline for it, and no scraper-driven UI. Images obtained from past
sources remain in the catalog and are never deleted.
