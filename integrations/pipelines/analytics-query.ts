/**
 * The ONE shared analytics service.
 *
 * Consumed by the Dashboard server page, the /api/dashboard route, the
 * /api/analytics route and the Analytics workspace so every surface reports the
 * SAME numbers (no server-vs-API drift — audit finding #1).
 *
 * Correctness rules baked in here:
 *   - local additive metrics are aggregated on Africa/Tripoli calendar days
 *     (not the server/UTC day — audit finding #3);
 *   - every day in the requested range is present, zero-filled, and every series
 *     is aligned on the same day keys (audit findings #2, and series alignment);
 *   - comparisons use an equal-length immediately-preceding period;
 *   - additive, snapshot and unique metrics are distinguished. Instagram reach is
 *     UNIQUE and is never summed across days into a period total (audit finding
 *     #4) — a period total requires the provider's own aggregate, which we do not
 *     fabricate.
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';

export const TRIPOLI_TZ = 'Africa/Tripoli';

export type Channel = 'all' | 'messenger' | 'instagram';
export type MetricKind = 'additive' | 'snapshot' | 'unique';

/** Inclusive Tripoli calendar range, YYYY-MM-DD. */
export interface Range { start: string; end: string }

export interface MetricSeries {
  metric: string;
  kind: MetricKind;
  days: string[];
  values: number[];
  /** Period total for additive/unique metrics; null when a truthful total is
   *  unavailable (e.g. unique reach with no provider period aggregate). */
  total: number | null;
  previousTotal: number | null;
  /** Percent change vs the previous equal-length period. null = no baseline. */
  changePct: number | null;
}

/* --------------------------- pure date helpers ---------------------------- */

/** Today's date in Tripoli as YYYY-MM-DD. */
export function tripoliToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TRIPOLI_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Add whole days to a YYYY-MM-DD calendar date. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** The last `days` Tripoli calendar days ending today (inclusive). */
export function rangeForDays(days: number, now: Date = new Date()): Range {
  const end = tripoliToday(now);
  return { start: addDays(end, -(Math.max(1, days) - 1)), end };
}

/** All Tripoli calendar days in the inclusive range, ascending. */
export function dayList(range: Range): string[] {
  const days: string[] = [];
  let d = range.start;
  for (let i = 0; i < 1000 && d <= range.end; i++) { days.push(d); d = addDays(d, 1); }
  return days;
}

/** Equal-length period immediately preceding `range`. */
export function previousRange(range: Range): Range {
  const len = dayList(range).length || 1;
  const prevEnd = addDays(range.start, -1);
  return { start: addDays(prevEnd, -(len - 1)), end: prevEnd };
}

/** Zero-fill and align a sparse {day->value} map onto the full day list. */
export function zeroFill(days: string[], sparse: Map<string, number>): number[] {
  return days.map((d) => sparse.get(d) ?? 0);
}

/** Percent change vs a baseline. null when there is no baseline to compare to. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/* ------------------------------ DB queries -------------------------------- */

/**
 * Daily counts of a timestamptz column bucketed by Tripoli calendar day, for a
 * single metric definition. Returns a sparse Map keyed by YYYY-MM-DD.
 */
async function dailyByTripoli(
  db: Kysely<DB>,
  opts: {
    table: 'messages' | 'conversations' | 'content_publications' | 'content_comments';
    tsColumn: string;
    range: Range;
    distinctColumn?: string;
    where?: string;
    channel?: Channel;
  },
): Promise<Map<string, number>> {
  const day = `date(${opts.table}.${opts.tsColumn} at time zone ${quote(TRIPOLI_TZ)})`;
  const count = opts.distinctColumn ? `count(distinct ${opts.table}.${opts.distinctColumn})` : 'count(*)';
  const joins: string[] = [];
  const conds: string[] = [
    `${opts.table}.${opts.tsColumn} >= ${tripoliDayStart(opts.range.start)}`,
    `${opts.table}.${opts.tsColumn} < ${tripoliDayStart(addDays(opts.range.end, 1))}`,
  ];
  if (opts.where) conds.push(opts.where);
  if (opts.channel && opts.channel !== 'all') {
    if (opts.table === 'messages') {
      joins.push('join conversations on conversations.id = messages.conversation_id');
      conds.push(`conversations.channel = ${quote(opts.channel)}`);
    } else if (opts.table === 'conversations') {
      conds.push(`conversations.channel = ${quote(opts.channel)}`);
    }
  }
  const query = `
    select ${day} as day, ${count}::int as n
    from ${opts.table}
    ${joins.join('\n')}
    where ${conds.join(' and ')}
    group by 1`;
  const res = await sql<{ day: unknown; n: number }>`${sql.raw(query)}`.execute(db);
  const map = new Map<string, number>();
  for (const row of res.rows) {
    const key = dayKey(row.day);
    if (key) map.set(key, Number(row.n));
  }
  return map;
}

/** Distinct count over the whole range (NOT a sum of daily distincts). */
async function distinctOverRange(
  db: Kysely<DB>,
  opts: { table: 'conversations'; tsColumn: string; distinctColumn: string; range: Range; where?: string; channel?: Channel },
): Promise<number> {
  const conds: string[] = [
    `${opts.table}.${opts.tsColumn} >= ${tripoliDayStart(opts.range.start)}`,
    `${opts.table}.${opts.tsColumn} < ${tripoliDayStart(addDays(opts.range.end, 1))}`,
  ];
  if (opts.where) conds.push(opts.where);
  if (opts.channel && opts.channel !== 'all') conds.push(`${opts.table}.channel = ${quote(opts.channel)}`);
  const query = `select count(distinct ${opts.table}.${opts.distinctColumn})::int as n from ${opts.table} where ${conds.join(' and ')}`;
  const res = await sql<{ n: number }>`${sql.raw(query)}`.execute(db);
  return Number(res.rows[0]?.n ?? 0);
}

/* ----------------------------- metric catalog ----------------------------- */

type LocalMetricDef = {
  metric: string;
  kind: MetricKind;
  table: 'messages' | 'conversations' | 'content_publications' | 'content_comments';
  tsColumn: string;
  where?: string;
  distinctColumn?: string;
  channelAware: boolean;
};

export const LOCAL_METRICS: LocalMetricDef[] = [
  { metric: 'inbound_messages', kind: 'additive', table: 'messages', tsColumn: 'created_at', where: "messages.direction = 'inbound'", channelAware: true },
  { metric: 'ai_replies', kind: 'additive', table: 'messages', tsColumn: 'created_at', where: "messages.direction = 'outbound' and messages.sender_type = 'ai' and messages.delivery_status in ('sent','partial')", channelAware: true },
  { metric: 'human_replies', kind: 'additive', table: 'messages', tsColumn: 'created_at', where: "messages.direction = 'outbound' and messages.sender_type = 'human'", channelAware: true },
  { metric: 'delivery_failures', kind: 'additive', table: 'messages', tsColumn: 'created_at', where: "messages.direction = 'outbound' and messages.delivery_status in ('failed','uncertain','dead')", channelAware: true },
  { metric: 'active_conversations', kind: 'unique', table: 'conversations', tsColumn: 'last_message_at', distinctColumn: 'id', channelAware: true },
  { metric: 'order_handoffs', kind: 'additive', table: 'conversations', tsColumn: 'handoff_sent_at', channelAware: true },
  { metric: 'content_published', kind: 'additive', table: 'content_publications', tsColumn: 'published_at', where: "content_publications.status = 'published'", channelAware: false },
  { metric: 'content_failed', kind: 'additive', table: 'content_publications', tsColumn: 'updated_at', where: "content_publications.status = 'failed'", channelAware: false },
  { metric: 'comment_replies', kind: 'additive', table: 'content_comments', tsColumn: 'updated_at', where: "content_comments.reply_status = 'sent'", channelAware: false },
  { metric: 'comment_reply_failures', kind: 'additive', table: 'content_comments', tsColumn: 'updated_at', where: "content_comments.reply_status = 'failed'", channelAware: false },
];

async function buildLocalMetric(db: Kysely<DB>, def: LocalMetricDef, range: Range, prev: Range, channel: Channel): Promise<MetricSeries> {
  const ch = def.channelAware ? channel : 'all';
  const days = dayList(range);

  const current = await dailyByTripoli(db, {
    table: def.table, tsColumn: def.tsColumn, range, where: def.where, channel: ch,
    distinctColumn: def.kind === 'unique' ? def.distinctColumn : undefined,
  });
  const values = zeroFill(days, current);

  let total: number | null;
  let previousTotal: number | null;
  if (def.kind === 'unique' && def.table === 'conversations' && def.distinctColumn) {
    // A unique count's period total is a distinct-over-range, never a sum of
    // daily distincts (which would double-count conversations active on
    // multiple days).
    total = await distinctOverRange(db, { table: 'conversations', tsColumn: def.tsColumn, distinctColumn: def.distinctColumn, range, where: def.where, channel: ch });
    previousTotal = await distinctOverRange(db, { table: 'conversations', tsColumn: def.tsColumn, distinctColumn: def.distinctColumn, range: prev, where: def.where, channel: ch });
  } else {
    total = values.reduce((a, b) => a + b, 0);
    const prevMap = await dailyByTripoli(db, { table: def.table, tsColumn: def.tsColumn, range: prev, where: def.where, channel: ch });
    previousTotal = [...prevMap.values()].reduce((a, b) => a + b, 0);
  }

  return {
    metric: def.metric, kind: def.kind, days, values,
    total, previousTotal, changePct: pctChange(total ?? 0, previousTotal ?? 0),
  };
}

/* ---------------------------- provider insights --------------------------- */

const PROVIDER_ADDITIVE = new Set(['facebook_page_engagements', 'facebook_page_views', 'instagram_views', 'instagram_interactions']);
const PROVIDER_UNIQUE = new Set(['instagram_reach']); // reach is NOT summable across days

export interface ProviderInsight {
  metric: string;
  kind: MetricKind;
  days: string[];
  values: number[];
  /** Additive → summed. Unique (reach) → null: a period total needs the
   *  provider's own aggregate; summing daily unique reach overstates it. */
  total: number | null;
  available: boolean;
  note: string | null;
}

async function buildProviderInsights(db: Kysely<DB>, range: Range): Promise<{ insights: ProviderInsight[]; lastSyncedAt: string | null }> {
  const metrics = [...PROVIDER_ADDITIVE, ...PROVIDER_UNIQUE];
  const rows = await db.selectFrom('analytics_daily')
    .select(['day', 'metric', 'value', 'computed_at'])
    .where('metric', 'in', metrics)
    .where('day', '>=', sql<any>`${range.start}::date`)
    .where('day', '<=', sql<any>`${range.end}::date`)
    .execute();

  const days = dayList(range);
  let lastSyncedAt: string | null = null;
  const byMetric = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = dayKey(r.day);
    if (!key) continue;
    if (!byMetric.has(r.metric)) byMetric.set(r.metric, new Map());
    byMetric.get(r.metric)!.set(key, Number(r.value));
    const c = r.computed_at ? new Date(r.computed_at as any).toISOString() : null;
    if (c && (!lastSyncedAt || c > lastSyncedAt)) lastSyncedAt = c;
  }

  const insights: ProviderInsight[] = metrics.map((metric) => {
    const map = byMetric.get(metric);
    const available = !!map && map.size > 0;
    const values = zeroFill(days, map ?? new Map());
    const unique = PROVIDER_UNIQUE.has(metric);
    return {
      metric,
      kind: unique ? 'unique' : 'additive',
      days,
      values,
      total: !available ? null : unique ? null : values.reduce((a, b) => a + b, 0),
      available,
      note: !available
        ? 'Not yet collected — appears once the Page token has read_insights and a sync succeeds.'
        : unique
          ? 'Daily reach shown for the trend only; a period total needs the provider aggregate (unique reach is not additive).'
          : null,
    };
  });

  return { insights, lastSyncedAt };
}

/* -------------------------------- bundle ---------------------------------- */

export interface AnalyticsBundle {
  range: Range;
  previous: Range;
  channel: Channel;
  metrics: Record<string, MetricSeries>;
  provider: ProviderInsight[];
  meta: {
    source: 'local';
    timezone: string;
    generatedAt: string;
    providerLastSyncedAt: string | null;
  };
}

export interface AnalyticsOptions {
  days?: number;
  range?: Range;
  channel?: Channel;
  now?: Date;
  metrics?: string[];
}

/** Compute the full analytics bundle used by every surface. */
export async function getAnalytics(db: Kysely<DB>, opts: AnalyticsOptions = {}): Promise<AnalyticsBundle> {
  const range = opts.range ?? rangeForDays(opts.days ?? 7, opts.now);
  const prev = previousRange(range);
  const channel: Channel = opts.channel ?? 'all';
  const defs = opts.metrics ? LOCAL_METRICS.filter((d) => opts.metrics!.includes(d.metric)) : LOCAL_METRICS;

  const metrics: Record<string, MetricSeries> = {};
  for (const def of defs) {
    metrics[def.metric] = await buildLocalMetric(db, def, range, prev, channel);
  }
  const { insights, lastSyncedAt } = await buildProviderInsights(db, range);

  return {
    range, previous: prev, channel, metrics, provider: insights,
    meta: { source: 'local', timezone: TRIPOLI_TZ, generatedAt: new Date().toISOString(), providerLastSyncedAt: lastSyncedAt },
  };
}

/* ------------------------------- utilities -------------------------------- */

/** Single-quote a literal for safe inline SQL (values here are code-controlled
 *  tz names / ISO dates, never user text, but we quote defensively). */
function quote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * The exact UTC instant of Tripoli-midnight for a YYYY-MM-DD day, as a SQL
 * timestamptz. Uses a `::timestamp` literal (NOT `::date`) so `AT TIME ZONE`
 * INTERPRETS the wall time as Tripoli-local and returns the right instant —
 * `date AT TIME ZONE` would instead convert from the server session tz and be
 * session-dependent (the exact bug we fix).
 */
function tripoliDayStart(day: string): string {
  return `(${quote(day + ' 00:00:00')}::timestamp at time zone ${quote(TRIPOLI_TZ)})`;
}

/** PostgreSQL may return a date column as YYYY-MM-DD or a Date; normalize. */
export function dayKey(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value ?? '');
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
