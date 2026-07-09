/**
 * Admin CRUD for the ai_behaviors table — GET (list), PATCH (update one row).
 * Changes here take effect immediately on the next live pipeline call.
 * Called by: admin-app/src/components/ai/AiBehaviors.tsx (AI Control page).
 * Calls: integrations/supabase/admin-client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { databaseStatus } from '@integrations/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELDS = ['title', 'prompt', 'rules', 'memory', 'enabled'];

/** List all AI behaviors. */
export async function GET() {
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: databaseStatus().missing },
      { status: 503 },
    );
  }
  try {
    const data = await db.selectFrom('ai_behaviors').selectAll().orderBy('behavior_key', 'asc').execute();
    return NextResponse.json({ behaviors: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'query_failed' }, { status: 500 });
  }
}

/** Update one behavior by id. Changes take effect on the next AI call. */
export async function PATCH(req: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: databaseStatus().missing },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const update: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no_editable_fields' }, { status: 400 });
  }

  try {
    await db.updateTable('ai_behaviors').set(update as any).where('id', '=', id).execute();
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
