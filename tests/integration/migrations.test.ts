import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { migrate } from '../../scripts/migrate';
import { createTestDatabase, type TestDb } from './setup';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://localhost/postgres';
const REPO = path.resolve(__dirname, '../..');

describe('migration runner', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase('eh_mig'); });
  afterAll(async () => { await t.destroy(); });

  it('bootstraps a fresh database with the full chain recorded in the ledger', async () => {
    const files = readdirSync(path.join(REPO, 'database/migrations')).filter((f) => f.endsWith('.sql'));
    const rows = await t.db.selectFrom('schema_migrations' as any).select('version' as any).execute();
    expect(rows.length).toBe(files.length);
  });

  it('creates the durable-processing and catalog-truth tables', async () => {
    for (const table of ['jobs', 'outbox_messages', 'inbound_events', 'content_items', 'content_publications',
      'content_comments', 'promotions', 'product_price_history', 'product_families', 'business_facts',
      'admin_accounts', 'admin_sessions', 'admin_audit_log', 'ai_behavior_versions']) {
      const r = await t.db.selectFrom(table as any).selectAll().limit(1).execute();
      expect(Array.isArray(r)).toBe(true);
    }
  });

  it('seeds the verified business facts', async () => {
    const facts = await t.db.selectFrom('business_facts').select(['key', 'value']).execute();
    const keys = facts.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining([
      'branches', 'working_hours', 'phone', 'delivery_available', 'pickup_available',
      'order_whatsapp_url', 'order_whatsapp_benghazi',
    ]));
    const branches = facts.find((f) => f.key === 'branches')!.value as string[];
    expect(branches).toHaveLength(3);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const again = await migrate({ databaseUrl: t.url, quiet: true });
    expect(again.applied).toEqual([]);
    expect(again.backfilled).toEqual([]);
  });
});

describe('upgrade from a legacy production-like database', () => {
  const name = `eh_legacy_${Date.now()}`;
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);

  beforeAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();

    // Reproduce the REAL production state: bootstrap + schema + 0001..0014
    // applied, but only 4 ledger rows (audit finding EH-013).
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query(readFileSync(path.join(REPO, 'database/bootstrap.sql'), 'utf8'));
    await client.query(readFileSync(path.join(REPO, 'database/schema.sql'), 'utf8'));
    const legacy = readdirSync(path.join(REPO, 'database/migrations'))
      .filter((f) => f.endsWith('.sql') && f < '0015')
      .sort();
    for (const f of legacy) {
      await client.query(readFileSync(path.join(REPO, 'database/migrations', f), 'utf8'));
    }
    await client.query(`delete from schema_migrations where version not in
      ('0001_init','0006_message_batching','0007_image_fingerprints','0008_campaign_asset_review')`);
    // Legacy data that must survive: a product with a price, a conversation.
    await client.query(`insert into products (product_code, english_name, base_price, active_price, status)
      values ('LEG1', 'Legacy Towel', 99, 99, 'active')`);
    await client.end();
  });

  afterAll(async () => {
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  it('repairs the ledger by probing and applies only the new migrations', async () => {
    const result = await migrate({ databaseUrl: url, quiet: true });
    expect(result.fresh).toBe(false);
    // 0002..0005 + 0009..0014 backfilled (effects present), 0015+ applied.
    expect(result.backfilled).toEqual(expect.arrayContaining([
      '0002_price_review_staging', '0004_admin_locked_fields', '0012_production_cleanup',
      '0014_prompt_control_and_campaign_variables',
    ]));
    expect(result.applied).toEqual(expect.arrayContaining([
      '0015_admin_accounts', '0016_durable_processing', '0017_catalog_truth',
      '0018_content_studio', '0019_ai_control_versions', '0020_readiness_and_analytics',
    ]));
    expect(result.applied.some((v) => v < '0015')).toBe(false);
  });

  it('preserves legacy data and gives it a price-history baseline', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    const product = await client.query(`select id, base_price from products where product_code = 'LEG1'`);
    expect(product.rows).toHaveLength(1);
    const history = await client.query(
      `select source, new_price from product_price_history where product_id = $1`,
      [product.rows[0].id],
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].source).toBe('migration');
    expect(Number(history.rows[0].new_price)).toBe(99);
    await client.end();
  });
});
