import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest } from '@/lib/api';
import { audit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Editable keys and their value shapes. New facts are added here, not free-form. */
const EDITABLE: Record<string, 'string' | 'boolean' | 'string_array'> = {
  branches: 'string_array',
  working_hours: 'string',
  phone: 'string',
  delivery_available: 'boolean',
  pickup_available: 'boolean',
  order_whatsapp_url: 'string',
  order_whatsapp_benghazi: 'string',
};

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const facts = await db.selectFrom('business_facts')
    .select(['key', 'value', 'label_ar', 'label_en', 'updated_at'])
    .orderBy('key', 'asc')
    .execute();
  return NextResponse.json({ facts });
}

/** Update Business Facts — structured, validated, audited. */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const body = await req.json().catch(() => ({}));
  const updates = body?.facts;
  if (!updates || typeof updates !== 'object') return badRequest('missing_facts');

  const applied: string[] = [];
  for (const [key, raw] of Object.entries(updates as Record<string, unknown>)) {
    const shape = EDITABLE[key];
    if (!shape) continue;
    let value: unknown;
    if (shape === 'string') {
      if (typeof raw !== 'string') return badRequest('invalid_value', `${key} must be a string`);
      value = raw.trim().slice(0, 500);
    } else if (shape === 'boolean') {
      if (typeof raw !== 'boolean') return badRequest('invalid_value', `${key} must be true/false`);
      value = raw;
    } else {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
        return badRequest('invalid_value', `${key} must be a list of strings`);
      }
      value = (raw as string[]).map((v) => v.trim().slice(0, 300)).filter(Boolean).slice(0, 20);
    }
    await db.updateTable('business_facts')
      .set({
        value: JSON.stringify(value),
        updated_by: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
        updated_at: new Date().toISOString(),
      })
      .where('key', '=', key)
      .execute();
    applied.push(key);
  }
  if (!applied.length) return badRequest('no_editable_keys');
  await audit(db, admin, 'settings.business_facts', { detail: { keys: applied } });
  return NextResponse.json({ ok: true, updated: applied });
}
