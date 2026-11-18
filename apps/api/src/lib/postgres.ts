import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';
import { requestContext } from './request-context.js';

export type DatabaseClaims = { sub?: string; email?: string | null; role: 'authenticated' | 'service_role' };
export type DatabaseRole = 'crm_tungsten_authenticated' | 'crm_tungsten_service';
let pool: Pool | undefined;
let checked: Promise<void> | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const url = new URL(connectionString);
    if (decodeURIComponent(url.pathname.slice(1)) !== 'crm_tungsten') {
      throw new Error('DATABASE_URL must point to the crm_tungsten database');
    }
    const max = Number(process.env.DB_POOL_MAX ?? 5);
    if (!Number.isInteger(max) || max < 1 || max > 30) throw new Error('DB_POOL_MAX must be between 1 and 30');
    pool = new Pool({ connectionString, max, idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000, application_name: 'tungsten-crm-native' });
    pool.on('error', () => console.error('[Database] Idle connection failed'));
  }
  return pool;
}

export function verifyDatabase(): Promise<void> {
  checked ??= (async () => {
    const result = await getPool().query(`
      SELECT current_database() AS database, r.rolname, r.rolsuper, r.rolbypassrls, r.rolinherit,
             pg_has_role(current_user, 'crm_tungsten_owner', 'MEMBER') AS is_owner,
             pg_has_role(current_user, 'crm_tungsten_authenticated', 'MEMBER') AS has_user_role,
             pg_has_role(current_user, 'crm_tungsten_service', 'MEMBER') AS has_service_role,
             EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname='native_sessions') AS auth_ready
        FROM pg_roles r WHERE r.rolname = current_user
    `);
    const config = result.rows[0];
    if (!config || config.database !== 'crm_tungsten' || config.rolname !== 'crm_tungsten_app' ||
        config.rolsuper || config.rolbypassrls || config.rolinherit || config.is_owner ||
        !config.has_user_role || !config.has_service_role || !config.auth_ready) {
      throw new Error('Run the native database setup and use the crm_tungsten_app connection URL');
    }
  })().catch(error => { checked = undefined; throw error; });
  return checked;
}

// All statements, including identity and role selection, use the same connection.
// SET LOCAL and transaction-local claims are discarded at COMMIT/ROLLBACK.
export async function runAs<T>(role: DatabaseRole, claims: DatabaseClaims,
  operation: (client: PoolClient) => Promise<T>): Promise<T> {
  await verifyDatabase();
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SET LOCAL search_path = pg_catalog, public, extensions");
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

export function runAsService<T>(operation: (client: PoolClient) => Promise<T>) {
  const actor = requestContext.getStore()?.user;
  return runAs('crm_tungsten_service', { role: 'service_role', sub: actor?.id, email: actor?.email }, operation);
}

export async function closeDatabase() {
  if (pool) await pool.end();
  pool = undefined;
  checked = undefined;
}
