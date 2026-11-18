import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { runAsService } from './postgres.js';
import { requestContext } from './request-context.js';

export type NativeUser = {
  id: string; email?: string; role: string; user_metadata: Record<string, any>;
  app_metadata: Record<string, unknown>; created_at: string;
};
export type NativeSession = {
  access_token: string; token_type: 'bearer'; expires_at: number; expires_in: number; user: NativeUser;
};
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const publicUserColumns = 'id, email, role, raw_user_meta_data, raw_app_meta_data, created_at';
const dummyHash = bcrypt.hash('native-auth-unknown-account', 12);

function publicUser(row: Record<string, any>): NativeUser {
  return { id: row.id, email: row.email ?? undefined, role: row.role ?? 'authenticated',
    user_metadata: row.raw_user_meta_data ?? {}, app_metadata: row.raw_app_meta_data ?? {},
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at };
}

export async function findSession(token: string): Promise<NativeSession | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return runAsService(async client => {
    const result = await client.query(`
      SELECT u.id, u.email, u.role, u.raw_user_meta_data, u.raw_app_meta_data, u.created_at, s.expires_at
        FROM private.native_sessions s JOIN auth.users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now())
         AND s.password_fingerprint = encode(extensions.digest(coalesce(u.encrypted_password, ''), 'sha256'), 'hex')
    `, [tokenHash(token)]);
    const row = result.rows[0];
    if (!row) return null;
    const expiresAt = Math.floor(new Date(row.expires_at).getTime() / 1000);
    return { access_token: token, token_type: 'bearer', expires_at: expiresAt,
      expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)), user: publicUser(row) };
  });
}

export async function consumeLoginAttempt(ip: string, email: string): Promise<boolean> {
  return runAsService(async client => {
    for (const [key, limit] of [[`ip:${ip}`, 40], [`email:${email}`, 15]] as const) {
      const result = await client.query(`
        INSERT INTO private.native_login_limits(key_hash, attempts, expires_at)
        VALUES ($1, 1, now() + interval '15 minutes')
        ON CONFLICT (key_hash) DO UPDATE SET
          attempts = CASE WHEN native_login_limits.expires_at <= now() THEN 1 ELSE native_login_limits.attempts + 1 END,
          expires_at = CASE WHEN native_login_limits.expires_at <= now() THEN now() + interval '15 minutes' ELSE native_login_limits.expires_at END
        RETURNING attempts
      `, [tokenHash(key)]);
      if (result.rows[0].attempts > limit) return false;
    }
    await client.query("DELETE FROM private.native_login_limits WHERE expires_at < now() - interval '1 day'");
    return true;
  });
}

export async function signIn(email: string, password: string): Promise<NativeSession | null> {
  const row = await runAsService(async client => {
    const result = await client.query(`SELECT ${publicUserColumns}, encrypted_password, deleted_at, banned_until
      FROM auth.users WHERE lower(email) = $1 AND is_sso_user = false LIMIT 1`, [email]);
    return result.rows[0];
  });
  const passwordHash = row?.encrypted_password || await dummyHash;
  const valid = await bcrypt.compare(password, passwordHash);
  if (!row || !valid || row.deleted_at || (row.banned_until && new Date(row.banned_until) > new Date())) return null;
  const ttlHours = Number(process.env.SESSION_TTL_HOURS ?? 12);
  if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 168) throw new Error('SESSION_TTL_HOURS must be between 1 and 168');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000 + ttlHours * 3600);
  await runAsService(async client => {
    // Lock the user while creating a session, so a concurrent ban/password change wins.
    const locked = await client.query(`SELECT encrypted_password FROM auth.users WHERE id = $1
      AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until <= now()) FOR UPDATE`, [row.id]);
    if (locked.rows[0]?.encrypted_password !== passwordHash) throw new Error('Account changed during sign-in');
    await client.query(`INSERT INTO private.native_sessions(id, user_id, token_hash, password_fingerprint, expires_at)
      VALUES ($1, $2, $3, $4, to_timestamp($5))`,
    [randomUUID(), row.id, tokenHash(token), tokenHash(passwordHash), expiresAt]);
    await client.query('UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1', [row.id]);
    await client.query("DELETE FROM private.native_sessions WHERE expires_at < now() - interval '7 days'");
  });
  return { access_token: token, token_type: 'bearer', expires_at: expiresAt,
    expires_in: expiresAt - Math.floor(Date.now() / 1000), user: publicUser(row) };
}

export async function signOut(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await runAsService(client => client.query('UPDATE private.native_sessions SET revoked_at = now() WHERE token_hash = $1', [tokenHash(token)]));
}

export async function listUsers(options?: { page?: number; perPage?: number }) {
  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const perPage = Math.min(1000, Math.max(1, Math.floor(options?.perPage ?? 1000)));
  const rows = await runAsService(client => client.query(`SELECT ${publicUserColumns} FROM auth.users
    WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT $1 OFFSET $2`, [perPage, (page - 1) * perPage]));
  return { data: { users: rows.rows.map(publicUser) }, error: null };
}

export async function createUser(input: { email: string; password: string; email_confirm?: boolean;
  user_metadata?: Record<string, unknown> }) {
  const actor = requestContext.getStore()?.user;
  if (!actor) return { data: { user: null }, error: { code: 'FORBIDDEN', message: 'Authenticated administrator required' } };
  const allowed = await runAsService(async client => {
    const result = await client.query(`SELECT EXISTS(SELECT FROM private.platform_admins WHERE user_id=$1)
      OR EXISTS(SELECT FROM public.crm_workspace_members WHERE user_id=$1 AND is_active
                AND role IN ('owner','company_owner','company_manager','manager')) AS allowed`, [actor.id]);
    return result.rows[0].allowed;
  });
  if (!allowed) return { data: { user: null }, error: { code: 'FORBIDDEN', message: 'Account creation is not allowed' } };
  const email = input.email?.trim().toLowerCase();
  const fullName = String(input.user_metadata?.full_name ?? '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName ||
      typeof input.password !== 'string' || input.password.length < 12 || Buffer.byteLength(input.password) > 72) {
    return { data: { user: null }, error: { code: 'VALIDATION_ERROR', message: 'A valid email, full name and password (12+ characters, up to 72 UTF-8 bytes) are required' } };
  }
  const hash = await bcrypt.hash(input.password, 12);
  try {
    const row = await runAsService(async client => {
      if ((await client.query('SELECT 1 FROM auth.users WHERE lower(email)=$1', [email])).rowCount) {
        throw Object.assign(new Error('User already exists'), { code: '23505' });
      }
      const result = await client.query(`INSERT INTO auth.users
        (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at, is_sso_user, is_anonymous)
        VALUES ($1, 'authenticated', 'authenticated', $2, $3, now(), $4, $5, now(), now(), false, false)
        RETURNING ${publicUserColumns}`,
      [randomUUID(), email, hash, JSON.stringify({ provider: 'email', providers: ['email'] }),
        JSON.stringify({ ...input.user_metadata, full_name: fullName })]);
      return result.rows[0];
    });
    return { data: { user: publicUser(row) }, error: null };
  } catch (error: any) {
    return { data: { user: null }, error: { code: error.code === '23505' ? 'email_exists' : 'USER_CREATE_FAILED',
      message: error.code === '23505' ? 'User already exists' : 'Unable to create user' } };
  }
}
