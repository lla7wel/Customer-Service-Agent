/**
 * PostgreSQL-backed durable job queue.
 *
 * Design (replaces in-memory debounce/sleep coordination — EH-001/007/016):
 *   * enqueue() persists work in the same database (and, where callers pass a
 *     transaction, the same transaction) as the state change that caused it;
 *   * claimNextJob() takes work with FOR UPDATE SKIP LOCKED + a lease, so any
 *     number of workers can run without double-claiming;
 *   * completeJob()/failJob() implement bounded backoff and a visible dead
 *     state — failures are never silently swallowed;
 *   * reapExpiredLeases() returns crashed workers' jobs to the queue.
 *
 * Debounced customer turns use dedupe keys: a new inbound message simply
 * pushes the existing pending turn job's run_at forward.
 */
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { DB, Jobs } from '../db/types';

export type JobType =
  | 'ingest_event'
  | 'customer_turn'
  | 'outbox_deliver'
  | 'content_publish'
  | 'content_generate'
  | 'comments_poll'
  | 'promotion_tick'
  | 'analytics_refresh'
  | 'readiness_check'
  | 'csv_import'
  | 'social_sync'
  | 'family_bootstrap';

export interface EnqueueOptions {
  jobType: JobType;
  payload?: Record<string, unknown>;
  /** One live (pending/running) job per dedupe key. */
  dedupeKey?: string;
  /** Absolute due time; default now. */
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /** When a pending job with the same dedupe key exists: */
  onDuplicate?: 'ignore' | 'push_run_at';
}

export type JobRow = Selectable<Jobs>;

const json = (v: unknown) => JSON.stringify(v ?? {});

export async function enqueue(
  db: Kysely<DB> | Transaction<DB>,
  opts: EnqueueOptions,
): Promise<{ id: string | null; deduped: boolean }> {
  const runAt = (opts.runAt ?? new Date()).toISOString();
  if (!opts.dedupeKey) {
    const row = await db
      .insertInto('jobs')
      .values({
        job_type: opts.jobType,
        payload: json(opts.payload),
        run_at: runAt,
        priority: opts.priority ?? 100,
        max_attempts: opts.maxAttempts ?? 5,
      })
      .returning('id')
      .executeTakeFirst();
    return { id: row?.id ?? null, deduped: false };
  }

  // Atomic dedupe against the partial unique index uq_jobs_dedupe_live.
  const pushRunAt = opts.onDuplicate === 'push_run_at';
  const res = await sql<{ id: string }>`
    insert into jobs (job_type, dedupe_key, payload, run_at, priority, max_attempts)
    values (${opts.jobType}, ${opts.dedupeKey}, ${json(opts.payload)}::jsonb, ${runAt}::timestamptz,
            ${opts.priority ?? 100}, ${opts.maxAttempts ?? 5})
    on conflict (dedupe_key) where dedupe_key is not null and status in ('pending','running')
    do update set
      run_at  = case when jobs.status = 'pending' and ${pushRunAt}
                     then excluded.run_at else jobs.run_at end,
      payload = case when jobs.status = 'pending'
                     then excluded.payload else jobs.payload end
    returning id
  `.execute(db);
  const id = res.rows[0]?.id ?? null;
  return { id, deduped: false };
}

/** Claim the next due job (any of the given types). Returns null when idle. */
export async function claimNextJob(
  db: Kysely<DB>,
  workerId: string,
  types: JobType[],
  leaseSeconds = 120,
): Promise<JobRow | null> {
  if (!types.length) return null;
  const res = await sql<JobRow>`
    update jobs set
      status = 'running',
      locked_by = ${workerId},
      lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
      attempts = attempts + 1
    where id = (
      select id from jobs
      where status = 'pending'
        and run_at <= now()
        and job_type = any(${sql.val(types)}::text[])
      order by priority asc, run_at asc
      limit 1
      for update skip locked
    )
    returning *
  `.execute(db);
  return res.rows[0] ?? null;
}

export async function completeJob(db: Kysely<DB>, jobId: string): Promise<void> {
  await db
    .updateTable('jobs')
    .set({ status: 'completed', finished_at: new Date().toISOString(), locked_by: null, lease_expires_at: null, last_error: null })
    .where('id', '=', jobId)
    .execute();
}

/** Bounded exponential backoff; a job out of attempts becomes DEAD (visible). */
export async function failJob(db: Kysely<DB>, job: JobRow, error: string): Promise<'retry' | 'dead'> {
  const exhausted = (job.attempts ?? 0) >= (job.max_attempts ?? 5);
  const backoffSeconds = Math.min(600, 15 * 2 ** Math.max(0, (job.attempts ?? 1) - 1));
  if (exhausted) {
    await db
      .updateTable('jobs')
      .set({ status: 'dead', finished_at: new Date().toISOString(), locked_by: null, lease_expires_at: null, last_error: error.slice(0, 2000) })
      .where('id', '=', job.id)
      .execute();
    return 'dead';
  }
  await sql`
    update jobs set
      status = 'pending',
      locked_by = null,
      lease_expires_at = null,
      last_error = ${error.slice(0, 2000)},
      run_at = now() + make_interval(secs => ${backoffSeconds})
    where id = ${job.id}
  `.execute(db);
  return 'retry';
}

/** Return crashed workers' expired leases to the queue (or dead-letter them). */
export async function reapExpiredLeases(db: Kysely<DB>): Promise<number> {
  const res = await sql`
    update jobs set
      status = case when attempts >= max_attempts then 'dead' else 'pending' end,
      locked_by = null,
      lease_expires_at = null,
      last_error = coalesce(last_error, 'worker lease expired'),
      finished_at = case when attempts >= max_attempts then now() else finished_at end
    where status = 'running' and lease_expires_at < now()
  `.execute(db);
  return Number(res.numAffectedRows ?? 0);
}

/** Extend the lease of a long-running job the worker still owns. */
export async function heartbeatJob(db: Kysely<DB>, jobId: string, workerId: string, leaseSeconds = 120): Promise<void> {
  await sql`
    update jobs set lease_expires_at = now() + make_interval(secs => ${leaseSeconds})
    where id = ${jobId} and locked_by = ${workerId} and status = 'running'
  `.execute(db);
}
