begin;

-- 1. Internal Roles table
create table if not exists private.tungsten_internal_roles (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  role text not null check (role in ('owner', 'manager', 'sales')),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table private.tungsten_internal_roles enable row level security;
revoke all on table private.tungsten_internal_roles from public, anon, authenticated;

-- Role checking helper functions in schema private
create or replace function private.is_tungsten_owner()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins where user_id = auth.uid())
      or exists (select 1 from private.tungsten_internal_roles where user_id = auth.uid() and role = 'owner');
$$;

create or replace function private.is_tungsten_manager()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.tungsten_internal_roles where user_id = auth.uid() and role = 'manager');
$$;

create or replace function private.is_tungsten_owner_or_manager()
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_tungsten_owner() or private.is_tungsten_manager();
$$;

create or replace function private.is_tungsten_sales()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.tungsten_internal_roles where user_id = auth.uid() and role = 'sales');
$$;

grant execute on function private.is_tungsten_owner() to authenticated;
grant execute on function private.is_tungsten_manager() to authenticated;
grant execute on function private.is_tungsten_owner_or_manager() to authenticated;
grant execute on function private.is_tungsten_sales() to authenticated;

-- 2. Tungsten Internal CRM Clients table
create table if not exists public.tungsten_clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null check (length(trim(client_name)) > 0),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  company_name text,
  service_requested text,
  deal_value numeric(12,2) default 0,
  status text not null default 'new' 
    check (status in ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  notes text,
  sales_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tungsten_clients_sales_id_idx on public.tungsten_clients (sales_id);
create index if not exists tungsten_clients_created_by_idx on public.tungsten_clients (created_by);
create index if not exists tungsten_clients_status_idx on public.tungsten_clients (status);

alter table public.tungsten_clients enable row level security;
revoke all on public.tungsten_clients from public, anon, authenticated;
grant select, insert, update on public.tungsten_clients to authenticated;

-- RLS Policies on tungsten_clients
create policy tungsten_clients_select on public.tungsten_clients
for select to authenticated using (
  private.is_tungsten_owner_or_manager()
  or (private.is_tungsten_sales() and (created_by = auth.uid() or sales_id = auth.uid()))
);

create policy tungsten_clients_insert on public.tungsten_clients
for insert to authenticated with check (
  private.is_tungsten_owner_or_manager()
  or (private.is_tungsten_sales() and created_by = auth.uid() and sales_id = auth.uid())
);

create policy tungsten_clients_update on public.tungsten_clients
for update to authenticated using (
  private.is_tungsten_owner_or_manager()
  or (private.is_tungsten_sales() and created_by = auth.uid())
) with check (
  private.is_tungsten_owner_or_manager()
  or (private.is_tungsten_sales() and created_by = auth.uid())
);

-- 3. RPC to add manual clinic for Owner and Manager
create or replace function public.crm_add_manual_clinic(p_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_clinic public.clinics%rowtype;
begin
  if not (private.is_platform_admin() or private.is_tungsten_owner_or_manager()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'CLINIC_NAME_REQUIRED' using errcode = '22023';
  end if;

  insert into public.clinics (name)
  values (trim(p_name))
  returning * into v_clinic;

  return jsonb_build_object('id', v_clinic.id, 'name', v_clinic.name);
end;
$$;

revoke all on function public.crm_add_manual_clinic(text) from public, anon;
grant execute on function public.crm_add_manual_clinic(text) to authenticated;

-- 4. RPC to get user internal status (Owner, Manager, Sales)
create or replace function public.crm_internal_user_status()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_is_platform_admin boolean := false;
  v_internal_role text := null;
begin
  select exists (
    select 1 from private.platform_admins where user_id = auth.uid()
  ) into v_is_platform_admin;

  select role into v_internal_role
  from private.tungsten_internal_roles
  where user_id = auth.uid();

  return jsonb_build_object(
    'is_admin', v_is_platform_admin,
    'is_owner', (v_is_platform_admin or v_internal_role = 'owner'),
    'is_manager', (v_internal_role = 'manager'),
    'is_sales', (v_internal_role = 'sales'),
    'internal_role', coalesce(v_internal_role, case when v_is_platform_admin then 'owner' else null end)
  );
end;
$$;

revoke all on function public.crm_internal_user_status() from public, anon;
grant execute on function public.crm_internal_user_status() to authenticated;

-- 5. RPC to assign clinic service for Owner and Manager
create or replace function public.crm_setup_assign_service(
  p_clinic_id uuid,
  p_service_id uuid,
  p_enabled boolean
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_platform_admin() or private.is_tungsten_owner_or_manager()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_clinic_id is null or p_service_id is null or p_enabled is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  insert into public.clinic_services (clinic_id, service_id, is_active)
  values (p_clinic_id, p_service_id, p_enabled)
  on conflict (clinic_id, service_id)
  do update set is_active = excluded.is_active;
end;
$$;

revoke all on function public.crm_setup_assign_service(uuid, uuid, boolean) from public, anon;
grant execute on function public.crm_setup_assign_service(uuid, uuid, boolean) to authenticated;

-- 6. RPC to add local service to a clinic for Owner and Manager
create or replace function public.crm_setup_add_service(
  p_clinic_id uuid,
  p_name text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_service_id uuid;
  v_code text;
begin
  if not (private.is_platform_admin() or private.is_tungsten_owner_or_manager()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_name is null or length(trim(p_name)) = 0 or p_clinic_id is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  v_code := 'local_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.services (service_code, service_name, is_active)
  values (v_code, trim(p_name), true)
  returning id into v_service_id;

  insert into public.clinic_services (clinic_id, service_id, is_active)
  values (p_clinic_id, v_service_id, true)
  on conflict (clinic_id, service_id)
  do update set is_active = true;

  return v_service_id;
end;
$$;

revoke all on function public.crm_setup_add_service(uuid, text) from public, anon;
grant execute on function public.crm_setup_add_service(uuid, text) to authenticated;

-- 7. Seed initial internal roles
-- Peter Fahmy (admin@tungsten.com) -> owner
insert into private.tungsten_internal_roles (user_id, role)
select id, 'owner' from auth.users where email = 'admin@tungsten.com'
on conflict (user_id) do update set role = 'owner';

-- Tungsten Manager (manager@tungsten.com) -> manager
insert into private.tungsten_internal_roles (user_id, role)
select id, 'manager' from auth.users where email = 'manager@tungsten.com'
on conflict (user_id) do update set role = 'manager';

-- Tungsten Sales (sales@tungsten.com) -> sales
insert into private.tungsten_internal_roles (user_id, role)
select id, 'sales' from auth.users where email = 'sales@tungsten.com'
on conflict (user_id) do update set role = 'sales';

-- Enforce: Remove Manager from platform_admins so Manager does NOT have platform_admin
delete from private.platform_admins
where user_id in (select id from auth.users where email = 'manager@tungsten.com');

commit;
