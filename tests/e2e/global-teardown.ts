import { Client } from 'pg';
import { promises as fs } from 'node:fs';
import { E2E_DB_NAME, E2E_MEDIA_ROOT } from '../../playwright.config';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://localhost/postgres';

export default async function globalTeardown() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${E2E_DB_NAME} with (force)`);
  await admin.end();
  await fs.rm(E2E_MEDIA_ROOT, { recursive: true, force: true }).catch(() => {});
}
