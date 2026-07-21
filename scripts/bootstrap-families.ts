/**
 * One-shot: build the initial product families from existing catalog data.
 * Safe to re-run — admin-corrected products (family_locked) are never moved.
 *
 * Run: npm run bootstrap:families   (from scripts/)
 */
import './_env';
import { requireDb } from '../integrations/db/client';
import { bootstrapFamilies } from '../integrations/catalog/families';

async function main() {
  const db = requireDb();
  const res = await bootstrapFamilies(db);
  console.log(`Families upserted: ${res.familiesCreated}`);
  console.log(`Products grouped:  ${res.productsGrouped}`);
  console.log(`Locked (kept):     ${res.skippedLocked}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Family bootstrap failed:', e?.message ?? e);
  process.exit(1);
});
