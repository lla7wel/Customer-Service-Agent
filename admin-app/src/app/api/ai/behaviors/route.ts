/**
 * Admin CRUD for the ai_behaviors table — GET (list), PATCH (update one row).
 * Changes here take effect immediately on the next live pipeline call.
 * Called by: admin-app/src/components/ai/AiBehaviors.tsx (AI Control page).
 * Calls: integrations/supabase/admin-client (service-role, bypasses RLS).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELDS = ['title', 'prompt', 'rules', 'memory', 'enabled'];

/** List all AI behaviors. */
export async function GET() {
  const db = adminClient();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') },
      { status: 503 },
    );
  }
  const { data, error } = await db.from('ai_behaviors').select('*').order('behavior_key', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ behaviors: data ?? [] });
}

/** Update one behavior by id. Changes take effect on the next AI call. */
export async function PATCH(req: NextRequest) {
  const db = adminClient();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') },
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

  const { error } = await db.from('ai_behaviors').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from('activity_logs').insert({
    actor_type: 'human',
    action: 'ai_behavior_updated',
    entity_type: 'ai_behaviors',
    entity_id: id,
    summary: `Updated AI behavior (${Object.keys(update).join(', ')})`,
  });
  return NextResponse.json({ ok: true });
}
