/**
 * Admin-lock helpers — enforce the "admin edits win forever" catalog rule.
 *
 * Once an admin edits a customer-facing product field, that field is recorded in
 * products.admin_locked_fields ({ "base_price": true, ... }). Any non-admin
 * writer (scraper sync, CSV re-import, automatic matching, AI suggestions) MUST
 * route its updates through `stripLockedFields` so it can never silently
 * overwrite an admin decision. Admin-initiated edits call `withLocks` to both
 * apply the change and mark the touched fields as locked.
 *
 * Shared by the admin app (API routes) and the scripts (import/sync), so it lives
 * in integrations/ with no framework dependencies.
 */

/** Fields that become "owned by admin" once edited in the app. */
export const LOCKABLE_FIELDS = [
  'libyan_display_name',
  'arabic_name',
  'english_name',
  'category',
  'subcategory',
  'base_price',
  'status',
  'availability',
  'search_keywords',
  'arabic_keywords',
  'primary_image_id',
] as const;

export type LockableField = (typeof LOCKABLE_FIELDS)[number];

export type LockMap = Record<string, boolean>;

/** Read the lock map off a raw products row value (tolerates null/garbage). */
export function asLockMap(value: unknown): LockMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: LockMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === true) out[k] = true;
  }
  return out;
}

/** True if `field` is locked in the given map. */
export function isLocked(locks: unknown, field: string): boolean {
  return asLockMap(locks)[field] === true;
}

/**
 * Merge the keys actually present in `update` into the existing lock map and
 * return the new map. Only lockable keys are recorded. Use when an ADMIN edits.
 */
export function lockEditedFields(existing: unknown, update: Record<string, unknown>): LockMap {
  const locks = asLockMap(existing);
  for (const key of Object.keys(update)) {
    if ((LOCKABLE_FIELDS as readonly string[]).includes(key)) locks[key] = true;
  }
  return locks;
}

/**
 * Build an admin update object that also persists the new lock map, so a single
 * UPDATE both writes the values and marks them locked.
 */
export function withLocks<T extends Record<string, unknown>>(
  existingLocks: unknown,
  update: T,
): T & { admin_locked_fields: LockMap } {
  return { ...update, admin_locked_fields: lockEditedFields(existingLocks, update) };
}

/**
 * Remove any locked keys from a NON-admin update (scraper sync, CSV re-import,
 * matcher, AI). Returns a new object containing only the keys that are safe to
 * write. Use this in every automated writer before calling .update().
 */
export function stripLockedFields<T extends Record<string, unknown>>(
  locks: unknown,
  update: T,
): Partial<T> {
  const map = asLockMap(locks);
  const out: Partial<T> = {};
  for (const [key, val] of Object.entries(update)) {
    if (map[key] !== true) (out as Record<string, unknown>)[key] = val;
  }
  return out;
}
