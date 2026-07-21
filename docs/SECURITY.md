# Security posture

What is enforced, and — just as importantly — what is not.

## Authentication and sessions

- **Fail-closed.** Without `SESSION_SECRET` (≥32 characters) the middleware
  refuses every protected route with 503 instead of allowing it through. Local
  development may opt out with `AUTH_DISABLED_DEV=true`, which is ignored when
  `NODE_ENV=production`.
- Passwords are **bcrypt** hashed (cost 12). No default password exists anywhere
  in the code, the image or the documentation; the first owner is created from
  `OWNER_USERNAME` + `OWNER_PASSWORD_HASH` and the bootstrap refuses to create a
  second owner or to store anything that is not a bcrypt hash.
- Sessions are two-layer: a signed HS256 cookie (verified at the edge) **and** a
  database row storing only the SHA-256 of the session id. Sessions are
  therefore revocable — disabling an admin or resetting a password invalidates
  their sessions immediately.
- Login is **rate limited** per IP and per username (5 failures / 10 minutes).
  A wrong username and a wrong password are indistinguishable by timing.
- The last active owner cannot be disabled and no admin can disable themselves.
- Every meaningful action is written to `admin_audit_log` with the acting
  admin's identity, even when several admins have equal access.

## Network and input handling

- **Outbound image fetching** (`integrations/util/safe-fetch.ts`) enforces:
  HTTPS only (HTTP allowed solely for localhost in development), DNS resolution
  checked against private/reserved ranges **on every redirect hop**, a redirect
  limit, a byte cap with streaming abort, a total timeout, an image content-type
  requirement and a magic-byte check. The app's own media is read from disk
  rather than fetched over the network at all.
- **Uploads** validate size, MIME type and magic bytes before anything is stored.
- **Webhooks** verify the `X-Hub-Signature-256` HMAC against the raw body before
  the payload is parsed.
- **Graph API calls** always carry the token in a header or POST body — never in
  a URL — and every call has a timeout with bounded retries.
- There is **no cron endpoint and no shared cron secret**: recurring work is
  scheduled by the worker itself.

## Data handling

- Raw provider payloads live in `inbound_events` only as long as they are useful
  and are swept after 30 days; job records, login attempts, expired sessions and
  integration logs have their own retention windows.
- Readiness results store account names, ids, permissions and expiry state —
  never tokens. A test asserts that no secret can leak into them.
- Operational logs record outcomes and error messages, not full customer
  transcripts.

## Repository hygiene

`./scripts/scan-secrets.sh` runs locally and in CI. It fails if:

- `.env`, `.env.local`, `CHAT_HANDOFF.md`, `docs/system-audit/`,
  `docs/owner-decisions/` or `backups/` are tracked;
- any tracked file contains a Meta token, Google API key, private key block,
  bcrypt hash, AWS key, Slack token or JWT;
- any security-critical variable is assigned a non-placeholder value.

CI additionally fails on any **high or critical** runtime dependency advisory.

## Known limitations

These are real and deliberately not hidden:

- **Trusted-admin model.** Every signed-in admin with full access can edit the
  catalog, prices and AI behaviour. There is no per-field permission system;
  the audit log is the control.
- **No inventory truth.** An active product with a verified price is reported as
  available. There is an inactive availability-provider boundary for a future
  ERP integration.
- **Media is served by the reverse proxy** with public, unguessable-by-path URLs.
  Product and content images are not secret, but they are publicly reachable.
- **Rate limiting is per instance** (database-backed counters). It is sized for
  a single-VPS deployment, not for a distributed one.
- **Next.js bundles its own `postcss`** which currently carries a moderate
  build-time advisory. The direct dependency is patched; the nested copy can
  only be fixed by Next upstream. It is a build-time CSS stringifier and is not
  reachable from runtime input.

## Reporting

Found something? Open a private security advisory on the repository rather than
a public issue.
