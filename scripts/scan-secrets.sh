#!/usr/bin/env bash
# =============================================================================
# Secret scan for the PUBLIC repository.
#
# Fails if any TRACKED file contains something that looks like a live
# credential, or if a file that must never be published is tracked at all.
# Run locally before committing:  ./scripts/scan-secrets.sh
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FAILED=0
note() { printf '  %s\n' "$1"; }
fail() { printf '\n✗ %s\n' "$1"; FAILED=1; }

# --- 1. Files that must never be tracked -------------------------------------
FORBIDDEN=(
  '.env'
  '.env.local'
  'admin-app/.env.local'
  'CHAT_HANDOFF.md'
)
FORBIDDEN_DIRS=(
  'docs/system-audit'
  'docs/owner-decisions'
  'backups'
)

echo "Checking for files that must not be published…"
for f in "${FORBIDDEN[@]}"; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    fail "$f is tracked but must never be committed."
  fi
done
for d in "${FORBIDDEN_DIRS[@]}"; do
  if [ -n "$(git ls-files "$d" 2>/dev/null)" ]; then
    fail "$d/ is tracked but must never be committed."
  fi
done

# --- 2. Credential-shaped strings in tracked files ---------------------------
# .env.example is allowed to contain KEY= with an EMPTY value only.
echo "Scanning tracked files for credential-shaped strings…"

TRACKED=$(git ls-files -- \
  ':!:package-lock.json' \
  ':!:*/package-lock.json' \
  ':!:*.svg' \
  ':!:*.ttf' \
  ':!:scripts/scan-secrets.sh')

scan() {
  local label="$1" pattern="$2"
  local hits
  hits=$(printf '%s\n' "$TRACKED" | xargs -I{} grep -nEI "$pattern" {} /dev/null 2>/dev/null || true)
  if [ -n "$hits" ]; then
    fail "Possible $label found:"
    printf '%s\n' "$hits" | head -10 | while read -r line; do note "$line"; done
  fi
}

# Long-lived Meta tokens (EAA...), Google API keys (AIza...), private keys,
# bcrypt hashes and non-empty secret assignments.
scan "Meta access token"       'EAA[A-Za-z0-9]{40,}'
scan "Google API key"          'AIza[A-Za-z0-9_\-]{30,}'
scan "private key block"       'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
scan "bcrypt password hash"    '\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{50,}'
scan "AWS access key"          'AKIA[0-9A-Z]{16}'
scan "Slack token"             'xox[baprs]-[0-9A-Za-z-]{10,}'
scan "JWT"                     'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.'

# Assignments with a real-looking value for security-critical variables.
SECRET_VARS='SESSION_SECRET|META_PAGE_ACCESS_TOKEN|META_APP_SECRET|META_VERIFY_TOKEN|GEMINI_API_KEY|OWNER_PASSWORD_HASH|POSTGRES_PASSWORD|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET'
ASSIGN_HITS=$(printf '%s\n' "$TRACKED" | xargs -I{} grep -nEI "^[[:space:]]*(${SECRET_VARS})[[:space:]]*=[[:space:]]*[^[:space:]\"']" {} /dev/null 2>/dev/null \
  | grep -vE "=[[:space:]]*(\\\$\{|\"\"|''|<|your|xxx|placeholder|changeme|e2e-|local-|test-)" || true)
if [ -n "$ASSIGN_HITS" ]; then
  fail "Non-placeholder secret assignment in a tracked file:"
  printf '%s\n' "$ASSIGN_HITS" | head -10 | while read -r line; do note "$line"; done
fi

if [ "$FAILED" -eq 0 ]; then
  echo
  echo "✓ Secret scan passed — no credentials or private files are tracked."
else
  echo
  echo "Secret scan FAILED. Remove the offending content before publishing."
  exit 1
fi
