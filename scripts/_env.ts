/**
 * Shared env loader for standalone scripts. Importing this FIRST guarantees the
 * repo-root EH-SYSTEM1/.env is loaded regardless of the cwd the script is run
 * from (previously scripts used `import 'dotenv/config'`, which only reads a
 * scripts/.env that does not exist → SUPABASE/GEMINI vars were missing).
 *
 * Order of precedence (first wins, never overrides an already-set value):
 *   1. real process.env (CI / shell exports)
 *   2. EH-SYSTEM1/.env  (the canonical local secrets file)
 *   3. ./.env           (a local override next to the script, if present)
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> EH-SYSTEM1/.env
config({ path: path.resolve(here, '../.env') });
// optional local override (won't clobber values already loaded above)
config();
