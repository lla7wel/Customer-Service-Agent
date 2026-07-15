# Architecture

## Runtime

The production stack is PostgreSQL 16, a Next.js 16 standalone app, and Caddy on one Docker Compose VPS. Caddy terminates HTTPS for `app.ehlibya.com` and serves persisted media from `media.ehlibya.com`. Gemini and Meta Graph are the only external runtime APIs.

![Architecture](diagrams/architecture.svg)

## AI instruction boundary

`ai_behaviors` is the source of truth for editable AI behavior. Every model task follows one path:

```text
ai_behaviors rows
  -> compilePrompt(typed task, structured runtime facts)
     -> immutable execution/safety policy
     -> exact applicable AI Control text (word-for-word)
     -> stable JSON runtime data
     -> tool policy and response schema
     -> trace hash
  -> provider adapter
  -> Gemini
```

`integrations/prompt-compiler.ts` owns task applicability and deterministic section ordering. Provider adapters own only Gemini formatting, modalities, model routing, timeouts, fallback, tools, and parsing. They must not append brand, language, tone, recommendation, handoff, or creative-direction prose.

Missing required AI Control rows, or enabled required rows with no content, raise `PromptConfigurationError`. Disabled rows are intentionally excluded. There is no hidden prose fallback.

Typed tasks are `customer_reply`, `product_recommendation`, `handoff_reply`, `vision_describe`, `vision_rank`, `memory_summary`, `campaign_caption`, `campaign_image`, and `campaign_image_verify`. AI Control preview calls the same compiler as runtime and never includes customer data.

## Core flows

Messenger:

```text
signed Meta webhook -> idempotent ingest -> burst debounce -> deterministic turn routing
-> catalog/image resolution -> compiled reply -> read-only product tools
-> supersede + ai_enabled + sanitizer gates -> Meta delivery -> memory update
```

Campaign creative:

```text
campaign variables + source product + current AI Control
-> shared campaign creative pipeline -> strongest image model/fallback chain
-> source/generated vision review + text-status review -> optional fidelity retry
-> unapproved review asset -> explicit human approval -> publish/schedule
```

Playground uses the same reply compiler, image matcher, campaign creative pipeline, model router, tools, and response parsers. It uses simulation data and never delivers a Messenger message.

## Deterministic invariants

Code, SQL, and tool contracts continue to enforce authentication, valid product IDs, `active_price` truth, catalog eligibility, read-only AI tools, webhook signatures, delivery race guards, output schemas, confidence thresholds, file limits, timeouts, and human approval. These are not editable prompts.

Vision tasks receive only `image_matching` plus optional advanced task instructions. Customer-service, campaign styling, language, and memory prose are excluded from vision extraction/ranking.

## Folder ownership

| Path | Responsibility |
|---|---|
| `admin-app/` | Authenticated UI and HTTP routes |
| `integrations/prompt-compiler.ts` | Canonical provider-neutral prompt contract |
| `integrations/pipelines/` | Messenger, matching, reply, and campaign workflows |
| `integrations/gemini/` | Provider formatting, model routing, fallback, parsing |
| `integrations/tools/` | Authorized read-only catalog tools |
| `integrations/db/` | Kysely/PostgreSQL access and generated types |
| `database/` | Fresh schema and forward-only migrations |
| `deploy/` | Caddy, backup, and VPS runbooks |
| `scripts/` | Offline catalog maintenance and regression tests |

## Security and operations

The jose session middleware protects admin pages and APIs. Only auth, health, Meta webhook, and the bearer-protected scheduler have public exceptions. Meta POSTs require `X-Hub-Signature-256`; cron requires `CRON_SECRET`. PostgreSQL is private to Compose. Secrets are environment-only.

Applied migrations are immutable. Deployments must be built and tested from Git, backed up before migration, and verified through `/api/health`, container status, logs, auth gates, webhook challenge, catalog counts, and restart persistence.
