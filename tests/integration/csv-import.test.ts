import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCsvImportJob, importFilePath } from '../../integrations/catalog/csv-import';
import { changePriceManual } from '../../integrations/catalog/pricing';
import { createTestDatabase, seedProduct, type TestDb } from './setup';
import { lockEditedFields } from '../../integrations/product-locks';

const HEADER = 'Product Code,Barcode,Product Name,Price,Website URL,Image URL,Arabic Keywords,Needs Size/Color,English Keywords,Variant Requirement,Search Text';

/** Write a CSV for an import run and process it through the real worker job. */
async function runImport(t: TestDb, csv: string): Promise<ReturnType<typeof runCsvImportJob>> {
  const run = await t.db.insertInto('product_import_runs')
    .values({ source: 'csv', source_file: 'test.csv', status: 'running' })
    .returning('id').executeTakeFirst();
  const dest = importFilePath(run!.id);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, csv, 'utf8');
  return runCsvImportJob(t.db, run!.id);
}

describe('CSV catalog import', () => {
  let t: TestDb;
  let mediaRoot: string;

  beforeAll(async () => {
    mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eh-media-'));
    process.env.MEDIA_ROOT = mediaRoot;
    process.env.PUBLIC_MEDIA_BASE_URL = 'https://media.test';
    t = await createTestDatabase('eh_csv');
  });
  afterAll(async () => {
    await t.destroy();
    await fs.rm(mediaRoot, { recursive: true, force: true });
    delete process.env.MEDIA_ROOT;
    delete process.env.PUBLIC_MEDIA_BASE_URL;
  });

  it('inserts new CSV-only products with a price-history baseline', async () => {
    const summary = await runImport(t, [
      HEADER,
      'NEW001,8680000000001,Cotton Bath Towel,45,https://x.example/t,,"منشفة, قطن",No,"towel, cotton",,towel',
    ].join('\n'));
    expect(summary.created).toBe(1);
    expect(summary.errors).toBe(0);

    const p = await t.db.selectFrom('products')
      .select(['id', 'base_price', 'active_price', 'status', 'arabic_keywords', 'search_keywords', 'variant_attributes'])
      .where('product_code', '=', 'NEW001').executeTakeFirst();
    expect(Number(p!.base_price)).toBe(45);
    expect(p!.status).toBe('active');
    expect(p!.arabic_keywords).toEqual(['منشفة', 'قطن']);
    expect(p!.search_keywords).toEqual(['towel', 'cotton']);
    expect((p!.variant_attributes as any).needs_size_color).toBe('No');

    const history = await t.db.selectFrom('product_price_history')
      .select(['source', 'new_price']).where('product_id', '=', p!.id).execute();
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe('csv_import');
  });

  it('updates UNLOCKED fields automatically and records every field change', async () => {
    const id = await seedProduct(t.db, { product_code: 'UPD001', english_name: 'Old Name', base_price: 100, active_price: 100 });
    const summary = await runImport(t, [
      HEADER,
      'UPD001,8680000000002,Brand New Name,175,https://x.example/u,,"جديد",Yes,"new",size,search',
    ].join('\n'));
    expect(summary.updated).toBe(1);
    expect(summary.priceUpdated).toBe(1);

    const p = await t.db.selectFrom('products')
      .select(['english_name', 'base_price', 'barcode']).where('id', '=', id).executeTakeFirst();
    expect(p!.english_name).toBe('Brand New Name');
    expect(Number(p!.base_price)).toBe(175);
    expect(p!.barcode).toBe('8680000000002');

    const changes = await t.db.selectFrom('product_field_changes')
      .select(['field', 'old_value', 'new_value']).where('product_id', '=', id).execute();
    const fields = changes.map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['english_name', 'barcode', 'base_price']));
    const nameChange = changes.find((c) => c.field === 'english_name')!;
    expect(nameChange.old_value).toBe('Old Name');
    expect(nameChange.new_value).toBe('Brand New Name');
  });

  it('ADMIN LOCKS WIN: a locked name and price are never overwritten by an import', async () => {
    const id = await seedProduct(t.db, { product_code: 'LOCK001', english_name: 'Admin Chosen Name', base_price: 90, active_price: 90 });
    // Admin edits the name (locks it) and the price (locks base_price).
    await t.db.updateTable('products')
      .set({ admin_locked_fields: JSON.stringify(lockEditedFields({}, { english_name: true })) })
      .where('id', '=', id).execute();
    await changePriceManual(t.db, { productId: id, newPrice: 90 });

    const summary = await runImport(t, [
      HEADER,
      'LOCK001,,Import Wants This Name,555,,,,,,,',
    ].join('\n'));
    expect(summary.lockedSkipped).toBeGreaterThanOrEqual(1);

    const p = await t.db.selectFrom('products')
      .select(['english_name', 'base_price', 'active_price']).where('id', '=', id).executeTakeFirst();
    expect(p!.english_name).toBe('Admin Chosen Name');
    expect(Number(p!.base_price)).toBe(90);
    expect(Number(p!.active_price)).toBe(90);
  });

  it('matches existing products by barcode when the code differs', async () => {
    const id = await seedProduct(t.db, { product_code: 'BC-INTERNAL', barcode: '8680000000777', base_price: 60, active_price: 60 });
    const summary = await runImport(t, [HEADER, 'OTHERCODE,8680000000777,Barcode Match,70,,,,,,,'].join('\n'));
    expect(summary.created).toBe(0);
    const p = await t.db.selectFrom('products').select('base_price').where('id', '=', id).executeTakeFirst();
    expect(Number(p!.base_price)).toBe(70);
  });

  it('a per-row failure never aborts the run and is reported truthfully', async () => {
    const summary = await runImport(t, [
      HEADER,
      'GOODROW,,Fine Product,50,,,,,,,',
      // duplicate of the first row → rejected at parse time, reported as a problem
      'GOODROW,,Duplicate,60,,,,,,,',
    ].join('\n'));
    expect(summary.created).toBe(1);
    expect(summary.problems.some((p) => p.includes('duplicate'))).toBe(true);
  });

  it('records a truthful run summary on product_import_runs', async () => {
    await runImport(t, [HEADER, 'SUMMARY1,,Summary Product,25,,,,,,,'].join('\n'));
    const run = await t.db.selectFrom('product_import_runs')
      .select(['status', 'total_records', 'created_count', 'error_count'])
      .orderBy('started_at', 'desc').executeTakeFirst();
    expect(run!.status).toBe('completed');
    expect(run!.total_records).toBe(1);
    expect(run!.created_count).toBe(1);
    expect(run!.error_count).toBe(0);
  });

  it('a CSV product with no price stays in draft (never customer-visible)', async () => {
    await runImport(t, [HEADER, 'NOPRICE1,,Unpriced Thing,,,,,,,,'].join('\n'));
    const p = await t.db.selectFrom('products')
      .select(['status', 'base_price']).where('product_code', '=', 'NOPRICE1').executeTakeFirst();
    expect(p!.status).toBe('draft');
    expect(p!.base_price).toBeNull();
  });

  it('preserves existing catalog images across an import', async () => {
    const id = await seedProduct(t.db, { product_code: 'IMG001', base_price: 30, active_price: 30 });
    await t.db.insertInto('product_images').values({
      product_id: id, public_url: 'https://media.test/products/IMG001/1.jpg', position: 0, is_primary: true,
    }).execute();
    await runImport(t, [HEADER, 'IMG001,,Renamed,35,,,,,,,'].join('\n'));
    const images = await t.db.selectFrom('product_images').select('public_url').where('product_id', '=', id).execute();
    expect(images).toHaveLength(1);
    expect(images[0].public_url).toBe('https://media.test/products/IMG001/1.jpg');
  });
});
