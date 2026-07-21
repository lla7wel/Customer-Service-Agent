/**
 * Admin CRUD for the ai_behaviors table — GET (list), PATCH (update one row).
 * Changes here take effect immediately on the next live pipeline call.
 * Called by: admin-app/src/components/ai/AiBehaviors.tsx (AI Control page).
 * Calls: PostgreSQL through the shared Kysely integration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { compilePrompt, publicPromptPreview, type AiTask } from '@integrations/prompt-compiler';
import { loadBehaviorsWith } from '@integrations/ai-behaviors';
import { requireAdminApi, forbidden } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELDS = ['title', 'prompt', 'rules', 'memory', 'enabled'];

/** List all AI behaviors. */
const TASKS: AiTask[] = ['customer_reply', 'product_recommendation', 'handoff_reply', 'vision_describe', 'vision_rank', 'memory_summary', 'campaign_caption', 'campaign_image', 'campaign_image_verify'];

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  try {
    const task = req.nextUrl.searchParams.get('task') as AiTask | null;
    if (task) {
      if (!TASKS.includes(task)) return NextResponse.json({ error: 'invalid_task' }, { status: 400 });
      const behaviors = await loadBehaviorsWith(db);
      const envelope = compilePrompt(behaviors, task, {});
      return NextResponse.json({ preview: publicPromptPreview(envelope) });
    }
    const data = await db.selectFrom('ai_behaviors').selectAll().orderBy('behavior_key', 'asc').execute();
    return NextResponse.json({ behaviors: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'query_failed' }, { status: 500 });
  }
}

/**
 * Update one behavior by id. Changes take effect on the next AI call. Every
 * save appends a version snapshot so any earlier state can be restored with
 * one click (no deployment).
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  if (admin.role !== 'owner') return forbidden('Only the owner can edit raw prompts.');
  const body = await req.json().catch(() => ({}));
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const update: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in body) update[k] = body[k];
  for (const field of ['title', 'prompt', 'rules', 'memory']) {
    if (typeof update[field] === 'string' && (update[field] as string).length > 30_000) {
      return NextResponse.json({ error: `${field}_too_long` }, { status: 400 });
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no_editable_fields' }, { status: 400 });
  }

  try {
    const updated = await db.updateTable('ai_behaviors').set(update as any).where('id', '=', id)
      .returning(['behavior_key', 'title', 'prompt', 'rules', 'memory', 'enabled'])
      .executeTakeFirst();
    if (updated) {
      await db.insertInto('ai_behavior_versions').values({
        behavior_key: updated.behavior_key,
        title: updated.title,
        prompt: updated.prompt,
        rules: updated.rules,
        memory: updated.memory,
        enabled: updated.enabled,
        note: `edit (${Object.keys(update).join(', ')})`,
      }).execute();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'update_failed' }, { status: 500 });
  }

  await db.insertInto('activity_logs').values({
    actor_type: 'human',
    action: 'ai_behavior_updated',
    entity_type: 'ai_behaviors',
    entity_id: id,
    summary: `Updated AI behavior (${Object.keys(update).join(', ')})`,
  }).execute();
  return NextResponse.json({ ok: true });
}
