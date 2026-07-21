import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAdminApi, badRequest, forbidden } from '@/lib/api';
import { audit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List admin accounts (never exposes password hashes). */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const admins = await db
    .selectFrom('admin_accounts')
    .select(['id', 'username', 'display_name', 'role', 'full_access', 'is_active', 'last_login_at', 'created_at'])
    .orderBy('created_at', 'asc')
    .execute();
  return NextResponse.json({ admins });
}

/** Create a new admin directly with username + password (no email invites). */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  if (admin.role !== 'owner' && !admin.fullAccess) {
    return forbidden('Only the owner or a full-access admin can create admins.');
  }

  const body = await req.json().catch(() => ({}));
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : username;
  const fullAccess = body?.full_access !== false;

  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    return badRequest('invalid_username', 'Username: 3–40 letters, digits, dot, dash or underscore.');
  }
  if (typeof password !== 'string' || password.length < 10) {
    return badRequest('weak_password', 'Password must be at least 10 characters.');
  }

  const existing = await db
    .selectFrom('admin_accounts').select('id')
    .where((eb) => eb(eb.fn('lower', ['username']), '=', username.toLowerCase()))
    .executeTakeFirst();
  if (existing) return badRequest('username_taken');

  const hash = await bcrypt.hash(password, 12);
  const created = await db
    .insertInto('admin_accounts')
    .values({
      username,
      display_name: displayName || username,
      password_hash: hash,
      role: 'admin',
      full_access: fullAccess,
      created_by: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
    })
    .returning(['id', 'username', 'display_name', 'role', 'full_access', 'is_active'])
    .executeTakeFirst();

  await audit(db, admin, 'admin.create', { type: 'admin_account', id: created?.id, detail: { username } });
  return NextResponse.json({ admin: created }, { status: 201 });
}
