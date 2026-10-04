-- Internal schema, separate from the public API tables.
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;


-- Accounts allowed to administer the whole CRM.
create table private.platform_admins (
  user_id uuid primary key
    references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now()
);

alter table private.platform_admins enable row level security;

revoke all privileges
on table private.platform_admins
from public, anon, authenticated;


-- Check whether the current user is a platform admin.
create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.platform_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_platform_admin()
from public, anon, authenticated;

grant execute on function private.is_platform_admin()
to authenticated;


-- Admin read access.
create policy profiles_select_platform_admin
on public.profiles
for select
to authenticated
using (
  (select private.is_platform_admin())
);

create policy clinics_select_platform_admin
on public.clinics
for select
to authenticated
using (
  (select private.is_platform_admin())
);

create policy memberships_select_platform_admin
on public.clinic_memberships
for select
to authenticated
using (
  (select private.is_platform_admin())
);