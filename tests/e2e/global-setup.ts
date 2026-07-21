/**
 * Creates the throwaway e2e database, applies the full migration chain and
 * seeds SYNTHETIC data plus an owner account for the browser tests.
 *
 * The database name and media root are DETERMINISTIC (exported from
 * playwright.config.ts) because Playwright captures `webServer.env` when the
 * config module loads — before this setup runs.
 */
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { promises as fs } from 'node:fs';
import { migrate } from '../../scripts/migrate';
import { E2E_DB_NAME, E2E_DATABASE_URL, E2E_MEDIA_ROOT } from '../../playwright.config';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://localhost/postgres';

export const E2E_USERNAME = 'e2e_owner';
export const E2E_PASSWORD = 'e2e-strong-password-1';

export default async function globalSetup() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${E2E_DB_NAME} with (force)`);
  await admin.query(`create database ${E2E_DB_NAME}`);
  await admin.end();

  await migrate({ databaseUrl: E2E_DATABASE_URL, quiet: true });
  await fs.mkdir(E2E_MEDIA_ROOT, { recursive: true });

  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  await db.query(
    `insert into admin_accounts (username, display_name, password_hash, role, full_access)
     values ($1, 'E2E Owner', $2, 'owner', true)`,
    [E2E_USERNAME, await bcrypt.hash(E2E_PASSWORD, 4)],
  );

  // Synthetic catalog.
  await db.query(`
    insert into products (product_code, english_name, arabic_name, libyan_display_name,
                          base_price, active_price, status, category, arabic_keywords, search_keywords)
    values
      ('E2E-1001','RANFORCE DUVET SET 160x220 WHITE','طقم غطاء لحاف','طقم غطاء لحاف أبيض 160×220',
       250,250,'active','Bedding', array['مفرش','لحاف'], array['duvet','set']),
      ('E2E-1002','COTTON BATH TOWEL 70x140','منشفة قطن','منشفة حمام قطن',
       45,45,'active','Bath', array['منشفة'], array['towel'])`);

  // Synthetic conversation already flagged for the team (order intent).
  await db.query(`
    with c as (
      insert into customers (channel, external_id, display_name)
      values ('messenger','e2e_psid_1','زبونة تجريبية') returning id
    ), cv as (
      insert into conversations (customer_id, channel, status, ai_enabled, last_message_at,
                                 last_message_preview, unread_count, human_attention,
                                 human_attention_reason, handoff_sent_at)
      select id,'messenger','ai_handling',true, now(),'نبي نطلب الطقم الأبيض',1,true,'order_intent',now()
      from c returning id
    )
    insert into messages (conversation_id, direction, sender_type, body, delivery_status, created_at)
    select id,'inbound'::message_direction,'customer'::message_sender_type,'سلام، عندكم أطقم مفارش؟',null, now() - interval '5 minutes' from cv
    union all
    select id,'outbound'::message_direction,'ai'::message_sender_type,'أهلاً بيك 🤍 عندنا أطقم بمقاسات مختلفة.','sent', now() - interval '4 minutes' from cv
    union all
    select id,'inbound'::message_direction,'customer'::message_sender_type,'نبي نطلب الطقم الأبيض',null, now() - interval '1 minute' from cv`);
  await db.end();
}
