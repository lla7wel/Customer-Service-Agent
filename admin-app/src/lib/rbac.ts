/**
 * Centralized role-based access control (the ONE capability matrix).
 *
 * There are exactly four roles. Every section, navigation item, page guard and
 * API guard resolves authorization through the maps in this file — never through
 * scattered string comparisons. This module is pure logic (no Node, no pg, no
 * jose) so the edge middleware, server components and API routes can all import
 * it.
 *
 *   Owner    — full application authority (Dashboard, Analytics, Inbox, Catalog,
 *              Content Studio, AI Control, Settings, admin management, prices…).
 *   Analyzer — Inbox, Analytics, Content Studio.
 *   Poster   — Content Studio.
 *   Messager — Inbox, Content Studio.
 *
 * "Full authority inside a permitted section" is intentional: there is no owner
 * approval queue for non-owner publishing. Owner-only power lives OUTSIDE the
 * shared sections (Dashboard, Catalog/prices/CSV, AI Control, Settings, Channels,
 * Business Facts, Brand Kit, admin/session administration).
 */

export type Role = 'owner' | 'analyzer' | 'poster' | 'messager';

export const ROLES: readonly Role[] = ['owner', 'analyzer', 'poster', 'messager'] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** The seven top-level sections of the operations center. */
export type Section =
  | 'dashboard'
  | 'analytics'
  | 'inbox'
  | 'catalog'
  | 'content-studio'
  | 'ai-control'
  | 'settings';

/** Which roles may enter each section. This is the single source of truth. */
export const SECTION_ROLES: Record<Section, readonly Role[]> = {
  dashboard: ['owner'],
  analytics: ['owner', 'analyzer'],
  inbox: ['owner', 'analyzer', 'messager'],
  catalog: ['owner'],
  'content-studio': ['owner', 'analyzer', 'poster', 'messager'],
  'ai-control': ['owner'],
  settings: ['owner'],
};

export function canAccessSection(role: Role, section: Section): boolean {
  return SECTION_ROLES[section].includes(role);
}

/** Sections a role may enter, in canonical order. */
export function sectionsForRole(role: Role): Section[] {
  return (Object.keys(SECTION_ROLES) as Section[]).filter((s) => canAccessSection(role, s));
}

/** Where each role lands after login / when redirected away from a forbidden page. */
export const ROLE_LANDING: Record<Role, string> = {
  owner: '/dashboard',
  analyzer: '/analytics',
  poster: '/content-studio',
  messager: '/inbox',
};

export function landingPath(role: Role | null | undefined): string {
  return (role && ROLE_LANDING[role]) || '/inbox';
}

/**
 * Resolve a page pathname to its guarded section, or null when the path is not a
 * gated section (profile/theme/language toggles, the login page, static assets).
 * A null section means "any authenticated admin" — never used to grant a section.
 */
export function sectionForPath(pathname: string): Section | null {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  const seg = (name: string) => p === name || p.startsWith(name + '/');
  if (p === '/' || seg('/dashboard')) return 'dashboard';
  if (seg('/analytics')) return 'analytics';
  if (seg('/inbox')) return 'inbox';
  if (seg('/catalog')) return 'catalog';
  if (seg('/content-studio')) return 'content-studio';
  if (seg('/ai-control') || seg('/ai-playground')) return 'ai-control';
  if (seg('/settings')) return 'settings';
  return null;
}

/** True when the role may open this app page. Ungated paths are always allowed. */
export function canAccessPath(role: Role, pathname: string): boolean {
  const section = sectionForPath(pathname);
  return section ? canAccessSection(role, section) : true;
}

/**
 * Resolve an API request to the roles allowed to call it, or null when any
 * authenticated admin may (shared reads such as product search / global search,
 * whose *results* are role-filtered inside the route).
 *
 * Method-aware: catalog reads under /api/products are shared (Inbox and Content
 * Studio both need product lookups), but catalog *writes* are owner-only.
 */
export function apiAccessRoles(pathname: string, method: string): readonly Role[] | null {
  const p = (pathname || '').replace(/\/+$/, '');
  const isRead = method === 'GET' || method === 'HEAD';
  const has = (prefix: string) => p === prefix || p.startsWith(prefix + '/');

  // Owner-only administration.
  if (has('/api/admins')) return ['owner'];
  if (has('/api/settings')) return ['owner'];
  if (has('/api/ai')) return ['owner'];
  if (has('/api/dashboard')) return ['owner'];
  if (has('/api/imports')) return ['owner'];

  // Section-scoped.
  if (has('/api/analytics')) return ['owner', 'analyzer'];
  if (has('/api/inbox')) return ['owner', 'analyzer', 'messager'];
  // Content APIs are open to every content-studio role (all four), i.e. any admin.
  if (has('/api/content')) return null;

  // Catalog: reads are shared across sections; writes are owner-only.
  if (has('/api/products')) return isRead ? null : ['owner'];

  // Global search: allowed for any admin; the route filters results by role.
  if (has('/api/search')) return null;

  return null;
}

export function canCallApi(role: Role, pathname: string, method: string): boolean {
  const allowed = apiAccessRoles(pathname, method);
  return allowed === null || allowed.includes(role);
}

/** Only the Owner may list, create, disable, reset or re-role admin accounts. */
export function canManageAdmins(role: Role): boolean {
  return role === 'owner';
}

/**
 * Normalize a legacy/unknown role value to a valid Role. Rows that predate the
 * four-role migration ('admin') and any corrupt value fall back to the least
 * privilege (messager) so authorization can never fail open.
 */
export function normalizeRole(role: string | null | undefined): Role {
  return isRole(role) ? role : 'messager';
}
