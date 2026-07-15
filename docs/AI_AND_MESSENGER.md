# AI Control and Messenger

## AI Control

`/ai-control` exposes every production behavior section: brand identity, customer service, language/tone, recommendations, vision matching, memory/context, handoff, campaign copy, master campaign image direction, product preservation, image typography, store facts/policies, and advanced task instructions.

Prompt, rules, and memory fields are editable and sent word-for-word when applicable. Each section shows its task applicability, enabled state, warnings, save/error state, character/token estimate, and description. The task preview displays the exact compiler result split into immutable policy, editable instructions, tools/schema, provenance, trace hash, and token estimate. Runtime customer data is never shown.

Changes are loaded on the next execution; there is no publish step or prompt-version system. Disabling a section excludes it. A missing or unreadable required configuration fails visibly rather than substituting a provider default.

## Messenger lifecycle

The only webhook is `GET/POST /api/meta/webhook`. GET performs Meta challenge verification. POST verifies the request HMAC before processing.

1. Inbound events are deduplicated by external message ID and stored.
2. A five-second burst window groups rapid messages.
3. The settled turn loads unanswered messages, customer memory, and current AI Control.
4. Deterministic routing selects an image, image-follow-up, text, or handoff flow.
5. Catalog resolution uses URL, perceptual hashes, learned corrections, visible code/barcode, keyword/embedding candidates, and visual reranking as applicable.
6. `composeCustomerReply()` compiles a typed prompt envelope. Conversation history, memory, verified catalog candidates/prices, and turn state are stable JSON runtime data.
7. Gemini may call only the authorized read-only catalog tools.
8. Before send, `deliverAndStore()` rechecks newer inbound messages and `ai_enabled`, sanitizes output, and records delivery only after Meta confirms it.
9. The memory summary task uses its own AI Control section and compiled runtime data.

![Message flow](diagrams/message-flow.svg)

## Image plus immediate follow-up

If an image is followed by `بكم هذا؟`, batching treats both as one turn. If the follow-up arrives after processing began, the supersede guard abandons the older unsent result; the newer turn still sees the full unanswered batch. Only one coherent answer owns delivery.

## Truth and safety

Only active, priced, eligible catalog products may be presented. Prices come from verified runtime/tool data backed by `products.active_price`. IDs, thresholds, matching eligibility, tool permissions, Meta-safe image URLs, the three-image cap, and delivery state remain deterministic.

Language, greeting, response length, recommendation style, missing-information wording, handoff wording, and store policy prose are editable only in AI Control. Provider code does not restore them.

## Vision isolation

`vision_describe` and `vision_rank` compile only image-matching guidance and optional advanced task instructions. Their allowed IDs and JSON schemas are immutable. Customer tone, campaign direction, memory prose, and reply language are not sent to these calls.

## Playground parity

Customer text/image tests call the same resolver and reply composer as Messenger. Campaign image tests call the same campaign creative pipeline as production. Debug output identifies the typed task, model, contributing sections, prompt trace, and whether the production execution path was used. Playground never sends to Meta.
