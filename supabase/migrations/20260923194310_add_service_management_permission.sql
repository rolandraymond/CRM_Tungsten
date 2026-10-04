-- Explicit permissions, managed through trusted admin operations.
create table private.user_permissions (
  user_id uuid not null
    references public.profiles(id) on delete restrict,

  permission text not null
    check (permission in ('manage_services')),

  is_active boolean not null default true,

  granted_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now(),

  primary key (user_id, permission)
);

alter table private.user_permissions
  enable row level security;

revoke all privileges
on table private.user_permissions
from public, anon, authenticated;


-- Check permission for the signed-in user only.
create function private.can_manage_services()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_platform_admin()
    or exists (
      select 1
      from private.user_permissions as permission
      where permission.user_id = (select auth.uid())
        and permission.permission = 'manage_services'
        and permission.is_active = true
    );
$$;

revoke all on function private.can_manage_services()
from public, anon, authenticated;

grant execute on function private.can_manage_services()
to authenticated;


-- Authorized catalog managers can read the full service catalog.
create policy services_select_catalog_managers
on public.services
for select
to authenticated
using (
  (select private.can_manage_services())
);