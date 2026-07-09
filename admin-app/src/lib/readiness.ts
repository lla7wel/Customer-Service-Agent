/**
 * Go-live readiness checklist — aggregates real env + DB state into a list of
 * pass/fail items shown on the dashboard. No faked values.
 * Called by: dashboard page. Must not: write to the DB or trigger mutations.
 */
import 'server-only';
import { getDb } from './supabase/db';
import { getCatalogStats } from './catalog';
import { supabaseStatus, geminiStatus, metaStatus, appBaseUrl } from '@integrations/status';

/**
 * Go-live readiness checklist. Each item is computed from real state — no faked
 * values. `critical` items must pass before the app is "ready to publish".
 */
export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  critical: boolean;
}

export interface Readiness {
  items: ReadinessItem[];
  ready: boolean;
  passed: number;
  total: number;
}

export async function getReadiness(): Promise<Readiness> {
  const sb = supabaseStatus();
  const gm = geminiStatus();
  const mt = metaStatus();
  const baseUrl = appBaseUrl();

  const stats = await getCatalogStats();

  // Active products that are missing a price (must be zero for go-live).
  let activeNoPrice = 0;
  const db = getDb();
  if (db) {
    const { count } = await db
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .is('base_price', null);
    activeNoPrice = count ?? 0;
  }

  // Enabled AI behaviors.
  let behaviorsEnabled = 0;
  if (db) {
    const { count } = await db
      .from('ai_behaviors')
      .select('id', { count: 'exact', head: true })
      .eq('enabled', true);
    behaviorsEnabled = count ?? 0;
  }

  const matchTotal = stats.matchPossible + stats.matchApproved + stats.matchNeedsReview + stats.matchNoSafe;

  const items: ReadinessItem[] = [
    { key: 'supabase', label: 'Supabase connected', ok: sb.configured, critical: true, detail: sb.configured ? 'Database reachable' : `Missing: ${sb.missing.join(', ')}` },
    { key: 'gemini', label: 'Gemini connected', ok: gm.configured, critical: true, detail: gm.configured ? 'AI provider ready' : 'Missing: GEMINI_API_KEY' },
    { key: 'catalog', label: 'Catalog loaded', ok: stats.products > 0, critical: true, detail: `${stats.products.toLocaleString()} products` },
    { key: 'active_priced', label: 'Active products have prices', ok: stats.activeProducts > 0, critical: true, detail: `${stats.activeProducts.toLocaleString()} active` },
    { key: 'no_active_no_price', label: 'No active product without price', ok: activeNoPrice === 0, critical: true, detail: activeNoPrice === 0 ? 'All active products priced' : `${activeNoPrice.toLocaleString()} active without price` },
    { key: 'behaviors', label: 'AI behaviors configured', ok: behaviorsEnabled > 0, critical: true, detail: `${behaviorsEnabled}/10 enabled` },
    { key: 'base_url', label: 'App base URL configured', ok: !!baseUrl, critical: true, detail: baseUrl ? baseUrl : 'Set APP_BASE_URL' },
    { key: 'images', label: 'Product images uploaded', ok: stats.uploadedImages > 0, critical: false, detail: `${stats.uploadedImages.toLocaleString()} uploaded` },
    { key: 'matches', label: 'Match suggestions available', ok: matchTotal > 0, critical: false, detail: `${matchTotal.toLocaleString()} suggestions` },
    { key: 'meta', label: 'Meta / Facebook configured', ok: mt.configured, critical: false, detail: mt.configured ? 'Page + webhook secrets set' : `Missing: ${mt.missing.join(', ')}` },
    { key: 'webhook_url', label: 'Webhook URL available', ok: !!baseUrl, critical: false, detail: baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api/webhooks/*` : 'Needs APP_BASE_URL' },
  ];

  const passed = items.filter((i) => i.ok).length;
  const ready = items.filter((i) => i.critical).every((i) => i.ok);
  return { items, ready, passed, total: items.length };
}
