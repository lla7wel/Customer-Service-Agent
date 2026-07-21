/**
 * Global test guard: strip REAL provider credentials from the environment.
 *
 * The migration runner loads the repo-root .env (so tests can find
 * TEST_DATABASE_ADMIN_URL and local settings), which would otherwise leak the
 * owner's live Meta/Gemini credentials into the test process. No test may ever
 * reach a real customer, page or paid API — each test sets the fake values it
 * needs explicitly.
 */
const PROVIDER_SECRETS = [
  'META_PAGE_ACCESS_TOKEN',
  'META_PAGE_ID',
  'META_IG_USER_ID',
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'GEMINI_API_KEY',
  'SESSION_SECRET',
  'OWNER_PASSWORD_HASH',
];

// Set to empty rather than delete: dotenv (loaded later by the migration
// runner) only fills keys that are ABSENT, so an empty value blocks the real
// secret from ever entering the test process. Empty reads as "not configured".
for (const key of PROVIDER_SECRETS) process.env[key] = '';

// Keep the app out of "production" behavior during tests.
process.env.NODE_ENV = 'test';
