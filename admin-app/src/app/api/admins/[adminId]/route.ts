import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdminApi, badRequest, forbidden, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Update an admin account: disable/enable, password reset, full-access toggle.
 * Protections: the last active owner can never be disabled or demoted, and an
 * admin cannot disable their own account (no self-lockout).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ adminId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { adminId } = await params;

  if (admin.role !== 'owner' && !admin.fullAccess) {
    return forbidden('Only the owner or a full-access admin can manage admins.');
  }

  const target = await db
    .selectFrom('admin_accounts')
    .select(['id', 'username', 'role', 'is_active'])
    .where('id', '=', adminId)
    .executeTakeFirst();
  if (!target) return notFound();

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};

  if (typeof body?.is_active === 'boolean') {
    if (!body.is_active) {
      if (target.id === admin.id) return badRequest('self_lockout', 'You cannot disable your own account.');
      if (target.role === 'owner') {
        const owners = await db
          .selectFrom('admin_accounts')
          .select(db.fn.countAll<number>().as('n'))
          .where('role', '=', 'owner')
          .where('is_active', '=', true)
          .executeTakeFirst();
        if (Number(owners?.n ?? 0) <= 1) return badRequest('last_owner', 'The last active owner cannot be disabled.');
      }
      // Kill the disabled admin's sessions immediately.
      await db.updateTable('admin_sessions')
        .set({ revoked_at: new Date().toISOString() })
        .where('admin_id', '=', target.id)
        .where('revoked_at', 'is', null)
        .execute();
    }
    update.is_active = body.is_active;
    changes.is_active = body.is_active;
  }

  if (typeof body?.full_access === 'boolean') {
    if (target.role === 'owner' && !body.full_access) return badRequest('owner_full_access', 'The owner always has full access.');
    update.full_access = body.full_access;
    changes.full_access = body.full_access;
  }

  if (typeof body?.display_name === 'string') {
    update.display_name = body.display_name.trim().slice(0, 80) || target.username;
    changes.display_name = update.display_name;
  }

  if (typeof body?.password === 'string' && body.password.length > 0) {
    if (body.password.length < 10) return badRequest('weak_password', 'Password must be at least 10 characters.');
    update.password_hash = await bcrypt.hash(body.password, 12);
    changes.password_reset = true;
    // A reset invalidates existing sessions for that account.
    await db.updateTable('admin_sessions')
      .set({ revoked_at: new Date().toISOString() })
      .where('admin_id', '=', target.id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  if (!Object.keys(update).length) return badRequest('no_changes');

  const updated = await db
    .updateTable('admin_accounts')
    .set(update as any)
    .where('id', '=', adminId)
    .returning(['id', 'username', 'display_name', 'role', 'full_access', 'is_active', 'last_login_at'])
    .executeTakeFirst();

  await audit(db, admin, 'admin.update', { type: 'admin_account', id: adminId, detail: changes });
  return NextResponse.json({ admin: updated });
}
