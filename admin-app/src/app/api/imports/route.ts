import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest } from '@/lib/api';
import { audit } from '@/lib/auth';
import { enqueue } from '@integrations/jobs/queue';
import { parseCatalogCsv, importFilePath } from '@integrations/catalog/csv-import';
import { isStorageConfigured } from '@integrations/storage';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CSV_BYTES = 15 * 1024 * 1024; // 15 MB is far beyond any real catalog

/** List recent CSV import runs with their truthful summaries. */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const runs = await db
    .selectFrom('product_import_runs')
    .select(['id', 'source', 'source_file', 'status', 'total_records', 'created_count', 'updated_count', 'skipped_count', 'error_count', 'errors', 'started_at', 'finished_at'])
    .orderBy('started_at', 'desc')
    .limit(30)
    .execute();
  return NextResponse.json({ runs });
}

/**
 * Upload a catalog CSV → validated, stored, queued as a worker job.
 * Unlocked fields update automatically; admin locks always win. No approval
 * queue — the result summary is the audit trail.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'storage_not_configured', detail: 'MEDIA_ROOT and PUBLIC_MEDIA_BASE_URL are required for import files.' }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return badRequest('missing_file', 'Send multipart/form-data with a "file" field.');
  if (file.size > MAX_CSV_BYTES) return badRequest('file_too_large', 'CSV exceeds 15 MB.');
  if (file.name && !/\.csv$/i.test(file.name)) return badRequest('not_csv', 'Only .csv files are accepted.');

  const text = Buffer.from(await file.arrayBuffer()).toString('utf8');
  const { rows, problems } = parseCatalogCsv(text);
  if (!rows.length) return badRequest('empty_csv', problems[0] ?? 'No valid data rows found.');

  const run = await db
    .insertInto('product_import_runs')
    .values({
      source: 'csv',
      source_file: (file.name || 'catalog.csv').slice(0, 200),
      status: 'running',
      total_records: rows.length,
      started_by: null,
    })
    .returning('id')
    .executeTakeFirst();
  if (!run) return NextResponse.json({ error: 'run_create_failed' }, { status: 500 });

  const dest = importFilePath(run.id);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, text, 'utf8');

  await enqueue(db, {
    jobType: 'csv_import',
    payload: { importRunId: run.id },
    dedupeKey: `csv_import:${run.id}`,
    maxAttempts: 2,
  });
  await audit(db, admin, 'catalog.csv_import', { type: 'import_run', id: run.id, detail: { rows: rows.length, file: file.name } });
  return NextResponse.json({ ok: true, run_id: run.id, rows: rows.length, validation_problems: problems.slice(0, 20) }, { status: 202 });
}
