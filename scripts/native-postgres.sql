-- Native application schema, applied after the reviewed source import.
SELECT pg_advisory_xact_lock(hashtextextended('crm-tungsten-native-setup-v1', 0));
DO $guard$
BEGIN
  IF current_database() <> 'crm_tungsten' OR
     (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) <> 'crm_tungsten_owner' THEN
    RAISE EXCEPTION 'Wrong target database or owner';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regclass('public.leads') IS NULL THEN
    RAISE EXCEPTION 'Import the reviewed source database first';
  END IF;
  IF to_regclass('private.native_sessions') IS NOT NULL OR to_regclass('public.crm_workspaces') IS NOT NULL THEN
    RAISE EXCEPTION 'Native schema already exists; setup refused';
  END IF;
END;
$guard$;
-- Capture existing table sizes and original password fingerprints inside this transaction.
CREATE TEMP TABLE crm_native_before(schema_name text, table_name text, rows bigint) ON COMMIT DROP;
DO $capture$
DECLARE t record; n bigint;
BEGIN
  FOR t IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','private','auth') LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I',t.schemaname,t.tablename) INTO n;
    INSERT INTO crm_native_before VALUES(t.schemaname,t.tablename,n);
  END LOOP;
END;
$capture$;
CREATE TEMP TABLE crm_native_passwords ON COMMIT DROP AS SELECT id, md5(coalesce(encrypted_password,'')) AS fingerprint FROM auth.users;
SET ROLE crm_tungsten_owner;
SET search_path = pg_catalog, public, extensions;
SET check_function_bodies = false;
-- Native adaptation of 20261111140000_tungsten_internal_crm.sql

-- 1. Internal Roles table
create table if not exists private.tungsten_internal_roles (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  role text not null check (role in ('owner', 'manager', 'sales')),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table private.tungsten_internal_roles enable row level security;
revoke all on table private.tungsten_internal_roles from public, crm_tungsten_anon, crm_tungsten_authenticated;

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

grant execute on function private.is_tungsten_owner() to crm_tungsten_authenticated;
grant execute on function private.is_tungsten_manager() to crm_tungsten_authenticated;
grant execute on function private.is_tungsten_owner_or_manager() to crm_tungsten_authenticated;
grant execute on function private.is_tungsten_sales() to crm_tungsten_authenticated;

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
revoke all on public.tungsten_clients from public, crm_tungsten_anon, crm_tungsten_authenticated;
grant select, insert, update on public.tungsten_clients to crm_tungsten_authenticated;

-- RLS Policies on tungsten_clients
create policy tungsten_clients_select on public.tungsten_clients
for select to crm_tungsten_authenticated using (
  private.is_tungsten_owner_or_manager()
  or (private.is_tungsten_sales() and (created_by = auth.uid() or sales_id = auth.uid()))
);

create policy tungsten_clients_insert on public.tungsten_clients
for insert to crm_tungsten_authenticated with check (
  private.is_tungsten_owner_or_manager()
  or (private.is_tungsten_sales() and created_by = auth.uid() and sales_id = auth.uid())
);

create policy tungsten_clients_update on public.tungsten_clients
for update to crm_tungsten_authenticated using (
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

revoke all on function public.crm_add_manual_clinic(text) from public, crm_tungsten_anon;
grant execute on function public.crm_add_manual_clinic(text) to crm_tungsten_authenticated;

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

revoke all on function public.crm_internal_user_status() from public, crm_tungsten_anon;
grant execute on function public.crm_internal_user_status() to crm_tungsten_authenticated;

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

revoke all on function public.crm_setup_assign_service(uuid, uuid, boolean) from public, crm_tungsten_anon;
grant execute on function public.crm_setup_assign_service(uuid, uuid, boolean) to crm_tungsten_authenticated;

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

revoke all on function public.crm_setup_add_service(uuid, text) from public, crm_tungsten_anon;
grant execute on function public.crm_setup_add_service(uuid, text) to crm_tungsten_authenticated;


-- Native adaptation of 20261111150000_tungsten_manager_setup_access.sql
-- Migration 57: Allow Tungsten Owner and Manager read access on clinics, services, and profiles for setup and internal CRM

create policy clinics_select_owner_manager
on public.clinics
for select
to crm_tungsten_authenticated
using (
  archived_at is null
  and (select private.is_tungsten_owner_or_manager())
);

create policy services_select_owner_manager
on public.services
for select
to crm_tungsten_authenticated
using (
  (select private.is_tungsten_owner_or_manager())
);

create policy clinic_services_select_owner_manager
on public.clinic_services
for select
to crm_tungsten_authenticated
using (
  (select private.is_tungsten_owner_or_manager())
);

create policy profiles_select_owner_manager
on public.profiles
for select
to crm_tungsten_authenticated
using (
  (select private.is_tungsten_owner_or_manager())
);

-- Native adaptation of 20261111160000_tungsten_enterprise_crm_v58.sql
-- ============================================================================
-- MIGRATION 58: ENTERPRISE MULTI-TENANT CRM (FINAL PRODUCTION SPECIFICATION)
-- (FOR ARCHITECTURAL REVIEW ONLY - DO NOT RUN UNTIL USER APPROVAL)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. جداول البنية التحتية الأساسية
-- ----------------------------------------------------------------------------

create table if not exists public.crm_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  workspace_type text not null default 'client_company' 
    check (workspace_type in ('tungsten_internal', 'client_company')),
  domain text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'sales', 'company_owner', 'company_manager')),
  manager_id uuid references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  unique (workspace_id, user_id, role)
);

create index if not exists idx_crm_members_lookup on public.crm_workspace_members (workspace_id, user_id);
create index if not exists idx_crm_members_hierarchy on public.crm_workspace_members (workspace_id, manager_id);

-- ----------------------------------------------------------------------------
-- 2. دوال الأمان والتحقق الأساسية (Security Definer - No Recursion)
-- ----------------------------------------------------------------------------

create or replace function private.get_crm_user_role(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  select role into v_role
  from public.crm_workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and is_active = true;
  return v_role;
end;
$$;

create or replace function private.is_crm_workspace_accessible(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ws_type text;
  v_is_active boolean;
begin
  select workspace_type, is_active into v_ws_type, v_is_active
  from public.crm_workspaces
  where id = p_workspace_id;

  if v_ws_type is null or v_is_active is not true then
    return false;
  end if;

  if v_ws_type = 'tungsten_internal' and (select exists(select 1 from private.platform_admins where user_id = p_user_id)) then
    return true;
  end if;

  return exists (
    select 1 from public.crm_workspace_members
    where workspace_id = p_workspace_id
      and user_id = p_user_id
      and is_active = true
  );
end;
$$;

create or replace function private.is_crm_workspace_admin_or_owner(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ws_type text;
  v_is_active boolean;
  v_role text;
begin
  select workspace_type, is_active into v_ws_type, v_is_active
  from public.crm_workspaces
  where id = p_workspace_id;

  if v_ws_type is null then
    return false;
  end if;

  if v_ws_type = 'tungsten_internal' then
    if (select exists(select 1 from private.platform_admins where user_id = p_user_id)) then
      return true;
    end if;
    v_role := private.get_crm_user_role(p_workspace_id, p_user_id);
    return (v_role = 'owner' and v_is_active is true);
  end if;

  -- For client company workspaces, deactivation blocks local company administration
  if v_is_active is not true then
    return false;
  end if;

  v_role := private.get_crm_user_role(p_workspace_id, p_user_id);
  return (v_role in ('company_owner', 'company_manager'));
end;
$$;

create or replace function private.is_sales_under_manager(p_workspace_id uuid, p_sales_id uuid, p_manager_id uuid default auth.uid())
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_sales_id is null or p_manager_id is null then
    return false;
  end if;

  return exists (
    select 1 from public.crm_workspace_members
    where workspace_id = p_workspace_id
      and user_id = p_sales_id
      and manager_id = p_manager_id
      and role = 'sales'
      and is_active = true
  );
end;
$$;

create or replace function private.can_access_crm_record(
  p_workspace_id uuid,
  p_owner_id uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ws_type text;
  v_is_active boolean;
  v_role text;
begin
  select workspace_type, is_active into v_ws_type, v_is_active
  from public.crm_workspaces
  where id = p_workspace_id;

  -- Crucial: Deactivated workspaces strictly block all operational access
  if v_ws_type is null or v_is_active is not true then
    return false;
  end if;

  v_role := private.get_crm_user_role(p_workspace_id, auth.uid());
  if v_role is null then
    if v_ws_type = 'tungsten_internal' and private.is_platform_admin() then
      return true;
    end if;
    return false;
  end if;

  if v_role in ('owner', 'company_owner', 'company_manager') then
    return true;
  end if;

  if v_role = 'manager' then
    return (
      p_owner_id = auth.uid()
      or private.is_sales_under_manager(p_workspace_id, p_owner_id, auth.uid())
    );
  end if;

  if v_role = 'sales' then
    return (p_owner_id = auth.uid());
  end if;

  return false;
end;
$$;

create or replace function private.validate_crm_record_ownership(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_field_name text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ws_type text;
  v_target_role text;
  v_is_active boolean;
begin
  if p_owner_id is null then
    return;
  end if;

  select workspace_type into v_ws_type
  from public.crm_workspaces
  where id = p_workspace_id;

  if v_ws_type is null then
    raise exception 'WORKSPACE_NOT_FOUND: Workspace does not exist.' using errcode = '23503';
  end if;

  select role, is_active into v_target_role, v_is_active
  from public.crm_workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_owner_id;

  if v_target_role is null or v_is_active is not true then
    raise exception 'INVALID_OWNER: % must belong to an active member in the same workspace.', p_field_name using errcode = '23503';
  end if;

  if v_ws_type = 'tungsten_internal' and v_target_role not in ('owner', 'manager', 'sales') then
    raise exception 'INVALID_ROLE: % role is not permitted in Tungsten Internal workspace.', p_field_name using errcode = '22023';
  end if;

  if v_ws_type = 'client_company' and v_target_role not in ('company_owner', 'company_manager') then
    raise exception 'INVALID_ROLE: % role is not permitted in Company workspace.', p_field_name using errcode = '22023';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. جداول البيانات التشغيلية مع Composite Foreign Keys
-- ----------------------------------------------------------------------------

create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  company_name text not null,
  domain text,
  industry text,
  phone text,
  address text,
  city text,
  district text,
  website text,
  number_of_employees int default 1,
  branch_count int default 1,
  company_owner_id uuid references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create index if not exists idx_crm_companies_ws_owner on public.crm_companies (workspace_id, company_owner_id);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  lead_id text not null,
  full_name text not null,
  job_title text,
  phone_number text not null,
  whatsapp_number text,
  business_phone text,
  company_phone text,
  email text,
  social_profile_link text not null,
  business_name text,
  medical_specialty text,
  clinic_address text,
  city text,
  district text,
  google_maps text,
  website text,
  business_instagram text,
  business_facebook text,
  branch_count int default 1,
  source_platform text not null,
  ad_id text not null,
  lead_status text not null default 'جديد' check (lead_status in ('جديد', 'قيد المتابعة', 'عقد', 'تم الفوز', 'خاسر')),
  meeting_date timestamptz,
  follow_up_date timestamptz,
  activity_status text not null default 'معاودة الاتصال' check (activity_status in ('معاودة الاتصال', 'مهتم', 'اهتمام مستقبلي', 'غير مهتم', 'اجتماع')),
  meeting_status text not null default 'محجوز' check (meeting_status in ('محجوز', 'لم يحضر', 'حضر', 'ملغي')),
  contact_owner_id uuid not null references auth.users(id),
  company_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, lead_id),
  constraint fk_contact_company foreign key (workspace_id, company_id)
    references public.crm_companies(workspace_id, id) on delete restrict
);

create index if not exists idx_crm_contacts_lookup on public.crm_contacts (workspace_id, contact_owner_id);
create index if not exists idx_crm_contacts_lead_id on public.crm_contacts (workspace_id, lead_id);

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  deal_name text not null,
  deal_stage text not null default 'مكالمة' 
    check (deal_stage in ('مكالمة', 'زيارة', 'عرض سعر', 'عقد', 'عميل', 'خسارة مغلقة', 'غير مؤهل', 'فقدان العميل')),
  deal_owner_id uuid not null references auth.users(id),
  closing_date date,
  deal_amount numeric(14,2) not null default 25000,
  currency text not null default 'EGP',
  company_id uuid,
  description text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint fk_deal_company foreign key (workspace_id, company_id)
    references public.crm_companies(workspace_id, id) on delete restrict
);

create index if not exists idx_crm_deals_lookup on public.crm_deals (workspace_id, deal_owner_id, deal_stage);

create table if not exists public.crm_deal_contacts (
  workspace_id uuid not null,
  deal_id uuid not null,
  contact_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (deal_id, contact_id),
  constraint fk_dc_deal foreign key (workspace_id, deal_id)
    references public.crm_deals(workspace_id, id) on delete cascade,
  constraint fk_dc_contact foreign key (workspace_id, contact_id)
    references public.crm_contacts(workspace_id, id) on delete cascade
);

create index if not exists idx_crm_deal_contacts_ws on public.crm_deal_contacts (workspace_id, contact_id);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
  activity_type text not null check (activity_type in ('مكالمة', 'اجتماع', 'ملاحظة', 'مهمة', 'متابعة')),
  title text not null,
  details text,
  assigned_user_id uuid not null references auth.users(id),
  start_date timestamptz,
  end_date timestamptz,
  due_date timestamptz,
  reminder_at timestamptz,
  meeting_status text check (meeting_status in ('محجوز', 'لم يحضر', 'حضر', 'ملغي')),
  completion_status text not null default 'قيد الانتظار' check (completion_status in ('قيد الانتظار', 'مكتمل', 'ملغي')),
  performed_at timestamptz default now(),
  contact_id uuid,
  company_id uuid,
  deal_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint fk_act_contact foreign key (workspace_id, contact_id)
    references public.crm_contacts(workspace_id, id) on delete cascade,
  constraint fk_act_company foreign key (workspace_id, company_id)
    references public.crm_companies(workspace_id, id) on delete cascade,
  constraint fk_act_deal foreign key (workspace_id, deal_id)
    references public.crm_deals(workspace_id, id) on delete cascade
);

create index if not exists idx_crm_activities_timeline on public.crm_activities (workspace_id, performed_at desc);

create table if not exists public.crm_audit_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.crm_workspaces(id) on delete set null,
  original_workspace_id uuid not null,
  workspace_type text not null default 'client_company' check (workspace_type in ('tungsten_internal', 'client_company')),
  entity_type text not null check (
    entity_type in ('crm_workspaces', 'crm_workspace_members', 'crm_companies', 'crm_contacts', 'crm_deals', 'crm_activities')
  ),
  entity_id uuid not null,
  record_owner_id uuid references auth.users(id) on delete set null,
  action text not null check (
    action in (
      'INSERT', 'UPDATE', 'DELETE',
      'STAGE_CHANGE', 'TRANSFER_OWNERSHIP',
      'WORKSPACE_ACTIVATED', 'WORKSPACE_DEACTIVATED', 'WORKSPACE_RENAMED',
      'ROLE_CHANGED', 'MANAGER_CHANGED'
    )
  ),
  old_values jsonb,
  new_values jsonb,
  performed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_audit_lookup on public.crm_audit_logs (workspace_id, entity_type, entity_id);
create index if not exists idx_crm_audit_orig_ws on public.crm_audit_logs (original_workspace_id, entity_type);
create index if not exists idx_crm_audit_owner on public.crm_audit_logs (original_workspace_id, record_owner_id);

revoke all on public.crm_audit_logs from public, crm_tungsten_anon, crm_tungsten_authenticated;
grant select on public.crm_audit_logs to crm_tungsten_authenticated;

-- ----------------------------------------------------------------------------
-- 4. Triggers الحماية والتحقق من النزاهة الهندسية
-- ----------------------------------------------------------------------------

-- 4.1 حماية عدم تغيير نوع Workspace بعد الإنشاء (Workspace Type Immutability)
create or replace function private.enforce_workspace_immutability()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.workspace_type is distinct from new.workspace_type) then
    raise exception 'IMMUTABLE_FIELD: workspace_type cannot be modified after creation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_workspace_type on public.crm_workspaces;
create trigger trg_lock_workspace_type
before update on public.crm_workspaces
for each row execute function private.enforce_workspace_immutability();

-- 4.2 تنظيف مراجع الشركة بأمان قبل الحذف لمنع الأخطاء المتسلسلة
create or replace function private.nullify_company_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.crm_contacts set company_id = null where workspace_id = old.workspace_id and company_id = old.id;
  update public.crm_deals set company_id = null where workspace_id = old.workspace_id and company_id = old.id;
  update public.crm_activities set company_id = null where workspace_id = old.workspace_id and company_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_nullify_company_before_delete on public.crm_companies;
create trigger trg_nullify_company_before_delete
before delete on public.crm_companies
for each row execute function private.nullify_company_before_delete();

-- 4.3 حماية منشئ السجل الأصلي والتحقق الإلزامي من المالك المكلّف
create or replace function private.enforce_crm_record_provenance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
  end if;

  -- Validate record owner / assignee on INSERT and UPDATE
  if tg_table_name = 'crm_companies' then
    perform private.validate_crm_record_ownership(new.workspace_id, new.company_owner_id, 'company_owner_id');
  elsif tg_table_name = 'crm_contacts' then
    perform private.validate_crm_record_ownership(new.workspace_id, new.contact_owner_id, 'contact_owner_id');
  elsif tg_table_name = 'crm_deals' then
    perform private.validate_crm_record_ownership(new.workspace_id, new.deal_owner_id, 'deal_owner_id');
  elsif tg_table_name = 'crm_activities' then
    perform private.validate_crm_record_ownership(new.workspace_id, new.assigned_user_id, 'assigned_user_id');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prov_contacts on public.crm_contacts;
create trigger trg_prov_contacts before insert or update on public.crm_contacts
for each row execute function private.enforce_crm_record_provenance();

drop trigger if exists trg_prov_deals on public.crm_deals;
create trigger trg_prov_deals before insert or update on public.crm_deals
for each row execute function private.enforce_crm_record_provenance();

drop trigger if exists trg_prov_companies on public.crm_companies;
create trigger trg_prov_companies before insert or update on public.crm_companies
for each row execute function private.enforce_crm_record_provenance();

drop trigger if exists trg_prov_activities on public.crm_activities;
create trigger trg_prov_activities before insert or update on public.crm_activities
for each row execute function private.enforce_crm_record_provenance();

-- 4.4 التحقق من تطابق أدوار الأعضاء مع نوع الـ Workspace
create or replace function private.validate_crm_member_role_and_type()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ws_type text;
begin
  select workspace_type into v_ws_type
  from public.crm_workspaces
  where id = new.workspace_id;

  if v_ws_type is null then
    raise exception 'WORKSPACE_NOT_FOUND' using errcode = '23503';
  end if;

  if v_ws_type = 'tungsten_internal' and new.role not in ('owner', 'manager', 'sales') then
    raise exception 'INVALID_ROLE: Tungsten Internal workspace only allows owner, manager, or sales.' using errcode = '22023';
  end if;

  if v_ws_type = 'client_company' and new.role not in ('company_owner', 'company_manager') then
    raise exception 'INVALID_ROLE: Company workspaces only allow company_owner or company_manager.' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_crm_member_role_and_type on public.crm_workspace_members;
create trigger trg_validate_crm_member_role_and_type
before insert or update on public.crm_workspace_members
for each row execute function private.validate_crm_member_role_and_type();

-- 4.5 فرض الهرمية الإدارية وتعيين المديرين حصرياً بواسطة المالك
create or replace function private.enforce_crm_member_hierarchy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_is_owner boolean;
  v_target_mgr_role text;
begin
  v_is_owner := private.is_crm_workspace_admin_or_owner(coalesce(new.workspace_id, old.workspace_id), auth.uid());

  if (tg_op = 'UPDATE' and (old.manager_id is distinct from new.manager_id or old.role is distinct from new.role)) then
    if not v_is_owner then
      raise exception 'SECURITY_VIOLATION: Only workspace owners can modify roles or assign managers.' using errcode = '42501';
    end if;
  end if;

  if (new.manager_id is not null) then
    v_target_mgr_role := private.get_crm_user_role(new.workspace_id, new.manager_id);
    if v_target_mgr_role is null or v_target_mgr_role not in ('manager', 'owner', 'company_manager', 'company_owner') then
      raise exception 'INVALID_MANAGER: Manager must be an active manager in the same workspace.' using errcode = '23503';
    end if;
    if new.user_id = new.manager_id then
      raise exception 'INVALID_MANAGER: An employee cannot manage themselves.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_crm_member_hierarchy on public.crm_workspace_members;
create trigger trg_enforce_crm_member_hierarchy
before insert or update on public.crm_workspace_members
for each row execute function private.enforce_crm_member_hierarchy();

-- 4.6 التحقق من نقل الملكية وحماية صلاحيات الفرق
create or replace function private.validate_crm_ownership_transfer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_caller_role text;
  v_old_owner uuid;
  v_new_owner uuid;
  v_is_owner boolean;
  v_ws_type text;
  v_target_role text;
begin
  if tg_table_name = 'crm_contacts' then
    v_old_owner := old.contact_owner_id;
    v_new_owner := new.contact_owner_id;
  elsif tg_table_name = 'crm_deals' then
    v_old_owner := old.deal_owner_id;
    v_new_owner := new.deal_owner_id;
  elsif tg_table_name = 'crm_companies' then
    v_old_owner := old.company_owner_id;
    v_new_owner := new.company_owner_id;
  end if;

  if v_old_owner is distinct from v_new_owner then
    select workspace_type into v_ws_type from public.crm_workspaces where id = new.workspace_id;

    select role into v_target_role
    from public.crm_workspace_members
    where workspace_id = new.workspace_id and user_id = v_new_owner and is_active = true;

    if v_target_role is null then
      raise exception 'INVALID_TARGET: Target owner must be an active member in this workspace.' using errcode = '23503';
    end if;

    if v_ws_type = 'tungsten_internal' and v_target_role not in ('owner', 'manager', 'sales') then
      raise exception 'INVALID_ROLE: Target owner has invalid role for Tungsten Internal workspace.' using errcode = '22023';
    end if;

    if v_ws_type = 'client_company' and v_target_role not in ('company_owner', 'company_manager') then
      raise exception 'INVALID_ROLE: Target owner has invalid role for Company workspace.' using errcode = '22023';
    end if;

    v_is_owner := private.is_crm_workspace_admin_or_owner(new.workspace_id, auth.uid());
    if v_is_owner then
      return new;
    end if;

    v_caller_role := private.get_crm_user_role(new.workspace_id, auth.uid());

    if v_caller_role = 'sales' then
      raise exception 'PERMISSION_DENIED: Sales representatives cannot transfer record ownership.' using errcode = '42501';
    end if;

    if v_caller_role = 'manager' then
      if not (
        (v_old_owner = auth.uid() or private.is_sales_under_manager(new.workspace_id, v_old_owner, auth.uid()))
        and (v_new_owner = auth.uid() or private.is_sales_under_manager(new.workspace_id, v_new_owner, auth.uid()))
      ) then
        raise exception 'PERMISSION_DENIED: Managers can only transfer records between members of their own managed team.' using errcode = '42501';
      end if;
      return new;
    end if;

    raise exception 'PERMISSION_DENIED: Unauthorized ownership transfer.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_transfer_contact on public.crm_contacts;
create trigger trg_transfer_contact before update on public.crm_contacts
for each row execute function private.validate_crm_ownership_transfer();

drop trigger if exists trg_transfer_deal on public.crm_deals;
create trigger trg_transfer_deal before update on public.crm_deals
for each row execute function private.validate_crm_ownership_transfer();

drop trigger if exists trg_transfer_company on public.crm_companies;
create trigger trg_transfer_company before update on public.crm_companies
for each row execute function private.validate_crm_ownership_transfer();

-- 4.7 تسجيل تدقيق شامل لجميع العمليات والاحتفاظ الدائم بالمعرّف الأصلي
create or replace function private.log_crm_entity_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_action text;
  v_old_json jsonb := null;
  v_new_json jsonb := null;
  v_record_owner uuid := null;
  v_entity_type text := tg_table_name;
  v_entity_id uuid;
  v_ws_id uuid := null;
  v_orig_ws_id uuid;
  v_ws_type text;
begin
  if (tg_op = 'INSERT') then
    v_action := 'INSERT';
    v_new_json := to_jsonb(new);
    v_entity_id := new.id;
    if (v_entity_type = 'crm_workspaces') then
      v_ws_id := new.id;
      v_orig_ws_id := new.id;
      v_ws_type := new.workspace_type;
      v_record_owner := null;
    else
      v_ws_id := new.workspace_id;
      v_orig_ws_id := new.workspace_id;
      select workspace_type into v_ws_type from public.crm_workspaces where id = new.workspace_id;
      if (v_entity_type = 'crm_contacts') then v_record_owner := new.contact_owner_id;
      elsif (v_entity_type = 'crm_deals') then v_record_owner := new.deal_owner_id;
      elsif (v_entity_type = 'crm_companies') then v_record_owner := new.company_owner_id;
      elsif (v_entity_type = 'crm_activities') then v_record_owner := new.assigned_user_id;
      elsif (v_entity_type = 'crm_workspace_members') then v_record_owner := new.user_id;
      end if;
    end if;

  elsif (tg_op = 'UPDATE') then
    v_old_json := to_jsonb(old);
    v_new_json := to_jsonb(new);
    v_entity_id := new.id;
    if (v_entity_type = 'crm_workspaces') then
      v_ws_id := new.id;
      v_orig_ws_id := new.id;
      v_ws_type := new.workspace_type;
      v_record_owner := null;
      if ((v_old_json->>'is_active') is distinct from (v_new_json->>'is_active')) then
        v_action := case when (new.is_active = true) then 'WORKSPACE_ACTIVATED' else 'WORKSPACE_DEACTIVATED' end;
      elsif ((v_old_json->>'name') is distinct from (v_new_json->>'name')) then
        v_action := 'WORKSPACE_RENAMED';
      else
        v_action := 'UPDATE';
      end if;
    elsif (v_entity_type = 'crm_workspace_members') then
      v_ws_id := new.workspace_id;
      v_orig_ws_id := new.workspace_id;
      select workspace_type into v_ws_type from public.crm_workspaces where id = new.workspace_id;
      v_record_owner := new.user_id;
      if ((v_old_json->>'role') is distinct from (v_new_json->>'role')) then
        v_action := 'ROLE_CHANGED';
      elsif ((v_old_json->>'manager_id') is distinct from (v_new_json->>'manager_id')) then
        v_action := 'MANAGER_CHANGED';
      else
        v_action := 'UPDATE';
      end if;
    elsif (v_entity_type = 'crm_deals' and (v_old_json->>'deal_stage') is distinct from (v_new_json->>'deal_stage')) then
      v_ws_id := new.workspace_id;
      v_orig_ws_id := new.workspace_id;
      select workspace_type into v_ws_type from public.crm_workspaces where id = new.workspace_id;
      v_record_owner := new.deal_owner_id;
      v_action := 'STAGE_CHANGE';
    elsif (
      (v_entity_type = 'crm_contacts' and (v_old_json->>'contact_owner_id') is distinct from (v_new_json->>'contact_owner_id'))
      or (v_entity_type = 'crm_deals' and (v_old_json->>'deal_owner_id') is distinct from (v_new_json->>'deal_owner_id'))
      or (v_entity_type = 'crm_companies' and (v_old_json->>'company_owner_id') is distinct from (v_new_json->>'company_owner_id'))
      or (v_entity_type = 'crm_activities' and (v_old_json->>'assigned_user_id') is distinct from (v_new_json->>'assigned_user_id'))
    ) then
      v_ws_id := new.workspace_id;
      v_orig_ws_id := new.workspace_id;
      select workspace_type into v_ws_type from public.crm_workspaces where id = new.workspace_id;
      v_action := 'TRANSFER_OWNERSHIP';
      if (v_entity_type = 'crm_contacts') then v_record_owner := new.contact_owner_id;
      elsif (v_entity_type = 'crm_deals') then v_record_owner := new.deal_owner_id;
      elsif (v_entity_type = 'crm_companies') then v_record_owner := new.company_owner_id;
      elsif (v_entity_type = 'crm_activities') then v_record_owner := new.assigned_user_id;
      end if;
    else
      v_ws_id := new.workspace_id;
      v_orig_ws_id := new.workspace_id;
      select workspace_type into v_ws_type from public.crm_workspaces where id = new.workspace_id;
      v_action := 'UPDATE';
      if (v_entity_type = 'crm_contacts') then v_record_owner := new.contact_owner_id;
      elsif (v_entity_type = 'crm_deals') then v_record_owner := new.deal_owner_id;
      elsif (v_entity_type = 'crm_companies') then v_record_owner := new.company_owner_id;
      elsif (v_entity_type = 'crm_activities') then v_record_owner := new.assigned_user_id;
      end if;
    end if;

  elsif (tg_op = 'DELETE') then
    v_action := 'DELETE';
    v_old_json := to_jsonb(old);
    v_entity_id := old.id;
    if (v_entity_type = 'crm_workspaces') then
      v_ws_id := null;
      v_orig_ws_id := old.id;
      v_ws_type := old.workspace_type;
      v_record_owner := null;
    else
      v_orig_ws_id := old.workspace_id;
      select workspace_type into v_ws_type from public.crm_workspaces where id = old.workspace_id;
      if exists (select 1 from public.crm_workspaces where id = old.workspace_id) then
        v_ws_id := old.workspace_id;
      else
        v_ws_id := null;
      end if;
      if (v_entity_type = 'crm_contacts') then v_record_owner := old.contact_owner_id;
      elsif (v_entity_type = 'crm_deals') then v_record_owner := old.deal_owner_id;
      elsif (v_entity_type = 'crm_companies') then v_record_owner := old.company_owner_id;
      elsif (v_entity_type = 'crm_activities') then v_record_owner := old.assigned_user_id;
      elsif (v_entity_type = 'crm_workspace_members') then v_record_owner := old.user_id;
      end if;
    end if;
  end if;

  if v_ws_type is null then
    v_ws_type := 'client_company';
  end if;

  insert into public.crm_audit_logs (
    workspace_id,
    original_workspace_id,
    workspace_type,
    entity_type,
    entity_id,
    record_owner_id,
    action,
    old_values,
    new_values,
    performed_by
  ) values (
    v_ws_id,
    v_orig_ws_id,
    v_ws_type,
    v_entity_type,
    v_entity_id,
    v_record_owner,
    v_action,
    v_old_json,
    v_new_json,
    auth.uid()
  );

  if (tg_op = 'DELETE') then
    return old;
  else
    return new;
  end if;
end;
$$;

drop trigger if exists trg_audit_crm_workspaces on public.crm_workspaces;
create trigger trg_audit_crm_workspaces after insert or update or delete on public.crm_workspaces
for each row execute function private.log_crm_entity_audit();

drop trigger if exists trg_audit_contacts on public.crm_contacts;
create trigger trg_audit_contacts after insert or update or delete on public.crm_contacts
for each row execute function private.log_crm_entity_audit();

drop trigger if exists trg_audit_deals on public.crm_deals;
create trigger trg_audit_deals after insert or update or delete on public.crm_deals
for each row execute function private.log_crm_entity_audit();

drop trigger if exists trg_audit_companies on public.crm_companies;
create trigger trg_audit_companies after insert or update or delete on public.crm_companies
for each row execute function private.log_crm_entity_audit();

drop trigger if exists trg_audit_activities on public.crm_activities;
create trigger trg_audit_activities after insert or update or delete on public.crm_activities
for each row execute function private.log_crm_entity_audit();

drop trigger if exists trg_audit_workspace_members on public.crm_workspace_members;
create trigger trg_audit_workspace_members after insert or update or delete on public.crm_workspace_members
for each row execute function private.log_crm_entity_audit();

-- ----------------------------------------------------------------------------
-- 5. إجراءات التأسيس والتهيئة الآمنة (Secure Provisioning RPC)
-- ----------------------------------------------------------------------------

create or replace function public.provision_client_company_workspace(
  p_name text,
  p_initial_owner_id uuid,
  p_domain text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_is_platform_admin boolean;
  v_user_exists boolean;
begin
  -- 1. التحقق من صلاحية Tungsten Owner (platform_admin)
  select exists(select 1 from private.platform_admins where user_id = auth.uid())
  into v_is_platform_admin;

  if not v_is_platform_admin then
    raise exception 'PERMISSION_DENIED: Only platform administrators can provision client company workspaces.'
      using errcode = '42501';
  end if;

  -- 2. التحقق من صحة المدخلات
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'INVALID_PARAMETER: Workspace name cannot be empty.'
      using errcode = '22023';
  end if;

  if p_initial_owner_id is null then
    raise exception 'INVALID_PARAMETER: Initial owner ID is required.'
      using errcode = '22023';
  end if;

  -- التحقق من وجود المستخدم في auth.users
  select exists(select 1 from auth.users where id = p_initial_owner_id)
  into v_user_exists;

  if not v_user_exists then
    raise exception 'USER_NOT_FOUND: Initial owner user does not exist.'
      using errcode = '23503';
  end if;

  -- 3. إنشاء مساحة عمل جديدة من نوع client_company ومفعلة تلقائياً
  insert into public.crm_workspaces (
    name,
    workspace_type,
    domain,
    is_active
  ) values (
    trim(p_name),
    'client_company',
    trim(p_domain),
    true
  ) returning id into v_workspace_id;

  -- 4. إضافة المالك الأول بصلاحية company_owner
  insert into public.crm_workspace_members (
    workspace_id,
    user_id,
    role,
    is_active
  ) values (
    v_workspace_id,
    p_initial_owner_id,
    'company_owner',
    true
  );

  -- 5. إرجاع معرف مساحة العمل المنشأة
  return v_workspace_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. تفعيل وسياسات Row Level Security (RLS) الشاملة
-- ----------------------------------------------------------------------------

alter table public.crm_workspaces enable row level security;
alter table public.crm_workspace_members enable row level security;
alter table public.crm_companies enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_deal_contacts enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_audit_logs enable row level security;

-- [crm_workspaces]
create policy crm_ws_select on public.crm_workspaces
for select to crm_tungsten_authenticated using (
  private.is_crm_workspace_accessible(id)
  or private.is_platform_admin()
);

create policy crm_ws_insert on public.crm_workspaces
for insert to crm_tungsten_authenticated with check (
  private.is_platform_admin()
);

create policy crm_ws_update on public.crm_workspaces
for update to crm_tungsten_authenticated using (
  private.is_crm_workspace_admin_or_owner(id)
  or private.is_platform_admin()
)
with check (
  private.is_crm_workspace_admin_or_owner(id)
  or private.is_platform_admin()
);

-- [crm_workspace_members]
create policy crm_members_select on public.crm_workspace_members
for select to crm_tungsten_authenticated using (
  user_id = auth.uid()
  or private.is_crm_workspace_admin_or_owner(workspace_id)
  or (private.get_crm_user_role(workspace_id) = 'manager' and manager_id = auth.uid())
);

create policy crm_members_insert on public.crm_workspace_members
for insert to crm_tungsten_authenticated with check (private.is_crm_workspace_admin_or_owner(workspace_id));

create policy crm_members_update on public.crm_workspace_members
for update to crm_tungsten_authenticated using (private.is_crm_workspace_admin_or_owner(workspace_id))
with check (private.is_crm_workspace_admin_or_owner(workspace_id));

create policy crm_members_delete on public.crm_workspace_members
for delete to crm_tungsten_authenticated using (private.is_crm_workspace_admin_or_owner(workspace_id));

-- [crm_companies]
create policy crm_comp_select on public.crm_companies
for select to crm_tungsten_authenticated using (private.can_access_crm_record(workspace_id, company_owner_id));

create policy crm_comp_insert on public.crm_companies
for insert to crm_tungsten_authenticated with check (
  private.is_crm_workspace_accessible(workspace_id)
  and (
    private.is_crm_workspace_admin_or_owner(workspace_id)
    or (private.get_crm_user_role(workspace_id) = 'manager' and (company_owner_id = auth.uid() or private.is_sales_under_manager(workspace_id, company_owner_id, auth.uid())))
    or (private.get_crm_user_role(workspace_id) = 'sales' and company_owner_id = auth.uid() and created_by = auth.uid())
  )
);

create policy crm_comp_update on public.crm_companies
for update to crm_tungsten_authenticated using (private.can_access_crm_record(workspace_id, company_owner_id))
with check (private.can_access_crm_record(workspace_id, company_owner_id));

create policy crm_comp_delete on public.crm_companies
for delete to crm_tungsten_authenticated using (private.is_crm_workspace_admin_or_owner(workspace_id));

-- [crm_contacts]
create policy crm_contacts_select on public.crm_contacts
for select to crm_tungsten_authenticated using (private.can_access_crm_record(workspace_id, contact_owner_id));

create policy crm_contacts_insert on public.crm_contacts
for insert to crm_tungsten_authenticated with check (
  private.is_crm_workspace_accessible(workspace_id)
  and (
    private.is_crm_workspace_admin_or_owner(workspace_id)
    or (private.get_crm_user_role(workspace_id) = 'manager' and (contact_owner_id = auth.uid() or private.is_sales_under_manager(workspace_id, contact_owner_id, auth.uid())))
    or (private.get_crm_user_role(workspace_id) = 'sales' and contact_owner_id = auth.uid() and created_by = auth.uid())
  )
);

create policy crm_contacts_update on public.crm_contacts
for update to crm_tungsten_authenticated using (private.can_access_crm_record(workspace_id, contact_owner_id))
with check (private.can_access_crm_record(workspace_id, contact_owner_id));

create policy crm_contacts_delete on public.crm_contacts
for delete to crm_tungsten_authenticated using (
  private.is_crm_workspace_admin_or_owner(workspace_id)
  or (private.get_crm_user_role(workspace_id) = 'manager' and private.is_sales_under_manager(workspace_id, contact_owner_id, auth.uid()))
);

-- [crm_deals]
create policy crm_deals_select on public.crm_deals
for select to crm_tungsten_authenticated using (private.can_access_crm_record(workspace_id, deal_owner_id));

create policy crm_deals_insert on public.crm_deals
for insert to crm_tungsten_authenticated with check (
  private.is_crm_workspace_accessible(workspace_id)
  and (
    private.is_crm_workspace_admin_or_owner(workspace_id)
    or (private.get_crm_user_role(workspace_id) = 'manager' and (deal_owner_id = auth.uid() or private.is_sales_under_manager(workspace_id, deal_owner_id, auth.uid())))
    or (private.get_crm_user_role(workspace_id) = 'sales' and deal_owner_id = auth.uid() and created_by = auth.uid())
  )
);

create policy crm_deals_update on public.crm_deals
for update to crm_tungsten_authenticated using (private.can_access_crm_record(workspace_id, deal_owner_id))
with check (private.can_access_crm_record(workspace_id, deal_owner_id));

create policy crm_deals_delete on public.crm_deals
for delete to crm_tungsten_authenticated using (private.is_crm_workspace_admin_or_owner(workspace_id));

-- [crm_deal_contacts]
create policy crm_dc_select on public.crm_deal_contacts
for select to crm_tungsten_authenticated using (
  exists (
    select 1 from public.crm_deals d
    where d.workspace_id = crm_deal_contacts.workspace_id
      and d.id = crm_deal_contacts.deal_id
      and private.can_access_crm_record(d.workspace_id, d.deal_owner_id)
  )
  and exists (
    select 1 from public.crm_contacts c
    where c.workspace_id = crm_deal_contacts.workspace_id
      and c.id = crm_deal_contacts.contact_id
      and private.can_access_crm_record(c.workspace_id, c.contact_owner_id)
  )
);

create policy crm_dc_insert on public.crm_deal_contacts
for insert to crm_tungsten_authenticated with check (
  exists (
    select 1 from public.crm_deals d
    where d.workspace_id = crm_deal_contacts.workspace_id
      and d.id = crm_deal_contacts.deal_id
      and private.can_access_crm_record(d.workspace_id, d.deal_owner_id)
  )
  and exists (
    select 1 from public.crm_contacts c
    where c.workspace_id = crm_deal_contacts.workspace_id
      and c.id = crm_deal_contacts.contact_id
      and private.can_access_crm_record(c.workspace_id, c.contact_owner_id)
  )
);

create policy crm_dc_delete on public.crm_deal_contacts
for delete to crm_tungsten_authenticated using (
  exists (
    select 1 from public.crm_deals d
    where d.workspace_id = crm_deal_contacts.workspace_id
      and d.id = crm_deal_contacts.deal_id
      and private.can_access_crm_record(d.workspace_id, d.deal_owner_id)
  )
  and exists (
    select 1 from public.crm_contacts c
    where c.workspace_id = crm_deal_contacts.workspace_id
      and c.id = crm_deal_contacts.contact_id
      and private.can_access_crm_record(c.workspace_id, c.contact_owner_id)
  )
);

-- [crm_activities]
create policy crm_act_select on public.crm_activities
for select to crm_tungsten_authenticated using (private.can_access_crm_record(workspace_id, assigned_user_id));

create policy crm_act_insert on public.crm_activities
for insert to crm_tungsten_authenticated with check (
  private.is_crm_workspace_accessible(workspace_id)
  and (contact_id is null or exists (
    select 1 from public.crm_contacts c
    where c.workspace_id = crm_activities.workspace_id and c.id = crm_activities.contact_id
      and private.can_access_crm_record(c.workspace_id, c.contact_owner_id)
  ))
  and (deal_id is null or exists (
    select 1 from public.crm_deals d
    where d.workspace_id = crm_activities.workspace_id and d.id = crm_activities.deal_id
      and private.can_access_crm_record(d.workspace_id, d.deal_owner_id)
  ))
  and (company_id is null or exists (
    select 1 from public.crm_companies cp
    where cp.workspace_id = crm_activities.workspace_id and cp.id = crm_activities.company_id
      and private.can_access_crm_record(cp.workspace_id, cp.company_owner_id)
  ))
  and (
    private.is_crm_workspace_admin_or_owner(workspace_id)
    or (
      private.get_crm_user_role(workspace_id) = 'manager'
      and (assigned_user_id = auth.uid() or private.is_sales_under_manager(workspace_id, assigned_user_id, auth.uid()))
    )
    or (
      private.get_crm_user_role(workspace_id) = 'sales'
      and assigned_user_id = auth.uid()
      and created_by = auth.uid()
    )
  )
);

create policy crm_act_update on public.crm_activities
for update to crm_tungsten_authenticated using (private.can_access_crm_record(workspace_id, assigned_user_id))
with check (
  private.can_access_crm_record(workspace_id, assigned_user_id)
  and (contact_id is null or exists (
    select 1 from public.crm_contacts c
    where c.workspace_id = crm_activities.workspace_id and c.id = crm_activities.contact_id
      and private.can_access_crm_record(c.workspace_id, c.contact_owner_id)
  ))
  and (deal_id is null or exists (
    select 1 from public.crm_deals d
    where d.workspace_id = crm_activities.workspace_id and d.id = crm_activities.deal_id
      and private.can_access_crm_record(d.workspace_id, d.deal_owner_id)
  ))
  and (company_id is null or exists (
    select 1 from public.crm_companies cp
    where cp.workspace_id = crm_activities.workspace_id and cp.id = crm_activities.company_id
      and private.can_access_crm_record(cp.workspace_id, cp.company_owner_id)
  ))
);

create policy crm_act_delete on public.crm_activities
for delete to crm_tungsten_authenticated using (
  private.is_crm_workspace_accessible(workspace_id)
  and (
    private.is_crm_workspace_admin_or_owner(workspace_id)
    or private.can_access_crm_record(workspace_id, assigned_user_id)
  )
);

-- [crm_audit_logs Helper & Policy]
create or replace function private.can_access_crm_audit(
  p_audit_id bigint,
  p_user_id uuid default auth.uid()
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_log record;
begin
  select workspace_id, original_workspace_id, workspace_type, entity_type, record_owner_id, performed_by
  into v_log
  from public.crm_audit_logs
  where id = p_audit_id;

  if v_log is null then
    return false;
  end if;

  -- 1. Platform Admin (Tungsten Owner):
  -- مسموح برؤية سجلات البنية التحتية فقط لجميع مساحات العمل (crm_workspaces)
  -- أو السجلات التشغيلية التابعة لـ tungsten_internal فقط.
  -- محظور تماماً من قراءة السجلات التشغيلية لشركات العملاء حتى بعد حذفها!
  if (select exists(select 1 from private.platform_admins where user_id = p_user_id)) then
    return (v_log.entity_type = 'crm_workspaces' or v_log.workspace_type = 'tungsten_internal');
  end if;

  -- 2. في حال حذف مساحة العمل، لا يُمنح أي مستخدم خارجي وصولاً للسجلات التشغيلية
  if v_log.workspace_id is null then
    return false;
  end if;

  -- 3. إداريو مساحات العمل النشطة (Company Owner / Company Manager):
  if private.is_crm_workspace_admin_or_owner(v_log.workspace_id, p_user_id) then
    return true;
  end if;

  -- 4. المديرون داخل مساحات العمل النشطة (سجلاتهم وسجلات موظفي فريقهم):
  if private.get_crm_user_role(v_log.workspace_id, p_user_id) = 'manager' then
    return (
      v_log.performed_by = p_user_id
      or v_log.record_owner_id = p_user_id
      or private.is_sales_under_manager(v_log.workspace_id, v_log.record_owner_id, p_user_id)
      or private.is_sales_under_manager(v_log.workspace_id, v_log.performed_by, p_user_id)
    );
  end if;

  -- 5. موظفو المبيعات داخل مساحات العمل النشطة (سجلاتهم الخاصة فقط):
  if private.get_crm_user_role(v_log.workspace_id, p_user_id) = 'sales' then
    return (
      v_log.performed_by = p_user_id
      or v_log.record_owner_id = p_user_id
    );
  end if;

  return false;
end;
$$;

create policy crm_audit_select on public.crm_audit_logs
for select to crm_tungsten_authenticated using (
  private.can_access_crm_audit(id, auth.uid())
);

-- ----------------------------------------------------------------------------
-- 7. صلاحيات التنفيذ وحماية Schema private
-- ----------------------------------------------------------------------------

-- 1. حماية Schema private وسحب كافة الصلاحيات العامة والتلقائية
revoke all on schema private from public, crm_tungsten_anon;
grant usage on schema private to crm_tungsten_authenticated;

-- سحب أي صلاحية تنفيذ افتراضية على دوال schema private من public و anon
revoke execute on all functions in schema private from public, crm_tungsten_anon;

-- سحب تنفيذ دوال Triggers الداخلية صراحة لمنع استدعائها المباشر من المستخدمين
revoke execute on function private.nullify_company_before_delete() from public, crm_tungsten_anon, crm_tungsten_authenticated;
revoke execute on function private.enforce_crm_record_provenance() from public, crm_tungsten_anon, crm_tungsten_authenticated;
revoke execute on function private.validate_crm_member_role_and_type() from public, crm_tungsten_anon, crm_tungsten_authenticated;
revoke execute on function private.enforce_crm_member_hierarchy() from public, crm_tungsten_anon, crm_tungsten_authenticated;
revoke execute on function private.validate_crm_ownership_transfer() from public, crm_tungsten_anon, crm_tungsten_authenticated;
revoke execute on function private.log_crm_entity_audit() from public, crm_tungsten_anon, crm_tungsten_authenticated;
revoke execute on function private.enforce_workspace_immutability() from public, crm_tungsten_anon, crm_tungsten_authenticated;

-- 2. منح صلاحيات EXECUTE حصرياً على دوال الاستعلام والتحقق اللازمة لـ RLS
grant execute on function private.get_crm_user_role(uuid, uuid) to crm_tungsten_authenticated;
grant execute on function private.is_crm_workspace_accessible(uuid, uuid) to crm_tungsten_authenticated;
grant execute on function private.is_crm_workspace_admin_or_owner(uuid, uuid) to crm_tungsten_authenticated;
grant execute on function private.is_sales_under_manager(uuid, uuid, uuid) to crm_tungsten_authenticated;
grant execute on function private.can_access_crm_record(uuid, uuid) to crm_tungsten_authenticated;
grant execute on function private.validate_crm_record_ownership(uuid, uuid, text) to crm_tungsten_authenticated;
grant execute on function private.can_access_crm_audit(bigint, uuid) to crm_tungsten_authenticated;

-- 3. منح الصلاحيات التشغيلية على الجداول للمستخدمين المصادقين (authenticated)
grant select, insert, update on public.crm_workspaces to crm_tungsten_authenticated;
grant select, insert, update, delete on public.crm_workspace_members to crm_tungsten_authenticated;
grant select, insert, update, delete on public.crm_companies to crm_tungsten_authenticated;
grant select, insert, update, delete on public.crm_contacts to crm_tungsten_authenticated;
grant select, insert, update, delete on public.crm_deals to crm_tungsten_authenticated;
grant select, insert, update, delete on public.crm_deal_contacts to crm_tungsten_authenticated;
grant select, insert, update, delete on public.crm_activities to crm_tungsten_authenticated;
grant select on public.crm_audit_logs to crm_tungsten_authenticated;

-- 4. منح صلاحية تنفيذ Provisioning RPC للمستخدمين المصادقين
grant execute on function public.provision_client_company_workspace(text, uuid, text) to crm_tungsten_authenticated;
revoke execute on function public.provision_client_company_workspace(text, uuid, text) from public, crm_tungsten_anon;
-- Native session storage; only the trusted server service role may access it.
CREATE TABLE private.native_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  password_fingerprint text NOT NULL CHECK(password_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX native_sessions_user_idx ON private.native_sessions(user_id);
CREATE INDEX native_sessions_expiry_idx ON private.native_sessions(expires_at);
ALTER TABLE private.native_sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE private.native_login_limits (
  key_hash text PRIMARY KEY CHECK(key_hash ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL CHECK(attempts>0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX native_login_limits_expiry_idx ON private.native_login_limits(expires_at);
ALTER TABLE private.native_login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.native_sessions, private.native_login_limits FROM PUBLIC, crm_tungsten_anon, crm_tungsten_authenticated;

CREATE TABLE public.brand_services (
  brand_id uuid NOT NULL REFERENCES public.crm_companies(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(brand_id,service_id)
);
ALTER TABLE public.brand_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY brand_services_read ON public.brand_services FOR SELECT TO crm_tungsten_authenticated USING (
  EXISTS(SELECT FROM public.crm_companies company WHERE company.id=brand_id
    AND private.can_access_crm_record(company.workspace_id, company.company_owner_id))
);
CREATE POLICY brand_services_manage ON public.brand_services FOR ALL TO crm_tungsten_authenticated USING (
  EXISTS(SELECT FROM public.crm_companies company WHERE company.id=brand_id
    AND private.is_crm_workspace_admin_or_owner(company.workspace_id))
) WITH CHECK (
  EXISTS(SELECT FROM public.crm_companies company WHERE company.id=brand_id
    AND private.is_crm_workspace_admin_or_owner(company.workspace_id))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_services TO crm_tungsten_authenticated;
ALTER TABLE public.crm_deals ALTER COLUMN deal_amount SET DEFAULT 0;
GRANT USAGE ON SCHEMA auth, extensions TO crm_tungsten_authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_tungsten_authenticated;

-- Use the imported platform administrator, with original user IDs intact.
DO $bootstrap$
DECLARE actor uuid; workspace uuid;
BEGIN
  SELECT p.user_id INTO actor FROM private.platform_admins p JOIN auth.users u ON u.id=p.user_id
   WHERE u.deleted_at IS NULL ORDER BY p.user_id LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'No imported platform administrator found'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  INSERT INTO private.tungsten_internal_roles(user_id, role)
    SELECT user_id, 'owner' FROM private.platform_admins;
  INSERT INTO public.crm_workspaces(name,workspace_type) VALUES ('Tungsten Media','tungsten_internal') RETURNING id INTO workspace;
  INSERT INTO public.crm_workspace_members(workspace_id,user_id,role)
    SELECT workspace, user_id, 'owner' FROM private.platform_admins;
  PERFORM set_config('request.jwt.claims','{}',true);
END;
$bootstrap$;

GRANT USAGE ON SCHEMA public, private, auth, extensions TO crm_tungsten_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, private, auth TO crm_tungsten_service;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public, private, auth TO crm_tungsten_service;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO crm_tungsten_service;
DO $policies$
DECLARE t record;
BEGIN
  FOR t IN SELECT n.nspname,c.relname,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private','auth') AND c.relkind IN ('r','p') AND c.relrowsecurity
  LOOP
    IF NOT EXISTS(SELECT FROM pg_policy WHERE polrelid=t.oid AND polname='crm_service_access') THEN
      EXECUTE format('CREATE POLICY crm_service_access ON %I.%I FOR ALL TO crm_tungsten_service USING(true) WITH CHECK(true)',t.nspname,t.relname);
    END IF;
  END LOOP;
END;
$policies$;

INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES
 ('20261111140000','tungsten_internal_crm',ARRAY['Applied native role adaptation']),
 ('20261111150000','tungsten_manager_setup_access',ARRAY['Applied native role adaptation']),
 ('20261111160000','tungsten_enterprise_crm_v58',ARRAY['Applied native role adaptation']);
RESET ROLE;

-- Abort the complete setup if any imported table loses or gains rows unexpectedly.
DO $preserve$
DECLARE t record; n bigint;
BEGIN
  FOR t IN SELECT * FROM crm_native_before LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I',t.schema_name,t.table_name) INTO n;
    IF n <> t.rows THEN RAISE EXCEPTION 'Imported table row count changed: %.%',t.schema_name,t.table_name; END IF;
  END LOOP;
  IF EXISTS(SELECT FROM crm_native_passwords p JOIN auth.users u USING(id) WHERE p.fingerprint <> md5(coalesce(u.encrypted_password,''))) THEN
    RAISE EXCEPTION 'Imported passwords changed';
  END IF;
END;
$preserve$;
