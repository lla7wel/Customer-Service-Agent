/**
 * The worker process — durable background execution for the whole platform.
 *
 * Runs as its own container (docker-compose `worker` service) beside the web
 * app. Everything asynchronous happens here, never inside a webhook request:
 *
 *   ingest_event      inbound webhook events → conversation state
 *   customer_turn     debounced, exactly-once AI replies
 *   outbox_deliver    provider sends with truthful delivery states
 *   content_publish   exactly-once FB/IG publishing (+ price activation)
 *   comments_poll     comment automation for app-published content
 *   promotion_tick    temporary price-drop expiry/restoration
 *   analytics_refresh owner dashboard rollups
 *   readiness_check   truthful provider capability probes
 *
 * Job claiming uses FOR UPDATE SKIP LOCKED with leases; crashed leases are
 * reaped back into the queue. Recurring work is self-scheduled with dedupe
 * keys — no host cron required.
 */
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';

// Runs both as ESM source (tsx) and as an esbuild CJS bundle, where
// import.meta.url is not available — resolve the repo .env by searching upward
// from the working directory instead of from the module URL.
for (const candidate of [
  process.env.DOTENV_PATH,
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
]) {
  if (candidate && existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

import { assertConfig } from '../integrations/config';
import { requireDb } from '../integrations/db/client';
import {
  claimNextJob, completeJob, failJob, reapExpiredLeases, enqueue, heartbeatJob, type JobType, type JobRow,
} from '../integrations/jobs/queue';
import { processInboundEvent } from '../integrations/pipelines/ingest';
import { runCustomerTurn } from '../integrations/pipelines/turn';
import { deliverOutboxMessage } from '../integrations/pipelines/outbox';
import { processPublication, startDueScheduledContent } from '../integrations/pipelines/content-publish';
import { processContentGeneration } from '../integrations/pipelines/content-create';
import { pollAndProcessComments } from '../integrations/pipelines/comments';
import { endDuePromotions } from '../integrations/catalog/pricing';
import { refreshAnalytics } from '../integrations/pipelines/analytics';
import { runAllReadinessChecks } from '../integrations/providers/readiness';
import { primeMetaFromDb } from '../integrations/providers/connection';
import { runCsvImportJob } from '../integrations/catalog/csv-import';
import { sql } from 'kysely';

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const HANDLED_TYPES: JobType[] = [
  'ingest_event', 'customer_turn', 'outbox_deliver', 'content_publish',
  'content_generate', 'comments_poll', 'promotion_tick', 'analytics_refresh', 'readiness_check', 'csv_import',
];

const RECURRING: { jobType: JobType; everySeconds: number }[] = [
  { jobType: 'comments_poll', everySeconds: 120 },
  { jobType: 'promotion_tick', everySeconds: 60 },
  { jobType: 'analytics_refresh', everySeconds: 3600 },
  { jobType: 'readiness_check', everySeconds: 6 * 3600 },
];

let running = true;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handleJob(db: ReturnType<typeof requireDb>, job: JobRow): Promise<void> {
  const payload = (job.payload ?? {}) as Record<string, any>;
  switch (job.job_type as JobType) {
    case 'ingest_event':
      await processInboundEvent(db, String(payload.eventId));
      break;
    case 'customer_turn':
      await runCustomerTurn(db, String(payload.conversationId));
      break;
    case 'outbox_deliver': {
      const outcome = await deliverOutboxMessage(db, String(payload.outboxId));
      if (outcome === 'retry') throw new Error('provider send failed transiently — retrying');
      break;
    }
    case 'content_publish': {
      const outcome = await processPublication(db, String(payload.publicationId));
      if (outcome === 'retry') throw new Error('publish failed transiently — retrying');
      break;
    }
    case 'content_generate':
      await processContentGeneration(db, String(payload.generationRunId));
      break;
    case 'comments_poll':
      await pollAndProcessComments(db);
      break;
    case 'promotion_tick':
      await endDuePromotions(db);
      await startDueScheduledContent(db);
      break;
    case 'analytics_refresh':
      await refreshAnalytics(db);
      break;
    case 'readiness_check':
      await runAllReadinessChecks(db);
      break;
    case 'csv_import':
      await runCsvImportJob(db, String(payload.importRunId));
      break;
    default:
      throw new Error(`unknown job type: ${job.job_type}`);
  }
}

/**
 * Retention sweep: raw provider payloads and operational records are kept only
 * as long as they are useful (privacy hygiene — the conversation itself stays).
 */
async function retentionSweep(db: ReturnType<typeof requireDb>): Promise<void> {
  await sql`delete from inbound_events where status in ('processed','skipped') and received_at < now() - interval '30 days'`.execute(db).catch(() => {});
  await sql`delete from jobs where status = 'completed' and finished_at < now() - interval '7 days'`.execute(db).catch(() => {});
  await sql`delete from login_attempts where created_at < now() - interval '14 days'`.execute(db).catch(() => {});
  await sql`delete from admin_sessions where expires_at < now() - interval '14 days'`.execute(db).catch(() => {});
  await sql`delete from integration_logs where created_at < now() - interval '60 days'`.execute(db).catch(() => {});
}

async function scheduleRecurring(db: ReturnType<typeof requireDb>): Promise<void> {
  for (const r of RECURRING) {
    await enqueue(db, {
      jobType: r.jobType,
      dedupeKey: `cron:${r.jobType}`,
      runAt: new Date(Date.now() + r.everySeconds * 1000),
      onDuplicate: 'ignore',
      maxAttempts: 2,
    }).catch(() => {});
  }
}

async function main(): Promise<void> {
  assertConfig('worker');
  const db = requireDb();
  console.log(`[worker] ${WORKER_ID} starting`);
  // Resolve Meta credentials from the encrypted DB connection (env fallback) so
  // the worker sends via the SAME connection the app manages.
  await primeMetaFromDb(db).catch(() => {});

  let lastMaintenance = 0;
  let lastRetention = 0;
  while (running) {
    try {
      const now = Date.now();
      if (now - lastMaintenance > 30_000) {
        lastMaintenance = now;
        const reaped = await reapExpiredLeases(db);
        if (reaped) console.log(`[worker] reaped ${reaped} expired lease(s)`);
        await scheduleRecurring(db);
        // Pick up any connection change (reconnect / repair) made in the app.
        await primeMetaFromDb(db).catch(() => {});
      }
      if (now - lastRetention > 6 * 3600_000) {
        lastRetention = now;
        await retentionSweep(db);
      }

      const job = await claimNextJob(db, WORKER_ID, HANDLED_TYPES, 900);
      if (!job) {
        await sleep(750);
        continue;
      }
      const started = Date.now();
      const heartbeat = setInterval(() => {
        void heartbeatJob(db, job.id, WORKER_ID, 900).catch(() => {});
      }, 60_000);
      try {
        await handleJob(db, job);
        await completeJob(db, job.id);
        console.log(`[worker] ${job.job_type} ${job.id} done in ${Date.now() - started}ms`);
      } catch (e: any) {
        const verdict = await failJob(db, job, String(e?.message ?? e));
        console.error(`[worker] ${job.job_type} ${job.id} ${verdict}: ${e?.message ?? e}`);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (e: any) {
      // Database blip — back off and keep the loop alive.
      console.error(`[worker] loop error: ${e?.message ?? e}`);
      await sleep(3000);
    }
  }
  console.log('[worker] stopped');
  process.exit(0);
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} received — finishing current job`);
    running = false;
  });
}

main().catch((e) => {
  console.error('[worker] fatal:', e?.message ?? e);
  process.exit(1);
});
