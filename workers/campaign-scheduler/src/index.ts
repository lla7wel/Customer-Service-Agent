/**
 * Cloudflare cron Worker: campaign scheduler. Runs on a schedule to (1) refresh
 * cached product pricing from active campaigns and (2) auto-publish any due
 * scheduled campaigns. Reuses the shared campaign pipeline.
 *
 * Also exposes an HTTP endpoint (protected by CLOUDFLARE_WEBHOOK_SECRET) so you
 * can trigger a tick manually while testing — same contract as the Next.js
 * route /api/cron/campaign-scheduler.
 */
import { setEnv } from '../../../integrations/env';
import { adminClient } from '../../../integrations/supabase/admin-client';
import { runSchedulerTick } from '../../../integrations/pipelines/campaign';

type Env = Record<string, string | undefined>;

async function tick(env: Env) {
  setEnv(env);
  const db = adminClient();
  if (!db) return { ok: false, reason: 'supabase_not_configured' };
  return { ok: true, ...(await runSchedulerTick(db)) };
}

export default {
  // Cron trigger (see wrangler.toml [triggers]).
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await tick(env);
  },

  // Manual HTTP trigger (Authorization: Bearer <CLOUDFLARE_WEBHOOK_SECRET>).
  async fetch(request: Request, env: Env): Promise<Response> {
    setEnv(env);
    const secret = env.CLOUDFLARE_WEBHOOK_SECRET;
    if (!secret) return Response.json({ error: 'integration_not_configured', missing: ['CLOUDFLARE_WEBHOOK_SECRET'] }, { status: 503 });
    const auth = request.headers.get('authorization') || '';
    const url = new URL(request.url);
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('secret');
    if (provided !== secret) return new Response('Unauthorized', { status: 401 });
    return Response.json(await tick(env));
  },
};
