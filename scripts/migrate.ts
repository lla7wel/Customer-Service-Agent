/**
 * Forward-only, idempotent migration runner with a reliable ledger.
 *
 * Why this exists: the historical migrations 0001–0014 did not share a ledger
 * contract — only 4 of them recorded themselves in schema_migrations (audit
 * finding EH-013), so "what has been applied?" could not be answered on a live
 * database. This runner repairs that WITHOUT rewriting history:
 *
 *   1. Fresh database  → bootstrap.sql + schema.sql + every migration, recorded.
 *   2. Existing database → for each unrecorded legacy migration, a read-only
 *      PROBE checks whether its effects are already present. Present → the
 *      ledger row is backfilled (marked backfilled=true). Absent → the file is
 *      applied inside a transaction, then recorded.
 *   3. New migrations (0015+) are written idempotent, applied in order inside
 *      transactions, and always self-recorded by the runner.
 *
 * Usage:
 *   npm run db:migrate            # apply pending migrations
 *   npm run db:migrate -- --preflight   # report only, change nothing
 *
 * Never edit an applied migration file — add a new one.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';

/**
 * Locate the repo root by walking up until database/migrations is found.
 * Deliberately avoids import.meta/__dirname so this module loads identically
 * under tsx (ESM), ts-node/CJS test loaders and bundlers.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'database', 'migrations'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const repoRoot = findRepoRoot();
loadDotenv({ path: path.join(repoRoot, '.env') });

const MIGRATIONS_DIR = path.join(repoRoot, 'database', 'migrations');
const SCHEMA_FILE = path.join(repoRoot, 'database', 'schema.sql');
const BOOTSTRAP_FILE = path.join(repoRoot, 'database', 'bootstrap.sql');

/**
 * Read-only probes proving a legacy migration's effects already exist.
 * Each returns SQL evaluating to one row with a boolean column `present`.
 */
const LEGACY_PROBES: Record<string, string> = {
  '0001_init': `select to_regclass('public.customers') is not null as present`,
  '0002_price_review_staging': `select exists (select 1 from pg_indexes where schemaname='public' and indexname='idx_products_needs_price') as present`,
  '0003_catalog_match_suggestions': `select to_regclass('public.catalog_match_suggestions') is not null as present`,
  '0004_admin_locked_fields': `select exists (select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='admin_locked_fields') as present`,
  '0005_ai_behaviors': `select to_regclass('public.ai_behaviors') is not null as present`,
  '0006_message_batching': `select exists (select 1 from information_schema.columns where table_schema='public' and table_name='conversations' and column_name='next_turn_at') as present`,
  '0007_image_fingerprints': `select exists (select 1 from pg_indexes where schemaname='public' and indexname='idx_img_corrections_customer_hash') as present`,
  '0008_campaign_asset_review': `select exists (select 1 from information_schema.columns where table_schema='public' and table_name='campaign_assets' and column_name='approved') as present`,
  '0009_ai_brain': `select to_regclass('public.customer_memory') is not null and to_regclass('public.product_fingerprints') is not null as present`,
  '0010_remove_facebook_comments': `select to_regclass('public.facebook_comments') is null as present`,
  '0011_attachments_and_indexes': `select to_regclass('public.conversation_attachments') is not null as present`,
  '0012_production_cleanup': `select to_regclass('public.orders') is null and to_regclass('public.ai_settings') is null and to_regclass('public.product_variants') is null as present`,
  '0013_self_hosted': `select not exists (select 1 from pg_constraint where conname='admin_users_id_fkey') as present`,
  '0014_prompt_control_and_campaign_variables': `select exists (select 1 from information_schema.columns where table_schema='public' and table_name='campaigns' and column_name='aspect_ratio') and exists (select 1 from ai_behaviors where behavior_key='brand_identity') as present`,
};

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

function listMigrations(): { version: string; file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      version: f.replace(/\.sql$/, ''),
      file: path.join(MIGRATIONS_DIR, f),
      sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'),
    }));
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )`);
  await client.query(`alter table schema_migrations add column if not exists backfilled boolean not null default false`);
  await client.query(`alter table schema_migrations add column if not exists checksum text`);
}

async function appliedVersions(client: Client): Promise<Set<string>> {
  const res = await client.query(`select version from schema_migrations`);
  return new Set(res.rows.map((r: { version: string }) => r.version));
}

async function isFreshDatabase(client: Client): Promise<boolean> {
  const res = await client.query(`select to_regclass('public.customers') is null as fresh`);
  return !!res.rows[0]?.fresh;
}

async function probeLegacy(client: Client, version: string): Promise<boolean | null> {
  const probe = LEGACY_PROBES[version];
  if (!probe) return null;
  try {
    const res = await client.query(probe);
    return !!res.rows[0]?.present;
  } catch {
    return false; // a failing probe (e.g. missing table it references) means "not applied"
  }
}

async function applyOne(client: Client, version: string, sql: string, backfilled: boolean): Promise<void> {
  // Some legacy files contain their own BEGIN/COMMIT; strip runner-level
  // transaction only when the file manages its own.
  const managesOwnTx = /^\s*begin\s*;/im.test(sql);
  if (!managesOwnTx) await client.query('begin');
  try {
    if (!backfilled) await client.query(sql);
    await client.query(
      `insert into schema_migrations (version, backfilled, checksum) values ($1, $2, $3)
       on conflict (version) do update set backfilled = excluded.backfilled, checksum = excluded.checksum`,
      [version, backfilled, checksum(sql)],
    );
    if (!managesOwnTx) await client.query('commit');
  } catch (e) {
    if (!managesOwnTx) await client.query('rollback').catch(() => {});
    throw e;
  }
}

export async function migrate(opts: { preflight?: boolean; databaseUrl?: string; quiet?: boolean } = {}): Promise<{
  fresh: boolean;
  applied: string[];
  backfilled: string[];
  alreadyApplied: string[];
}> {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required (set it in .env)');
  const log = opts.quiet ? () => {} : (m: string) => console.log(m);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  const backfilledList: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    // Serialize concurrent runners (two deploys must not race).
    await client.query(`select pg_advisory_lock(hashtext('eh_system_migrations'))`);
    const fresh = await isFreshDatabase(client);
    const migrations = listMigrations();

    if (fresh) {
      log('Fresh database detected → bootstrap + schema + full migration chain.');
      if (opts.preflight) {
        return { fresh, applied: migrations.map((m) => m.version), backfilled: [], alreadyApplied: [] };
      }
      if (existsSync(BOOTSTRAP_FILE)) await client.query(readFileSync(BOOTSTRAP_FILE, 'utf8'));
      await client.query(readFileSync(SCHEMA_FILE, 'utf8'));
      await ensureLedger(client);
      for (const m of migrations) {
        await applyOne(client, m.version, m.sql, false);
        applied.push(m.version);
        log(`  applied ${m.version}`);
      }
      return { fresh, applied, backfilled: [], alreadyApplied };
    }

    await ensureLedger(client);
    const done = await appliedVersions(client);
    for (const m of migrations) {
      if (done.has(m.version)) {
        alreadyApplied.push(m.version);
        continue;
      }
      const probed = await probeLegacy(client, m.version);
      if (probed === true) {
        if (!opts.preflight) await applyOne(client, m.version, m.sql, true);
        backfilledList.push(m.version);
        log(`  ledger backfilled ${m.version} (effects already present)`);
        continue;
      }
      if (opts.preflight) {
        applied.push(m.version);
        log(`  pending ${m.version}`);
        continue;
      }
      log(`  applying ${m.version} ...`);
      await applyOne(client, m.version, m.sql, false);
      applied.push(m.version);
      log(`  applied ${m.version}`);
    }
    return { fresh, applied, backfilled: backfilledList, alreadyApplied };
  } finally {
    await client.query(`select pg_advisory_unlock(hashtext('eh_system_migrations'))`).catch(() => {});
    await client.end();
  }
}

// CLI entry (tsx runs this file directly; importing it from tests must not run it).
if (process.argv[1] && /migrate\.ts$/.test(process.argv[1])) {
  const preflight = process.argv.includes('--preflight');
  migrate({ preflight })
    .then((r) => {
      console.log(preflight ? 'Preflight (no changes made):' : 'Migration complete:');
      console.log(`  fresh database: ${r.fresh}`);
      console.log(`  applied: ${r.applied.length ? r.applied.join(', ') : 'none'}`);
      console.log(`  ledger backfilled: ${r.backfilled.length ? r.backfilled.join(', ') : 'none'}`);
      console.log(`  already recorded: ${r.alreadyApplied.length}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error('Migration failed:', e?.message ?? e);
      process.exit(1);
    });
}
