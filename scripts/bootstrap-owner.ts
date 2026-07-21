/**
 * Owner bootstrap — creates (or repairs) the FIRST owner admin account.
 *
 * Reads OWNER_USERNAME + OWNER_PASSWORD_HASH (bcrypt) from the environment and
 * upserts the owner account. Fails safely:
 *   * missing configuration → clear error, nothing created, exit 1;
 *   * an active owner already exists with a different username → refuses to
 *     create a second owner (use the in-app admin management instead);
 *   * never prints secrets; never embeds a default password.
 *
 * Generate the hash locally:
 *   node -e "require('bcryptjs').hash(process.argv[1],12).then(console.log)" 'your-password'
 *
 * Run: npm run bootstrap:owner   (from scripts/)
 */
import './_env';
import { Client } from 'pg';

async function main() {
  const username = process.env.OWNER_USERNAME?.trim();
  const passwordHash = process.env.OWNER_PASSWORD_HASH?.trim();
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  if (!username || !passwordHash) {
    throw new Error('OWNER_USERNAME and OWNER_PASSWORD_HASH must both be set (no default credentials exist).');
  }
  if (!/^\$2[aby]\$\d\d\$/.test(passwordHash)) {
    throw new Error('OWNER_PASSWORD_HASH does not look like a bcrypt hash — refusing to store a plaintext password.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const existing = await client.query(
      `select id, lower(username) as username from admin_accounts where role = 'owner' and is_active`,
    );
    if (existing.rows.length && !existing.rows.some((r) => r.username === username.toLowerCase())) {
      throw new Error(
        `An active owner account already exists (${existing.rows[0].username}). ` +
        'Refusing to create a second owner from env. Manage admins inside the app.',
      );
    }
    await client.query(
      `insert into admin_accounts (username, display_name, password_hash, role, full_access)
       values ($1, $1, $2, 'owner', true)
       on conflict (lower(username)) do update
         set password_hash = excluded.password_hash,
             role = 'owner',
             is_active = true,
             full_access = true`,
      [username, passwordHash],
    );
    await client.query(
      `insert into admin_audit_log (admin_username, action, detail)
       values ($1, 'owner.bootstrap', '{}'::jsonb)`,
      [username],
    );
    console.log(`Owner account "${username}" is ready.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('Owner bootstrap failed:', e?.message ?? e);
  process.exit(1);
});
