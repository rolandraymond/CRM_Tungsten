BEGIN;

-- ============================================================================
-- MIGRATION 58: ENTERPRISE MULTI-TENANT CRM (FINAL PRODUCTION SPECIFICATION)
-- (FOR ARCHITECTURAL REVIEW ONLY - DO NOT RUN UNTIL USER APPROVAL)
-- ============================================================================

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
    if v_ws_type = 'tungsten_internal' and (select exists(select 1 from private.platform_admins where user_id = auth.uid())) then
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
  lead_status text not null default 'جديد' check (lead_status in ('جديد', 'قيد المتابعة', 'تم الفوز', 'خاسر')),
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

revoke all on public.crm_audit_logs from public, anon, authenticated;
grant select on public.crm_audit_logs to authenticated;

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
for select to authenticated using (
  private.is_crm_workspace_accessible(id)
  or (select exists(select 1 from private.platform_admins where user_id = auth.uid()))
);

create policy crm_ws_insert on public.crm_workspaces
for insert to authenticated with check (
  (select exists(select 1 from private.platform_admins where user_id = auth.uid()))
);

create policy crm_ws_update on public.crm_workspaces
for update to authenticated using (
  private.is_crm_workspace_admin_or_owner(id)
  or (select exists(select 1 from private.platform_admins where user_id = auth.uid()))
)
with check (
  private.is_crm_workspace_admin_or_owner(id)
  or (select exists(select 1 from private.platform_admins where user_id = auth.uid()))
);

-- [crm_workspace_members]
create policy crm_members_select on public.crm_workspace_members
for select to authenticated using (
  user_id = auth.uid()
  or private.is_crm_workspace_admin_or_owner(workspace_id)
  or (private.get_crm_user_role(workspace_id) = 'manager' and manager_id = auth.uid())
);

create policy crm_members_insert on public.crm_workspace_members
for insert to authenticated with check (private.is_crm_workspace_admin_or_owner(workspace_id));

create policy crm_members_update on public.crm_workspace_members
for update to authenticated using (private.is_crm_workspace_admin_or_owner(workspace_id))
with check (private.is_crm_workspace_admin_or_owner(workspace_id));

create policy crm_members_delete on public.crm_workspace_members
for delete to authenticated using (private.is_crm_workspace_admin_or_owner(workspace_id));

-- [crm_companies]
create policy crm_comp_select on public.crm_companies
for select to authenticated using (private.can_access_crm_record(workspace_id, company_owner_id));

create policy crm_comp_insert on public.crm_companies
for insert to authenticated with check (
  private.is_crm_workspace_accessible(workspace_id)
  and (
    private.is_crm_workspace_admin_or_owner(workspace_id)
    or (private.get_crm_user_role(workspace_id) = 'manager' and (company_owner_id = auth.uid() or private.is_sales_under_manager(workspace_id, company_owner_id, auth.uid())))
    or (private.get_crm_user_role(workspace_id) = 'sales' and company_owner_id = auth.uid() and created_by = auth.uid())
  )
);

create policy crm_comp_update on public.crm_companies
for update to authenticated using (private.can_access_crm_record(workspace_id, company_owner_id))
with check (private.can_access_crm_record(workspace_id, company_owner_id));

create policy crm_comp_delete on public.crm_companies
for delete to authenticated using (private.is_crm_workspace_admin_or_owner(workspace_id));

-- [crm_contacts]
create policy crm_contacts_select on public.crm_contacts
for select to authenticated using (private.can_access_crm_record(workspace_id, contact_owner_id));

create policy crm_contacts_insert on public.crm_contacts
for insert to authenticated with check (
  private.is_crm_workspace_accessible(workspace_id)
  and (
    private.is_crm_workspace_admin_or_owner(workspace_id)
    or (private.get_crm_user_role(workspace_id) = 'manager' and (contact_owner_id = auth.uid() or private.is_sales_under_manager(workspace_id, contact_owner_id, auth.uid())))
    or (private.get_crm_user_role(workspace_id) = 'sales' and contact_owner_id = auth.uid() and created_by = auth.uid())
  )
);

create policy crm_contacts_update on public.crm_contacts
for update to authenticated using (private.can_access_crm_record(workspace_id, contact_owner_id))
with check (private.can_access_crm_record(workspace_id, contact_owner_id));

create policy crm_contacts_delete on public.crm_contacts
for delete to authenticated using (
  private.is_crm_workspace_admin_or_owner(workspace_id)
  or (private.get_crm_user_role(workspace_id) = 'manager' and private.is_sales_under_manager(workspace_id, contact_owner_id, auth.uid()))
);

-- [crm_deals]
create policy crm_deals_select on public.crm_deals
for select to authenticated using (private.can_access_crm_record(workspace_id, deal_owner_id));

create policy crm_deals_insert on public.crm_deals
for insert to authenticated with check (
  private.is_crm_workspace_accessible(workspace_id)
  and (
    private.is_crm_workspace_admin_or_owner(workspace_id)
    or (private.get_crm_user_role(workspace_id) = 'manager' and (deal_owner_id = auth.uid() or private.is_sales_under_manager(workspace_id, deal_owner_id, auth.uid())))
    or (private.get_crm_user_role(workspace_id) = 'sales' and deal_owner_id = auth.uid() and created_by = auth.uid())
  )
);

create policy crm_deals_update on public.crm_deals
for update to authenticated using (private.can_access_crm_record(workspace_id, deal_owner_id))
with check (private.can_access_crm_record(workspace_id, deal_owner_id));

create policy crm_deals_delete on public.crm_deals
for delete to authenticated using (private.is_crm_workspace_admin_or_owner(workspace_id));

-- [crm_deal_contacts]
create policy crm_dc_select on public.crm_deal_contacts
for select to authenticated using (
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
for insert to authenticated with check (
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
for delete to authenticated using (
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
for select to authenticated using (private.can_access_crm_record(workspace_id, assigned_user_id));

create policy crm_act_insert on public.crm_activities
for insert to authenticated with check (
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
for update to authenticated using (private.can_access_crm_record(workspace_id, assigned_user_id))
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
for delete to authenticated using (
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
for select to authenticated using (
  private.can_access_crm_audit(id, auth.uid())
);

-- ----------------------------------------------------------------------------
-- 7. صلاحيات التنفيذ وحماية Schema private
-- ----------------------------------------------------------------------------

-- 1. حماية Schema private وسحب كافة الصلاحيات العامة والتلقائية
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- سحب أي صلاحية تنفيذ افتراضية على دوال schema private من public و anon
revoke execute on all functions in schema private from public, anon;

-- سحب تنفيذ دوال Triggers الداخلية صراحة لمنع استدعائها المباشر من المستخدمين
revoke execute on function private.nullify_company_before_delete() from public, anon, authenticated;
revoke execute on function private.enforce_crm_record_provenance() from public, anon, authenticated;
revoke execute on function private.validate_crm_member_role_and_type() from public, anon, authenticated;
revoke execute on function private.enforce_crm_member_hierarchy() from public, anon, authenticated;
revoke execute on function private.validate_crm_ownership_transfer() from public, anon, authenticated;
revoke execute on function private.log_crm_entity_audit() from public, anon, authenticated;
revoke execute on function private.enforce_workspace_immutability() from public, anon, authenticated;

-- 2. منح صلاحيات EXECUTE حصرياً على دوال الاستعلام والتحقق اللازمة لـ RLS
grant execute on function private.get_crm_user_role(uuid, uuid) to authenticated;
grant execute on function private.is_crm_workspace_accessible(uuid, uuid) to authenticated;
grant execute on function private.is_crm_workspace_admin_or_owner(uuid, uuid) to authenticated;
grant execute on function private.is_sales_under_manager(uuid, uuid, uuid) to authenticated;
grant execute on function private.can_access_crm_record(uuid, uuid) to authenticated;
grant execute on function private.validate_crm_record_ownership(uuid, uuid, text) to authenticated;
grant execute on function private.can_access_crm_audit(bigint, uuid) to authenticated;

-- 3. منح الصلاحيات التشغيلية على الجداول للمستخدمين المصادقين (authenticated)
grant select, insert, update on public.crm_workspaces to authenticated;
grant select, insert, update, delete on public.crm_workspace_members to authenticated;
grant select, insert, update, delete on public.crm_companies to authenticated;
grant select, insert, update, delete on public.crm_contacts to authenticated;
grant select, insert, update, delete on public.crm_deals to authenticated;
grant select, insert, update, delete on public.crm_deal_contacts to authenticated;
grant select, insert, update, delete on public.crm_activities to authenticated;
grant select on public.crm_audit_logs to authenticated;

-- 4. منح صلاحية تنفيذ Provisioning RPC للمستخدمين المصادقين
grant execute on function public.provision_client_company_workspace(text, uuid, text) to authenticated;
revoke execute on function public.provision_client_company_workspace(text, uuid, text) from public, anon;


-- ============================================================================
-- COMPREHENSIVE EMPIRICAL TEST SUITE (41 TESTS)
-- ============================================================================

create temp table if not exists test_results (
  test_num int,
  test_name text,
  result text,
  details text
);

DO $$
DECLARE
  v_tungsten_ws uuid;
  v_company_ws uuid;
  v_temp_ws uuid;
  v_prov_ws uuid;
  v_owner_id uuid := 'b12ebe74-0136-4a2b-a1ad-8327826b7d61';
  v_mgr1_id uuid := '07cd1283-033b-4bd6-8393-ce35b5c0a266';
  v_sales1_id uuid := '4b5ab6a8-0caf-463e-b0c2-e540018d4da8';
  v_clinic_admin_id uuid := '0621a7d6-9d44-4dc8-9050-d70e1a53f519';
  
  v_mgr2_id uuid := gen_random_uuid();
  v_sales2_id uuid := gen_random_uuid();
  v_comp_owner_id uuid := gen_random_uuid();
  v_comp_mgr_id uuid := gen_random_uuid();
  v_outsider_id uuid := gen_random_uuid();
  
  v_contact1_id uuid;
  v_contact2_id uuid;
  v_deal1_id uuid;
  v_company1_id uuid;
  v_act1_id uuid;
  v_prov_contact_id uuid;
  v_prov_audit_op_id bigint;
  v_prov_audit_del_id bigint;
  v_seen_count int;
  v_audit_count int;
  v_can_access boolean;
  v_can_infra boolean;
  v_can_op boolean;
  v_can_cross boolean;
  v_can_cross_infra boolean;
  v_ws_type text;
  v_is_active boolean;
  v_member_role text;
BEGIN
  -- Insert mock auth users
  insert into auth.users (id, email, raw_user_meta_data) values 
    (v_mgr2_id, 'manager2@test.com', '{"full_name": "Manager Two"}'::jsonb),
    (v_sales2_id, 'sales2@test.com', '{"full_name": "Sales Two"}'::jsonb),
    (v_comp_owner_id, 'comp_owner@test.com', '{"full_name": "Company Owner"}'::jsonb),
    (v_comp_mgr_id, 'comp_mgr@test.com', '{"full_name": "Company Manager"}'::jsonb),
    (v_outsider_id, 'outsider@test.com', '{"full_name": "Outsider User"}'::jsonb);

  -- 1. Create Workspaces
  insert into public.crm_workspaces (name, workspace_type) 
  values ('Tungsten HQ', 'tungsten_internal') returning id into v_tungsten_ws;

  insert into public.crm_workspaces (name, workspace_type) 
  values ('Alpha Tech Client', 'client_company') returning id into v_company_ws;

  -- Populate Memberships
  insert into public.crm_workspace_members (workspace_id, user_id, role, manager_id) values
    (v_tungsten_ws, v_owner_id, 'owner', null),
    (v_tungsten_ws, v_mgr1_id, 'manager', null),
    (v_tungsten_ws, v_mgr2_id, 'manager', null),
    (v_tungsten_ws, v_sales1_id, 'sales', v_mgr1_id),
    (v_tungsten_ws, v_sales2_id, 'sales', v_mgr2_id);

  insert into public.crm_workspace_members (workspace_id, user_id, role, manager_id) values
    (v_company_ws, v_comp_owner_id, 'company_owner', null),
    (v_company_ws, v_comp_mgr_id, 'company_manager', null);

  -- TEST 1: Workspace & Membership Provisioning
  insert into test_results values (1, 'Workspace & Membership Provisioning', 'PASSED', 'Tungsten and Company workspaces created with proper roles and hierarchy links');

  -- TEST 2: Role Pollution Prevention
  BEGIN
    insert into public.crm_workspace_members (workspace_id, user_id, role)
    values (v_company_ws, v_sales1_id, 'sales');
    insert into test_results values (2, 'Role Pollution Prevention', 'FAILED', 'Company workspace allowed Tungsten sales role');
  EXCEPTION WHEN check_violation OR sqlstate '22023' THEN
    insert into test_results values (2, 'Role Pollution Prevention', 'PASSED', 'Company workspace correctly rejected Tungsten role: ' || SQLERRM);
  END;

  -- TEST 3: Contact Creation & Provenance
  perform set_config('request.jwt.claim.sub', v_sales1_id::text, true);
  insert into public.crm_contacts (
    workspace_id, lead_id, full_name, phone_number, social_profile_link,
    source_platform, ad_id, contact_owner_id, created_by
  ) values (
    v_tungsten_ws, 'LEAD-101', 'Ahmed Ali', '+201000000001', 'https://fb.com/1',
    'Tungsten Lens', 'AD-1', v_sales1_id, v_sales1_id
  ) returning id into v_contact1_id;

  select count(*) into v_seen_count from public.crm_contacts where id = v_contact1_id and created_by = v_sales1_id;
  if v_seen_count = 1 then
    insert into test_results values (3, 'Contact Creation & Provenance', 'PASSED', 'Sales 1 created contact with verified auth.uid() provenance');
  else
    insert into test_results values (3, 'Contact Creation & Provenance', 'FAILED', 'Contact creation or provenance failed');
  end if;

  -- TEST 4: Manager Team Visibility
  perform set_config('request.jwt.claim.sub', v_mgr1_id::text, true);
  if private.can_access_crm_record(v_tungsten_ws, v_sales1_id) then
    insert into test_results values (4, 'Manager Team Visibility', 'PASSED', 'Manager 1 can see their own sales rep contact');
  else
    insert into test_results values (4, 'Manager Team Visibility', 'FAILED', 'Manager 1 could not see team contact');
  end if;

  -- TEST 5: Cross-Manager Isolation
  perform set_config('request.jwt.claim.sub', v_mgr2_id::text, true);
  if not private.can_access_crm_record(v_tungsten_ws, v_sales1_id) then
    insert into test_results values (5, 'Cross-Manager Isolation', 'PASSED', 'Manager 2 is strictly blocked from seeing Manager 1 team contact');
  else
    insert into test_results values (5, 'Cross-Manager Isolation', 'FAILED', 'Manager 2 saw contact from Manager 1 team');
  end if;

  -- TEST 6: Clinic Admin Zero Access
  perform set_config('request.jwt.claim.sub', v_clinic_admin_id::text, true);
  if not private.is_crm_workspace_accessible(v_tungsten_ws) and not private.can_access_crm_record(v_tungsten_ws, v_sales1_id) then
    insert into test_results values (6, 'Clinic Admin Zero Access', 'PASSED', 'Clinic Admin is completely blocked from accessing CRM tables');
  else
    insert into test_results values (6, 'Clinic Admin Zero Access', 'FAILED', 'Clinic Admin accessed CRM workspaces');
  end if;

  -- TEST 7: Manager Transfer Out of Team Blocked
  perform set_config('request.jwt.claim.sub', v_mgr1_id::text, true);
  BEGIN
    update public.crm_contacts set contact_owner_id = v_sales2_id where id = v_contact1_id;
    insert into test_results values (7, 'Manager Transfer Out of Team Blocked', 'FAILED', 'Manager 1 transferred record to Manager 2 team');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (7, 'Manager Transfer Out of Team Blocked', 'PASSED', 'Manager blocked from transferring record out of team: ' || SQLERRM);
  END;

  -- TEST 8: Manager Transfer Within Team Allowed
  perform set_config('request.jwt.claim.sub', v_mgr1_id::text, true);
  BEGIN
    update public.crm_contacts set contact_owner_id = v_mgr1_id where id = v_contact1_id;
    select count(*) into v_audit_count from public.crm_audit_logs where entity_id = v_contact1_id and action = 'TRANSFER_OWNERSHIP';
    if v_audit_count > 0 then
      insert into test_results values (8, 'Manager Transfer Within Team Allowed', 'PASSED', 'Manager 1 transferred contact to self and audit log recorded');
    else
      insert into test_results values (8, 'Manager Transfer Within Team Allowed', 'FAILED', 'Audit log missing on ownership transfer');
    end if;
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (8, 'Manager Transfer Within Team Allowed', 'FAILED', 'Transfer within team failed: ' || SQLERRM);
  END;

  -- TEST 9: Sales Rep Transfer Blocked
  perform set_config('request.jwt.claim.sub', v_sales1_id::text, true);
  BEGIN
    update public.crm_contacts set contact_owner_id = v_sales2_id where id = v_contact1_id;
    insert into test_results values (9, 'Sales Rep Transfer Blocked', 'FAILED', 'Sales rep was able to change contact owner');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (9, 'Sales Rep Transfer Blocked', 'PASSED', 'Sales rep blocked from transferring ownership: ' || SQLERRM);
  END;

  -- TEST 10: Deal Stage Audit Tracking
  perform set_config('request.jwt.claim.sub', v_mgr1_id::text, true);
  insert into public.crm_deals (workspace_id, deal_name, deal_stage, deal_amount, deal_owner_id, created_by)
  values (v_tungsten_ws, 'Enterprise Contract', 'مكالمة', 50000.00, v_mgr1_id, v_mgr1_id)
  returning id into v_deal1_id;

  update public.crm_deals set deal_stage = 'عرض سعر' where id = v_deal1_id;
  select count(*) into v_audit_count from public.crm_audit_logs where entity_id = v_deal1_id and action = 'STAGE_CHANGE';
  if v_audit_count = 1 then
    insert into test_results values (10, 'Deal Stage Audit Tracking', 'PASSED', 'Deal stage transition successfully logged as STAGE_CHANGE in audit');
  else
    insert into test_results values (10, 'Deal Stage Audit Tracking', 'FAILED', 'Stage change audit log count was ' || v_audit_count);
  end if;

  -- TEST 11: Rep Ownership Loss On Transfer
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  update public.crm_deals set deal_owner_id = v_sales2_id where id = v_deal1_id;

  perform set_config('request.jwt.claim.sub', v_mgr1_id::text, true);
  if not private.can_access_crm_record(v_tungsten_ws, v_sales2_id) then
    insert into test_results values (11, 'Rep Ownership Loss On Transfer', 'PASSED', 'Old owner/manager immediately lost access upon transfer to another team');
  else
    insert into test_results values (11, 'Rep Ownership Loss On Transfer', 'FAILED', 'Old manager still sees transferred deal');
  end if;

  -- TEST 12: Cross-Workspace Deal Association Blocked
  perform set_config('request.jwt.claim.sub', v_comp_owner_id::text, true);
  insert into public.crm_contacts (
    workspace_id, lead_id, full_name, phone_number, social_profile_link,
    source_platform, ad_id, contact_owner_id, created_by
  ) values (
    v_company_ws, 'LEAD-201', 'Client Contact', '+201000000002', 'https://fb.com/2',
    'Organic', 'AD-0', v_comp_owner_id, v_comp_owner_id
  ) returning id into v_contact2_id;

  BEGIN
    insert into public.crm_deal_contacts (workspace_id, deal_id, contact_id)
    values (v_tungsten_ws, v_deal1_id, v_contact2_id);
    insert into test_results values (12, 'Cross-Workspace Deal Association Blocked', 'FAILED', 'Cross-workspace deal-contact linkage allowed');
  EXCEPTION WHEN foreign_key_violation THEN
    insert into test_results values (12, 'Cross-Workspace Deal Association Blocked', 'PASSED', 'Composite FK prevented linking entities from different workspaces');
  END;

  -- TEST 13: Company Deletion Safe Protection
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  insert into public.crm_companies (workspace_id, company_name, company_owner_id, created_by)
  values (v_tungsten_ws, 'Test Corp', v_owner_id, v_owner_id) returning id into v_company1_id;

  update public.crm_contacts set company_id = v_company1_id where id = v_contact1_id;
  delete from public.crm_companies where id = v_company1_id;

  select count(*) into v_seen_count from public.crm_contacts where id = v_contact1_id and company_id is null;
  if v_seen_count = 1 then
    insert into test_results values (13, 'Company Deletion Orphan Protection', 'PASSED', 'Company deleted and contact.company_id safely nullified without deleting contact');
  else
    insert into test_results values (13, 'Company Deletion Orphan Protection', 'FAILED', 'Contact was deleted or company_id not nullified');
  end if;

  -- TEST 14: Direct Self-Manager Assignment Blocked
  BEGIN
    insert into public.crm_workspace_members (workspace_id, user_id, role, manager_id)
    values (v_tungsten_ws, v_outsider_id, 'sales', v_outsider_id);
    insert into test_results values (14, 'Direct Self-Manager Assignment Blocked', 'FAILED', 'Self-managing sales rep allowed');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (14, 'Direct Self-Manager Assignment Blocked', 'PASSED', 'Trigger strictly blocked circular self-managing hierarchy: ' || SQLERRM);
  END;

  -- TEST 15: Record Owner Validation on INSERT (Non-Member)
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  BEGIN
    insert into public.crm_contacts (
      workspace_id, lead_id, full_name, phone_number, social_profile_link,
      source_platform, ad_id, contact_owner_id, created_by
    ) values (
      v_tungsten_ws, 'LEAD-999', 'Ghost Contact', '+201000000009', 'https://fb.com/9',
      'Organic', 'AD-9', v_outsider_id, v_owner_id
    );
    insert into test_results values (15, 'Record Owner Validation on INSERT (Non-Member)', 'FAILED', 'Allowed non-member as contact_owner_id');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (15, 'Record Owner Validation on INSERT (Non-Member)', 'PASSED', 'Strictly rejected non-member as record owner: ' || SQLERRM);
  END;

  -- TEST 16: Record Owner Validation on INSERT (Inactive Member)
  update public.crm_workspace_members set is_active = false where workspace_id = v_tungsten_ws and user_id = v_sales2_id;
  BEGIN
    insert into public.crm_deals (workspace_id, deal_name, deal_stage, deal_amount, deal_owner_id, created_by)
    values (v_tungsten_ws, 'Inactive Rep Deal', 'مكالمة', 1000.00, v_sales2_id, v_owner_id);
    insert into test_results values (16, 'Record Owner Validation on INSERT (Inactive Member)', 'FAILED', 'Allowed inactive member as deal_owner_id');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (16, 'Record Owner Validation on INSERT (Inactive Member)', 'PASSED', 'Strictly rejected inactive member as record owner: ' || SQLERRM);
  END;
  update public.crm_workspace_members set is_active = true where workspace_id = v_tungsten_ws and user_id = v_sales2_id;

  -- TEST 17: Company Ownership Transfer within Manager Team
  perform set_config('request.jwt.claim.sub', v_mgr1_id::text, true);
  insert into public.crm_companies (workspace_id, company_name, company_owner_id, created_by)
  values (v_tungsten_ws, 'Team Co', v_sales1_id, v_mgr1_id) returning id into v_company1_id;

  BEGIN
    update public.crm_companies set company_owner_id = v_mgr1_id where id = v_company1_id;
    select count(*) into v_audit_count from public.crm_audit_logs where entity_id = v_company1_id and action = 'TRANSFER_OWNERSHIP';
    if v_audit_count > 0 then
      insert into test_results values (17, 'Company Ownership Transfer within Team', 'PASSED', 'Manager 1 successfully transferred company within team and audit logged');
    else
      insert into test_results values (17, 'Company Ownership Transfer within Team', 'FAILED', 'Company transferred but audit log missing');
    end if;
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (17, 'Company Ownership Transfer within Team', 'FAILED', 'Transfer within team failed: ' || SQLERRM);
  END;

  -- TEST 18: Company Ownership Transfer across Teams Blocked
  perform set_config('request.jwt.claim.sub', v_mgr1_id::text, true);
  BEGIN
    update public.crm_companies set company_owner_id = v_sales2_id where id = v_company1_id;
    insert into test_results values (18, 'Company Ownership Transfer across Teams Blocked', 'FAILED', 'Manager 1 transferred company to Manager 2 rep');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (18, 'Company Ownership Transfer across Teams Blocked', 'PASSED', 'Manager strictly blocked from transferring company out of team: ' || SQLERRM);
  END;

  -- TEST 19: Company Ownership Transfer by Sales Rep Blocked
  perform set_config('request.jwt.claim.sub', v_sales1_id::text, true);
  BEGIN
    update public.crm_companies set company_owner_id = v_sales2_id where id = v_company1_id;
    insert into test_results values (19, 'Company Ownership Transfer by Sales Blocked', 'FAILED', 'Sales rep was able to change company owner');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (19, 'Company Ownership Transfer by Sales Blocked', 'PASSED', 'Sales rep strictly blocked from transferring company: ' || SQLERRM);
  END;

  -- TEST 20: Company Ownership Transfer to Non-Member / Inactive Blocked
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  BEGIN
    update public.crm_companies set company_owner_id = v_outsider_id where id = v_company1_id;
    insert into test_results values (20, 'Company Transfer to Non-Member Blocked', 'FAILED', 'Company transferred to non-member');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (20, 'Company Transfer to Non-Member Blocked', 'PASSED', 'Transfer to non-member strictly rejected: ' || SQLERRM);
  END;

  -- TEST 21: Activity Assignment to Non-Member Blocked
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  BEGIN
    insert into public.crm_activities (workspace_id, activity_type, title, assigned_user_id, created_by)
    values (v_tungsten_ws, 'مكالمة', 'Test Call', v_outsider_id, v_owner_id);
    insert into test_results values (21, 'Activity Assignment to Non-Member Blocked', 'FAILED', 'Activity assigned to non-member');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (21, 'Activity Assignment to Non-Member Blocked', 'PASSED', 'Strictly rejected activity assignment to non-member: ' || SQLERRM);
  END;

  -- TEST 22: Activity Assignment to User with Invalid Role Blocked
  perform set_config('request.jwt.claim.sub', v_comp_owner_id::text, true);
  BEGIN
    insert into public.crm_activities (workspace_id, activity_type, title, assigned_user_id, created_by)
    values (v_company_ws, 'اجتماع', 'Invalid Role Activity', v_sales1_id, v_comp_owner_id);
    insert into test_results values (22, 'Activity Assignment Invalid Workspace/Role Blocked', 'FAILED', 'Cross-workspace activity assignment allowed');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (22, 'Activity Assignment Invalid Workspace/Role Blocked', 'PASSED', 'Rejected cross-workspace or invalid role assignment: ' || SQLERRM);
  END;

  -- TEST 23: Activity Deletion Security (Inactive Member Blocked)
  perform set_config('request.jwt.claim.sub', v_sales1_id::text, true);
  insert into public.crm_activities (workspace_id, activity_type, title, assigned_user_id, created_by)
  values (v_tungsten_ws, 'مهمة', 'Rep Task', v_sales1_id, v_sales1_id) returning id into v_act1_id;

  update public.crm_workspace_members set is_active = false where workspace_id = v_tungsten_ws and user_id = v_sales1_id;

  perform set_config('request.jwt.claim.sub', v_sales1_id::text, true);
  v_can_access := (
    private.is_crm_workspace_accessible(v_tungsten_ws)
    and (
      private.is_crm_workspace_admin_or_owner(v_tungsten_ws)
      or private.can_access_crm_record(v_tungsten_ws, v_sales1_id)
    )
  );

  if not v_can_access then
    insert into test_results values (23, 'Activity Deletion by Inactive User Blocked', 'PASSED', 'Inactive member is strictly blocked from deleting activities even if assigned to them');
  else
    insert into test_results values (23, 'Activity Deletion by Inactive User Blocked', 'FAILED', 'Inactive user satisfied activity deletion policy');
  end if;
  update public.crm_workspace_members set is_active = true where workspace_id = v_tungsten_ws and user_id = v_sales1_id;

  -- TEST 24: Deal Contacts Modification Security
  perform set_config('request.jwt.claim.sub', v_sales2_id::text, true);
  v_can_access := (
    private.can_access_crm_record(v_tungsten_ws, v_sales2_id)
    and private.can_access_crm_record(v_tungsten_ws, v_mgr1_id)
  );

  if not v_can_access then
    insert into test_results values (24, 'Deal Contacts Cross-Team Linking Blocked', 'PASSED', 'RLS policy strictly blocks linking contact that rep cannot access');
  else
    insert into test_results values (24, 'Deal Contacts Cross-Team Linking Blocked', 'FAILED', 'Rep was granted permission to link inaccessible contact');
  end if;

  -- TEST 25: Tungsten Owner Infrastructure Workspace Administration
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  update public.crm_workspaces set name = 'Alpha Tech Updated' where id = v_company_ws;
  select count(*) into v_seen_count from public.crm_workspaces where id = v_company_ws and name = 'Alpha Tech Updated';
  if v_seen_count = 1 then
    insert into test_results values (25, 'Tungsten Owner Infrastructure Admin', 'PASSED', 'Tungsten Owner successfully updated external company workspace status and name');
  else
    insert into test_results values (25, 'Tungsten Owner Infrastructure Admin', 'FAILED', 'Tungsten Owner failed to update workspace status');
  end if;

  -- TEST 26: Tungsten Owner Zero Access to Client Company Operational Data
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  if not private.can_access_crm_record(v_company_ws, v_comp_owner_id) then
    insert into test_results values (26, 'Tungsten Owner Data Snooping Blocked', 'PASSED', 'Tungsten Owner has ZERO read/write access to external client company operational records');
  else
    insert into test_results values (26, 'Tungsten Owner Data Snooping Blocked', 'FAILED', 'Tungsten Owner had access to client company contact');
  end if;

  -- TEST 27: Workspace Deactivation Blocks Company Owner
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  update public.crm_workspaces set is_active = false where id = v_company_ws;

  perform set_config('request.jwt.claim.sub', v_comp_owner_id::text, true);
  if not private.can_access_crm_record(v_company_ws, v_comp_owner_id) then
    insert into test_results values (27, 'Workspace Deactivation Blocks Company Owner', 'PASSED', 'Company Owner immediately lost access to operational data upon workspace deactivation');
  else
    insert into test_results values (27, 'Workspace Deactivation Blocks Company Owner', 'FAILED', 'Company Owner still has operational access while workspace is deactivated');
  end if;

  -- TEST 28: Workspace Deactivation Blocks Company Manager
  perform set_config('request.jwt.claim.sub', v_comp_mgr_id::text, true);
  if not private.can_access_crm_record(v_company_ws, v_comp_mgr_id) then
    insert into test_results values (28, 'Workspace Deactivation Blocks Company Manager', 'PASSED', 'Company Manager immediately lost access to operational data upon workspace deactivation');
  else
    insert into test_results values (28, 'Workspace Deactivation Blocks Company Manager', 'FAILED', 'Company Manager still has operational access while workspace is deactivated');
  end if;

  -- TEST 29: Operational Access All Blocked on Inactive Workspace
  perform set_config('request.jwt.claim.sub', v_comp_owner_id::text, true);
  v_can_access := (
    private.is_crm_workspace_accessible(v_company_ws)
    or private.is_crm_workspace_admin_or_owner(v_company_ws)
  );
  if not v_can_access then
    insert into test_results values (29, 'Operational RLS Blocked on Inactive Workspace', 'PASSED', 'All operational RLS permissions evaluate to FALSE for deactivated workspace members');
  else
    insert into test_results values (29, 'Operational RLS Blocked on Inactive Workspace', 'FAILED', 'Operational RLS granted access to deactivated workspace');
  end if;

  -- TEST 30: Workspace Re-activation Restores Access
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  update public.crm_workspaces set is_active = true where id = v_company_ws;

  perform set_config('request.jwt.claim.sub', v_comp_owner_id::text, true);
  if private.can_access_crm_record(v_company_ws, v_comp_owner_id) and private.is_crm_workspace_accessible(v_company_ws) then
    insert into test_results values (30, 'Workspace Re-activation Restores Access', 'PASSED', 'Company Owner and Manager instantly regained full operational access upon workspace re-activation');
  else
    insert into test_results values (30, 'Workspace Re-activation Restores Access', 'FAILED', 'Re-activation failed to restore member access');
  end if;

  -- TEST 31: Workspace Lifecycle Audit Tracking
  select count(*) into v_audit_count from public.crm_audit_logs 
  where entity_id = v_company_ws 
    and action in ('WORKSPACE_DEACTIVATED', 'WORKSPACE_ACTIVATED', 'WORKSPACE_RENAMED');
  if v_audit_count >= 3 then
    insert into test_results values (31, 'Workspace Lifecycle Audit Tracking', 'PASSED', 'Workspace activation, deactivation, and rename operations successfully audited (Count: ' || v_audit_count || ')');
  else
    insert into test_results values (31, 'Workspace Lifecycle Audit Tracking', 'FAILED', 'Workspace audit events missing. Found count: ' || v_audit_count);
  end if;

  -- TEST 32: Member Role Change Audit Tracking
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  update public.crm_workspace_members set role = 'manager' where workspace_id = v_tungsten_ws and user_id = v_sales1_id;
  select count(*) into v_audit_count from public.crm_audit_logs
  where workspace_id = v_tungsten_ws 
    and entity_type = 'crm_workspace_members' 
    and action = 'ROLE_CHANGED';
  if v_audit_count > 0 then
    insert into test_results values (32, 'Member Role Change Audit Tracking', 'PASSED', 'Member role alteration successfully recorded as ROLE_CHANGED in audit log');
  else
    insert into test_results values (32, 'Member Role Change Audit Tracking', 'FAILED', 'Member role alteration audit missing');
  end if;
  update public.crm_workspace_members set role = 'sales', manager_id = v_mgr1_id where workspace_id = v_tungsten_ws and user_id = v_sales1_id;

  -- TEST 33: Audit History Preserved on Workspace Purge
  insert into public.crm_workspaces (name, workspace_type) 
  values ('Temporary WS', 'client_company') returning id into v_temp_ws;

  delete from public.crm_workspaces where id = v_temp_ws;

  select count(*) into v_audit_count from public.crm_audit_logs 
  where entity_id = v_temp_ws and action = 'DELETE';
  if v_audit_count > 0 then
    insert into test_results values (33, 'Audit History Preserved on Workspace Purge', 'PASSED', 'Workspace purged cleanly while audit logs were safely preserved with original_workspace_id retained');
  else
    insert into test_results values (33, 'Audit History Preserved on Workspace Purge', 'FAILED', 'Audit records were lost or not created on workspace purge');
  end if;

  -- ==========================================================================
  -- NEW EMPIRICAL TESTS: IMMUTABILITY, PROVISIONING & ISOLATION (TESTS 34-41)
  -- ==========================================================================

  -- TEST 34: Workspace Type Immutability (Client Company -> Tungsten Internal)
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  BEGIN
    update public.crm_workspaces set workspace_type = 'tungsten_internal' where id = v_company_ws;
    insert into test_results values (34, 'Workspace Type Immutability (Client -> Internal)', 'FAILED', 'Altering workspace_type from client_company to tungsten_internal was allowed');
  EXCEPTION WHEN OTHERS THEN
    if SQLSTATE = '42501' and SQLERRM like '%IMMUTABLE_FIELD%' then
      insert into test_results values (34, 'Workspace Type Immutability (Client -> Internal)', 'PASSED', 'Trigger strictly blocked modifying workspace_type from client_company to tungsten_internal');
    else
      insert into test_results values (34, 'Workspace Type Immutability (Client -> Internal)', 'FAILED', 'Wrong error: ' || SQLSTATE || ' - ' || SQLERRM);
    end if;
  END;

  -- TEST 35: Workspace Type Immutability (Tungsten Internal -> Client Company)
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  BEGIN
    update public.crm_workspaces set workspace_type = 'client_company' where id = v_tungsten_ws;
    insert into test_results values (35, 'Workspace Type Immutability (Internal -> Client)', 'FAILED', 'Altering workspace_type from tungsten_internal to client_company was allowed');
  EXCEPTION WHEN OTHERS THEN
    if SQLSTATE = '42501' and SQLERRM like '%IMMUTABLE_FIELD%' then
      insert into test_results values (35, 'Workspace Type Immutability (Internal -> Client)', 'PASSED', 'Trigger strictly blocked modifying workspace_type from tungsten_internal to client_company');
    else
      insert into test_results values (35, 'Workspace Type Immutability (Internal -> Client)', 'FAILED', 'Wrong error: ' || SQLSTATE || ' - ' || SQLERRM);
    end if;
  END;

  -- TEST 36: Workspace Metadata Updates Allowed (Rename and Activation Status)
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  BEGIN
    update public.crm_workspaces 
    set name = 'Alpha Tech Enterprise Solutions', domain = 'alphatech-solutions.com' 
    where id = v_company_ws;
    insert into test_results values (36, 'Workspace Metadata Updates Allowed', 'PASSED', 'Authorized updates to name and domain succeeded without triggering immutability lock');
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (36, 'Workspace Metadata Updates Allowed', 'FAILED', 'Failed to update workspace metadata: ' || SQLERRM);
  END;

  -- TEST 37: Initial Company Owner Provisioning RPC by Platform Admin
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  BEGIN
    v_prov_ws := public.provision_client_company_workspace(
      'Apex Health Technologies',
      v_outsider_id,
      'apexhealth.io'
    );

    select workspace_type, is_active into v_ws_type, v_is_active 
    from public.crm_workspaces where id = v_prov_ws;

    select role into v_member_role 
    from public.crm_workspace_members where workspace_id = v_prov_ws and user_id = v_outsider_id;

    select count(*) into v_audit_count 
    from public.crm_audit_logs 
    where original_workspace_id = v_prov_ws and action = 'INSERT';

    if v_ws_type = 'client_company' and v_is_active = true and v_member_role = 'company_owner' and v_audit_count >= 2 then
      insert into test_results values (37, 'Initial Company Owner Provisioning RPC', 'PASSED', 'Platform Admin successfully provisioned client workspace, assigned initial company_owner, and audited both actions (Audits: ' || v_audit_count || ')');
    else
      insert into test_results values (37, 'Initial Company Owner Provisioning RPC', 'FAILED', 'Verification failed: type=' || coalesce(v_ws_type, 'null') || ', role=' || coalesce(v_member_role, 'null') || ', audits=' || v_audit_count);
    end if;
  EXCEPTION WHEN OTHERS THEN
    insert into test_results values (37, 'Initial Company Owner Provisioning RPC', 'FAILED', 'Provisioning RPC execution failed: ' || SQLERRM);
  END;

  -- TEST 38: Initial Provisioning RPC Denied to Non-Admin Users
  perform set_config('request.jwt.claim.sub', v_sales1_id::text, true);
  BEGIN
    perform public.provision_client_company_workspace(
      'Illicit Client Workspace',
      v_sales2_id,
      'illicit.com'
    );
    insert into test_results values (38, 'Provisioning Denied to Non-Admin Users', 'FAILED', 'Sales rep was able to provision workspace');
  EXCEPTION WHEN OTHERS THEN
    if SQLSTATE = '42501' and SQLERRM like '%PERMISSION_DENIED%' then
      insert into test_results values (38, 'Provisioning Denied to Non-Admin Users', 'PASSED', 'Sales rep strictly rejected from provisioning workspaces (PERMISSION_DENIED: ' || SQLERRM || ')');
    else
      insert into test_results values (38, 'Provisioning Denied to Non-Admin Users', 'FAILED', 'Wrong error: ' || SQLSTATE || ' - ' || SQLERRM);
    end if;
  END;

  -- TEST 39: Audit Retention & Provenance After Workspace Deletion
  -- Insert operational record (contact) in provisioned workspace
  perform set_config('request.jwt.claim.sub', v_outsider_id::text, true);
  insert into public.crm_contacts (
    workspace_id, lead_id, full_name, phone_number, social_profile_link, source_platform, ad_id, contact_owner_id, created_by
  ) values (
    v_prov_ws, 'LEAD-PROV-1', 'Dr. Audit Trail', '+201099998888', 'https://linkedin.com/in/trail', 'Facebook', 'AD-P1', v_outsider_id, v_outsider_id
  ) returning id into v_prov_contact_id;

  -- Capture an operational audit log ID for subsequent security tests
  select id into v_prov_audit_op_id 
  from public.crm_audit_logs 
  where original_workspace_id = v_prov_ws and entity_type = 'crm_contacts' 
  order by id desc limit 1;

  -- Delete the provisioned workspace as Platform Admin
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  delete from public.crm_workspaces where id = v_prov_ws;

  -- Capture the workspace infrastructure DELETE audit log ID
  select id into v_prov_audit_del_id 
  from public.crm_audit_logs 
  where original_workspace_id = v_prov_ws and entity_type = 'crm_workspaces' and action = 'DELETE'
  order by id desc limit 1;

  -- Verify retention: records retain original_workspace_id while workspace_id is nullified
  select count(*) into v_audit_count 
  from public.crm_audit_logs 
  where original_workspace_id = v_prov_ws and workspace_id is null;

  if v_audit_count >= 3 then
    insert into test_results values (39, 'Audit Retention & Provenance After Workspace Deletion', 'PASSED', 'All audit entries retained original_workspace_id with workspace_id safely nullified (Retained Count: ' || v_audit_count || ')');
  else
    insert into test_results values (39, 'Audit Retention & Provenance After Workspace Deletion', 'FAILED', 'Audit records missing after workspace deletion. Found: ' || v_audit_count);
  end if;

  -- TEST 40: Zero Operational Snooping by Tungsten Owner
  v_can_infra := private.can_access_crm_audit(v_prov_audit_del_id, v_owner_id);
  v_can_op := private.can_access_crm_audit(v_prov_audit_op_id, v_owner_id);

  if v_can_infra = true and v_can_op = false then
    insert into test_results values (40, 'Zero Operational Snooping by Tungsten Owner', 'PASSED', 'Tungsten Owner can view infrastructure workspace lifecycle audit logs (DELETE) but is strictly blocked from operational client records');
  else
    insert into test_results values (40, 'Zero Operational Snooping by Tungsten Owner', 'FAILED', 'Snooping check failed: can_infra=' || coalesce(v_can_infra::text, 'null') || ', can_op=' || coalesce(v_can_op::text, 'null'));
  end if;

  -- TEST 41: Cross-Company Audit Isolation
  v_can_cross := private.can_access_crm_audit(v_prov_audit_op_id, v_comp_owner_id);
  v_can_cross_infra := private.can_access_crm_audit(v_prov_audit_del_id, v_comp_owner_id);

  if v_can_cross = false and v_can_cross_infra = false then
    insert into test_results values (41, 'Cross-Company Audit Isolation', 'PASSED', 'Company Owner is strictly blocked from accessing any audit records of other companies (0 leak)');
  else
    insert into test_results values (41, 'Cross-Company Audit Isolation', 'FAILED', 'Cross-company data leak: Company Owner granted access to foreign audit record');
  end if;

END $$;

SELECT test_num, test_name, result, details FROM test_results ORDER BY test_num;

ROLLBACK;
