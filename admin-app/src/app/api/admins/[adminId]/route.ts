import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdminApi, badRequest, forbidden, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { canManageAdmins, isRole, type Role } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Count active owners — the guard for last-owner protection. */
async function activeOwnerCount(db: Parameters<typeof audit>[0]): Promise<number> {
  const row = await db
    .selectFrom('admin_accounts')
    .select(db.fn.countAll<number>().as('n'))
    .where('role', '=', 'owner')
    .where('is_active', '=', true)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/**
 * Update an admin account: disable/enable, password reset, role assignment.
 * Protections: the last active owner can never be disabled or demoted, an admin
 * cannot disable their own account (no self-lockout), and any change to a role
 * revokes that admin's existing sessions.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ adminId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { adminId } = await params;

  if (!canManageAdmins(admin.role)) {
    return forbidden('Only the owner can manage admins.');
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

  // Revoke the target admin's live sessions when their access changes
  // (disable, password reset, or role change) — enforced once before update.
  let revokeSessions = false;

  if (typeof body?.is_active === 'boolean') {
    if (!body.is_active) {
      if (target.id === admin.id) return badRequest('self_lockout', 'You cannot disable your own account.');
      if (target.role === 'owner' && (await activeOwnerCount(db)) <= 1) {
        return badRequest('last_owner', 'The last active owner cannot be disabled.');
      }
      revokeSessions = true;
    }
    update.is_active = body.is_active;
    changes.is_active = body.is_active;
  }

  if (body?.role !== undefined) {
    if (!isRole(body.role)) return badRequest('invalid_role', 'Role must be owner, analyzer, poster or messager.');
    const newRole = body.role as Role;
    if (newRole !== target.role) {
      // Final-owner protection: never demote the last active owner.
      if (target.role === 'owner' && newRole !== 'owner' && (await activeOwnerCount(db)) <= 1) {
        return badRequest('last_owner', 'The last active owner cannot be demoted.');
      }
      update.role = newRole;
      // Keep the legacy column consistent; it is no longer read for authz.
      update.full_access = newRole === 'owner';
      changes.role = newRole;
      revokeSessions = true;
    }
  }

  if (typeof body?.display_name === 'string') {
    update.display_name = body.display_name.trim().slice(0, 80) || target.username;
    changes.display_name = update.display_name;
  }

  if (typeof body?.password === 'string' && body.password.length > 0) {
    if (body.password.length < 10) return badRequest('weak_password', 'Password must be at least 10 characters.');
    update.password_hash = await bcrypt.hash(body.password, 12);
    changes.password_reset = true;
    revokeSessions = true;
  }

  if (!Object.keys(update).length) return badRequest('no_changes');

  if (revokeSessions) {
    await db.updateTable('admin_sessions')
      .set({ revoked_at: new Date().toISOString() })
      .where('admin_id', '=', target.id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  const updated = await db
    .updateTable('admin_accounts')
    .set(update as any)
    .where('id', '=', adminId)
    .returning(['id', 'username', 'display_name', 'role', 'is_active', 'last_login_at'])
    .executeTakeFirst();

  await audit(db, admin, 'admin.update', { type: 'admin_account', id: adminId, detail: changes });
  return NextResponse.json({ admin: updated });
}
