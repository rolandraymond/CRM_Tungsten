import type { PoolClient } from 'pg';
import { runAs, runAsService, type DatabaseClaims } from './postgres.js';
import { createUser, findSession, listUsers, type NativeUser } from './session-store.js';
import { requestContext } from './request-context.js';

type Row = Record<string, any>;
export type DatabaseError = { code: string; message: string; status: number; details?: string };
export type DatabaseResult<T> = { data: T | null; error: DatabaseError | null; count: number | null; status: number };
type Column = { name: string; type: string };
type Table = { columns: Map<string, Column>; primary: string[] };
type ForeignKey = { name: string; child: string; parent: string; child_columns: string[]; parent_columns: string[] };
type Filter = { column: string; operator: string; value: unknown; negate?: boolean } | { or: string };
type Selection = { alias: string; column?: string; table?: string; hint?: string; inner?: boolean; children?: Selection[] };
const tableCache = new Map<string, Promise<Table>>();
let foreignKeyCache: Promise<ForeignKey[]> | undefined;

function failure(code: string, message: string, status = 400): never {
  throw Object.assign(new Error(message), { code, status });
}
function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) failure('INVALID_IDENTIFIER', 'Invalid database identifier');
  return `"${value}"`;
}
function literal(value: string) { return `'${value.replace(/'/g, "''")}'`; }
function errorResult<T>(error: any): DatabaseResult<T> {
  const code = typeof error?.code === 'string' ? error.code : 'DATABASE_ERROR';
  const status = error?.status ?? (code === '42501' ? 403 : code === '23505' ? 409 : 400);
  return { data: null, error: { code, message: error?.message ?? 'Database operation failed', status }, count: null, status };
}

async function tableInfo(client: PoolClient, table: string): Promise<Table> {
  identifier(table);
  if (!tableCache.has(table)) tableCache.set(table, (async () => {
    const columns = await client.query(`SELECT a.attname AS name, t.typname AS type
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname='public' AND c.relname=$1
      AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
    if (!columns.rowCount) failure('UNKNOWN_TABLE', `Unknown application table: ${table}`);
    const pk = await client.query(`SELECT a.attname AS name FROM pg_index i
      JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, position) ON true
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
      WHERE n.nspname='public' AND c.relname=$1 AND i.indisprimary ORDER BY k.position`, [table]);
    return { columns: new Map(columns.rows.map(c => [c.name, c])), primary: pk.rows.map(c => c.name) };
  })().catch(error => { tableCache.delete(table); throw error; }));
  return tableCache.get(table)!;
}

async function foreignKeys(client: PoolClient): Promise<ForeignKey[]> {
  foreignKeyCache ??= client.query(`SELECT c.conname AS name, child.relname AS child, parent.relname AS parent,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,pos)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.pos) AS child_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,pos)
            JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.pos) AS parent_columns
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
    JOIN pg_namespace cn ON cn.oid=child.relnamespace JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    WHERE c.contype='f' AND cn.nspname='public' AND pn.nspname='public'`)
    .then(result => result.rows as ForeignKey[]).catch(error => { foreignKeyCache = undefined; throw error; });
  return foreignKeyCache;
}

export function splitTopLevel(text: string): string[] {
  const values: string[] = [];
  let start = 0, depth = 0, quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && text[index - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (depth < 0) failure('INVALID_FILTER', 'Unbalanced query expression');
    if (char === ',' && depth === 0) { values.push(text.slice(start, index).trim()); start = index + 1; }
  }
  if (depth || quoted) failure('INVALID_FILTER', 'Unbalanced query expression');
  const last = text.slice(start).trim();
  if (last) values.push(last);
  return values.filter(Boolean);
}

export function parseSelection(text: string): Selection[] {
  return splitTopLevel(text).map(part => {
    const open = part.indexOf('(');
    const label = (open < 0 ? part : part.slice(0, open)).trim();
    const colon = label.indexOf(':');
    const alias = colon < 0 ? undefined : label.slice(0, colon).trim();
    const name = colon < 0 ? label : label.slice(colon + 1).trim();
    if (open < 0) {
      if (name !== '*') identifier(name);
      if (alias) identifier(alias);
      return { alias: alias ?? name, column: name };
    }
    if (!part.endsWith(')')) failure('INVALID_SELECT', 'Invalid embedded relationship');
    const [table, ...hints] = name.split('!');
    identifier(table); if (alias) identifier(alias);
    const hint = hints.find(h => h !== 'inner' && h !== 'left');
    if (hint) identifier(hint);
    return { alias: alias ?? table, table, hint, inner: hints.includes('inner'),
      children: parseSelection(part.slice(open + 1, -1)) };
  });
}

class Compiler {
  values: unknown[] = [];
  nextAlias = 0;
  constructor(readonly client: PoolClient, readonly filters: Filter[]) {}
  bind(value: unknown) { this.values.push(value); return `$${this.values.length}`; }
  async column(table: string, column: string, alias: string) {
    const metadata = await tableInfo(this.client, table);
    if (!metadata.columns.has(column)) failure('UNKNOWN_COLUMN', `Unknown column ${table}.${column}`);
    return `${alias}.${identifier(column)}`;
  }
  async atom(table: string, alias: string, filter: Exclude<Filter, { or: string }>) {
    const column = await this.column(table, filter.column, alias);
    let result: string;
    if (filter.operator === 'is') {
      if (filter.value !== null && typeof filter.value !== 'boolean') failure('INVALID_FILTER', 'IS requires null or boolean');
      result = `${column} IS ${filter.value === null ? 'NULL' : filter.value ? 'TRUE' : 'FALSE'}`;
    } else if (filter.operator === 'in') {
      if (!Array.isArray(filter.value)) failure('INVALID_FILTER', 'IN requires an array');
      result = filter.value.length ? `${column} IN (${filter.value.map(v => this.bind(v)).join(',')})` : 'FALSE';
    } else {
      const operators: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', ilike: 'ILIKE', like: 'LIKE' };
      if (!operators[filter.operator]) failure('INVALID_FILTER', 'Unsupported filter operator');
      result = `${column} ${operators[filter.operator]} ${this.bind(filter.value)}`;
    }
    return filter.negate ? `NOT (${result})` : result;
  }
  async booleanExpression(table: string, alias: string, expression: string): Promise<string> {
    const terms = await Promise.all(splitTopLevel(expression).map(async item => {
      const group = item.match(/^(and|or)\((.*)\)$/s);
      if (group) {
        const pieces = splitTopLevel(group[2]);
        const compiled = [];
        for (const piece of pieces) compiled.push(await this.booleanExpression(table, alias, piece));
        return `(${compiled.join(group[1] === 'and' ? ' AND ' : ' OR ')})`;
      }
      const match = item.match(/^([A-Za-z_][A-Za-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|ilike|like|is|in)\.(.*)$/s);
      if (!match) failure('INVALID_FILTER', 'Invalid OR filter');
      const [, column, operator, raw] = match;
      let value: unknown = raw;
      if (operator === 'is') value = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : raw;
      if (operator === 'in') {
        if (!raw.startsWith('(') || !raw.endsWith(')')) failure('INVALID_FILTER', 'Invalid IN list');
        value = splitTopLevel(raw.slice(1, -1)).map(v => v.replace(/^"|"$/g, ''));
      }
      return this.atom(table, alias, { column, operator, value });
    }));
    return `(${terms.join(' OR ') || 'FALSE'})`;
  }
  async relation(parent: string, alias: string, node: Selection) {
    const candidates = (await foreignKeys(this.client)).filter(fk =>
      (fk.child === parent && fk.parent === node.table) || (fk.parent === parent && fk.child === node.table));
    const matching = node.hint ? candidates.filter(fk => fk.name === node.hint || fk.child_columns.includes(node.hint!)) : candidates;
    if (!matching.length) failure('UNKNOWN_RELATION', `Relationship not found: ${parent}.${node.table}`);
    // Composite tenant-aware FK takes precedence over a redundant scalar FK.
    matching.sort((a, b) => b.child_columns.length - a.child_columns.length);
    if (matching.length > 1 && matching[0].child_columns.length === matching[1].child_columns.length && !node.hint) {
      failure('AMBIGUOUS_RELATION', `Specify the foreign key for ${parent}.${node.table}`);
    }
    const fk = matching[0];
    const forward = fk.child === parent;
    const childAlias = `r${++this.nextAlias}`;
    const pairs = fk.child_columns.map((column, index) => forward
      ? `${childAlias}.${identifier(fk.parent_columns[index])}=${alias}.${identifier(column)}`
      : `${childAlias}.${identifier(column)}=${alias}.${identifier(fk.parent_columns[index])}`);
    return { forward, childAlias, pairs };
  }
  async where(table: string, alias: string, nodes: Selection[], path = ''): Promise<string[]> {
    const result: string[] = [];
    for (const filter of this.filters) {
      if ('or' in filter) { if (!path) result.push(await this.booleanExpression(table, alias, filter.or)); continue; }
      const pieces = filter.column.split('.');
      const column = pieces.pop()!;
      if (pieces.join('.') === path) result.push(await this.atom(table, alias, { ...filter, column }));
    }
    for (const node of nodes.filter(n => n.table && n.inner)) {
      const rel = await this.relation(table, alias, node);
      const extra = await this.where(node.table!, rel.childAlias, node.children!, path ? `${path}.${node.alias}` : node.alias);
      result.push(`EXISTS (SELECT 1 FROM public.${identifier(node.table!)} ${rel.childAlias} WHERE ${[...rel.pairs, ...extra].join(' AND ')})`);
    }
    return result;
  }
  async projection(table: string, alias: string, nodes: Selection[], path = ''): Promise<string> {
    const fields: string[] = [];
    let star = false;
    for (const node of nodes) {
      if (node.column === '*') { star = true; continue; }
      if (node.column) {
        fields.push(`${literal(node.alias)}, ${await this.column(table, node.column, alias)}`); continue;
      }
      const rel = await this.relation(table, alias, node);
      const nextPath = path ? `${path}.${node.alias}` : node.alias;
      const projected = await this.projection(node.table!, rel.childAlias, node.children!, nextPath);
      const extra = await this.where(node.table!, rel.childAlias, node.children!, nextPath);
      const inner = `SELECT ${projected} AS value FROM public.${identifier(node.table!)} ${rel.childAlias} WHERE ${[...rel.pairs, ...extra].join(' AND ')}`;
      const selected = rel.forward ? `(${inner} LIMIT 1)` : `(SELECT coalesce(jsonb_agg(embedded.value), '[]'::jsonb) FROM (${inner}) embedded)`;
      fields.push(`${literal(node.alias)}, ${selected}`);
    }
    const object = fields.length ? `jsonb_build_object(${fields.join(',')})` : "'{}'::jsonb";
    return star ? `(to_jsonb(${alias}) || ${object})` : object;
  }
}

export class NativeQuery<T = any[]> implements PromiseLike<DatabaseResult<T>> {
  private operation = 'select';
  private payload: Row | Row[] = {};
  private columns = '*';
  private returning = false;
  private wantCount = false;
  private head = false;
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  private take = 1000;
  private skip = 0;
  private singular: 'single' | 'maybe' | undefined;
  private conflict: string[] | undefined;
  private ignoreDuplicates = false;
  private promise: Promise<DatabaseResult<T>> | undefined;
  constructor(readonly database: NativeDatabaseClient, readonly table: string) { identifier(table); }
  select(columns = '*', options?: { count?: string; head?: boolean }) {
    this.columns = columns; this.returning = true; this.wantCount = options?.count === 'exact'; this.head = options?.head ?? false; return this;
  }
  insert(payload: Row | Row[]) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload: Row) { this.operation = 'update'; this.payload = payload; return this; }
  delete() { this.operation = 'delete'; return this; }
  upsert(payload: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.operation = 'upsert'; this.payload = payload; this.conflict = options?.onConflict?.split(',').map(v => v.trim());
    this.ignoreDuplicates = options?.ignoreDuplicates ?? false; return this;
  }
  eq(column: string, value: unknown) { this.filters.push({ column, operator: 'eq', value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ column, operator: 'neq', value }); return this; }
  gt(column: string, value: unknown) { this.filters.push({ column, operator: 'gt', value }); return this; }
  gte(column: string, value: unknown) { this.filters.push({ column, operator: 'gte', value }); return this; }
  lt(column: string, value: unknown) { this.filters.push({ column, operator: 'lt', value }); return this; }
  lte(column: string, value: unknown) { this.filters.push({ column, operator: 'lte', value }); return this; }
  ilike(column: string, value: string) { this.filters.push({ column, operator: 'ilike', value }); return this; }
  is(column: string, value: unknown) { this.filters.push({ column, operator: 'is', value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ column, operator: 'in', value }); return this; }
  not(column: string, operator: string, value: unknown) { this.filters.push({ column, operator, value, negate: true }); return this; }
  or(value: string) { this.filters.push({ or: value }); return this; }
  match(values: Row) { for (const [column, value] of Object.entries(values)) this.eq(column, value); return this; }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst }); return this;
  }
  limit(value: number) { if (!Number.isInteger(value) || value < 0 || value > 10000) failure('INVALID_RANGE', 'Invalid result limit'); this.take = value; return this; }
  range(start: number, end: number) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) failure('INVALID_RANGE', 'Invalid result range');
    this.skip = start; return this.limit(end - start + 1);
  }
  single(): NativeQuery<any> { this.singular = 'single'; return this as NativeQuery<any>; }
  maybeSingle(): NativeQuery<any> { this.singular = 'maybe'; return this as NativeQuery<any>; }
  then<TResult1 = DatabaseResult<T>, TResult2 = never>(
    fulfilled?: ((value: DatabaseResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    this.promise ??= this.execute();
    return this.promise.then(fulfilled, rejected);
  }
  private async execute(): Promise<DatabaseResult<T>> {
    try { return await this.database.execute(async client => {
      const metadata = await tableInfo(client, this.table);
      const nodes = parseSelection(this.columns);
      const compiler = new Compiler(client, this.filters);
      const where = await compiler.where(this.table, 'q', nodes);
      let count: number | null = null;
      if (this.wantCount) {
        const counter = new Compiler(client, this.filters);
        const conditions = await counter.where(this.table, 'q', nodes);
        const result = await client.query(`SELECT count(*)::int AS count FROM public.${identifier(this.table)} q ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`, counter.values);
        count = result.rows[0].count;
      }
      const selected = this.returning || this.operation === 'select';
      let query: string;
      const filters = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      if (this.operation === 'select') {
        const projection = this.head ? 'NULL' : await compiler.projection(this.table, 'q', nodes);
        const ordering: string[] = [];
        for (const order of this.orders) ordering.push(`${await compiler.column(this.table, order.column, 'q')} ${order.ascending ? 'ASC' : 'DESC'}${order.nullsFirst === undefined ? '' : order.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'}`);
        query = `SELECT ${projection} AS data FROM public.${identifier(this.table)} q${filters}${ordering.length ? ' ORDER BY ' + ordering.join(',') : ''} LIMIT ${compiler.bind(this.head ? 0 : this.singular ? 2 : this.take)} OFFSET ${compiler.bind(this.skip)}`;
      } else {
        let statement: string;
        const encode = (column: string, value: unknown) => {
          const info = metadata.columns.get(column);
          if (!info) failure('UNKNOWN_COLUMN', `Unknown column ${this.table}.${column}`);
          return compiler.bind(value != null && ['json','jsonb'].includes(info.type) ? JSON.stringify(value) : value);
        };
        if (this.operation === 'delete') statement = `DELETE FROM public.${identifier(this.table)} q${filters}`;
        else if (this.operation === 'update') {
          const values = Object.entries(this.payload).filter(([, value]) => value !== undefined);
          if (!values.length) failure('EMPTY_UPDATE', 'No fields supplied');
          statement = `UPDATE public.${identifier(this.table)} q SET ${values.map(([column,value]) => `${identifier(column)}=${encode(column,value)}`).join(',')}${filters}`;
        } else {
          const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
          if (!rows.length) return { data: null, error: null, count: 0, status: 201 };
          const columns = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => row[key] !== undefined)))];
          if (!columns.length) failure('EMPTY_INSERT', 'No fields supplied');
          statement = `INSERT INTO public.${identifier(this.table)} (${columns.map(identifier).join(',')}) VALUES ${rows.map(row => '(' + columns.map(column => row[column] === undefined ? 'DEFAULT' : encode(column,row[column])).join(',') + ')').join(',')}`;
          if (this.operation === 'upsert') {
            const target = this.conflict ?? metadata.primary;
            if (!target.length || target.some(column => !metadata.columns.has(column))) failure('INVALID_CONFLICT', 'Invalid conflict target');
            const updates = columns.filter(column => !target.includes(column));
            statement += ` ON CONFLICT (${target.map(identifier).join(',')}) ${this.ignoreDuplicates || !updates.length ? 'DO NOTHING' : 'DO UPDATE SET ' + updates.map(column => `${identifier(column)}=EXCLUDED.${identifier(column)}`).join(',')}`;
          }
        }
        if (selected) {
          const projection = await compiler.projection(this.table, 'q', nodes);
          query = `WITH affected AS (${statement} RETURNING *) SELECT ${projection} AS data FROM affected q`;
        } else query = statement;
      }
      const response = await client.query(query, compiler.values);
      const rows = response.rows.map(row => row.data);
      if (this.singular && (rows.length > 1 || (this.singular === 'single' && rows.length !== 1))) {
        failure('PGRST116', 'Expected exactly one row', 406);
      }
      const data = this.head || !selected ? null : this.singular ? rows[0] ?? null : rows;
      return { data: data as T | null, error: null, count, status: this.operation === 'insert' ? 201 : 200 };
    }); } catch (error) { return errorResult<T>(error); }
  }
}

export class NativeDatabaseClient {
  readonly auth = { admin: { createUser, listUsers } };
  constructor(readonly accessToken?: string, private readonly serviceActor?: NativeUser) {}
  from(table: string) { return new NativeQuery(this, table); }
  async execute<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.accessToken) {
      if (!this.serviceActor) return runAsService(operation);
      return runAs('crm_tungsten_service', { role: 'service_role', sub: this.serviceActor.id, email: this.serviceActor.email }, operation);
    }
    const context = requestContext.getStore();
    const user = context?.accessToken === this.accessToken ? context.user : (await findSession(this.accessToken))?.user;
    if (!user) failure('UNAUTHENTICATED', 'Invalid or expired session', 401);
    const claims: DatabaseClaims = { sub: user.id, email: user.email, role: 'authenticated' };
    return runAs('crm_tungsten_authenticated', claims, operation);
  }
  async rpc(name: string, args: Row = {}): Promise<DatabaseResult<any>> {
    try { return await this.execute(async client => {
      identifier(name);
      const functions = await client.query(`SELECT p.oid, p.proretset, t.typtype,
        p.proargnames, p.pronargs, p.pronargdefaults,
        ARRAY(SELECT format_type(arg, NULL) FROM unnest(p.proargtypes) WITH ORDINALITY a(arg,ord) ORDER BY ord) AS argument_types,
        ARRAY(SELECT typname FROM unnest(p.proargtypes) WITH ORDINALITY a(arg,ord) JOIN pg_type ON pg_type.oid=a.arg ORDER BY ord) AS type_names
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_type t ON t.oid=p.prorettype
        WHERE n.nspname='public' AND p.proname=$1`, [name]);
      const entries = Object.entries(args).filter(([, value]) => value !== undefined);
      const matching = functions.rows.filter(fn => {
        const names = (fn.proargnames ?? []).slice(0, fn.pronargs);
        return entries.every(([key]) => names.includes(key)) &&
          names.slice(0, fn.pronargs - fn.pronargdefaults).every((key: string) => Object.hasOwn(args, key));
      });
      if (matching.length !== 1) failure('RPC_NOT_FOUND', `Function or argument signature not found: ${name}`);
      const fn = matching[0];
      const values: unknown[] = [];
      const params = entries.map(([key, value]) => {
        const index = fn.proargnames.indexOf(key);
        values.push(value != null && ['json','jsonb'].includes(fn.type_names[index]) ? JSON.stringify(value) : value);
        return `${identifier(key)} => $${values.length}::${fn.argument_types[index]}`;
      });
      const call = `public.${identifier(name)}(${params.join(',')})`;
      const set = fn.proretset || fn.typtype === 'c';
      const result = await client.query(set ? `SELECT to_jsonb(r) AS data FROM ${call} r` : `SELECT ${call} AS data`, values);
      return { data: set ? result.rows.map(row => row.data) : result.rows[0]?.data ?? null, error: null, count: null, status: 200 };
    }); } catch (error) { return errorResult(error); }
  }
}

export function createUserDatabaseClient(accessToken: string) {
  if (!accessToken) failure('UNAUTHENTICATED', 'A session token is required', 401);
  return new NativeDatabaseClient(accessToken);
}
export function getDatabaseAdmin(actor?: NativeUser) { return new NativeDatabaseClient(undefined, actor); }
