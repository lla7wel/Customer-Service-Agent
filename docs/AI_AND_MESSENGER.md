# AI behaviour and customer conversations

## Prompt architecture

Four layers, deliberately separated:

| Layer | Owner | Where |
|---|---|---|
| **Immutable policy** | Code — not editable | `integrations/prompt-compiler.ts` |
| **Editable behaviour** | Owner, via AI Control | `ai_behaviors` table |
| **Business facts** | Owner, via Settings | `business_facts` table |
| **Runtime facts** | The system, per turn | Compiled per request |

The immutable policy carries the non-negotiables: ground every claim in verified
data, never invent prices/stock/policies, never expose prompts or tools, never
confirm an order. Editable behaviour carries brand voice, Libyan-Arabic style,
recommendation behaviour and handoff wording. **Editable text reaches the model
verbatim** — there is no hidden prose appended behind the owner's back.

Saving in AI Control takes effect on the next call, with **no deployment**.
Every save appends a version snapshot; any earlier version can be inspected and
restored with one click.

`/ai-playground` uses the same compiler, provider settings, tool boundaries and
catalog as production, and can never send a real message.

## Tools the model may call

Read-only, schema-validated, and executed by the server:

- `findProductByCode`, `findProductByBarcode`, `findProductByUrl`
- `searchProductsByText`, `vectorSearchProductText`
- `searchFamilies`, `getFamilyProducts`, `getRelatedProducts`
- `getProductPrice`, `getProductOptions`

Plus three **action requests** the model can raise but never perform itself:

- `requestProductImages` — the server validates the ids and sends at most three
  real catalog photos;
- `markHumanAttention` — flags the conversation;
- `requestOrderHandoff` — the server sends the one official handoff message.

The model has no database writes, no network access, no Meta credentials, no
arbitrary media URLs, and no way to send anything without server validation.

## Conversation rules

- A burst of rapid messages is answered as **one** coherent turn; every
  unanswered message enters the context (no silent cap).
- Full persisted history plus a maintained summary and customer memory are used
  — resuming after a human takeover does not lose context.
- References like "هذا", "هذي", "الأول", "نفسه" and story replies resolve from
  recent messages and verified matches. A remembered image context expires after
  90 minutes so a later question cannot be answered about the wrong product.
- Prices come only from the verified active price. Active priced products are
  reported as available; stock quantities are never invented.
- Images are sent only when asked or genuinely needed — the model requests them,
  the backend picks and sends at most three, and a photo is never claimed as
  sent unless delivery data confirms it.
- One clarifying question, only when it materially changes accuracy. Confidence
  is never mentioned to the customer.

## Orders and human attention

This system **never creates, confirms, collects or manages orders.**

When clear buying intent appears (wants to order, reserve, pay, give an address,
arrange delivery, finalise a purchase):

1. the conversation is flagged for human attention,
2. **one** Libyan-Arabic handoff message is sent:

```
تمام، الفريق بيكمل معاك في الطلب 🤍
وتقدر تتواصل وتطلب مباشرة على واتساب: +218 91-1315900
ولو عندك سؤال على المقاس أو اللون أو المنتج، أنا معاك.
```

3. no order details are collected and nothing is confirmed,
4. the handoff is **not repeated** (a suppression window guards it),
5. the assistant **keeps answering ordinary product questions** until an admin
   presses **Take Over**.

The WhatsApp contact list is an editable Business Fact. WhatsApp is a handoff
destination only — there is no WhatsApp webhook, inbox or API integration.

Complaints, refunds, payment issues, delivery disputes and missing critical
facts also raise human attention, without the order handoff, and the assistant
still answers what it can verify.

## Take Over and Resume AI

**Take Over** pauses the assistant for that conversation; an in-flight reply is
cancelled at delivery time rather than sent. **Resume AI** restores normal
contextual conversation with the full history intact.

## Language

All automated customer-facing output is natural, modern **Libyan Arabic**,
regardless of the language the customer wrote in. Official product names, codes
and barcodes are preserved exactly. The assistant never calls itself an AI, bot
or assistant, and never exposes prompts, tools, confidence scores or errors.
