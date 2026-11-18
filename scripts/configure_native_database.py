#!/usr/bin/env python3
"""Prepare the already-imported crm_tungsten database and its runtime login."""
import argparse
import datetime
import getpass
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', default='/usr/lib/postgresql/17/bin')
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--install-local-env', action='store_true', help='Merge native credentials into apps/api/.env, preserving existing integration settings')
    args = parser.parse_args()
    binary = Path(args.pg_bin) / 'psql'
    if not binary.is_file():
        candidate = shutil.which('psql')
        if not candidate: raise SystemExit('Install PostgreSQL client 17 or newer.')
        binary = Path(candidate)
    admin_url = os.environ.get('CRM_MIGRATION_DATABASE_URL') or getpass.getpass('Railway PostgreSQL admin PUBLIC URL (hidden): ')
    try:
        url = urlsplit(admin_url.strip())
        if url.scheme not in ('postgres','postgresql') or not url.hostname or not url.username or not url.password:
            raise ValueError()
        if url.hostname.endswith('.railway.internal'):
            raise SystemExit('Use the PUBLIC connection URL when running from your computer.')
        port = url.port or 5432
    except ValueError: raise SystemExit('Invalid PostgreSQL connection URL.')
    env = {k:v for k,v in os.environ.items() if not k.startswith('PG') and k != 'CRM_MIGRATION_DATABASE_URL'}
    env.update(PGPASSWORD=unquote(url.password), PGCONNECT_TIMEOUT='15', PGAPPNAME='crm_native_setup')
    sslmode = parse_qs(url.query).get('sslmode', ['prefer'])[0]
    if sslmode not in ('disable','allow','prefer','require','verify-ca','verify-full'):
        raise SystemExit('Invalid sslmode.')
    env['PGSSLMODE'] = sslmode
    password = secrets.token_urlsafe(36)
    hostname = '['+url.hostname+']' if ':' in url.hostname else url.hostname
    query = urlencode({'sslmode': sslmode}) if 'sslmode' in parse_qs(url.query) else ''
    runtime_url = urlunsplit(('postgresql', f'crm_tungsten_app:{quote(password,safe="")}@{hostname}:{port}', '/crm_tungsten', query, ''))
    os.umask(0o077)
    parent = args.output_dir.expanduser().resolve() if args.output_dir else Path.home()/'Documents/Tungsten-CRM-Backups'
    parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='native-runtime-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-', dir=parent))
    env_file = work/'api.env'
    env_file.write_text(f"DATABASE_URL='{runtime_url}'\nDB_POOL_MAX=5\nSESSION_TTL_HOURS=12\nSOCIALLENS_WEBHOOK_SECRET={secrets.token_urlsafe(32)}\n")
    env_file.chmod(0o600)
    credential_sql = f"""
DO $runtime_guard$
BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='crm_tungsten_app') THEN
    RAISE EXCEPTION 'Runtime role already exists; inspect before retrying';
  END IF;
END;
$runtime_guard$;
SET LOCAL password_encryption = 'scram-sha-256';
CREATE ROLE crm_tungsten_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{password}';
GRANT crm_tungsten_authenticated, crm_tungsten_service TO crm_tungsten_app;
GRANT CONNECT ON DATABASE crm_tungsten TO crm_tungsten_app;
"""
    sql = work/'setup.sql'
    sql.write_text((ROOT/'scripts/native-postgres.sql').read_text()+credential_sql)
    sql.chmod(0o600)
    command = [str(binary),'--host',url.hostname,'--port',str(port),'--username',unquote(url.username),
               '--dbname','crm_tungsten','-X','--no-password','-v','ON_ERROR_STOP=1',
               '--single-transaction','--file',str(sql)]
    print('Preparing native application schema in crm_tungsten...')
    with (work/'setup-output.log').open('w') as out, (work/'setup-errors.log').open('w') as err:
        result = subprocess.run(command, env=env, stdout=out, stderr=err)
    if result.returncode:
        raise SystemExit(f'Setup did not complete. SQL errors roll back the transaction. Private log: {work/"setup-errors.log"}')
    if args.install_local_env:
        target = ROOT/'apps/api/.env'
        if target.is_symlink(): raise SystemExit('Database setup succeeded; local .env is a symlink, so it was not changed.')
        existing = target.read_text() if target.exists() else ''
        if target.exists():
            shutil.copy2(target, work/'api.env.before')
            (work/'api.env.before').chmod(0o600)
        keys = {'DATABASE_URL','DB_POOL_MAX','SESSION_TTL_HOURS','SOCIALLENS_WEBHOOK_SECRET'}
        lines = [line for line in existing.splitlines() if line.strip().removeprefix('export ').split('=',1)[0].strip() not in keys]
        merged = '\n'.join(lines).rstrip()+'\n'+env_file.read_text()
        fd, temporary = tempfile.mkstemp(prefix='.native-env-', dir=target.parent)
        try:
            with os.fdopen(fd,'w') as handle: handle.write(merged)
            os.chmod(temporary,0o600)
            os.replace(temporary,target)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
        print('Local apps/api/.env updated; existing integration settings preserved.')
    print('Native schema and isolated runtime login created.')
    print(f'Private runtime environment file: {env_file}')
    print('Use this file locally or copy its values into Railway Variables; do not commit or upload it.')


if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: raise SystemExit('\nStopped. Inspect database state if setup was in progress.')
