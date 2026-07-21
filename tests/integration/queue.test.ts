import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { enqueue, claimNextJob, completeJob, failJob, reapExpiredLeases } from '../../integrations/jobs/queue';
import { createTestDatabase, type TestDb } from './setup';
import { sql } from 'kysely';

describe('durable job queue', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase('eh_queue'); });
  afterAll(async () => { await t.destroy(); });

  it('debounce dedupe: a newer message pushes the SAME job forward', async () => {
    const first = await enqueue(t.db, {
      jobType: 'customer_turn', dedupeKey: 'turn:conv1',
      runAt: new Date(Date.now() + 5000), onDuplicate: 'push_run_at',
    });
    const second = await enqueue(t.db, {
      jobType: 'customer_turn', dedupeKey: 'turn:conv1',
      runAt: new Date(Date.now() + 9000), onDuplicate: 'push_run_at',
    });
    expect(second.id).toBe(first.id);
    const rows = await t.db.selectFrom('jobs').select(['id', 'run_at'])
      .where('dedupe_key', '=', 'turn:conv1').execute();
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].run_at as any).getTime()).toBeGreaterThan(Date.now() + 8000);
    await t.db.deleteFrom('jobs').execute();
  });

  it('exactly-once claim: N concurrent workers never share a job', async () => {
    for (let i = 0; i < 5; i++) {
      await enqueue(t.db, { jobType: 'outbox_deliver', payload: { i } });
    }
    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, w) => claimNextJob(t.db, `w${w}`, ['outbox_deliver'])),
    );
    const got = claims.filter((c) => c !== null);
    expect(got).toHaveLength(5);
    const ids = new Set(got.map((c) => c!.id));
    expect(ids.size).toBe(5); // no double-claims
    for (const c of got) await completeJob(t.db, c!.id);
    await t.db.deleteFrom('jobs').execute();
  });

  it('bounded retries end in a VISIBLE dead state, never silence', async () => {
    await enqueue(t.db, { jobType: 'comments_poll', maxAttempts: 2 });
    const c1 = await claimNextJob(t.db, 'w1', ['comments_poll']);
    expect(await failJob(t.db, c1!, 'boom 1')).toBe('retry');
    await sql`update jobs set run_at = now() where id = ${c1!.id}`.execute(t.db);
    const c2 = await claimNextJob(t.db, 'w1', ['comments_poll']);
    expect(await failJob(t.db, c2!, 'boom 2')).toBe('dead');
    const row = await t.db.selectFrom('jobs').select(['status', 'last_error']).where('id', '=', c1!.id).executeTakeFirst();
    expect(row!.status).toBe('dead');
    expect(row!.last_error).toContain('boom');
    await t.db.deleteFrom('jobs').execute();
  });

  it('reaps expired leases from crashed workers back into the queue', async () => {
    await enqueue(t.db, { jobType: 'promotion_tick' });
    const claimed = await claimNextJob(t.db, 'crashed-worker', ['promotion_tick'], 1);
    expect(claimed).not.toBeNull();
    await sql`update jobs set lease_expires_at = now() - interval '1 minute' where id = ${claimed!.id}`.execute(t.db);
    const reaped = await reapExpiredLeases(t.db);
    expect(reaped).toBe(1);
    const row = await t.db.selectFrom('jobs').select('status').where('id', '=', claimed!.id).executeTakeFirst();
    expect(row!.status).toBe('pending');
  });
});
