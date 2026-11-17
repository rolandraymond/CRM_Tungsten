-- =============================================================================
-- Tungsten CRM — Complete Database Setup for Fresh Supabase Project
-- Generated: 2026-11-10T15:13:08.929Z
-- Contains exact 55 original migrations from repository
-- =============================================================================

-- =============================================================================
-- Migration: 20260923000100_create_clinics.sql
-- =============================================================================
create table public.clinics (
  id uuid primary key default gen_random_uuid(),

  name text not null
    check (length(trim(name)) > 0),

  created_at timestamptz not null default now(),

  archived_at timestamptz
);

alter table public.clinics enable row level security;

-- =============================================================================
-- Migration: 20260923132408_create_profiles_and_memberships.sql
-- =============================================================================
create table public.profiles (
  id uuid primary key
    references auth.users(id) on delete restrict,

  full_name text not null
    check (length(trim(full_name)) > 0),

  created_at timestamptz not null default now()
);

create table public.clinic_memberships (
  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  user_id uuid not null
    references public.profiles(id) on delete restrict,

  role text not null
    check (
      role in (
        'moderator',
        'agency_follow_up',
        'clinic_customer_service',
        'doctor',
        'clinic_manager'
      )
    ),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  primary key (clinic_id, user_id)
);

create index clinic_memberships_user_id_idx
  on public.clinic_memberships (user_id);

alter table public.profiles enable row level security;

alter table public.clinic_memberships enable row level security;

-- =============================================================================
-- Migration: 20260923133046_auto_create_profiles.sql
-- =============================================================================
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'New user'
    )
  );

  return new;
end;
$$;

revoke all on function public.handle_new_user()
from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- =============================================================================
-- Migration: 20260923140603_allow_read_own_profile.sql
-- =============================================================================
grant select on table public.profiles to authenticated;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
);

-- =============================================================================
-- Migration: 20260923140945_allow_read_assigned_clinics.sql
-- =============================================================================
-- Employees can read memberships, but cannot manage them.
revoke all privileges
on table public.clinic_memberships
from anon, authenticated;

grant select
on table public.clinic_memberships
to authenticated;

create policy memberships_select_own_active
on public.clinic_memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  and is_active = true
);


-- Employees can read their assigned clinics.
revoke all privileges
on table public.clinics
from anon, authenticated;

grant select
on table public.clinics
to authenticated;

create policy clinics_select_assigned
on public.clinics
for select
to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.clinic_memberships as membership
    where membership.clinic_id = clinics.id
      and membership.user_id = (select auth.uid())
      and membership.is_active = true
  )
);

-- =============================================================================
-- Migration: 20260923141227_add_platform_admin_access.sql
-- =============================================================================
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

-- =============================================================================
-- Migration: 20260923141509_create_contacts.sql
-- =============================================================================
create table public.contacts (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

full_name text not null
  check (length(trim(full_name)) > 0),

  phone text not null
    check (phone ~ '^\+[1-9][0-9]{7,14}$'),

  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now(),

  archived_at timestamptz,

  constraint contacts_clinic_phone_unique
    unique (clinic_id, phone),

  constraint contacts_clinic_id_id_unique
    unique (clinic_id, id)
);

alter table public.contacts enable row level security;

revoke all privileges
on table public.contacts
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923142045_require_user_full_name.sql
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_full_name text;
begin
  user_full_name :=
    trim(new.raw_user_meta_data ->> 'full_name');

  if user_full_name is null or user_full_name = '' then
    raise exception 'Full name is required'
      using errcode = '23514';
  end if;

  insert into public.profiles (id, full_name)
  values (
    new.id,
    user_full_name
  );

  return new;
end;
$$;

-- =============================================================================
-- Migration: 20260923142530_create_leads.sql
-- =============================================================================
create table public.leads (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  contact_id uuid not null,

  service_name text not null
    check (length(trim(service_name)) > 0),

    source text not null
    check (
        source in (
        'paid_instagram',
        'paid_facebook',
        'tiktok',
        'whatsapp',
        'organic_instagram',
        'organic_facebook',
        'website',
        'other'
        )
    ),

  status text not null default 'new'
    check (
      status in (
        'new',
        'in_progress',
        'no_answer',
        'follow_up',
        'converted',
        'not_interested'
      )
    ),

  notes text,

  assigned_to uuid,

  next_follow_up_at timestamptz,

  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now(),

  archived_at timestamptz,

  constraint leads_contact_same_clinic_fk
    foreign key (clinic_id, contact_id)
    references public.contacts (clinic_id, id)
    on delete restrict,

  constraint leads_assignee_same_clinic_fk
    foreign key (clinic_id, assigned_to)
    references public.clinic_memberships (clinic_id, user_id)
    on delete restrict,

  constraint leads_clinic_id_id_unique
    unique (clinic_id, id)
);

create index leads_contact_idx
  on public.leads (clinic_id, contact_id);

create index leads_clinic_status_idx
  on public.leads (clinic_id, status);

create index leads_assignee_follow_up_idx
  on public.leads (assigned_to, next_follow_up_at)
  where archived_at is null;

alter table public.leads enable row level security;

revoke all privileges
on table public.leads
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923184139_create_services_and_clinic_services.sql
-- =============================================================================
create table public.services (
  id uuid primary key default gen_random_uuid(),

  service_code text not null unique
    check (
      length(trim(service_code)) > 0
      and service_code = lower(trim(service_code))
    ),

  service_name text not null
    check (length(trim(service_name)) > 0),

  finance_service_id bigint unique,

  is_active boolean not null default true,

  created_at timestamptz not null default now()
);


create table public.clinic_services (
  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  service_id uuid not null
    references public.services(id) on delete restrict,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  primary key (clinic_id, service_id)
);

create index clinic_services_service_id_idx
  on public.clinic_services (service_id);


alter table public.services enable row level security;

alter table public.clinic_services enable row level security;

revoke all privileges
on table public.services, public.clinic_services
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923184600_link_leads_to_clinic_services.sql
-- =============================================================================
alter table public.leads
  add column requested_service_id uuid;

alter table public.leads
  add constraint leads_requested_service_same_clinic_fk
  foreign key (clinic_id, requested_service_id)
  references public.clinic_services (clinic_id, service_id)
  on delete restrict;

create index leads_requested_service_idx
  on public.leads (clinic_id, requested_service_id);

-- =============================================================================
-- Migration: 20260923185008_create_appointments.sql
-- =============================================================================
create table public.appointments (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  lead_id uuid not null,

  booked_service_id uuid not null,

  doctor_id uuid,

  starts_at timestamptz not null,

  ends_at timestamptz,

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'confirmed',
        'attended',
        'no_show',
        'cancelled'
      )
    ),

  booking_origin text not null
    check (booking_origin in ('agency', 'clinic')),

  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  confirmed_by uuid
    references public.profiles(id) on delete restrict,

  confirmed_at timestamptz,

  notes text,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  archived_at timestamptz,

  constraint appointments_time_order_check
    check (
      ends_at is null
      or ends_at > starts_at
    ),

  constraint appointments_confirmation_pair_check
    check (
      (confirmed_by is null and confirmed_at is null)
      or
      (confirmed_by is not null and confirmed_at is not null)
    ),

  constraint appointments_confirmed_status_check
    check (
      status <> 'confirmed'
      or confirmed_at is not null
    ),

  constraint appointments_lead_same_clinic_fk
    foreign key (clinic_id, lead_id)
    references public.leads (clinic_id, id)
    on delete restrict,

  constraint appointments_service_same_clinic_fk
    foreign key (clinic_id, booked_service_id)
    references public.clinic_services (clinic_id, service_id)
    on delete restrict,

  constraint appointments_doctor_same_clinic_fk
    foreign key (clinic_id, doctor_id)
    references public.clinic_memberships (clinic_id, user_id)
    on delete restrict,

  constraint appointments_clinic_id_id_unique
    unique (clinic_id, id)
);

create index appointments_clinic_schedule_idx
  on public.appointments (clinic_id, starts_at)
  where archived_at is null;

create index appointments_doctor_schedule_idx
  on public.appointments (clinic_id, doctor_id, starts_at)
  where archived_at is null;

create index appointments_lead_idx
  on public.appointments (clinic_id, lead_id);

create index appointments_service_idx
  on public.appointments (clinic_id, booked_service_id);

alter table public.appointments enable row level security;

revoke all privileges
on table public.appointments
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923185357_create_appointment_events.sql
-- =============================================================================
create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null,

  appointment_id uuid not null,

  event_type text not null
    check (
      event_type in (
        'created',
        'status_changed',
        'rescheduled',
        'archived',
        'restored'
      )
    ),

  performed_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  performed_at timestamptz not null default now(),

  old_status text
    check (
      old_status in (
        'pending',
        'confirmed',
        'attended',
        'no_show',
        'cancelled'
      )
    ),

  new_status text
    check (
      new_status in (
        'pending',
        'confirmed',
        'attended',
        'no_show',
        'cancelled'
      )
    ),

  old_starts_at timestamptz,
  new_starts_at timestamptz,

  old_ends_at timestamptz,
  new_ends_at timestamptz,

  reason text
    check (
      reason is null
      or length(trim(reason)) > 0
    ),

  constraint appointment_events_same_clinic_fk
    foreign key (clinic_id, appointment_id)
    references public.appointments (clinic_id, id)
    on delete restrict,

  constraint appointment_events_status_change_check
    check (
      event_type <> 'status_changed'
      or (
        old_status is not null
        and new_status is not null
        and old_status <> new_status
      )
    ),

  constraint appointment_events_reschedule_check
    check (
      event_type <> 'rescheduled'
      or (
        old_starts_at is not null
        and new_starts_at is not null
        and (
          old_starts_at <> new_starts_at
          or old_ends_at is distinct from new_ends_at
        )
        and reason is not null
      )
    ),

  constraint appointment_events_old_time_order_check
    check (
      old_ends_at is null
      or (
        old_starts_at is not null
        and old_ends_at > old_starts_at
      )
    ),

  constraint appointment_events_new_time_order_check
    check (
      new_ends_at is null
      or (
        new_starts_at is not null
        and new_ends_at > new_starts_at
      )
    )
);

create index appointment_events_history_idx
  on public.appointment_events (
    clinic_id,
    appointment_id,
    performed_at,
    id
  );

alter table public.appointment_events
  enable row level security;

revoke all privileges
on table public.appointment_events
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923185501_create_lead_events.sql
-- =============================================================================
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null,

  lead_id uuid not null,

  event_type text not null
    check (
      event_type in (
        'created',
        'contact_attempted',
        'status_changed',
        'assignment_changed',
        'follow_up_scheduled',
        'note_added',
        'archived',
        'restored'
      )
    ),

  performed_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  performed_at timestamptz not null default now(),

  contact_channel text
    check (
      contact_channel in (
        'phone',
        'whatsapp',
        'instagram',
        'facebook',
        'tiktok',
        'other'
      )
    ),

  contact_outcome text
    check (
      contact_outcome in (
        'reached',
        'no_answer',
        'unreachable',
        'invalid_number'
      )
    ),

  notes text
    check (
      notes is null
      or length(trim(notes)) > 0
    ),

  changes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(changes) = 'object'),

  constraint lead_events_same_clinic_fk
    foreign key (clinic_id, lead_id)
    references public.leads (clinic_id, id)
    on delete restrict,

  constraint lead_events_contact_details_check
    check (
      (
        event_type = 'contact_attempted'
        and contact_channel is not null
        and contact_outcome is not null
      )
      or
      (
        event_type <> 'contact_attempted'
        and contact_channel is null
        and contact_outcome is null
      )
    ),

  constraint lead_events_note_required_check
    check (
      event_type <> 'note_added'
      or notes is not null
    ),

  constraint lead_events_changes_required_check
    check (
      event_type not in (
        'status_changed',
        'assignment_changed',
        'follow_up_scheduled'
      )
      or changes <> '{}'::jsonb
    )
);

create index lead_events_history_idx
  on public.lead_events (
    clinic_id,
    lead_id,
    performed_at,
    id
  );

create index lead_events_staff_activity_idx
  on public.lead_events (
    clinic_id,
    performed_by,
    performed_at
  );

alter table public.lead_events
  enable row level security;

revoke all privileges
on table public.lead_events
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923185916_create_clinic_finance_links.sql
-- =============================================================================
create table public.clinic_finance_links (
  clinic_id uuid primary key
    references public.clinics(id) on delete restrict,

  finance_client_id bigint not null
    check (finance_client_id > 0),

  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now()
);

create index clinic_finance_links_client_idx
  on public.clinic_finance_links (finance_client_id);

alter table public.clinic_finance_links
  enable row level security;

revoke all privileges
on table public.clinic_finance_links
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923190210_create_clinic_ads.sql
-- =============================================================================
create table public.clinic_ads (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  finance_ad_id bigint
    check (finance_ad_id > 0),

  meta_ad_id text not null
    check (meta_ad_id ~ '^[0-9]+$'),

  meta_ad_account_id text not null
    check (meta_ad_account_id ~ '^[0-9]+$'),

  meta_campaign_id text
    check (meta_campaign_id ~ '^[0-9]+$'),

  meta_adset_id text
    check (meta_adset_id ~ '^[0-9]+$'),

  meta_creative_id text
    check (meta_creative_id ~ '^[0-9]+$'),

  ad_name text not null
    check (length(trim(ad_name)) > 0),

  caption text,

  thumbnail_url text,

  preview_url text,

  creative_variants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(creative_variants) = 'array'),

  advertised_service_id uuid,

  meta_effective_status text,

  is_selectable boolean not null default true,

  last_synced_at timestamptz,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  archived_at timestamptz,

constraint clinic_ads_meta_ad_unique
  unique (meta_ad_id),

constraint clinic_ads_finance_ad_unique
  unique (finance_ad_id),

  constraint clinic_ads_clinic_id_id_unique
    unique (clinic_id, id),

  constraint clinic_ads_service_same_clinic_fk
    foreign key (clinic_id, advertised_service_id)
    references public.clinic_services (clinic_id, service_id)
    on delete restrict
);

create index clinic_ads_campaign_idx
  on public.clinic_ads (clinic_id, meta_campaign_id);

create index clinic_ads_service_idx
  on public.clinic_ads (clinic_id, advertised_service_id);

create index clinic_ads_picker_idx
  on public.clinic_ads (clinic_id, ad_name)
  where archived_at is null
    and is_selectable = true
    and meta_effective_status = 'ACTIVE';

alter table public.clinic_ads
  enable row level security;

revoke all privileges
on table public.clinic_ads
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923190930_create_lead_touchpoints.sql
-- =============================================================================
create table public.lead_touchpoints (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null,

  lead_id uuid not null,

  source text not null
    check (
      source in (
        'paid_instagram',
        'paid_facebook',
        'tiktok',
        'whatsapp',
        'organic_instagram',
        'organic_facebook',
        'website',
        'other'
      )
    ),

  attribution_status text not null
    check (
      attribution_status in (
        'exact_ad',
        'creative_only',
        'unknown',
        'not_applicable'
      )
    ),

  ad_id uuid,

  meta_creative_id text
    check (meta_creative_id ~ '^[0-9]+$'),

  occurred_at timestamptz not null default now(),

  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now(),

  notes text
    check (
      notes is null
      or length(trim(notes)) > 0
    ),

  constraint lead_touchpoints_lead_same_clinic_fk
    foreign key (clinic_id, lead_id)
    references public.leads (clinic_id, id)
    on delete restrict,

  constraint lead_touchpoints_ad_same_clinic_fk
    foreign key (clinic_id, ad_id)
    references public.clinic_ads (clinic_id, id)
    on delete restrict,

  constraint lead_touchpoints_attribution_check
    check (
      (
        attribution_status = 'exact_ad'
        and ad_id is not null
      )
      or
      (
        attribution_status = 'creative_only'
        and ad_id is null
        and meta_creative_id is not null
      )
      or
      (
        attribution_status in ('unknown', 'not_applicable')
        and ad_id is null
        and meta_creative_id is null
      )
    )
);

create index lead_touchpoints_history_idx
  on public.lead_touchpoints (
    clinic_id,
    lead_id,
    occurred_at,
    id
  );

create index lead_touchpoints_ad_idx
  on public.lead_touchpoints (
    clinic_id,
    ad_id,
    occurred_at
  )
  where ad_id is not null;

alter table public.lead_touchpoints
  enable row level security;

revoke all privileges
on table public.lead_touchpoints
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923192142_add_lead_contact_type.sql
-- =============================================================================
alter table public.leads
  add column contact_type_at_creation text not null
    constraint leads_contact_type_at_creation_check
    check (
      contact_type_at_creation in (
        'new_contact',
        'existing_contact'
      )
    );

comment on column public.leads.contact_type_at_creation is
  'Contact classification when this lead was created. '
  'Set by the lead creation function and preserved for historical reporting.';

-- =============================================================================
-- Migration: 20260923192339_auto_update_timestamps.sql
-- =============================================================================
create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();

  return new;
end;
$$;

revoke all on function private.set_updated_at()
from public, anon, authenticated;


create trigger appointments_set_updated_at
  before update on public.appointments
  for each row
  execute function private.set_updated_at();


create trigger clinic_ads_set_updated_at
  before update on public.clinic_ads
  for each row
  execute function private.set_updated_at();

-- =============================================================================
-- Migration: 20260923192559_add_current_clinic_role_helper.sql
-- =============================================================================
create function private.current_clinic_role(
  p_clinic_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from public.clinic_memberships as membership
  join public.clinics as clinic
    on clinic.id = membership.clinic_id
  where membership.clinic_id = p_clinic_id
    and membership.user_id = (select auth.uid())
    and membership.is_active = true
    and clinic.archived_at is null;
$$;

revoke all on function private.current_clinic_role(uuid)
from public, anon, authenticated;

grant execute
on function private.current_clinic_role(uuid)
to authenticated;

-- =============================================================================
-- Migration: 20260923192655_allow_read_clinic_catalog.sql
-- =============================================================================
-- Clinic service assignments.
grant select on table public.clinic_services
to authenticated;

create policy clinic_services_select_authorized
on public.clinic_services
for select
to authenticated
using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) is not null
);


-- Service definitions available to the user's clinics.
grant select on table public.services
to authenticated;

create policy services_select_authorized
on public.services
for select
to authenticated
using (
  (select private.is_platform_admin())
  or exists (
    select 1
    from public.clinic_services as clinic_service
    where clinic_service.service_id = services.id
      and private.current_clinic_role(
        clinic_service.clinic_id
      ) is not null
  )
);


-- Ads belonging to the user's clinics.
grant select on table public.clinic_ads
to authenticated;

create policy clinic_ads_select_authorized
on public.clinic_ads
for select
to authenticated
using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) is not null
);


-- Finance mappings are readable by platform admins only.
grant select on table public.clinic_finance_links
to authenticated;

create policy clinic_finance_links_select_platform_admin
on public.clinic_finance_links
for select
to authenticated
using (
  (select private.is_platform_admin())
);

-- =============================================================================
-- Migration: 20260923192827_allow_read_appointments.sql
-- =============================================================================
grant select on table public.appointments
to authenticated;

create policy appointments_select_authorized
on public.appointments
for select
to authenticated
using (
  (select private.is_platform_admin())

  or private.current_clinic_role(clinic_id) in (
    'moderator',
    'agency_follow_up',
    'clinic_customer_service',
    'clinic_manager'
  )

  or (
    private.current_clinic_role(clinic_id) = 'doctor'
    and doctor_id = (select auth.uid())
  )
);


grant select on table public.appointment_events
to authenticated;

create policy appointment_events_select_authorized
on public.appointment_events
for select
to authenticated
using (
  exists (
    select 1
    from public.appointments as appointment
    where appointment.id = appointment_events.appointment_id
      and appointment.clinic_id = appointment_events.clinic_id
  )
);

-- =============================================================================
-- Migration: 20260923192958_allow_read_contacts_and_leads.sql
-- =============================================================================
-- Leads.
grant select on table public.leads
to authenticated;

create policy leads_select_authorized
on public.leads
for select
to authenticated
using (
  (select private.is_platform_admin())

  or private.current_clinic_role(clinic_id) in (
    'moderator',
    'agency_follow_up',
    'clinic_customer_service',
    'clinic_manager'
  )

  or (
    private.current_clinic_role(clinic_id) = 'doctor'
    and exists (
      select 1
      from public.appointments as appointment
      where appointment.clinic_id = leads.clinic_id
        and appointment.lead_id = leads.id
        and appointment.doctor_id = (select auth.uid())
    )
  )
);


-- Contact details.
grant select on table public.contacts
to authenticated;

create policy contacts_select_authorized
on public.contacts
for select
to authenticated
using (
  (select private.is_platform_admin())

  or private.current_clinic_role(clinic_id) in (
    'moderator',
    'agency_follow_up',
    'clinic_customer_service',
    'clinic_manager'
  )

  or (
    private.current_clinic_role(clinic_id) = 'doctor'
    and exists (
      select 1
      from public.leads as lead
      where lead.clinic_id = contacts.clinic_id
        and lead.contact_id = contacts.id
    )
  )
);


-- Follow-up history.
grant select on table public.lead_events
to authenticated;

create policy lead_events_select_authorized
on public.lead_events
for select
to authenticated
using (
  exists (
    select 1
    from public.leads as lead
    where lead.clinic_id = lead_events.clinic_id
      and lead.id = lead_events.lead_id
  )
);


-- Attribution and touchpoint history.
grant select on table public.lead_touchpoints
to authenticated;

create policy lead_touchpoints_select_authorized
on public.lead_touchpoints
for select
to authenticated
using (
  exists (
    select 1
    from public.leads as lead
    where lead.clinic_id = lead_touchpoints.clinic_id
      and lead.id = lead_touchpoints.lead_id
  )
);

-- =============================================================================
-- Migration: 20260923193147_allow_read_clinic_team.sql
-- =============================================================================
-- Active clinic members can read their clinic's team memberships.
create policy memberships_select_clinic_team
on public.clinic_memberships
for select
to authenticated
using (
  private.current_clinic_role(clinic_id) is not null
);


-- Users can read profiles of people sharing an accessible clinic.
create policy profiles_select_clinic_team
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.clinic_memberships as membership
    where membership.user_id = profiles.id
      and private.current_clinic_role(
        membership.clinic_id
      ) is not null
  )
);

-- =============================================================================
-- Migration: 20260923193546_finalize_lead_service_reference.sql
-- =============================================================================
-- Stop safely if existing leads still need service mapping.
do $$
begin
  if exists (
    select 1
    from public.leads
    where requested_service_id is null
  ) then
    raise exception
      'Map existing leads to clinic services before applying this migration';
  end if;
end;
$$;


-- Every lead must reference a service offered by its clinic.
alter table public.leads
  alter column requested_service_id set not null;


-- Preserve the service name recorded when the lead was created.
alter table public.leads
  rename column service_name
  to requested_service_name_snapshot;

alter table public.leads
  rename constraint leads_service_name_check
  to leads_requested_service_name_snapshot_check;


comment on column public.leads.requested_service_id is
  'Requested service, linked to the clinic service catalog.';

comment on column public.leads.requested_service_name_snapshot is
  'Service name copied by the lead creation function at creation time.';

-- =============================================================================
-- Migration: 20260923194310_add_service_management_permission.sql
-- =============================================================================
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

-- =============================================================================
-- Migration: 20260923194649_add_create_service_function.sql
-- =============================================================================
create function public.create_service(
  p_service_code text,
  p_service_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_code text;
  v_service_name text;
  v_service_id uuid;
begin
  -- Require a signed-in user.
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  -- Require explicit service-management permission.
  if private.can_manage_services() is not true then
    raise exception 'You do not have permission to manage services'
      using errcode = '42501';
  end if;

  -- Normalize and validate inputs.
  v_service_code := lower(trim(p_service_code));
  v_service_name := trim(p_service_name);

  if v_service_code is null or v_service_code = '' then
    raise exception 'Service code is required'
      using errcode = '22023';
  end if;

  if v_service_name is null or v_service_name = '' then
    raise exception 'Service name is required'
      using errcode = '22023';
  end if;

  -- Insert the service and return its ID.
  insert into public.services (
    service_code,
    service_name
  )
  values (
    v_service_code,
    v_service_name
  )
  returning id into v_service_id;

  return v_service_id;
end;
$$;

revoke all on function public.create_service(text, text)
from public, anon, authenticated;

grant execute on function public.create_service(text, text)
to authenticated;

-- =============================================================================
-- Migration: 20260923194953_add_set_clinic_service_function.sql
-- =============================================================================
create function public.set_clinic_service(
  p_clinic_id uuid,
  p_service_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_is_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if private.is_platform_admin() is not true then
    raise exception 'Only platform admins can manage clinic services'
      using errcode = '42501';
  end if;

  if p_clinic_id is null
     or p_service_id is null
     or p_is_active is null then
    raise exception 'Clinic, service and active status are required'
      using errcode = '22023';
  end if;

  -- Keep the clinic available throughout this operation.
  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Clinic not found or archived'
      using errcode = '22023';
  end if;

  -- Read and lock the service while validating its status.
  select service.is_active
  into v_service_is_active
  from public.services as service
  where service.id = p_service_id
  for share;

  if not found then
    raise exception 'Service not found'
      using errcode = '22023';
  end if;

  if p_is_active and not v_service_is_active then
    raise exception 'Cannot enable an inactive service'
      using errcode = '22023';
  end if;

  insert into public.clinic_services (
    clinic_id,
    service_id,
    is_active
  )
  values (
    p_clinic_id,
    p_service_id,
    p_is_active
  )
  on conflict (clinic_id, service_id)
  do update
    set is_active = excluded.is_active;
end;
$$;

revoke all on function public.set_clinic_service(uuid, uuid, boolean)
from public, anon, authenticated;

grant execute
on function public.set_clinic_service(uuid, uuid, boolean)
to authenticated;

-- =============================================================================
-- Migration: 20260923195335_add_lead_creation_requests.sql
-- =============================================================================
create table private.lead_creation_requests (
  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  requested_by uuid not null
    references public.profiles(id) on delete restrict,

  request_id uuid not null,

  request_payload jsonb not null
    check (jsonb_typeof(request_payload) = 'object'),

  lead_id uuid not null,

  created_at timestamptz not null default now(),

  primary key (
    clinic_id,
    requested_by,
    request_id
  ),

  constraint lead_creation_requests_lead_same_clinic_fk
    foreign key (clinic_id, lead_id)
    references public.leads (clinic_id, id)
    on delete restrict,

  constraint lead_creation_requests_lead_unique
    unique (lead_id)
);

alter table private.lead_creation_requests
  enable row level security;

revoke all privileges
on table private.lead_creation_requests
from public, anon, authenticated;

-- =============================================================================
-- Migration: 20260923200336_add_create_lead_function.sql
-- =============================================================================
-- Copy into a new migration created AFTER finalize_lead_service_reference
-- and add_lead_creation_requests. Do not run against production before tests.
-- Public RPC: create a contact if needed, a lead, its first touchpoint,
-- its creation event, and an idempotency receipt in one transaction.
create function public.create_lead(
  p_request_id uuid,
  p_clinic_id uuid,
  p_full_name text,
  p_phone text,
  p_requested_service_id uuid,
  p_source text,
  p_attribution_status text,
  p_ad_id uuid default null,
  p_meta_creative_id text default null,
  p_notes text default null,
  p_allow_inactive_ad boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_name text := nullif(trim(p_full_name), '');
  v_phone text := nullif(trim(p_phone), '');
  v_notes text := nullif(trim(p_notes), '');
  v_service_name text;
  v_payload jsonb;
  v_receipt private.lead_creation_requests%rowtype;
  v_contact public.contacts%rowtype;
  v_ad public.clinic_ads%rowtype;
  v_lead_id uuid;
  v_contact_type text;
  v_creative_id text;
begin
  -- 1. Authentication and authorization. Never trust an actor from the client.
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_request_id is null or p_clinic_id is null then
    raise exception 'Request ID and clinic are required' using errcode = '22023';
  end if;

  -- Lock active membership so it cannot be disabled mid-operation.
  select membership.role into v_role
  from public.clinic_memberships as membership
  where membership.clinic_id = p_clinic_id
    and membership.user_id = v_actor
    and membership.is_active = true
  for share;

  if private.is_platform_admin() is not true
     and coalesce(v_role in (
       'moderator', 'agency_follow_up',
       'clinic_customer_service', 'clinic_manager'
     ), false) = false then
    raise exception 'Not authorized to create leads for this clinic'
      using errcode = '42501';
  end if;

  perform 1 from public.clinics
  where id = p_clinic_id and archived_at is null
  for share;
  if not found then
    raise exception 'Clinic not found or archived' using errcode = '22023';
  end if;

  -- 2. Canonical input contract: the UI must send an international phone.
  if v_name is null or v_phone is null
     or p_requested_service_id is null
     or p_allow_inactive_ad is null then
    raise exception 'Name, phone, service and ad-selection flag are required'
      using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Phone must use international format, for example +201012345678'
      using errcode = '22023';
  end if;
  if p_source is null or p_source not in (
    'paid_instagram', 'paid_facebook', 'tiktok', 'whatsapp',
    'organic_instagram', 'organic_facebook', 'website', 'other'
  ) then
    raise exception 'Invalid source' using errcode = '22023';
  end if;
  if p_attribution_status is null or p_attribution_status not in (
    'exact_ad', 'creative_only', 'unknown', 'not_applicable'
  ) then
    raise exception 'Invalid attribution status' using errcode = '22023';
  end if;

  -- The receipt compares canonical user input, not mutable catalog values.
  v_payload := jsonb_build_object(
    'full_name', v_name, 'phone', v_phone,
    'requested_service_id', p_requested_service_id,
    'source', p_source, 'attribution_status', p_attribution_status,
    'ad_id', p_ad_id, 'meta_creative_id', p_meta_creative_id,
    'notes', v_notes, 'allow_inactive_ad', p_allow_inactive_ad
  );

  -- 3. Serialize retries for this actor/clinic/request until commit or rollback.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      jsonb_build_array('create_lead', p_clinic_id, v_actor, p_request_id)::text,
      0
    )
  );

  select receipt.* into v_receipt
  from private.lead_creation_requests as receipt
  where receipt.clinic_id = p_clinic_id
    and receipt.requested_by = v_actor
    and receipt.request_id = p_request_id;

  if found then
    if v_receipt.request_payload is distinct from v_payload then
      raise exception 'Request ID was already used with different data'
        using errcode = '22023';
    end if;
    return jsonb_build_object('lead_id', v_receipt.lead_id, 'replayed', true);
  end if;

  -- 4. The requested service must be active globally AND at this clinic.
  select service.service_name into v_service_name
  from public.services as service
  join public.clinic_services as clinic_service
    on clinic_service.service_id = service.id
  where service.id = p_requested_service_id
    and clinic_service.clinic_id = p_clinic_id
    and service.is_active = true
    and clinic_service.is_active = true
  for share of service, clinic_service;

  if not found then
    raise exception 'Service is not available at this clinic' using errcode = '22023';
  end if;

  -- 5. Attribution: exact ad, known creative, unknown, or non-ad contact.
  if p_attribution_status = 'exact_ad' then
    if p_ad_id is null or p_meta_creative_id is not null then
      raise exception 'Select an ad; its creative ID is populated by the server'
        using errcode = '22023';
    end if;
    select ad.* into v_ad
    from public.clinic_ads as ad
    where ad.id = p_ad_id and ad.clinic_id = p_clinic_id
      and ad.archived_at is null and ad.is_selectable = true
    for share;
    if not found then
      raise exception 'Ad is not selectable for this clinic' using errcode = '22023';
    end if;
    if not p_allow_inactive_ad
       and v_ad.meta_effective_status is distinct from 'ACTIVE' then
      raise exception 'Use the previous-ads option to select a non-active ad'
        using errcode = '22023';
    end if;
    v_creative_id := v_ad.meta_creative_id;

  elsif p_attribution_status = 'creative_only' then
    if p_ad_id is not null or p_meta_creative_id is null
       or p_meta_creative_id !~ '^[0-9]+$' then
      raise exception 'Creative-only attribution requires a valid creative ID and no ad ID'
        using errcode = '22023';
    end if;
    -- Deterministic candidate used ONLY to validate clinic access;
    -- do not assign its ad ID or claim exact-ad attribution.
    perform 1 from public.clinic_ads as ad
    where ad.clinic_id = p_clinic_id
      and ad.meta_creative_id = p_meta_creative_id
      and ad.archived_at is null and ad.is_selectable = true
      and (p_allow_inactive_ad or ad.meta_effective_status = 'ACTIVE')
    order by ad.id
    limit 1
    for share;
    if not found then
      raise exception 'Creative is not selectable for this clinic'
        using errcode = '22023';
    end if;
    v_creative_id := p_meta_creative_id;

  else
    if p_ad_id is not null or p_meta_creative_id is not null then
      raise exception 'Unknown and non-ad attribution must not contain ad or creative IDs'
        using errcode = '22023';
    end if;
    if p_attribution_status = 'not_applicable'
       and p_source in ('paid_instagram', 'paid_facebook') then
      raise exception 'For an unidentified paid ad, select unknown attribution'
        using errcode = '22023';
    end if;
  end if;

  -- 6. Reuse the contact without overwriting their name.
  -- The unique clinic/phone constraint arbitrates concurrent inserts.
  insert into public.contacts (clinic_id, full_name, phone, created_by)
  values (p_clinic_id, v_name, v_phone, v_actor)
  on conflict (clinic_id, phone) do nothing
  returning * into v_contact;

  if found then
    v_contact_type := 'new_contact';
  else
    select contact.* into v_contact
    from public.contacts as contact
    where contact.clinic_id = p_clinic_id and contact.phone = v_phone
    for update;
    if not found then
      -- Safe failure if a concurrent administrative change removed the row.
      raise exception 'Contact changed concurrently; retry with the same request ID'
        using errcode = '40001';
    end if;
    if v_contact.archived_at is not null then
      raise exception 'Contact is archived; restore it before creating a lead'
        using errcode = '22023';
    end if;
    v_contact_type := 'existing_contact';
  end if;

  -- 7. Create the independent inquiry and snapshot its requested service name.
  insert into public.leads (
    clinic_id, contact_id, requested_service_id,
    requested_service_name_snapshot, source, notes,
    created_by, contact_type_at_creation
  ) values (
    p_clinic_id, v_contact.id, p_requested_service_id,
    v_service_name, p_source, v_notes, v_actor, v_contact_type
  ) returning id into v_lead_id;

  insert into public.lead_touchpoints (
    clinic_id, lead_id, source, attribution_status,
    ad_id, meta_creative_id, created_by
  ) values (
    p_clinic_id, v_lead_id, p_source, p_attribution_status,
    p_ad_id, v_creative_id, v_actor
  );

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by, changes
  ) values (
    p_clinic_id, v_lead_id, 'created', v_actor,
    jsonb_build_object(
      'contact_type_at_creation', v_contact_type,
      'requested_service_id', p_requested_service_id
    )
  );

  -- 8. Persist the successful receipt in the same transaction.
  insert into private.lead_creation_requests (
    clinic_id, requested_by, request_id, request_payload, lead_id
  ) values (
    p_clinic_id, v_actor, p_request_id, v_payload, v_lead_id
  );

  return jsonb_build_object('lead_id', v_lead_id, 'replayed', false);
end;
$$;

revoke all on function public.create_lead(
  uuid, uuid, text, text, uuid, text, text, uuid, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.create_lead(
  uuid, uuid, text, text, uuid, text, text, uuid, text, text, boolean
) to authenticated;

-- =============================================================================
-- Migration: 20260924081313_add_lead_note_function.sql
-- =============================================================================
create function public.add_lead_note(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_note text := nullif(trim(p_note), '');
  v_event_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if p_clinic_id is null
     or p_lead_id is null
     or v_note is null then
    raise exception 'Clinic, lead and note are required'
      using errcode = '22023';
  end if;

  if (
    private.is_platform_admin()
    or private.current_clinic_role(p_clinic_id) in (
      'moderator',
      'agency_follow_up',
      'clinic_customer_service',
      'clinic_manager'
    )
  ) is not true then
    raise exception 'Not authorized to add notes for this clinic'
      using errcode = '42501';
  end if;

  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Clinic not found or archived'
      using errcode = '22023';
  end if;

  perform 1
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Lead not found or archived'
      using errcode = '22023';
  end if;

  insert into public.lead_events (
    clinic_id,
    lead_id,
    event_type,
    performed_by,
    notes
  )
  values (
    p_clinic_id,
    p_lead_id,
    'note_added',
    v_actor,
    v_note
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all
on function public.add_lead_note(uuid, uuid, text)
from public, anon, authenticated;

grant execute
on function public.add_lead_note(uuid, uuid, text)
to authenticated;

-- =============================================================================
-- Migration: 20260928020906_crm_admin_setup.sql
-- =============================================================================
begin;

create or replace function public.crm_admin_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin();
$$;


create or replace function public.crm_activate_finance_client(
  p_finance_id bigint,
  p_name text,
  p_clinic_id uuid default null,
  p_services jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_count integer;
  v_service uuid;
  v_item jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  if p_finance_id is null
     or p_finance_id < 1
     or nullif(btrim(p_name), '') is null
     or p_services is null
     or jsonb_typeof(p_services) <> 'array' then
    raise exception 'Invalid input'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crm-finance-client:' || p_finance_id::text,
      0
    )
  );

  select
    count(*),
    (array_agg(clinic_id))[1]
  into v_count, v_clinic
  from public.clinic_finance_links
  where finance_client_id = p_finance_id;

  if v_count > 1 then
    raise exception
      'Multiple existing clinic mappings require review'
      using errcode = '22023';
  end if;

  if v_clinic is not null
     and p_clinic_id is not null
     and v_clinic <> p_clinic_id then
    raise exception 'Client already linked to another clinic'
      using errcode = '22023';
  end if;

  if v_clinic is null then
    if p_clinic_id is null then
      insert into public.clinics(name)
      values (btrim(p_name))
      returning id into v_clinic;
    else
      v_clinic := p_clinic_id;
    end if;

    perform 1
    from public.clinics
    where id = v_clinic
      and archived_at is null
    for update;

    if not found then
      raise exception 'Clinic unavailable'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.clinic_finance_links
      where clinic_id = v_clinic
    ) then
      raise exception 'Clinic already linked'
        using errcode = '22023';
    end if;

    insert into public.clinic_finance_links(
      clinic_id,
      finance_client_id,
      created_by
    )
    values (
      v_clinic,
      p_finance_id,
      auth.uid()
    );

  else
    perform 1
    from public.clinics
    where id = v_clinic
      and archived_at is null
    for update;

    if not found then
      raise exception 'Clinic unavailable'
        using errcode = '22023';
    end if;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_services)
    order by (value->>'id')::bigint
  loop
    if coalesce((v_item->>'id')::bigint, 0) < 1
       or nullif(btrim(v_item->>'service_code'), '') is null
       or nullif(btrim(v_item->>'service_name'), '') is null then
      raise exception 'Invalid service'
        using errcode = '22023';
    end if;

    insert into public.services(
      finance_service_id,
      service_code,
      service_name,
      is_active
    )
    values (
      (v_item->>'id')::bigint,
      lower(btrim(v_item->>'service_code')),
      btrim(v_item->>'service_name'),
      true
    )
    on conflict (finance_service_id)
    do update set
      service_code = excluded.service_code,
      service_name = excluded.service_name,
      is_active = true
    returning id into v_service;

    insert into public.clinic_services(
      clinic_id,
      service_id,
      is_active
    )
    values (
      v_clinic,
      v_service,
      true
    )
    on conflict (clinic_id, service_id)
    do update set is_active = true;
  end loop;

  return v_clinic;
end;
$$;


create or replace function public.crm_add_local_service(
  p_clinic_id uuid,
  p_code text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_name), '') is null
     or p_code is null
     or p_code !~ '^[a-z0-9][a-z0-9_]{0,63}$' then
    raise exception 'Invalid service'
      using errcode = '22023';
  end if;

  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Clinic unavailable'
      using errcode = '22023';
  end if;

  insert into public.services(
    service_code,
    service_name
  )
  values (
    p_code,
    btrim(p_name)
  )
  returning id into v_id;

  insert into public.clinic_services(
    clinic_id,
    service_id
  )
  values (
    p_clinic_id,
    v_id
  );

  return v_id;
end;
$$;


create or replace function public.crm_set_clinic_service(
  p_clinic_id uuid,
  p_service_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'Invalid state'
      using errcode = '22023';
  end if;

  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Clinic unavailable'
      using errcode = '22023';
  end if;

  perform 1
  from public.services
  where id = p_service_id
    and is_active = true
  for share;

  if not found then
    raise exception 'Service unavailable'
      using errcode = '22023';
  end if;

  insert into public.clinic_services(
    clinic_id,
    service_id,
    is_active
  )
  values (
    p_clinic_id,
    p_service_id,
    p_enabled
  )
  on conflict (clinic_id, service_id)
  do update set is_active = excluded.is_active;
end;
$$;


revoke all on function public.crm_admin_status()
from public, anon, authenticated;

revoke all on function
public.crm_activate_finance_client(bigint,text,uuid,jsonb)
from public, anon, authenticated;

revoke all on function
public.crm_add_local_service(uuid,text,text)
from public, anon, authenticated;

revoke all on function
public.crm_set_clinic_service(uuid,uuid,boolean)
from public, anon, authenticated;


grant execute on function public.crm_admin_status()
to authenticated;

grant execute on function
public.crm_activate_finance_client(bigint,text,uuid,jsonb)
to authenticated;

grant execute on function
public.crm_add_local_service(uuid,text,text)
to authenticated;

grant execute on function
public.crm_set_clinic_service(uuid,uuid,boolean)
to authenticated;

commit;

-- =============================================================================
-- Migration: 20260928030446_crm_team_management.sql
-- =============================================================================
begin;

create table private.clinic_membership_audit (
  id bigint generated always as identity primary key,

  clinic_id uuid not null
    references public.clinics(id),

  user_id uuid not null
    references public.profiles(id),

  changed_by uuid not null
    references public.profiles(id),

  previous_role text,
  previous_active boolean,
  new_role text not null,
  new_active boolean not null,

  changed_at timestamptz not null default now()
);

alter table private.clinic_membership_audit
  enable row level security;

revoke all on private.clinic_membership_audit
from public, anon, authenticated;


create function public.crm_team_directory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_platform_admin() is not true then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'full_name', p.full_name,
          'email', u.email
        )
        order by p.full_name, p.id
      )
      from public.profiles p
      join auth.users u on u.id = p.id
      where not exists (
        select 1
        from private.platform_admins a
        where a.user_id = p.id
      )
    ), '[]'::jsonb),

    'clinics',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name
        )
        order by name, id
      )
      from public.clinics
      where archived_at is null
    ), '[]'::jsonb),

    'memberships',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'clinic_id', m.clinic_id,
          'user_id', m.user_id,
          'role', m.role,
          'is_active', m.is_active
        )
      )
      from public.clinic_memberships m
      join public.clinics c
        on c.id = m.clinic_id
        and c.archived_at is null
      where not exists (
        select 1
        from private.platform_admins a
        where a.user_id = m.user_id
      )
    ), '[]'::jsonb)
  );
end;
$$;


create function public.crm_set_membership(
  p_clinic_id uuid,
  p_user_id uuid,
  p_role text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.clinic_memberships%rowtype;
begin
  if private.is_platform_admin() is not true then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  if p_clinic_id is null
     or p_user_id is null
     or p_active is null
     or p_role is null
     or p_role not in (
       'moderator',
       'agency_follow_up',
       'clinic_customer_service',
       'doctor',
       'clinic_manager'
     ) then
    raise exception 'Invalid membership'
      using errcode = '22023';
  end if;

  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Clinic unavailable'
      using errcode = '22023';
  end if;

  perform 1
  from public.profiles
  where id = p_user_id
  for share;

  if not found then
    raise exception 'User unavailable'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from private.platform_admins
    where user_id = p_user_id
  ) then
    raise exception 'Platform admins are managed separately'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crm-membership:'
      || p_clinic_id::text
      || ':'
      || p_user_id::text,
      0
    )
  );

  select *
  into v_previous
  from public.clinic_memberships
  where clinic_id = p_clinic_id
    and user_id = p_user_id
  for update;

  if found
     and v_previous.role = p_role
     and v_previous.is_active = p_active then
    return;
  end if;

  insert into public.clinic_memberships(
    clinic_id,
    user_id,
    role,
    is_active
  )
  values (
    p_clinic_id,
    p_user_id,
    p_role,
    p_active
  )
  on conflict (clinic_id, user_id)
  do update set
    role = excluded.role,
    is_active = excluded.is_active;

  insert into private.clinic_membership_audit(
    clinic_id,
    user_id,
    changed_by,
    previous_role,
    previous_active,
    new_role,
    new_active
  )
  values (
    p_clinic_id,
    p_user_id,
    auth.uid(),
    v_previous.role,
    v_previous.is_active,
    p_role,
    p_active
  );
end;
$$;


revoke all on function public.crm_team_directory()
from public, anon, authenticated;

revoke all on function
public.crm_set_membership(uuid, uuid, text, boolean)
from public, anon, authenticated;

grant execute on function public.crm_team_directory()
to authenticated;

grant execute on function
public.crm_set_membership(uuid, uuid, text, boolean)
to authenticated;

commit;

-- =============================================================================
-- Migration: 20260928060438_crm_sync_finance_ads.sql
-- =============================================================================
begin;

create or replace function public.crm_sync_finance_ads(
  p_clinic_id uuid,
  p_finance_id bigint,
  p_ads jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  affected integer;
  total integer := 0;
begin
  if not private.is_platform_admin() then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  perform 1
  from public.clinic_finance_links
  where clinic_id = p_clinic_id
    and finance_client_id = p_finance_id
  for update;

  if not found or not exists (
    select 1
    from public.clinics
    where id = p_clinic_id
      and archived_at is null
  ) then
    raise exception 'Clinic link is unavailable'
      using errcode = '22023';
  end if;

  if p_ads is null or jsonb_typeof(p_ads) <> 'array' then
    raise exception 'Expected ads array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_ads) > 10000 then
    raise exception 'Too many ads'
      using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_ads)
  loop
    if (item->>'finance_client_id')::bigint
         is distinct from p_finance_id
      or item->>'finance_ad_id' is null
      or item->>'meta_synced_at' is null
    then
      raise exception 'Invalid ad source'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.clinic_ads
      where (
        meta_ad_id = item->>'meta_ad_id'
        or finance_ad_id = (item->>'finance_ad_id')::bigint
      )
      and (
        clinic_id <> p_clinic_id
        or meta_ad_id <> item->>'meta_ad_id'
        or (
          finance_ad_id is not null
          and finance_ad_id <> (item->>'finance_ad_id')::bigint
        )
      )
    ) then
      raise exception 'Ad is already linked elsewhere'
        using errcode = '23505';
    end if;

    insert into public.clinic_ads as existing (
      clinic_id,
      finance_ad_id,
      meta_ad_id,
      meta_ad_account_id,
      meta_campaign_id,
      meta_adset_id,
      meta_creative_id,
      ad_name,
      caption,
      thumbnail_url,
      creative_variants,
      meta_effective_status,
      last_synced_at
    )
    values (
      p_clinic_id,
      (item->>'finance_ad_id')::bigint,
      item->>'meta_ad_id',
      item->>'meta_ad_account_id',
      item->>'meta_campaign_id',
      item->>'meta_adset_id',
      item->>'meta_creative_id',
      item->>'ad_name',
      item->>'caption',
      item->>'thumbnail_url',
      coalesce(item->'caption_variants', '[]'::jsonb),
      item->>'meta_effective_status',
      (item->>'meta_synced_at')::timestamptz
    )
    on conflict (meta_ad_id) do update set
      finance_ad_id = excluded.finance_ad_id,
      meta_ad_account_id = excluded.meta_ad_account_id,
      meta_campaign_id = excluded.meta_campaign_id,
      meta_adset_id = excluded.meta_adset_id,
      meta_creative_id = excluded.meta_creative_id,
      ad_name = excluded.ad_name,
      caption = excluded.caption,
      thumbnail_url = excluded.thumbnail_url,
      creative_variants = excluded.creative_variants,
      meta_effective_status = excluded.meta_effective_status,
      last_synced_at = excluded.last_synced_at
    where existing.clinic_id = p_clinic_id
      and (
        existing.last_synced_at is null
        or excluded.last_synced_at >= existing.last_synced_at
      );

    get diagnostics affected = row_count;
    total := total + affected;
  end loop;

  return total;
end;
$$;

revoke all
on function public.crm_sync_finance_ads(uuid, bigint, jsonb)
from public, anon, authenticated;

grant execute
on function public.crm_sync_finance_ads(uuid, bigint, jsonb)
to authenticated;

commit;

-- =============================================================================
-- Migration: 20260929120000_dashboard_realtime_publication.sql
-- =============================================================================
-- Publish only the tables used by clinic dashboards. Existing SELECT RLS
-- policies determine which rows each authenticated subscriber can receive.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clinic_ads'
  ) then
    alter publication supabase_realtime add table public.clinic_ads;
  end if;
end;
$$;

-- =============================================================================
-- Migration: 20260929154128_lead_status_history.sql
-- =============================================================================
-- A status change and its audit event must commit together.
create function public.crm_change_lead_status(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_new_status text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_old_status text;
  v_event_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_new_status is null
     or p_new_status not in ('new', 'in_progress', 'no_answer', 'follow_up', 'not_interested')
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000 then
    raise exception 'Status and reason are required' using errcode = '22023';
  end if;

  v_role := private.current_clinic_role(p_clinic_id);
  if private.is_platform_admin() is not true
     and coalesce(v_role in ('clinic_manager', 'clinic_customer_service', 'doctor'), false) = false then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select status into v_old_status
  from public.leads
  where id = p_lead_id and clinic_id = p_clinic_id and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable' using errcode = '22023';
  end if;

  if v_role = 'doctor' and private.is_platform_admin() is not true
     and not exists (
       select 1 from public.appointments a
       where a.clinic_id = p_clinic_id and a.lead_id = p_lead_id
         and a.doctor_id = v_actor and a.archived_at is null
     ) then
    raise exception 'Not assigned to this lead' using errcode = '42501';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user' using errcode = '40001';
  end if;

  if v_old_status = p_new_status or v_old_status = 'converted' then
    raise exception 'Invalid status transition' using errcode = '22023';
  end if;

  update public.leads set status = p_new_status
  where id = p_lead_id and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by, notes, changes
  ) values (
    p_clinic_id, p_lead_id, 'status_changed', v_actor, trim(p_reason),
    jsonb_build_object('old_status', v_old_status, 'new_status', p_new_status)
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.crm_change_lead_status(uuid, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.crm_change_lead_status(uuid, uuid, text, text, text)
to authenticated;

-- =============================================================================
-- Migration: 20260929163918_create_lead_booking.sql
-- =============================================================================
create function public.crm_create_lead_booking(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_starts_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_old_status text;
  v_service_id uuid;
  v_appointment_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := private.current_clinic_role(p_clinic_id);
  if private.is_platform_admin() is not true
     and coalesce(v_role in ('clinic_manager', 'clinic_customer_service'), false) = false then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_starts_at is null or p_starts_at <= now()
     or nullif(trim(p_reason), '') is null or length(p_reason) > 2000 then
    raise exception 'Future time and reason are required' using errcode = '22023';
  end if;

  select status, requested_service_id into v_old_status, v_service_id
  from public.leads
  where id = p_lead_id and clinic_id = p_clinic_id and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable' using errcode = '22023';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user' using errcode = '40001';
  end if;

  if v_old_status = 'converted' or not exists (
    select 1 from public.clinic_services cs
    join public.services s on s.id = cs.service_id
    where cs.clinic_id = p_clinic_id and cs.service_id = v_service_id
      and cs.is_active and s.is_active
  ) then
    raise exception 'Lead cannot be booked' using errcode = '22023';
  end if;

  insert into public.appointments (
    clinic_id, lead_id, booked_service_id, starts_at, status,
    booking_origin, created_by, confirmed_by, confirmed_at, notes
  ) values (
    p_clinic_id, p_lead_id, v_service_id, p_starts_at, 'confirmed',
    'clinic', v_actor, v_actor, now(), trim(p_reason)
  ) returning id into v_appointment_id;

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type, performed_by,
    new_status, new_starts_at, reason
  ) values (
    p_clinic_id, v_appointment_id, 'created', v_actor,
    'confirmed', p_starts_at, trim(p_reason)
  );

  update public.leads set status = 'converted'
  where id = p_lead_id and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by, notes, changes
  ) values (
    p_clinic_id, p_lead_id, 'status_changed', v_actor, trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', 'converted',
      'appointment_id', v_appointment_id,
      'starts_at', p_starts_at
    )
  );

  return v_appointment_id;
end;
$$;

revoke all on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) to authenticated;

-- =============================================================================
-- Migration: 20260930134810_meta_webhook_inbox.sql
-- =============================================================================
create table public.meta_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  payload_hash text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.meta_webhook_inbox
  enable row level security;

revoke all on public.meta_webhook_inbox
  from anon, authenticated;

grant select, insert, update
  on public.meta_webhook_inbox
  to service_role;

-- =============================================================================
-- Migration: 20261001070000_crm_chats.sql
-- =============================================================================
-- Channels belong to one clinic. Access tokens stay in the API environment.
create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  platform text not null check (platform in ('facebook', 'instagram')),
  asset_id text not null check (length(asset_id) between 1 and 100),
  name text not null check (length(trim(name)) between 1 and 200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (platform, asset_id),
  unique (id, clinic_id)
);

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  channel_id uuid not null,
  customer_id text not null,
  last_message_at timestamptz not null,
  last_customer_message_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (channel_id, clinic_id) references public.chat_channels(id, clinic_id),
  unique (channel_id, customer_id),
  unique (id, clinic_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  conversation_id uuid not null,
  channel_id uuid not null,
  provider_message_id text,
  request_id uuid,
  direction text not null check (direction in ('incoming', 'outgoing')),
  text text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null check (status in ('received', 'queued', 'sending', 'sent', 'failed', 'unknown')),
  failure_code text,
  sending_started_at timestamptz,
  sent_by uuid references public.profiles(id),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, clinic_id) references public.chat_conversations(id, clinic_id),
  foreign key (channel_id, clinic_id) references public.chat_channels(id, clinic_id),
  unique (channel_id, provider_message_id),
  unique (request_id),
  check (jsonb_typeof(attachments) = 'array')
);

create index chat_conversations_clinic_time on public.chat_conversations(clinic_id, last_message_at desc, id desc);
create index chat_messages_conversation_time on public.chat_messages(conversation_id, occurred_at desc, id desc);
create index chat_messages_outbox on public.chat_messages(created_at) where status = 'queued';
alter table public.meta_webhook_inbox add column attempts integer not null default 0;
alter table public.meta_webhook_inbox add column retry_at timestamptz not null default now();
alter table public.meta_webhook_inbox add column last_error text;

create function private.can_read_chats(p_clinic_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() or private.current_clinic_role(p_clinic_id) is not null;
$$;
revoke all on function private.can_read_chats(uuid) from public, anon;
grant execute on function private.can_read_chats(uuid) to authenticated;

alter table public.chat_channels enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_channels, public.chat_conversations, public.chat_messages from public, anon, authenticated;
grant select on public.chat_channels, public.chat_conversations, public.chat_messages to authenticated;
grant all on public.chat_channels, public.chat_conversations, public.chat_messages to service_role;
create policy chat_channels_read on public.chat_channels for select to authenticated using (private.can_read_chats(clinic_id));
create policy chat_conversations_read on public.chat_conversations for select to authenticated using (private.can_read_chats(clinic_id));
create policy chat_messages_read on public.chat_messages for select to authenticated using (private.can_read_chats(clinic_id));

-- Only an admin can bind a Meta asset. Never move existing history to another clinic.
create function public.crm_add_chat_channel(p_clinic_id uuid, p_platform text, p_asset_id text, p_name text)
returns public.chat_channels language plpgsql security definer set search_path = '' as $$
declare v_channel public.chat_channels;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id and archived_at is null) then
    raise exception 'CLINIC_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.chat_channels(clinic_id, platform, asset_id, name)
  values (p_clinic_id, p_platform, trim(p_asset_id), trim(p_name)) returning * into v_channel;
  return v_channel;
end;
$$;
revoke all on function public.crm_add_chat_channel(uuid,text,text,text) from public, anon;
grant execute on function public.crm_add_chat_channel(uuid,text,text,text) to authenticated;

-- A durable inbox consumer. Every payload is one transaction/savepoint, including dedupe.
-- Unmapped assets remain pending so registering a channel later can recover the events.
create function public.crm_process_meta_inbox() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_inbox record; v_entry jsonb; v_event jsonb; v_channel public.chat_channels;
  v_platform text; v_customer text; v_mid text; v_time timestamptz;
  v_conversation uuid; v_echo boolean; v_count integer := 0;
begin
  for v_inbox in select * from public.meta_webhook_inbox
    where processed_at is null and retry_at <= now()
    order by received_at limit 25 for update skip locked
  loop
    begin
      v_platform := case v_inbox.payload->>'object' when 'page' then 'facebook' when 'instagram' then 'instagram' end;
      for v_entry in select value from jsonb_array_elements(v_inbox.payload->'entry') loop
        for v_event in select value from jsonb_array_elements(coalesce(v_entry->'messaging', '[]'::jsonb)) loop
          -- Read/delivery receipts do not create fake customer messages.
          if not (v_event ? 'message') or coalesce(v_event->'message'->>'is_deleted','false') = 'true' then continue; end if;
          v_mid := v_event->'message'->>'mid';
          if v_mid is null or length(v_mid) = 0 then raise exception 'MESSAGE_ID_MISSING'; end if;
          select * into v_channel from public.chat_channels
            where platform = v_platform and asset_id = v_entry->>'id' and is_active;
          if not found then raise exception 'CHANNEL_NOT_CONFIGURED'; end if;
          perform pg_advisory_xact_lock(hashtextextended(v_channel.id::text, 0));
          v_echo := coalesce((v_event->'message'->>'is_echo')::boolean, false);
          if (not v_echo and v_event->'recipient'->>'id' is distinct from v_channel.asset_id)
            or (v_echo and v_event->'sender'->>'id' is distinct from v_channel.asset_id) then
            raise exception 'ASSET_MISMATCH';
          end if;
          v_customer := case when v_echo then v_event->'recipient'->>'id' else v_event->'sender'->>'id' end;
          if v_customer is null or length(v_customer) = 0 then raise exception 'CUSTOMER_ID_MISSING'; end if;
          v_time := to_timestamp((v_event->>'timestamp')::double precision / 1000);
          if v_time is null or v_time > now() + interval '5 minutes' then raise exception 'INVALID_EVENT_TIME'; end if;
          insert into public.chat_conversations(clinic_id, channel_id, customer_id, last_message_at, last_customer_message_at)
            values (v_channel.clinic_id, v_channel.id, v_customer, v_time, case when not v_echo then v_time end)
            on conflict (channel_id, customer_id) do update set
              last_message_at = greatest(chat_conversations.last_message_at, excluded.last_message_at),
              last_customer_message_at = greatest(chat_conversations.last_customer_message_at, excluded.last_customer_message_at)
            returning id into v_conversation;
          insert into public.chat_messages(clinic_id, conversation_id, channel_id, provider_message_id, direction, text, attachments, status, occurred_at)
            values (v_channel.clinic_id, v_conversation, v_channel.id, v_mid,
              case when v_echo then 'outgoing' else 'incoming' end,
              v_event->'message'->>'text', coalesce(v_event->'message'->'attachments','[]'::jsonb),
              case when v_echo then 'sent' else 'received' end, v_time)
            on conflict (channel_id, provider_message_id) do nothing;
        end loop;
      end loop;
      update public.meta_webhook_inbox set processed_at = now(), last_error = null where id = v_inbox.id;
      v_count := v_count + 1;
    exception when others then
      update public.meta_webhook_inbox set attempts = attempts + 1,
        retry_at = now() + interval '1 minute', last_error = left(sqlerrm, 200) where id = v_inbox.id;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.crm_process_meta_inbox() from public, anon, authenticated;
grant execute on function public.crm_process_meta_inbox() to service_role;

create function public.crm_queue_chat_reply(p_clinic_id uuid, p_conversation_id uuid, p_request_id uuid, p_text text)
returns public.chat_messages language plpgsql security definer set search_path = '' as $$
declare v_conversation public.chat_conversations; v_message public.chat_messages;
begin
  if not (private.is_platform_admin() or coalesce(private.current_clinic_role(p_clinic_id)
    in ('moderator','agency_follow_up','clinic_customer_service','clinic_manager'), false)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_text is null or length(trim(p_text)) not between 1 and 1000 or p_request_id is null then raise exception 'INVALID_REPLY' using errcode = '22023'; end if;
  select * into v_conversation from public.chat_conversations where id = p_conversation_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_message from public.chat_messages where request_id = p_request_id;
  if found then
    if v_message.conversation_id <> p_conversation_id or v_message.sent_by <> auth.uid() or v_message.text <> trim(p_text) then
      raise exception 'REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_message;
  end if;
  if not exists (select 1 from public.chat_channels where id = v_conversation.channel_id and is_active) then
    raise exception 'CHANNEL_INACTIVE' using errcode = '22023';
  end if;
  if v_conversation.last_customer_message_at is null or v_conversation.last_customer_message_at < now() - interval '24 hours' then
    raise exception 'REPLY_WINDOW_CLOSED' using errcode = '22023';
  end if;
  insert into public.chat_messages(clinic_id, conversation_id, channel_id, request_id, direction, text, status, sent_by, occurred_at)
    values (p_clinic_id, p_conversation_id, v_conversation.channel_id, p_request_id, 'outgoing', trim(p_text), 'queued', auth.uid(), now())
    returning * into v_message;
  return v_message;
end;
$$;
revoke all on function public.crm_queue_chat_reply(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.crm_queue_chat_reply(uuid,uuid,uuid,text) to authenticated;

-- A claim prevents two API workers sending one queued reply.
create function public.crm_claim_chat_reply() returns setof public.chat_messages
language sql security definer set search_path = '' as $$
  update public.chat_messages set status = 'sending', sending_started_at = now()
  where id = (select id from public.chat_messages where status = 'queued' order by created_at limit 1 for update skip locked)
  returning *;
$$;
revoke all on function public.crm_claim_chat_reply() from public, anon, authenticated;
grant execute on function public.crm_claim_chat_reply() to service_role;

-- Echoes can arrive before the Send API response. Reconcile them atomically.
create function public.crm_complete_chat_reply(p_message_id uuid, p_provider_message_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_message public.chat_messages; v_echo public.chat_messages;
begin
  select * into v_message from public.chat_messages where id = p_message_id;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_message.channel_id::text, 0));
  if p_provider_message_id is null or length(p_provider_message_id) = 0 then raise exception 'MESSAGE_ID_MISSING'; end if;
  select * into v_echo from public.chat_messages where channel_id = v_message.channel_id
    and provider_message_id = p_provider_message_id;
  if found and v_echo.id <> p_message_id then
    if v_echo.direction <> 'outgoing' or v_echo.conversation_id <> v_message.conversation_id or v_echo.sent_by is not null then
      raise exception 'MESSAGE_ID_CONFLICT';
    end if;
    delete from public.chat_messages where id = v_echo.id;
  end if;
  update public.chat_messages set status = 'sent', provider_message_id = p_provider_message_id, failure_code = null
    where id = p_message_id;
  update public.chat_conversations set last_message_at = greatest(last_message_at, v_message.occurred_at)
    where id = v_message.conversation_id;
end;
$$;
revoke all on function public.crm_complete_chat_reply(uuid,text) from public, anon, authenticated;
grant execute on function public.crm_complete_chat_reply(uuid,text) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_channels, public.chat_conversations, public.chat_messages;
  end if;
end $$;

-- =============================================================================
-- Migration: 20261003171643_create_lead_with_booking.sql
-- =============================================================================
-- One RPC transaction creates an inquiry or a lead with a confirmed appointment.
alter table private.lead_creation_requests
  add column booking_payload jsonb,
  add column appointment_id uuid references public.appointments(id);

create function public.crm_create_lead_with_booking(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_booking jsonb := nullif(p_input -> 'booking', 'null'::jsonb);
  v_clinic uuid;
  v_request uuid;
  v_appointment uuid;
  v_saved_booking jsonb;
  v_starts_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'Input must be an object' using errcode = '22023';
  end if;
  v_clinic := (p_input ->> 'clinic_id')::uuid;
  v_request := (p_input ->> 'request_id')::uuid;
  if v_booking is not null then
    if jsonb_typeof(v_booking) is distinct from 'object'
       or jsonb_typeof(v_booking -> 'starts_at') is distinct from 'string'
       or jsonb_typeof(v_booking -> 'reason') is distinct from 'string' then
      raise exception 'Booking time and reason are required' using errcode = '22023';
    end if;
    begin
      v_starts_at := (v_booking ->> 'starts_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Invalid booking time' using errcode = '22023';
    end;
    v_booking := jsonb_build_object(
      'starts_at', v_starts_at,
      'reason', trim(v_booking ->> 'reason')
    );
  end if;

  -- create_lead checks permissions and serializes retries with an advisory lock.
  v_result := public.create_lead(
    p_request_id => v_request,
    p_clinic_id => v_clinic,
    p_full_name => p_input ->> 'full_name',
    p_phone => p_input ->> 'phone',
    p_requested_service_id => (p_input ->> 'requested_service_id')::uuid,
    p_source => p_input ->> 'source',
    p_attribution_status => p_input ->> 'attribution_status',
    p_ad_id => (p_input ->> 'ad_id')::uuid,
    p_meta_creative_id => p_input ->> 'meta_creative_id',
    p_notes => p_input ->> 'notes',
    p_allow_inactive_ad => coalesce((p_input ->> 'allow_inactive_ad')::boolean, false)
  );

  select booking_payload, appointment_id into v_saved_booking, v_appointment
  from private.lead_creation_requests
  where clinic_id = v_clinic and requested_by = auth.uid() and request_id = v_request;

  if (v_result ->> 'replayed')::boolean then
    if v_saved_booking is distinct from v_booking then
      raise exception 'Request ID was already used with different booking data'
        using errcode = '23505';
    end if;
    return v_result || jsonb_build_object('appointment_id', v_appointment);
  end if;

  if v_booking is not null then
    v_appointment := public.crm_create_lead_booking(
      v_clinic, (v_result ->> 'lead_id')::uuid, 'new',
      v_starts_at, v_booking ->> 'reason'
    );
  end if;
  -- A booking error rolls back the lead, contact, history and receipt too.
  update private.lead_creation_requests
  set booking_payload = v_booking, appointment_id = v_appointment
  where clinic_id = v_clinic and requested_by = auth.uid() and request_id = v_request;

  return v_result || jsonb_build_object('appointment_id', v_appointment);
end;
$$;

revoke all on function public.crm_create_lead_with_booking(jsonb) from public, anon;
grant execute on function public.crm_create_lead_with_booking(jsonb) to authenticated;

-- =============================================================================
-- Migration: 20261003211059_chat_lead_link.sql
-- =============================================================================


-- =============================================================================
-- Migration: 20261004094210_chat_lead_link.sql
-- =============================================================================
alter table public.chat_conversations
  add column lead_id uuid,
  add column lead_linked_at timestamptz,
  add column lead_linked_by uuid references public.profiles(id),

  add constraint chat_conversations_lead_same_clinic_fk
    foreign key (clinic_id, lead_id)
    references public.leads (clinic_id, id);

create index chat_conversations_lead_idx
  on public.chat_conversations (clinic_id, lead_id)
  where lead_id is not null;

create function public.crm_link_chat_lead(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.chat_conversations;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if not (
    private.is_platform_admin()
    or coalesce(
      private.current_clinic_role(p_clinic_id) in (
        'moderator',
        'agency_follow_up',
        'clinic_customer_service',
        'clinic_manager'
      ),
      false
    )
  ) then
    raise exception 'FORBIDDEN'
      using errcode = '42501';
  end if;

  select *
  into v_conversation
  from public.chat_conversations
  where id = p_conversation_id
    and clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_conversation.lead_id = p_lead_id then
    return jsonb_build_object(
      'conversation_id', v_conversation.id,
      'lead_id', v_conversation.lead_id,
      'replayed', true
    );
  end if;

  if v_conversation.lead_id is not null then
    raise exception 'CONVERSATION_ALREADY_LINKED'
      using errcode = '23505';
  end if;

  perform 1
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'LEAD_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  update public.chat_conversations
  set lead_id = p_lead_id,
      lead_linked_at = now(),
      lead_linked_by = auth.uid()
  where id = p_conversation_id
    and clinic_id = p_clinic_id;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'lead_id', p_lead_id,
    'replayed', false
  );
end;
$$;

revoke all
on function public.crm_link_chat_lead(uuid, uuid, uuid)
from public, anon;

grant execute
on function public.crm_link_chat_lead(uuid, uuid, uuid)
to authenticated;

-- =============================================================================
-- Migration: 20261004213049_clinic_customer_service_follow_up.sql
-- =============================================================================
-- Clinic schedule settings.
-- ISO weekdays: Monday = 1, Sunday = 7.

create table public.clinic_booking_settings (
  clinic_id uuid primary key
    references public.clinics(id) on delete restrict,

  timezone text not null default 'Africa/Cairo'
    check (timezone = 'Africa/Cairo'),

  working_days integer[] not null default '{}'
    check (
      working_days <@ array[1, 2, 3, 4, 5, 6, 7]
      and array_position(working_days, null) is null
      and cardinality(working_days) <= 7
    ),

  opens_at time not null default '13:00',
  closes_at time not null default '01:00',

  slot_minutes integer not null default 30
    check (slot_minutes in (10, 20, 30, 60)),

  slot_capacity integer not null default 1
    check (slot_capacity between 1 and 100),

  enabled boolean not null default false,

  updated_at timestamptz not null default now(),

  constraint clinic_booking_hours_differ
    check (opens_at <> closes_at)
);

alter table public.clinic_booking_settings
  enable row level security;

revoke all on public.clinic_booking_settings
  from public, anon, authenticated;

grant select, insert, update
  on public.clinic_booking_settings
  to authenticated;

create policy clinic_booking_settings_read
on public.clinic_booking_settings
for select
to authenticated
using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) in (
    'moderator',
    'agency_follow_up',
    'clinic_customer_service',
    'clinic_manager',
    'doctor'
  )
);

create policy clinic_booking_settings_insert
on public.clinic_booking_settings
for insert
to authenticated
with check (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) = 'clinic_manager'
);

create policy clinic_booking_settings_update
on public.clinic_booking_settings
for update
to authenticated
using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) = 'clinic_manager'
)
with check (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) = 'clinic_manager'
);

-- =============================================================================
-- Migration: 20261004231752_enforce_clinic_booking_capacity.sql
-- =============================================================================
create or replace function public.crm_create_lead_booking(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_starts_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_settings public.clinic_booking_settings%rowtype;

  v_old_status text;
  v_service_id uuid;
  v_appointment_id uuid;

  v_local_start timestamp without time zone;
  v_shift_date date;
  v_local_open timestamp without time zone;
  v_local_close timestamp without time zone;
  v_closes_at timestamptz;
  v_ends_at timestamptz;

  v_slot_seconds integer;
  v_offset_seconds numeric;
  v_occupied bigint;
begin
  -- Authentication and clinic permissions.
  if v_actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  v_role := private.current_clinic_role(p_clinic_id);

  if private.is_platform_admin() is not true
     and coalesce(
       v_role in ('clinic_manager', 'clinic_customer_service'),
       false
     ) = false then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_starts_at is null
     or not isfinite(p_starts_at)
     or p_starts_at <= clock_timestamp()
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000 then
    raise exception 'Future time and reason are required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.clinics
    where id = p_clinic_id
      and archived_at is null
  ) then
    raise exception 'Clinic unavailable'
      using errcode = '22023';
  end if;

  -- A fresh snapshot after the lock is required for capacity checks.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Booking requires read committed isolation'
      using errcode = '22023';
  end if;

  -- Serialize bookings for this clinic.
  -- Also prevent settings from changing during the booking.
  select *
  into v_settings
  from public.clinic_booking_settings
  where clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'BOOKING_SETTINGS_REQUIRED'
      using errcode = '22023';
  end if;

  if not v_settings.enabled then
    raise exception 'BOOKING_DISABLED'
      using errcode = '22023';
  end if;

  if v_settings.timezone <> 'Africa/Cairo'
     or v_settings.slot_minutes not in (10, 20, 30, 60)
     or v_settings.slot_capacity < 1
     or v_settings.opens_at = v_settings.closes_at then
    raise exception 'INVALID_BOOKING_SETTINGS'
      using errcode = '22023';
  end if;

  -- The request may have waited for another booking.
  if p_starts_at <= clock_timestamp() then
    raise exception 'Booking time has passed'
      using errcode = '22023';
  end if;

  v_slot_seconds := v_settings.slot_minutes * 60;
  v_local_start := p_starts_at at time zone 'Africa/Cairo';
  v_shift_date := v_local_start::date;

  -- After-midnight slots belong to the previous working day's shift.
  if v_settings.closes_at < v_settings.opens_at
     and v_local_start::time < v_settings.closes_at then
    v_shift_date := v_shift_date - 1;
  end if;

  if not (
    extract(isodow from v_shift_date)::integer
    = any(v_settings.working_days)
  ) then
    raise exception 'CLINIC_CLOSED'
      using errcode = '22023';
  end if;

  v_local_open := v_shift_date + v_settings.opens_at;
  v_local_close := v_shift_date + v_settings.closes_at;

  if v_settings.closes_at < v_settings.opens_at then
    v_local_close := v_local_close + interval '1 day';
  end if;

  -- Validate the local slot grid, including fractional seconds.
  v_offset_seconds := extract(
    epoch from (v_local_start - v_local_open)
  );

  if v_local_start < v_local_open
     or v_local_start >= v_local_close
     or mod(v_offset_seconds, v_slot_seconds) <> 0
     or v_local_start + make_interval(
       mins => v_settings.slot_minutes
     ) > v_local_close then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  v_closes_at := v_local_close at time zone 'Africa/Cairo';

  -- Reject a closing clock time skipped by a DST transition.
  if (v_closes_at at time zone 'Africa/Cairo')
     is distinct from v_local_close then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(
    mins => v_settings.slot_minutes
  );

  if v_ends_at > v_closes_at then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  -- Preserve the existing lead concurrency and service checks.
  select status, requested_service_id
  into v_old_status, v_service_id
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable'
      using errcode = '22023';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user'
      using errcode = '40001';
  end if;

  if v_old_status = 'converted'
     or not exists (
       select 1
       from public.clinic_services cs
       join public.services s on s.id = cs.service_id
       where cs.clinic_id = p_clinic_id
         and cs.service_id = v_service_id
         and cs.is_active
         and s.is_active
     ) then
    raise exception 'Lead cannot be booked'
      using errcode = '22023';
  end if;

  -- Count overlapping non-cancelled appointments.
  -- Legacy appointments without ends_at use the current slot duration.
  select count(*)
  into v_occupied
  from public.appointments a
  where a.clinic_id = p_clinic_id
    and a.archived_at is null
    and a.status <> 'cancelled'
    and a.starts_at < v_ends_at
    and coalesce(
      a.ends_at,
      a.starts_at + make_interval(
        mins => v_settings.slot_minutes
      )
    ) > p_starts_at;

  if v_occupied >= v_settings.slot_capacity then
    raise exception 'BOOKING_SLOT_FULL'
      using errcode = '40001';
  end if;

  insert into public.appointments (
    clinic_id,
    lead_id,
    booked_service_id,
    starts_at,
    ends_at,
    status,
    booking_origin,
    created_by,
    confirmed_by,
    confirmed_at,
    notes
  )
  values (
    p_clinic_id,
    p_lead_id,
    v_service_id,
    p_starts_at,
    v_ends_at,
    'confirmed',
    'clinic',
    v_actor,
    v_actor,
    now(),
    trim(p_reason)
  )
  returning id into v_appointment_id;

  insert into public.appointment_events (
    clinic_id,
    appointment_id,
    event_type,
    performed_by,
    new_status,
    new_starts_at,
    reason
  )
  values (
    p_clinic_id,
    v_appointment_id,
    'created',
    v_actor,
    'confirmed',
    p_starts_at,
    trim(p_reason)
  );

  update public.leads
  set status = 'converted'
  where id = p_lead_id
    and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id,
    lead_id,
    event_type,
    performed_by,
    notes,
    changes
  )
  values (
    p_clinic_id,
    p_lead_id,
    'status_changed',
    v_actor,
    trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', 'converted',
      'appointment_id', v_appointment_id,
      'starts_at', p_starts_at,
      'ends_at', v_ends_at
    )
  );

  return v_appointment_id;
end;
$$;

revoke all on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) to authenticated;

-- =============================================================================
-- Migration: 20261005061532_clinic_booking_follow_up_workflow.sql
-- =============================================================================
-- Follow-up state. Existing appointments retain their current status.
alter table public.appointments
  add column follow_up_at timestamptz,
  add column no_answer_count integer not null default 0
    check (no_answer_count between 0 and 3),
  add column last_contact_at timestamptz,
  add column follow_up_version integer not null default 0
    check (follow_up_version >= 0);

alter table public.leads
  add column no_answer_count integer not null default 0
    check (no_answer_count between 0 and 3),
  add column last_contact_at timestamptz,
  add column follow_up_version integer not null default 0
    check (follow_up_version >= 0);

alter table public.appointment_events
  add column details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object');

alter table public.appointment_events
  drop constraint appointment_events_event_type_check;

alter table public.appointment_events
  add constraint appointment_events_event_type_check
  check (
    event_type in (
      'created',
      'status_changed',
      'rescheduled',
      'archived',
      'restored',
      'contact_attempted'
    )
  );

create index appointments_pending_follow_up_idx
  on public.appointments (clinic_id, follow_up_at)
  where archived_at is null and status = 'pending';

create index leads_follow_up_due_idx
  on public.leads (clinic_id, next_follow_up_at)
  where archived_at is null
    and status in ('new', 'in_progress', 'no_answer', 'follow_up');


-- Shared authorization for the new workflow.
create function private.can_manage_booking_follow_up(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      private.is_platform_admin()
      or coalesce(
        private.current_clinic_role(p_clinic_id) in (
          'clinic_manager',
          'clinic_customer_service',
          'moderator'
        ),
        false
      )
    )
    and exists (
      select 1
      from public.clinics
      where id = p_clinic_id
        and archived_at is null
    );
$$;

revoke all on function private.can_manage_booking_follow_up(uuid)
from public, anon, authenticated;


-- Validates one slot and returns its end time.
-- Public callers must check permissions before calling this helper.
-- The settings row lock remains held until the transaction finishes.
create function private.check_clinic_booking_slot(
  p_clinic_id uuid,
  p_starts_at timestamptz,
  p_exclude_appointment_id uuid default null
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings public.clinic_booking_settings%rowtype;
  v_local_start timestamp without time zone;
  v_shift_date date;
  v_local_open timestamp without time zone;
  v_local_close timestamp without time zone;
  v_closes_at timestamptz;
  v_ends_at timestamptz;
  v_offset_seconds numeric;
  v_occupied bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Booking requires read committed isolation'
      using errcode = '22023';
  end if;

  select *
  into v_settings
  from public.clinic_booking_settings
  where clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'BOOKING_SETTINGS_REQUIRED'
      using errcode = '22023';
  end if;

  if not v_settings.enabled then
    raise exception 'BOOKING_DISABLED'
      using errcode = '22023';
  end if;

  if p_starts_at is null
     or not isfinite(p_starts_at)
     or p_starts_at <= clock_timestamp() then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  if v_settings.timezone <> 'Africa/Cairo'
     or v_settings.slot_minutes not in (10, 20, 30, 60)
     or v_settings.slot_capacity < 1
     or v_settings.opens_at = v_settings.closes_at then
    raise exception 'INVALID_BOOKING_SETTINGS'
      using errcode = '22023';
  end if;

  v_local_start := p_starts_at at time zone 'Africa/Cairo';
  v_shift_date := v_local_start::date;

  if v_settings.closes_at < v_settings.opens_at
     and v_local_start::time < v_settings.closes_at then
    v_shift_date := v_shift_date - 1;
  end if;

  if not (
    extract(isodow from v_shift_date)::integer
    = any(v_settings.working_days)
  ) then
    raise exception 'CLINIC_CLOSED'
      using errcode = '22023';
  end if;

  v_local_open := v_shift_date + v_settings.opens_at;
  v_local_close := v_shift_date + v_settings.closes_at;

  if v_settings.closes_at < v_settings.opens_at then
    v_local_close := v_local_close + interval '1 day';
  end if;

  v_offset_seconds :=
    extract(epoch from (v_local_start - v_local_open));

  if v_local_start < v_local_open
     or v_local_start >= v_local_close
     or mod(
       v_offset_seconds,
       v_settings.slot_minutes * 60
     ) <> 0
     or v_local_start + make_interval(
       mins => v_settings.slot_minutes
     ) > v_local_close then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  v_closes_at := v_local_close at time zone 'Africa/Cairo';

  if (v_closes_at at time zone 'Africa/Cairo')
     is distinct from v_local_close then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  v_ends_at := p_starts_at
    + make_interval(mins => v_settings.slot_minutes);

  if v_ends_at > v_closes_at then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  select count(*)
  into v_occupied
  from public.appointments a
  where a.clinic_id = p_clinic_id
    and a.archived_at is null
    and a.status <> 'cancelled'
    and a.id is distinct from p_exclude_appointment_id
    and a.starts_at < v_ends_at
    and coalesce(
      a.ends_at,
      a.starts_at + make_interval(mins => v_settings.slot_minutes)
    ) > p_starts_at;

  if v_occupied >= v_settings.slot_capacity then
    raise exception 'BOOKING_SLOT_FULL'
      using errcode = '40001';
  end if;

  return v_ends_at;
end;
$$;

revoke all on function private.check_clinic_booking_slot(
  uuid, timestamptz, uuid
) from public, anon, authenticated;


-- Both existing-lead and new-lead booking paths use this function.
create or replace function public.crm_create_lead_booking(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_starts_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old_status text;
  v_service_id uuid;
  v_appointment_id uuid;
  v_ends_at timestamptz;
  v_follow_up_at timestamptz;
begin
  if private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000 then
    raise exception 'Booking reason is required'
      using errcode = '22023';
  end if;

  v_ends_at := private.check_clinic_booking_slot(
    p_clinic_id, p_starts_at, null
  );

  select status, requested_service_id
  into v_old_status, v_service_id
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable'
      using errcode = '22023';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user'
      using errcode = '40001';
  end if;

  if v_old_status = 'converted'
     or not exists (
       select 1
       from public.clinic_services cs
       join public.services s on s.id = cs.service_id
       where cs.clinic_id = p_clinic_id
         and cs.service_id = v_service_id
         and cs.is_active
         and s.is_active
     ) then
    raise exception 'Lead cannot be booked'
      using errcode = '22023';
  end if;

  v_follow_up_at := (
    (p_starts_at at time zone 'Africa/Cairo')::date::timestamp
    at time zone 'Africa/Cairo'
  );

  insert into public.appointments (
    clinic_id, lead_id, booked_service_id,
    starts_at, ends_at, status,
    booking_origin, created_by,
    confirmed_by, confirmed_at,
    notes, follow_up_at
  )
  values (
    p_clinic_id, p_lead_id, v_service_id,
    p_starts_at, v_ends_at, 'pending',
    'clinic', v_actor,
    null, null,
    trim(p_reason), v_follow_up_at
  )
  returning id into v_appointment_id;

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type,
    performed_by, new_status,
    new_starts_at, new_ends_at, reason, details
  )
  values (
    p_clinic_id, v_appointment_id, 'created',
    v_actor, 'pending',
    p_starts_at, v_ends_at, trim(p_reason),
    jsonb_build_object('follow_up_at', v_follow_up_at)
  );

  update public.leads
  set status = 'converted',
      next_follow_up_at = null,
      follow_up_version = follow_up_version + 1
  where id = p_lead_id
    and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id, lead_id, event_type,
    performed_by, notes, changes
  )
  values (
    p_clinic_id, p_lead_id, 'status_changed',
    v_actor, trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', 'converted',
      'appointment_id', v_appointment_id,
      'appointment_status', 'pending',
      'starts_at', p_starts_at,
      'ends_at', v_ends_at
    )
  );

  return v_appointment_id;
end;
$$;


-- One action, state update and history entry commit together.
-- expected_version prevents two staff members changing the same version.
create function public.crm_follow_up_appointment(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason text,
  p_new_starts_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.appointments%rowtype;
  v_new public.appointments%rowtype;
  v_now timestamptz;
  v_today date;
  v_due timestamptz;
  v_next timestamptz;
  v_ends_at timestamptz;
  v_count integer;
  v_event_type text;
  v_changes jsonb;
begin
  if private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_action is null
     or p_action not in ('confirm', 'no_answer', 'reschedule', 'cancel')
     or p_expected_version is null
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000
     or (p_action <> 'reschedule' and p_new_starts_at is not null) then
    raise exception 'Invalid follow-up input'
      using errcode = '22023';
  end if;

  -- Same lock order as booking: clinic settings, then appointment.
  perform 1
  from public.clinic_booking_settings
  where clinic_id = p_clinic_id
  for update;

  select *
  into v_old
  from public.appointments
  where id = p_appointment_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_old.follow_up_version <> p_expected_version then
    raise exception 'STALE_APPOINTMENT'
      using errcode = '40001';
  end if;

  if v_old.status not in ('pending', 'confirmed') then
    raise exception 'APPOINTMENT_NOT_ACTIONABLE'
      using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Africa/Cairo')::date;

  if p_action = 'confirm' then
    if v_old.status <> 'pending'
       or (v_old.starts_at at time zone 'Africa/Cairo')::date
          <> v_today then
      raise exception 'CONFIRM_VISIT_DAY_ONLY'
        using errcode = '22023';
    end if;

    update public.appointments
    set status = 'confirmed',
        confirmed_by = v_actor,
        confirmed_at = v_now,
        follow_up_at = null,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'status_changed';

  elsif p_action = 'no_answer' then
    if v_old.status <> 'pending' then
      raise exception 'PENDING_APPOINTMENT_REQUIRED'
        using errcode = '22023';
    end if;

    v_due := coalesce(
      v_old.follow_up_at,
      (
        (v_old.starts_at at time zone 'Africa/Cairo')::date::timestamp
        at time zone 'Africa/Cairo'
      )
    );

    if v_due > v_now then
      raise exception 'FOLLOW_UP_NOT_DUE'
        using errcode = '22023';
    end if;

    if v_old.no_answer_count >= 3 then
      raise exception 'MANUAL_REVIEW_REQUIRED'
        using errcode = '22023';
    end if;

    v_count := v_old.no_answer_count + 1;

    v_next := case
      when v_count = 1 then v_now + interval '5 hours'
      else (
        (v_now at time zone 'Africa/Cairo') + interval '1 day'
      ) at time zone 'Africa/Cairo'
    end;

    update public.appointments
    set no_answer_count = v_count,
        follow_up_at = v_next,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'contact_attempted';

  elsif p_action = 'reschedule' then
    if p_new_starts_at is null
       or p_new_starts_at = v_old.starts_at then
      raise exception 'Choose a different appointment time'
        using errcode = '22023';
    end if;

    v_ends_at := private.check_clinic_booking_slot(
      p_clinic_id, p_new_starts_at, p_appointment_id
    );

    v_next := (
      (p_new_starts_at at time zone 'Africa/Cairo')::date::timestamp
      at time zone 'Africa/Cairo'
    );

    update public.appointments
    set starts_at = p_new_starts_at,
        ends_at = v_ends_at,
        status = 'pending',
        confirmed_by = null,
        confirmed_at = null,
        no_answer_count = 0,
        follow_up_at = v_next,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'rescheduled';

  else
    update public.appointments
    set status = 'cancelled',
        follow_up_at = null,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'status_changed';
  end if;

  v_changes := jsonb_build_object(
    'action', p_action,
    'appointment_id', p_appointment_id,
    'old_status', v_old.status,
    'new_status', v_new.status,
    'old_starts_at', v_old.starts_at,
    'new_starts_at', v_new.starts_at,
    'old_follow_up_at', v_old.follow_up_at,
    'new_follow_up_at', v_new.follow_up_at,
    'old_no_answer_count', v_old.no_answer_count,
    'new_no_answer_count', v_new.no_answer_count,
    'version', v_new.follow_up_version
  );

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type, performed_by,
    old_status, new_status,
    old_starts_at, new_starts_at,
    old_ends_at, new_ends_at,
    reason, details
  )
  values (
    p_clinic_id, p_appointment_id, v_event_type, v_actor,
    v_old.status, v_new.status,
    v_old.starts_at, v_new.starts_at,
    v_old.ends_at, v_new.ends_at,
    trim(p_reason), v_changes
  );

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by,
    contact_channel, contact_outcome, notes, changes
  )
  values (
    p_clinic_id, v_old.lead_id, 'contact_attempted', v_actor,
    'phone',
    case when p_action = 'no_answer' then 'no_answer' else 'reached' end,
    trim(p_reason), v_changes
  );

  return jsonb_build_object(
    'appointment_id', v_new.id,
    'status', v_new.status,
    'starts_at', v_new.starts_at,
    'ends_at', v_new.ends_at,
    'follow_up_at', v_new.follow_up_at,
    'no_answer_count', v_new.no_answer_count,
    'follow_up_version', v_new.follow_up_version
  );
end;
$$;


-- Follow-up for inquiries that do not have a booking.
create function public.crm_follow_up_inquiry(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason text,
  p_next_follow_up_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.leads%rowtype;
  v_new public.leads%rowtype;
  v_now timestamptz;
  v_next timestamptz;
  v_count integer;
  v_status text;
  v_changes jsonb;
begin
  if private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_action is null
     or p_action not in ('schedule', 'no_answer', 'not_interested')
     or p_expected_version is null
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000
     or (p_action <> 'schedule' and p_next_follow_up_at is not null) then
    raise exception 'Invalid inquiry follow-up input'
      using errcode = '22023';
  end if;

  select *
  into v_old
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'LEAD_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_old.follow_up_version <> p_expected_version then
    raise exception 'STALE_LEAD'
      using errcode = '40001';
  end if;

  if v_old.status in ('converted', 'not_interested')
     or exists (
       select 1
       from public.appointments
       where clinic_id = p_clinic_id
         and lead_id = p_lead_id
         and archived_at is null
         and status <> 'cancelled'
     ) then
    raise exception 'INQUIRY_NOT_ACTIONABLE'
      using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  v_count := v_old.no_answer_count;

  if p_action = 'schedule' then
    if p_next_follow_up_at is null
       or not isfinite(p_next_follow_up_at)
       or p_next_follow_up_at <= v_now then
      raise exception 'Future follow-up time required'
        using errcode = '22023';
    end if;

    v_next := p_next_follow_up_at;
    v_count := 0;
    v_status := 'follow_up';

  elsif p_action = 'no_answer' then
    if v_old.next_follow_up_at > v_now then
      raise exception 'FOLLOW_UP_NOT_DUE'
        using errcode = '22023';
    end if;

    if v_count >= 3 then
      raise exception 'MANUAL_REVIEW_REQUIRED'
        using errcode = '22023';
    end if;

    v_count := v_count + 1;
    v_status := 'no_answer';

    v_next := case
      when v_count = 1 then v_now + interval '5 hours'
      else (
        (v_now at time zone 'Africa/Cairo') + interval '1 day'
      ) at time zone 'Africa/Cairo'
    end;

  else
    v_next := null;
    v_status := 'not_interested';
  end if;

  update public.leads
  set status = v_status,
      next_follow_up_at = v_next,
      no_answer_count = v_count,
      last_contact_at = v_now,
      follow_up_version = follow_up_version + 1
  where id = p_lead_id
  returning * into v_new;

  v_changes := jsonb_build_object(
    'action', p_action,
    'old_status', v_old.status,
    'new_status', v_new.status,
    'old_follow_up_at', v_old.next_follow_up_at,
    'new_follow_up_at', v_new.next_follow_up_at,
    'old_no_answer_count', v_old.no_answer_count,
    'new_no_answer_count', v_new.no_answer_count,
    'version', v_new.follow_up_version
  );

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by,
    contact_channel, contact_outcome, notes, changes
  )
  values (
    p_clinic_id, p_lead_id, 'contact_attempted', v_actor,
    'phone',
    case when p_action = 'no_answer' then 'no_answer' else 'reached' end,
    trim(p_reason), v_changes
  );

  if v_old.status is distinct from v_new.status then
    insert into public.lead_events (
      clinic_id, lead_id, event_type,
      performed_by, notes, changes
    )
    values (
      p_clinic_id, p_lead_id, 'status_changed',
      v_actor, trim(p_reason), v_changes
    );
  end if;

  return jsonb_build_object(
    'lead_id', v_new.id,
    'status', v_new.status,
    'next_follow_up_at', v_new.next_follow_up_at,
    'no_answer_count', v_new.no_answer_count,
    'follow_up_version', v_new.follow_up_version
  );
end;
$$;


-- Clients can call the public workflow functions.
-- Writes and permission checks remain inside those transactions.
revoke all on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) to authenticated;

revoke all on function public.crm_follow_up_appointment(
  uuid, uuid, integer, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.crm_follow_up_appointment(
  uuid, uuid, integer, text, text, timestamptz
) to authenticated;

revoke all on function public.crm_follow_up_inquiry(
  uuid, uuid, integer, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.crm_follow_up_inquiry(
  uuid, uuid, integer, text, text, timestamptz
) to authenticated;


-- Any update invalidates an older follow-up screen.
-- This also covers updates made through older functions.
create function private.bump_follow_up_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.follow_up_version := old.follow_up_version + 1;
  return new;
end;
$$;

revoke all on function private.bump_follow_up_version()
from public, anon, authenticated;

create trigger leads_bump_follow_up_version
before update on public.leads
for each row
execute function private.bump_follow_up_version();

create trigger appointments_bump_follow_up_version
before update on public.appointments
for each row
execute function private.bump_follow_up_version();


-- Keep basic lead status changes.
-- Follow-up outcomes must use crm_follow_up_inquiry,
-- where scheduling, attempts and history are saved together.
create or replace function public.crm_change_lead_status(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_new_status text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_old_status text;
  v_event_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  v_role := private.current_clinic_role(p_clinic_id);

  if private.is_platform_admin() is not true
     and coalesce(
       v_role in (
         'clinic_manager',
         'clinic_customer_service',
         'moderator',
         'doctor'
       ),
       false
     ) = false then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000
     or p_new_status is null then
    raise exception 'Status and reason are required'
      using errcode = '22023';
  end if;

  if p_new_status not in ('new', 'in_progress') then
    raise exception 'USE_FOLLOW_UP_WORKFLOW'
      using errcode = '22023';
  end if;

  select status
  into v_old_status
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable'
      using errcode = '22023';
  end if;

  if v_role = 'doctor'
     and private.is_platform_admin() is not true
     and not exists (
       select 1
       from public.appointments a
       where a.clinic_id = p_clinic_id
         and a.lead_id = p_lead_id
         and a.doctor_id = v_actor
         and a.archived_at is null
     ) then
    raise exception 'Not assigned to this lead'
      using errcode = '42501';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user'
      using errcode = '40001';
  end if;

  if v_old_status not in ('new', 'in_progress') then
    raise exception 'USE_FOLLOW_UP_WORKFLOW'
      using errcode = '22023';
  end if;

  if v_old_status = p_new_status then
    raise exception 'Invalid status transition'
      using errcode = '22023';
  end if;

  update public.leads
  set status = p_new_status
  where id = p_lead_id
    and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id,
    lead_id,
    event_type,
    performed_by,
    notes,
    changes
  )
  values (
    p_clinic_id,
    p_lead_id,
    'status_changed',
    v_actor,
    trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', p_new_status
    )
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

-- =============================================================================
-- Migration: 20261005085755_respect_clinic_follow_up_working_hours.sql
-- =============================================================================
-- Move a follow-up time forward to the next working period.
-- Booking availability being disabled does not disable customer follow-up.

create function private.next_clinic_follow_up_time(
  p_clinic_id uuid,
  p_candidate timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.clinic_booking_settings%rowtype;
  v_first_date date;
  v_shift_date date;
  v_local_open timestamp without time zone;
  v_local_close timestamp without time zone;
  v_open timestamptz;
  v_close timestamptz;
  v_offset integer;
begin
  if p_candidate is null or not isfinite(p_candidate) then
    raise exception 'Invalid follow-up time'
      using errcode = '22023';
  end if;

  select *
  into v_settings
  from public.clinic_booking_settings
  where clinic_id = p_clinic_id;

  if not found then
    raise exception 'BOOKING_SETTINGS_REQUIRED'
      using errcode = '22023';
  end if;

  if v_settings.timezone <> 'Africa/Cairo'
     or coalesce(cardinality(v_settings.working_days), 0) = 0
     or v_settings.opens_at = v_settings.closes_at then
    raise exception 'INVALID_BOOKING_SETTINGS'
      using errcode = '22023';
  end if;

  -- Include the previous day because a shift can cross midnight.
  v_first_date :=
    (p_candidate at time zone 'Africa/Cairo')::date - 1;

  for v_offset in 0..8 loop
    v_shift_date := v_first_date + v_offset;

    if not (
      extract(isodow from v_shift_date)::integer
      = any(v_settings.working_days)
    ) then
      continue;
    end if;

    v_local_open := v_shift_date + v_settings.opens_at;
    v_local_close := v_shift_date + v_settings.closes_at;

    if v_settings.closes_at < v_settings.opens_at then
      v_local_close := v_local_close + interval '1 day';
    end if;

    v_open := v_local_open at time zone 'Africa/Cairo';
    v_close := v_local_close at time zone 'Africa/Cairo';

    -- Reject nonexistent opening/closing times during DST changes.
    if (v_open at time zone 'Africa/Cairo')
         is distinct from v_local_open
       or (v_close at time zone 'Africa/Cairo')
         is distinct from v_local_close
       or v_close <= v_open then
      raise exception 'INVALID_BOOKING_SETTINGS'
        using errcode = '22023';
    end if;

    if p_candidate >= v_close then
      continue;
    end if;

    -- If already inside working hours, preserve the requested time.
    -- Otherwise move forward to this shift's opening time.
    return greatest(p_candidate, v_open);
  end loop;

  raise exception 'No working period found'
    using errcode = '22023';
end;
$$;

revoke all on function private.next_clinic_follow_up_time(
  uuid, timestamptz
) from public, anon, authenticated;


-- Normalize the appointment follow-up before the existing workflow
-- receives its updated row and writes the history.
create function private.normalize_appointment_no_answer_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.no_answer_count > old.no_answer_count then
    new.follow_up_at := private.next_clinic_follow_up_time(
      new.clinic_id,
      new.follow_up_at
    );
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_appointment_no_answer_time()
from public, anon, authenticated;

create trigger appointments_normalize_no_answer_time
before update on public.appointments
for each row
when (new.no_answer_count > old.no_answer_count)
execute function private.normalize_appointment_no_answer_time();


-- Apply the same rule to inquiries without a booking.
create function private.normalize_inquiry_no_answer_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.no_answer_count > old.no_answer_count then
    new.next_follow_up_at := private.next_clinic_follow_up_time(
      new.clinic_id,
      new.next_follow_up_at
    );
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_inquiry_no_answer_time()
from public, anon, authenticated;

create trigger leads_normalize_no_answer_time
before update on public.leads
for each row
when (new.no_answer_count > old.no_answer_count)
execute function private.normalize_inquiry_no_answer_time();

-- =============================================================================
-- Migration: 20261006161959_chat_ad_referral_attribution.sql
-- =============================================================================
begin;

-- Each referral is preserved as a separate event.
-- No referral means unknown attribution, not automatically organic.
create table public.chat_referrals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  conversation_id uuid not null,
  channel_id uuid not null,
  meta_ad_id text,
  source text,
  referral_type text,
  referral_ref text,
  ad_title text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  event_key text not null,

  constraint chat_referrals_conversation_same_clinic_fk
    foreign key (conversation_id, clinic_id)
    references public.chat_conversations (id, clinic_id),

  constraint chat_referrals_channel_same_clinic_fk
    foreign key (channel_id, clinic_id)
    references public.chat_channels (id, clinic_id),

  constraint chat_referrals_ad_id_check
    check (
      meta_ad_id is null
      or (
        length(meta_ad_id) between 1 and 100
        and meta_ad_id ~ '^[0-9]+$'
      )
    ),

  constraint chat_referrals_event_unique
    unique (channel_id, event_key)
);

create index chat_referrals_conversation_time_idx
  on public.chat_referrals (
    clinic_id,
    conversation_id,
    occurred_at desc,
    id desc
  );

create index chat_referrals_ad_idx
  on public.chat_referrals (clinic_id, meta_ad_id)
  where meta_ad_id is not null;

alter table public.chat_referrals enable row level security;

revoke all on public.chat_referrals
  from public, anon, authenticated;

grant select on public.chat_referrals to authenticated;
grant all on public.chat_referrals to service_role;

create policy chat_referrals_read
  on public.chat_referrals
  for select
  to authenticated
  using (private.can_read_chats(clinic_id));

-- Replace the existing consumer without changing its RPC name.
create or replace function public.crm_process_meta_inbox()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox record;
  v_entry jsonb;
  v_event jsonb;
  v_referral jsonb;
  v_candidate jsonb;

  v_channel public.chat_channels;
  v_platform text;
  v_customer text;
  v_mid text;
  v_time timestamptz;
  v_conversation uuid;

  v_echo boolean;
  v_has_message boolean;
  v_ad_id text;
  v_source text;
  v_referral_type text;
  v_ref text;
  v_ad_title text;
  v_event_key text;

  v_count integer := 0;
begin
  for v_inbox in
    select *
    from public.meta_webhook_inbox
    where processed_at is null
      and retry_at <= now()
    order by received_at
    limit 25
    for update skip locked
  loop
    begin
      v_platform := case v_inbox.payload ->> 'object'
        when 'page' then 'facebook'
        when 'instagram' then 'instagram'
        else null
      end;

      for v_entry in
        select value
        from jsonb_array_elements(
          coalesce(v_inbox.payload -> 'entry', '[]'::jsonb)
        )
      loop
        for v_event in
          select value
          from jsonb_array_elements(
            coalesce(v_entry -> 'messaging', '[]'::jsonb)
          )
        loop
          v_has_message :=
            jsonb_typeof(v_event -> 'message') = 'object';

          v_has_message := coalesce(v_has_message, false);
          v_referral := null;

          -- Supported referral locations.
          -- Select an actual object rather than a JSON null.
          foreach v_candidate in array array[
            v_event -> 'referral',
            v_event -> 'message' -> 'referral',
            v_event -> 'postback' -> 'referral'
          ]
          loop
            if jsonb_typeof(v_candidate) = 'object'
              and v_candidate <> '{}'::jsonb
            then
              v_referral := v_candidate;
              exit;
            end if;
          end loop;

          -- Ignore receipts and unrelated events.
          if not v_has_message and v_referral is null then
            continue;
          end if;

          if v_has_message
            and coalesce(
              v_event -> 'message' ->> 'is_deleted',
              'false'
            ) = 'true'
          then
            continue;
          end if;

          v_mid := null;

          if v_has_message then
            v_mid := v_event -> 'message' ->> 'mid';

            if v_mid is null or length(v_mid) = 0 then
              raise exception 'MESSAGE_ID_MISSING';
            end if;
          end if;

          select *
          into v_channel
          from public.chat_channels
          where platform = v_platform
            and asset_id = v_entry ->> 'id'
            and is_active;

          if not found then
            raise exception 'CHANNEL_NOT_CONFIGURED';
          end if;

          perform pg_advisory_xact_lock(
            hashtextextended(v_channel.id::text, 0)
          );

          v_echo := coalesce(
            (v_event -> 'message' ->> 'is_echo')::boolean,
            false
          );

          if (
            not v_echo
            and v_event -> 'recipient' ->> 'id'
              is distinct from v_channel.asset_id
          ) or (
            v_echo
            and v_event -> 'sender' ->> 'id'
              is distinct from v_channel.asset_id
          ) then
            raise exception 'ASSET_MISMATCH';
          end if;

          v_customer := case
            when v_echo then v_event -> 'recipient' ->> 'id'
            else v_event -> 'sender' ->> 'id'
          end;

          if v_customer is null or length(v_customer) = 0 then
            raise exception 'CUSTOMER_ID_MISSING';
          end if;

          v_time := to_timestamp(
            (v_event ->> 'timestamp')::double precision / 1000
          );

          if v_time is null
            or not isfinite(v_time)
            or v_time > now() + interval '5 minutes'
          then
            raise exception 'INVALID_EVENT_TIME';
          end if;

          -- Referral-only events can create a conversation,
          -- but cannot open the customer-message reply window.
          insert into public.chat_conversations (
            clinic_id,
            channel_id,
            customer_id,
            last_message_at,
            last_customer_message_at
          )
          values (
            v_channel.clinic_id,
            v_channel.id,
            v_customer,
            v_time,
            case
              when v_has_message and not v_echo then v_time
              else null
            end
          )
          on conflict (channel_id, customer_id)
          do update set
            last_message_at = greatest(
              chat_conversations.last_message_at,
              excluded.last_message_at
            ),
            last_customer_message_at = greatest(
              chat_conversations.last_customer_message_at,
              excluded.last_customer_message_at
            )
          returning id into v_conversation;

          -- Preserve incoming referral history.
          -- An outgoing echo must not attribute the customer to an ad.
          if v_referral is not null and not v_echo then
            v_ad_id := nullif(
              trim(v_referral ->> 'ad_id'),
              ''
            );

            -- Invalid ad identifiers remain unknown.
            if v_ad_id is not null and (
              length(v_ad_id) > 100
              or v_ad_id !~ '^[0-9]+$'
            ) then
              v_ad_id := null;
            end if;

            v_source := nullif(
              left(trim(v_referral ->> 'source'), 100),
              ''
            );

            v_referral_type := nullif(
              left(trim(v_referral ->> 'type'), 100),
              ''
            );

            v_ref := nullif(
              left(v_referral ->> 'ref', 2000),
              ''
            );

            v_ad_title := nullif(
              left(
                v_referral -> 'ads_context_data' ->> 'ad_title',
                500
              ),
              ''
            );

            -- Stable dedupe across repeated webhook deliveries.
            v_event_key := md5(
              jsonb_build_array(
                v_customer,
                v_event ->> 'timestamp',
                v_ad_id,
                v_source,
                v_referral_type,
                v_ref
              )::text
            );

            insert into public.chat_referrals (
              clinic_id,
              conversation_id,
              channel_id,
              meta_ad_id,
              source,
              referral_type,
              referral_ref,
              ad_title,
              occurred_at,
              event_key
            )
            values (
              v_channel.clinic_id,
              v_conversation,
              v_channel.id,
              v_ad_id,
              v_source,
              v_referral_type,
              v_ref,
              v_ad_title,
              v_time,
              v_event_key
            )
            on conflict (channel_id, event_key)
            do nothing;
          end if;

          -- Keep the existing message storage and dedupe behavior.
          if v_has_message then
            insert into public.chat_messages (
              clinic_id,
              conversation_id,
              channel_id,
              provider_message_id,
              direction,
              text,
              attachments,
              status,
              occurred_at
            )
            values (
              v_channel.clinic_id,
              v_conversation,
              v_channel.id,
              v_mid,
              case when v_echo then 'outgoing' else 'incoming' end,
              v_event -> 'message' ->> 'text',
              coalesce(
                v_event -> 'message' -> 'attachments',
                '[]'::jsonb
              ),
              case when v_echo then 'sent' else 'received' end,
              v_time
            )
            on conflict (channel_id, provider_message_id)
            do nothing;
          end if;
        end loop;
      end loop;

      update public.meta_webhook_inbox
      set processed_at = now(),
          last_error = null
      where id = v_inbox.id;

      v_count := v_count + 1;

    exception when others then
      -- Roll back this payload's writes and retain it for retry.
      update public.meta_webhook_inbox
      set attempts = attempts + 1,
          retry_at = now() + interval '1 minute',
          last_error = left(sqlerrm, 200)
      where id = v_inbox.id;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.crm_process_meta_inbox()
  from public, anon, authenticated;

grant execute on function public.crm_process_meta_inbox()
  to service_role;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime
      add table public.chat_referrals;
  end if;
end;
$$;

commit;

-- =============================================================================
-- Migration: 20261007124829_doctor_scheduling.sql
-- =============================================================================
begin;

-- Doctors can exist without a CRM login account.
create table public.clinic_doctors (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  full_name text not null
    check (length(trim(full_name)) between 1 and 200),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  unique (clinic_id, id)
);

-- Each row represents one physical device.
-- Example: Laser 1 and Laser 2 are separate rows.
create table public.clinic_devices (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  device_name text not null
    check (length(trim(device_name)) between 1 and 200),

  device_type text not null
    check (length(trim(device_type)) between 1 and 100),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  unique (clinic_id, id)
);

-- Duration belongs to the doctor + service combination.
create table public.clinic_doctor_services (
  clinic_id uuid not null,

  doctor_id uuid not null,

  service_id uuid not null,

  duration_minutes integer not null
    check (duration_minutes between 1 and 1440),

  requires_device boolean not null default false,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  primary key (clinic_id, doctor_id, service_id),

  foreign key (clinic_id, doctor_id)
    references public.clinic_doctors(clinic_id, id)
    on delete restrict,

  foreign key (clinic_id, service_id)
    references public.clinic_services(clinic_id, service_id)
    on delete restrict
);

-- Physical devices this doctor may use for this service.
-- Booking will select one available device from these rows.
create table public.clinic_doctor_service_devices (
  clinic_id uuid not null,

  doctor_id uuid not null,

  service_id uuid not null,

  device_id uuid not null,

  is_active boolean not null default true,

  primary key (
    clinic_id,
    doctor_id,
    service_id,
    device_id
  ),

  foreign key (clinic_id, doctor_id, service_id)
    references public.clinic_doctor_services(
      clinic_id,
      doctor_id,
      service_id
    )
    on delete restrict,

  foreign key (clinic_id, device_id)
    references public.clinic_devices(clinic_id, id)
    on delete restrict
);

-- Weekly working periods for a doctor OR a device.
-- ISO weekdays: Monday = 1, Sunday = 7.
-- Multiple rows per day allow split shifts and breaks.
create table public.clinic_resource_working_periods (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  doctor_id uuid,

  device_id uuid,

  iso_weekday integer not null
    check (iso_weekday between 1 and 7),

  starts_at time not null,

  ends_at time not null,

  -- 0: ends on the same day.
  -- 1: ends on the following day.
  end_day_offset integer not null default 0
    check (end_day_offset in (0, 1)),

  is_active boolean not null default true,

  constraint working_period_one_resource check (
    (doctor_id is not null and device_id is null)
    or
    (doctor_id is null and device_id is not null)
  ),

  constraint working_period_valid_times check (
    (
      end_day_offset = 0
      and ends_at > starts_at
    )
    or
    (
      end_day_offset = 1
      and ends_at <= starts_at
    )
  ),

  foreign key (clinic_id, doctor_id)
    references public.clinic_doctors(clinic_id, id)
    on delete restrict,

  foreign key (clinic_id, device_id)
    references public.clinic_devices(clinic_id, id)
    on delete restrict
);

-- Dated exceptions: leave, breaks, maintenance, etc.
-- Times are stored as absolute timestamps.
create table public.clinic_resource_blocks (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  doctor_id uuid,

  device_id uuid,

  starts_at timestamptz not null,

  ends_at timestamptz not null,

  reason text not null
    check (length(trim(reason)) between 1 and 1000),

  created_at timestamptz not null default now(),

  constraint resource_block_one_resource check (
    (doctor_id is not null and device_id is null)
    or
    (doctor_id is null and device_id is not null)
  ),

  constraint resource_block_valid_times check (
    ends_at > starts_at
  ),

  foreign key (clinic_id, doctor_id)
    references public.clinic_doctors(clinic_id, id)
    on delete restrict,

  foreign key (clinic_id, device_id)
    references public.clinic_devices(clinic_id, id)
    on delete restrict
);

create index doctor_services_by_service_idx
  on public.clinic_doctor_services (
    clinic_id,
    service_id,
    doctor_id
  )
  where is_active;

create index doctor_service_devices_by_device_idx
  on public.clinic_doctor_service_devices (
    clinic_id,
    device_id
  );

create index working_periods_doctor_idx
  on public.clinic_resource_working_periods (
    clinic_id,
    doctor_id,
    iso_weekday
  )
  where doctor_id is not null;

create index working_periods_device_idx
  on public.clinic_resource_working_periods (
    clinic_id,
    device_id,
    iso_weekday
  )
  where device_id is not null;

create index resource_blocks_doctor_idx
  on public.clinic_resource_blocks (
    clinic_id,
    doctor_id,
    starts_at,
    ends_at
  )
  where doctor_id is not null;

create index resource_blocks_device_idx
  on public.clinic_resource_blocks (
    clinic_id,
    device_id,
    starts_at,
    ends_at
  )
  where device_id is not null;

-- Apply the same clinic-scoped permissions to all new tables.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinic_doctors',
    'clinic_devices',
    'clinic_doctor_services',
    'clinic_doctor_service_devices',
    'clinic_resource_working_periods',
    'clinic_resource_blocks'
  ]
  loop
    execute format(
      'alter table public.%I enable row level security',
      v_table
    );

    execute format(
      'revoke all privileges on table public.%I
       from public, anon, authenticated',
      v_table
    );

    execute format(
      'grant select, insert, update, delete
       on table public.%I to authenticated',
      v_table
    );

    execute format(
      'create policy scheduling_read
       on public.%I
       for select
       to authenticated
       using (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id) in (
           ''moderator'',
           ''agency_follow_up'',
           ''clinic_customer_service'',
           ''clinic_manager'',
           ''doctor''
         )
       )',
      v_table
    );

    execute format(
      'create policy scheduling_insert
       on public.%I
       for insert
       to authenticated
       with check (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id)
           = ''clinic_manager''
       )',
      v_table
    );

    execute format(
      'create policy scheduling_update
       on public.%I
       for update
       to authenticated
       using (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id)
           = ''clinic_manager''
       )
       with check (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id)
           = ''clinic_manager''
       )',
      v_table
    );

    execute format(
      'create policy scheduling_delete
       on public.%I
       for delete
       to authenticated
       using (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id)
           = ''clinic_manager''
       )',
      v_table
    );
  end loop;
end;
$$;

commit;

-- =============================================================================
-- Migration: 20261007152006_clinic_service_device_requirements.sql
-- =============================================================================
begin;

alter table public.clinic_services
  add column requires_device boolean,
  add column required_device_type text;

-- NULL: not configured yet.
-- FALSE: the service does not require a device.
-- TRUE: a device type must be specified.
alter table public.clinic_services
  add constraint clinic_service_device_requirement_check
  check (
    (
      requires_device is null
      and required_device_type is null
    )
    or
    (
      requires_device is false
      and required_device_type is null
    )
    or
    (
      requires_device is true
      and required_device_type is not null
      and length(trim(required_device_type)) between 1 and 100
      and required_device_type = lower(trim(required_device_type))
    )
  );

comment on column public.clinic_services.requires_device is
  'Clinic-wide service requirement. NULL means not configured.';

comment on column public.clinic_services.required_device_type is
  'Required device type, e.g. laser or onda. Applies to every doctor performing this clinic service.';

-- Retained temporarily for compatibility with the current API.
comment on column public.clinic_doctor_services.requires_device is
  'Deprecated. Use clinic_services.requires_device after API and UI migration.';

commit;

-- =============================================================================
-- Migration: 20261007193041_clinic_service_device_permissions.sql
-- =============================================================================
begin;

-- Allow updates only to the device requirement fields.
grant update (
  requires_device,
  required_device_type
)
on public.clinic_services
to authenticated;

create policy clinic_services_update_device_requirements
on public.clinic_services
for update
to authenticated
using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) = 'clinic_manager'
)
with check (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) = 'clinic_manager'
);

commit;

-- =============================================================================
-- Migration: 20261007202655_unified_booking_setup.sql
-- =============================================================================
begin;

-- Run after the doctor_scheduling and clinic_service_device_requirements migrations.
create table public.clinic_service_devices (
  clinic_id uuid not null,
  service_id uuid not null,
  device_id uuid not null,
  is_active boolean not null default true,
  primary key (clinic_id, service_id, device_id),
  foreign key (clinic_id, service_id)
    references public.clinic_services(clinic_id, service_id) on delete restrict,
  foreign key (clinic_id, device_id)
    references public.clinic_devices(clinic_id, id) on delete restrict
);

-- Preserve the old type-based configuration as physical device links.
insert into public.clinic_service_devices (clinic_id, service_id, device_id)
select cs.clinic_id, cs.service_id, d.id
from public.clinic_services cs
join public.clinic_devices d on d.clinic_id = cs.clinic_id
  and d.device_type = cs.required_device_type
where cs.requires_device is true
on conflict do nothing;

-- Preserve all existing doctor links, including inactive ones.
insert into public.clinic_service_devices (clinic_id, service_id, device_id, is_active)
select ds.clinic_id, ds.service_id, ds.device_id,
       coalesce(cs.requires_device is true and d.device_type = cs.required_device_type, false)
from public.clinic_doctor_service_devices ds
join public.clinic_services cs on cs.clinic_id = ds.clinic_id and cs.service_id = ds.service_id
join public.clinic_devices d on d.clinic_id = ds.clinic_id and d.id = ds.device_id
on conflict do nothing;

alter table public.clinic_doctor_service_devices
  add constraint doctor_device_belongs_to_service_fk
  foreign key (clinic_id, service_id, device_id)
  references public.clinic_service_devices(clinic_id, service_id, device_id)
  on delete restrict;

alter table public.clinic_services
  drop constraint if exists clinic_service_device_requirement_check;

comment on column public.clinic_services.required_device_type is
  'Legacy field retained for compatibility. New setup uses clinic_service_devices.';

alter table public.clinic_service_devices enable row level security;
revoke all on public.clinic_service_devices from public, anon, authenticated;
grant select on public.clinic_service_devices to authenticated;
create policy clinic_service_devices_read on public.clinic_service_devices
for select to authenticated using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) is not null
);

create function public.crm_setup_set_service_devices(
  p_clinic_id uuid, p_service_id uuid,
  p_requires_device boolean, p_device_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := coalesce(p_device_ids, '{}'::uuid[]);
begin
  if auth.uid() is null or (
    private.is_platform_admin() is not true
    and coalesce(private.current_clinic_role(p_clinic_id) = 'clinic_manager', false) is false
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic_id::text, 491));
  perform 1 from public.clinic_services
    where clinic_id = p_clinic_id and service_id = p_service_id for update;
  if not found then
    raise exception 'Clinic service not found' using errcode = '22023';
  end if;
  if p_requires_device is null
     or array_position(v_ids, null) is not null
     or (p_requires_device and cardinality(v_ids) = 0)
     or (not p_requires_device and cardinality(v_ids) <> 0)
     or cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) as ids(id))
     or exists (
       select 1 from unnest(v_ids) as ids(id)
       where not exists (
         select 1 from public.clinic_devices d
         where d.clinic_id = p_clinic_id and d.id = ids.id and d.is_active
       )
     ) then
    raise exception 'Invalid service device selection' using errcode = '22023';
  end if;

  update public.clinic_services
    set requires_device = p_requires_device, required_device_type = null
    where clinic_id = p_clinic_id and service_id = p_service_id;
  update public.clinic_service_devices set is_active = false
    where clinic_id = p_clinic_id and service_id = p_service_id;
  insert into public.clinic_service_devices (clinic_id, service_id, device_id, is_active)
    select p_clinic_id, p_service_id, id, true from unnest(v_ids) as ids(id)
    on conflict (clinic_id, service_id, device_id) do update set is_active = true;

  -- Remove permission for devices no longer allowed by this service.
  update public.clinic_doctor_service_devices set is_active = false
    where clinic_id = p_clinic_id and service_id = p_service_id
      and not (device_id = any(v_ids));
end;
$$;

create function public.crm_setup_set_doctor_service(
  p_clinic_id uuid, p_doctor_id uuid, p_service_id uuid,
  p_duration_minutes integer, p_is_active boolean, p_device_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_requires boolean;
  v_ids uuid[] := coalesce(p_device_ids, '{}'::uuid[]);
begin
  if auth.uid() is null or (
    private.is_platform_admin() is not true
    and coalesce(private.current_clinic_role(p_clinic_id) = 'clinic_manager', false) is false
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic_id::text, 491));
  if p_duration_minutes is null or p_duration_minutes not between 1 and 1440
     or p_is_active is null
     or not exists (select 1 from public.clinic_doctors
       where clinic_id = p_clinic_id and id = p_doctor_id) then
    raise exception 'Invalid doctor or duration' using errcode = '22023';
  end if;
  select requires_device into v_requires from public.clinic_services
    where clinic_id = p_clinic_id and service_id = p_service_id for update;
  if not found then
    raise exception 'Clinic service not found' using errcode = '22023';
  end if;
  if p_is_active and not exists (
    select 1 from public.clinic_services cs join public.services s on s.id = cs.service_id
    where cs.clinic_id = p_clinic_id and cs.service_id = p_service_id and cs.is_active and s.is_active
  ) then
    raise exception 'Service inactive' using errcode = '22023';
  end if;
  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) as ids(id))
     or (v_requires is not true and cardinality(v_ids) > 0)
     or (p_is_active and v_requires is true and cardinality(v_ids) = 0)
     or exists (
       select 1 from unnest(v_ids) as ids(id)
       where not exists (
         select 1 from public.clinic_service_devices sd
         join public.clinic_devices d on d.clinic_id = sd.clinic_id and d.id = sd.device_id
         where sd.clinic_id = p_clinic_id and sd.service_id = p_service_id
           and sd.device_id = ids.id and sd.is_active and d.is_active
       )
     ) then
    raise exception 'Devices must belong to this clinic service' using errcode = '22023';
  end if;
  insert into public.clinic_doctor_services (
    clinic_id, doctor_id, service_id, duration_minutes, is_active
  ) values (p_clinic_id, p_doctor_id, p_service_id, p_duration_minutes, p_is_active)
  on conflict (clinic_id, doctor_id, service_id) do update
    set duration_minutes = excluded.duration_minutes, is_active = excluded.is_active;
  update public.clinic_doctor_service_devices set is_active = false
    where clinic_id = p_clinic_id and doctor_id = p_doctor_id and service_id = p_service_id;
  insert into public.clinic_doctor_service_devices (
    clinic_id, doctor_id, service_id, device_id, is_active
  ) select p_clinic_id, p_doctor_id, p_service_id, id, true from unnest(v_ids) as ids(id)
  on conflict (clinic_id, doctor_id, service_id, device_id) do update set is_active = true;
end;
$$;

revoke all on function public.crm_setup_set_service_devices(uuid, uuid, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.crm_setup_set_service_devices(uuid, uuid, boolean, uuid[])
  to authenticated;
revoke all on function public.crm_setup_set_doctor_service(uuid, uuid, uuid, integer, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.crm_setup_set_doctor_service(uuid, uuid, uuid, integer, boolean, uuid[])
  to authenticated;
commit;

-- =============================================================================
-- Migration: 20261007210026_appointment_resources.sql
-- =============================================================================
begin;

-- Required for equality comparisons in GiST exclusion constraints.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = pg_catalog, public, extensions;

-- doctor_id already references a clinic user account.
-- resource_doctor_id references the doctor added in booking setup.
-- Existing appointments retain NULL resource fields until explicitly assigned.
alter table public.appointments
  add column resource_doctor_id uuid,
  add column device_id uuid,
  add column duration_minutes integer,
  add column assignment_mode text;

comment on column public.appointments.resource_doctor_id is
  'Scheduling doctor from clinic_doctors; independent of legacy doctor_id.';

comment on column public.appointments.device_id is
  'One physical device reserved for this appointment, or NULL for a service without a device.';

comment on column public.appointments.duration_minutes is
  'Duration snapshot when booked. Changing doctor service settings does not change existing appointments.';

comment on column public.appointments.assignment_mode is
  'specific or auto; NULL for legacy appointments without assigned scheduling resources.';

alter table public.appointments
  add constraint appointments_resource_fields_check
  check (
    (
      resource_doctor_id is null
      and device_id is null
      and duration_minutes is null
      and assignment_mode is null
    )
    or
    (
      resource_doctor_id is not null
      and duration_minutes is not null
      and duration_minutes between 1 and 1440
      and assignment_mode is not null
      and assignment_mode in ('specific', 'auto')
      and ends_at is not null
      and ends_at - starts_at = make_interval(mins => duration_minutes)
    )
  ),

  add constraint appointments_resource_doctor_same_clinic_fk
  foreign key (clinic_id, resource_doctor_id)
  references public.clinic_doctors (clinic_id, id)
  on delete restrict,

  add constraint appointments_resource_doctor_service_fk
  foreign key (clinic_id, resource_doctor_id, booked_service_id)
  references public.clinic_doctor_services (clinic_id, doctor_id, service_id)
  on delete restrict,

  add constraint appointments_device_same_clinic_fk
  foreign key (clinic_id, device_id)
  references public.clinic_devices (clinic_id, id)
  on delete restrict,

  add constraint appointments_resource_doctor_service_device_fk
  foreign key (
    clinic_id,
    resource_doctor_id,
    booked_service_id,
    device_id
  )
  references public.clinic_doctor_service_devices (
    clinic_id,
    doctor_id,
    service_id,
    device_id
  )
  on delete restrict;

-- [start, end): another appointment may start exactly when this one ends.
-- Pending appointments reserve resources too, before phone confirmation.
-- Cancelled or archived appointments release their reservation.
-- GiST exclusions also protect against simultaneous booking requests.
alter table public.appointments
  add constraint appointments_resource_doctor_no_overlap
  exclude using gist (
    clinic_id with =,
    resource_doctor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    resource_doctor_id is not null
    and archived_at is null
    and status <> 'cancelled'
  ),

  add constraint appointments_device_no_overlap
  exclude using gist (
    clinic_id with =,
    device_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    device_id is not null
    and archived_at is null
    and status <> 'cancelled'
  );

commit;

-- =============================================================================
-- Migration: 20261007212301_hybrid_booking.sql
-- =============================================================================
begin;

-- Serialize resource configuration and reservations within each clinic.
-- Uses the same lock key as the existing booking-setup RPCs.
create function private.crm_lock_booking_resources()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  -- Clinic IDs are immutable in the setup API, but lock both if SQL moves a row.
  for v_clinic_id in
    select distinct id
    from unnest(array[
      case when tg_op <> 'INSERT' then old.clinic_id else null end,
      case when tg_op <> 'DELETE' then new.clinic_id else null end
    ]) as clinics(id)
    where id is not null
    order by id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_clinic_id::text, 491)
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.crm_lock_booking_resources()
from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinic_doctors',
    'clinic_devices',
    'clinic_services',
    'clinic_doctor_services',
    'clinic_service_devices',
    'clinic_doctor_service_devices',
    'clinic_resource_working_periods',
    'clinic_resource_blocks',
    'appointments'
  ] loop
    execute format(
      'create trigger crm_resource_lock before insert or update or delete on public.%I '
      'for each row execute function private.crm_lock_booking_resources()',
      v_table
    );
  end loop;
end;
$$;

-- Private helper; caller holds the clinic transaction lock.
-- A service uses one physical device. Device working periods are not consulted.
create function private.crm_resource_slot_available(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_device_id uuid,
  p_exclude_appointment_id uuid default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_requires_device boolean;
  v_ends_at timestamptz;
  v_day date;
  v_work tstzmultirange;
  v_blocks tstzmultirange;
  v_invalid_schedule boolean;
begin
  if p_starts_at is null or not isfinite(p_starts_at)
     or p_duration_minutes is null
     or p_duration_minutes not between 1 and 1440 then
    return false;
  end if;

  select cs.requires_device
  into v_requires_device
  from public.clinic_services cs
  join public.services s on s.id = cs.service_id
  join public.clinic_doctor_services ds
    on ds.clinic_id = cs.clinic_id
    and ds.service_id = cs.service_id
    and ds.doctor_id = p_doctor_id
  join public.clinic_doctors d
    on d.clinic_id = ds.clinic_id and d.id = ds.doctor_id
  where cs.clinic_id = p_clinic_id
    and cs.service_id = p_service_id
    and cs.is_active and s.is_active and ds.is_active and d.is_active;

  if not found or v_requires_device is null then
    return false;
  end if;

  if v_requires_device then
    if p_device_id is null or not exists (
      select 1
      from public.clinic_doctor_service_devices dd
      join public.clinic_service_devices sd
        on sd.clinic_id = dd.clinic_id
        and sd.service_id = dd.service_id
        and sd.device_id = dd.device_id
      join public.clinic_devices d
        on d.clinic_id = dd.clinic_id and d.id = dd.device_id
      where dd.clinic_id = p_clinic_id
        and dd.doctor_id = p_doctor_id
        and dd.service_id = p_service_id
        and dd.device_id = p_device_id
        and dd.is_active and sd.is_active and d.is_active
    ) then
      return false;
    end if;
  elsif p_device_id is not null then
    return false;
  end if;

  v_ends_at := p_starts_at + make_interval(mins => p_duration_minutes);
  v_day := (p_starts_at at time zone 'Africa/Cairo')::date;

  -- Merge connected working periods. Keep overnight periods from the day before.
  -- Reject missing or repeated Cairo clock times instead of guessing a DST offset.
  with local_periods as (
    select
      (v_day + days.offset_day) + w.starts_at as local_start,
      (v_day + days.offset_day + w.end_day_offset) + w.ends_at as local_end
    from generate_series(-1, 1) as days(offset_day)
    join public.clinic_resource_working_periods w
      on w.iso_weekday = extract(isodow from (v_day + days.offset_day))
    where w.clinic_id = p_clinic_id
      and w.doctor_id = p_doctor_id
      and w.is_active
  ), utc_periods as (
    select *,
      local_start at time zone 'Africa/Cairo' as utc_start,
      local_end at time zone 'Africa/Cairo' as utc_end
    from local_periods
  )
  select
    coalesce(range_agg(tstzrange(utc_start, utc_end, '[)')), '{}'::tstzmultirange),
    coalesce(bool_or(
      (utc_start at time zone 'Africa/Cairo') <> local_start
      or (utc_end at time zone 'Africa/Cairo') <> local_end
      or ((utc_start - interval '1 hour') at time zone 'Africa/Cairo') = local_start
      or ((utc_start + interval '1 hour') at time zone 'Africa/Cairo') = local_start
      or ((utc_end - interval '1 hour') at time zone 'Africa/Cairo') = local_end
      or ((utc_end + interval '1 hour') at time zone 'Africa/Cairo') = local_end
    ), false)
  into v_work, v_invalid_schedule
  from utc_periods;

  if v_invalid_schedule then
    raise exception 'INVALID_OR_AMBIGUOUS_SCHEDULE_TIME' using errcode = '22023';
  end if;

  select coalesce(range_agg(tstzrange(starts_at, ends_at, '[)')), '{}'::tstzmultirange)
  into v_blocks
  from public.clinic_resource_blocks
  where clinic_id = p_clinic_id
    and doctor_id = p_doctor_id
    and starts_at < v_ends_at
    and ends_at > p_starts_at;

  if not ((v_work - v_blocks) @> tstzrange(p_starts_at, v_ends_at, '[)')) then
    return false;
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.clinic_id = p_clinic_id
      and a.archived_at is null
      and a.status <> 'cancelled'
      and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
      and a.starts_at < v_ends_at
      and (a.ends_at is null or a.ends_at > p_starts_at)
      and (
        a.resource_doctor_id is null
        or a.resource_doctor_id = p_doctor_id
        or (p_device_id is not null and a.device_id = p_device_id)
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function private.crm_resource_slot_available(
  uuid, uuid, uuid, timestamptz, integer, uuid, uuid
) from public, anon, authenticated;

-- Validate resource changes even if a legacy reschedule RPC writes the row.
-- Phone confirmation and follow-up updates do not run this trigger.
create function private.crm_validate_resource_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.resource_doctor_id is null then
    -- During UI migration, do not let an unassigned legacy write overlap
    -- a reservation that already owns a doctor/device. Its owner is unknown.
    if new.archived_at is null and new.status <> 'cancelled' and exists (
      select 1 from public.appointments a
      where a.clinic_id = new.clinic_id
        and a.id <> new.id
        and a.resource_doctor_id is not null
        and a.archived_at is null and a.status <> 'cancelled'
        and (new.ends_at is null or a.starts_at < new.ends_at)
        and a.ends_at > new.starts_at
    ) then
      raise exception 'LEGACY_BOOKING_REQUIRES_RESOURCE_ASSIGNMENT'
        using errcode = '23P01';
    end if;
    return new;
  end if;

  if not private.crm_resource_slot_available(
    new.clinic_id,
    new.resource_doctor_id,
    new.booked_service_id,
    new.starts_at,
    new.duration_minutes,
    new.device_id,
    new.id
  ) then
    raise exception 'BOOKING_RESOURCE_UNAVAILABLE' using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function private.crm_validate_resource_appointment()
from public, anon, authenticated;

create trigger crm_resource_validate
before insert or update of
  clinic_id, booked_service_id, resource_doctor_id, device_id,
  duration_minutes, starts_at, ends_at
on public.appointments
for each row execute function private.crm_validate_resource_appointment();

-- Adds a new RPC; the old booking endpoint stays available until UI migration.
create function public.crm_create_hybrid_booking(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_starts_at timestamptz,
  p_assignment_mode text,
  p_doctor_id uuid,
  p_device_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old_status text;
  v_service_id uuid;
  v_requires_device boolean;
  v_candidate record;
  v_device_id uuid;
  v_doctor_id uuid;
  v_duration integer;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_follow_up_at timestamptz;
begin
  -- Preserve existing booking permissions rather than grant a new role implicitly.
  if v_actor is null
     or private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_expected_status is null
     or p_starts_at is null
     or not isfinite(p_starts_at)
     or p_starts_at < statement_timestamp()
     or p_assignment_mode is null
     or p_assignment_mode not in ('specific', 'auto')
     or (p_assignment_mode = 'specific' and p_doctor_id is null)
     or (p_assignment_mode = 'auto' and p_doctor_id is not null)
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000 then
    raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_clinic_id::text, 491)
  );

  select status, requested_service_id
  into v_old_status, v_service_id
  from public.leads
  where id = p_lead_id and clinic_id = p_clinic_id and archived_at is null
  for update;

  if not found then
    raise exception 'LEAD_UNAVAILABLE' using errcode = '22023';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'LEAD_CHANGED' using errcode = '40001';
  end if;

  if v_old_status = 'converted' then
    raise exception 'LEAD_ALREADY_BOOKED' using errcode = '22023';
  end if;

  -- Protect catalog activation against a concurrent global service edit.
  perform 1
  from public.services s
  join public.clinic_services cs on cs.service_id = s.id
  where cs.clinic_id = p_clinic_id and cs.service_id = v_service_id
    and cs.is_active and s.is_active
  for share of s;

  if not found then
    raise exception 'SERVICE_UNAVAILABLE' using errcode = '22023';
  end if;

  select requires_device into v_requires_device
  from public.clinic_services
  where clinic_id = p_clinic_id and service_id = v_service_id;

  if v_requires_device is null then
    raise exception 'SERVICE_DEVICE_REQUIREMENT_NOT_CONFIGURED' using errcode = '22023';
  end if;
  if not v_requires_device and p_device_id is not null then
    raise exception 'SERVICE_DOES_NOT_USE_DEVICE' using errcode = '22023';
  end if;

  -- The requested start is fixed. Auto tries eligible doctors in stable ID order.
  -- No balancing rule or automatic change to the requested time is applied.
  for v_candidate in
    select d.id as doctor_id, ds.duration_minutes
    from public.clinic_doctors d
    join public.clinic_doctor_services ds
      on ds.clinic_id = d.clinic_id and ds.doctor_id = d.id
    where d.clinic_id = p_clinic_id and d.is_active
      and ds.service_id = v_service_id and ds.is_active
      and (p_assignment_mode = 'auto' or d.id = p_doctor_id)
    order by d.id
  loop
    if v_requires_device then
      for v_device_id in
        select dd.device_id
        from public.clinic_doctor_service_devices dd
        join public.clinic_service_devices sd
          on sd.clinic_id = dd.clinic_id
          and sd.service_id = dd.service_id and sd.device_id = dd.device_id
        join public.clinic_devices d
          on d.clinic_id = dd.clinic_id and d.id = dd.device_id
        where dd.clinic_id = p_clinic_id
          and dd.doctor_id = v_candidate.doctor_id
          and dd.service_id = v_service_id
          and dd.is_active and sd.is_active and d.is_active
          and (p_device_id is null or dd.device_id = p_device_id)
        order by dd.device_id
      loop
        if private.crm_resource_slot_available(
          p_clinic_id, v_candidate.doctor_id, v_service_id,
          p_starts_at, v_candidate.duration_minutes, v_device_id
        ) then
          v_doctor_id := v_candidate.doctor_id;
          v_duration := v_candidate.duration_minutes;
          exit;
        end if;
      end loop;
    elsif private.crm_resource_slot_available(
      p_clinic_id, v_candidate.doctor_id, v_service_id,
      p_starts_at, v_candidate.duration_minutes, null
    ) then
      v_doctor_id := v_candidate.doctor_id;
      v_duration := v_candidate.duration_minutes;
      v_device_id := null;
    end if;

    exit when v_doctor_id is not null;
  end loop;

  if v_doctor_id is null then
    raise exception 'BOOKING_RESOURCE_UNAVAILABLE' using errcode = '23P01';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration);
  v_follow_up_at := (
    (p_starts_at at time zone 'Africa/Cairo')::date::timestamp
    at time zone 'Africa/Cairo'
  );

  insert into public.appointments (
    clinic_id, lead_id, booked_service_id,
    resource_doctor_id, device_id, duration_minutes, assignment_mode,
    starts_at, ends_at, status, booking_origin, created_by,
    notes, follow_up_at
  ) values (
    p_clinic_id, p_lead_id, v_service_id,
    v_doctor_id, v_device_id, v_duration, p_assignment_mode,
    p_starts_at, v_ends_at, 'pending', 'clinic', v_actor,
    trim(p_reason), v_follow_up_at
  ) returning id into v_appointment_id;

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type, performed_by, new_status,
    new_starts_at, new_ends_at, reason, details
  ) values (
    p_clinic_id, v_appointment_id, 'created', v_actor, 'pending',
    p_starts_at, v_ends_at, trim(p_reason),
    jsonb_build_object(
      'resource_doctor_id', v_doctor_id, 'device_id', v_device_id,
      'duration_minutes', v_duration, 'assignment_mode', p_assignment_mode,
      'follow_up_at', v_follow_up_at
    )
  );

  update public.leads
  set status = 'converted', next_follow_up_at = null,
      follow_up_version = follow_up_version + 1
  where clinic_id = p_clinic_id and id = p_lead_id;

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by, notes, changes
  ) values (
    p_clinic_id, p_lead_id, 'status_changed', v_actor, trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status, 'new_status', 'converted',
      'appointment_id', v_appointment_id, 'appointment_status', 'pending',
      'starts_at', p_starts_at, 'ends_at', v_ends_at,
      'resource_doctor_id', v_doctor_id, 'device_id', v_device_id,
      'duration_minutes', v_duration, 'assignment_mode', p_assignment_mode
    )
  );

  return jsonb_build_object(
    'appointment_id', v_appointment_id,
    'doctor_id', v_doctor_id, 'device_id', v_device_id,
    'duration_minutes', v_duration, 'assignment_mode', p_assignment_mode,
    'starts_at', p_starts_at, 'ends_at', v_ends_at
  );
end;
$$;

revoke all on function public.crm_create_hybrid_booking(
  uuid, uuid, text, timestamptz, text, uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.crm_create_hybrid_booking(
  uuid, uuid, text, timestamptz, text, uuid, uuid, text
) to authenticated;

commit;

-- =============================================================================
-- Migration: 20261007220237_create_lead_hybrid_booking.sql
-- =============================================================================
begin;

-- Preserve the successful assignment for retries, even if its appointment is
-- later rescheduled or cancelled. Never infer the original result from new settings.
alter table private.lead_creation_requests
  add column hybrid_booking_result jsonb,
  add constraint lead_creation_hybrid_booking_result_check
  check (
    hybrid_booking_result is null
    or (
      jsonb_typeof(hybrid_booking_result) = 'object'
      and appointment_id is not null
      and jsonb_typeof(hybrid_booking_result -> 'appointment_id') is not distinct from 'string'
      and hybrid_booking_result ->> 'appointment_id' = appointment_id::text
    )
  );

create function public.crm_create_lead_with_hybrid_booking(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor uuid := auth.uid();
  v_clinic_id uuid;
  v_request_id uuid;
  v_service_id uuid;
  v_ad_id uuid;
  v_result jsonb;
  v_booking jsonb;
  v_saved_booking jsonb;
  v_booking_result jsonb;
  v_appointment_id uuid;
  v_starts_at timestamptz;
  v_mode text;
  v_doctor_id uuid;
  v_device_id uuid;
  v_reason text;
begin
  if v_actor is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'INVALID_LEAD_INPUT' using errcode = '22023';
  end if;

  begin
    v_clinic_id := (p_input ->> 'clinic_id')::uuid;
    v_request_id := (p_input ->> 'request_id')::uuid;
    v_service_id := (p_input ->> 'requested_service_id')::uuid;
    v_ad_id := (p_input ->> 'ad_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'INVALID_LEAD_INPUT' using errcode = '22023';
  end;

  if v_clinic_id is null or v_request_id is null or v_service_id is null then
    raise exception 'INVALID_LEAD_INPUT' using errcode = '22023';
  end if;

  v_booking := nullif(p_input -> 'booking', 'null'::jsonb);

  if v_booking is not null then
    if jsonb_typeof(v_booking) is distinct from 'object' then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end if;

    if exists (
      select 1 from jsonb_object_keys(v_booking) as fields(name)
      where name not in (
        'starts_at', 'assignment_mode', 'doctor_id', 'device_id', 'reason'
      )
    ) or jsonb_typeof(v_booking -> 'starts_at') is distinct from 'string'
       or jsonb_typeof(v_booking -> 'assignment_mode') is distinct from 'string'
       or jsonb_typeof(v_booking -> 'reason') is distinct from 'string'
       or (v_booking ? 'doctor_id' and jsonb_typeof(v_booking -> 'doctor_id') not in ('string', 'null'))
       or (v_booking ? 'device_id' and jsonb_typeof(v_booking -> 'device_id') not in ('string', 'null')) then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end if;

    -- Require an explicit offset; a browser's local timezone is not clinic time.
    if (v_booking ->> 'starts_at') !~* '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end if;

    begin
      v_starts_at := (v_booking ->> 'starts_at')::timestamptz;
      v_doctor_id := (v_booking ->> 'doctor_id')::uuid;
      v_device_id := (v_booking ->> 'device_id')::uuid;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end;

    v_mode := v_booking ->> 'assignment_mode';
    v_reason := trim(v_booking ->> 'reason');
    if v_mode not in ('specific', 'auto')
       or (v_mode = 'specific' and v_doctor_id is null)
       or (v_mode = 'auto' and v_doctor_id is not null)
       or nullif(v_reason, '') is null or length(v_reason) > 2000
       or v_starts_at is null or not isfinite(v_starts_at) then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end if;

    if private.can_manage_booking_follow_up(v_clinic_id) is not true then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    -- Compare canonical input on retries. Equivalent timezone representations
    -- and omitted optional device IDs describe the same request.
    v_booking := jsonb_build_object(
      'starts_at', v_starts_at,
      'assignment_mode', v_mode,
      'doctor_id', v_doctor_id,
      'device_id', v_device_id,
      'reason', v_reason
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_clinic_id::text, 491)
  );

  -- Reuse the existing contact, phone, clinic-service and ad-attribution rules.
  -- create_lead also holds its actor/clinic/request lock until this RPC finishes.
  v_result := public.create_lead(
    p_request_id => v_request_id,
    p_clinic_id => v_clinic_id,
    p_full_name => p_input ->> 'full_name',
    p_phone => p_input ->> 'phone',
    p_requested_service_id => v_service_id,
    p_source => p_input ->> 'source',
    p_attribution_status => p_input ->> 'attribution_status',
    p_ad_id => v_ad_id,
    p_meta_creative_id => p_input ->> 'meta_creative_id',
    p_notes => p_input ->> 'notes',
    p_allow_inactive_ad => coalesce((p_input ->> 'allow_inactive_ad')::boolean, false)
  );

  select booking_payload, appointment_id, hybrid_booking_result
  into v_saved_booking, v_appointment_id, v_booking_result
  from private.lead_creation_requests
  where clinic_id = v_clinic_id
    and requested_by = v_actor
    and request_id = v_request_id
  for update;

  if not found then
    raise exception 'LEAD_CREATION_RECEIPT_UNAVAILABLE' using errcode = '40001';
  end if;

  if (v_result ->> 'replayed')::boolean then
    if v_saved_booking is distinct from v_booking then
      raise exception 'REQUEST_BOOKING_CHANGED' using errcode = '23505';
    end if;

    return v_result || jsonb_build_object(
      'appointment_id', v_appointment_id,
      'booking', v_booking_result
    );
  end if;

  if v_booking is not null then
    v_booking_result := public.crm_create_hybrid_booking(
      p_clinic_id => v_clinic_id,
      p_lead_id => (v_result ->> 'lead_id')::uuid,
      p_expected_status => 'new',
      p_starts_at => v_starts_at,
      p_assignment_mode => v_mode,
      p_doctor_id => v_doctor_id,
      p_device_id => v_device_id,
      p_reason => v_reason
    );
    v_appointment_id := (v_booking_result ->> 'appointment_id')::uuid;
  end if;

  -- Any booking error rolls back contact/lead creation, touchpoints and history.
  update private.lead_creation_requests
  set booking_payload = v_booking,
      appointment_id = v_appointment_id,
      hybrid_booking_result = v_booking_result
  where clinic_id = v_clinic_id
    and requested_by = v_actor
    and request_id = v_request_id;

  return v_result || jsonb_build_object(
    'appointment_id', v_appointment_id,
    'booking', v_booking_result
  );
end;
$$;

revoke all on function public.crm_create_lead_with_hybrid_booking(jsonb)
from public, anon, authenticated;

grant execute on function public.crm_create_lead_with_hybrid_booking(jsonb)
to authenticated;

commit;

-- =============================================================================
-- Migration: 20261007222450_hybrid_booking_reschedule.sql
-- =============================================================================
begin;

-- Reschedule the existing appointment; do not create another reservation.
-- Doctor, device and booked duration remain unchanged.
create or replace function public.crm_follow_up_appointment(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason text,
  p_new_starts_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.appointments%rowtype;
  v_new public.appointments%rowtype;
  v_now timestamptz;
  v_today date;
  v_due timestamptz;
  v_next timestamptz;
  v_ends_at timestamptz;
  v_count integer;
  v_event_type text;
  v_changes jsonb;
begin
  if private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_action is null
     or p_action not in ('confirm', 'no_answer', 'reschedule', 'cancel')
     or p_expected_version is null
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000
     or (p_action <> 'reschedule' and p_new_starts_at is not null) then
    raise exception 'Invalid follow-up input'
      using errcode = '22023';
  end if;

  -- Match the resource booking lock order before locking individual rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_clinic_id::text, 491)
  );

  -- Preserve the settings lock for unassigned legacy appointments.
  perform 1
  from public.clinic_booking_settings
  where clinic_id = p_clinic_id
  for update;

  select *
  into v_old
  from public.appointments
  where id = p_appointment_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_old.follow_up_version <> p_expected_version then
    raise exception 'STALE_APPOINTMENT'
      using errcode = '40001';
  end if;

  if v_old.status not in ('pending', 'confirmed') then
    raise exception 'APPOINTMENT_NOT_ACTIONABLE'
      using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Africa/Cairo')::date;

  if p_action = 'confirm' then
    if v_old.status <> 'pending'
       or (v_old.starts_at at time zone 'Africa/Cairo')::date
          <> v_today then
      raise exception 'CONFIRM_VISIT_DAY_ONLY'
        using errcode = '22023';
    end if;

    update public.appointments
    set status = 'confirmed',
        confirmed_by = v_actor,
        confirmed_at = v_now,
        follow_up_at = null,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'status_changed';

  elsif p_action = 'no_answer' then
    if v_old.status <> 'pending' then
      raise exception 'PENDING_APPOINTMENT_REQUIRED'
        using errcode = '22023';
    end if;

    v_due := coalesce(
      v_old.follow_up_at,
      (
        (v_old.starts_at at time zone 'Africa/Cairo')::date::timestamp
        at time zone 'Africa/Cairo'
      )
    );

    if v_due > v_now then
      raise exception 'FOLLOW_UP_NOT_DUE'
        using errcode = '22023';
    end if;

    if v_old.no_answer_count >= 3 then
      raise exception 'MANUAL_REVIEW_REQUIRED'
        using errcode = '22023';
    end if;

    v_count := v_old.no_answer_count + 1;

    v_next := case
      when v_count = 1 then v_now + interval '5 hours'
      else (
        (v_now at time zone 'Africa/Cairo') + interval '1 day'
      ) at time zone 'Africa/Cairo'
    end;

    update public.appointments
    set no_answer_count = v_count,
        follow_up_at = v_next,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'contact_attempted';

  elsif p_action = 'reschedule' then
    if p_new_starts_at is null
       or p_new_starts_at = v_old.starts_at then
      raise exception 'Choose a different appointment time'
        using errcode = '22023';
    end if;

    if v_old.resource_doctor_id is null then
      -- Existing unassigned appointments keep the legacy validation path.
      v_ends_at := private.check_clinic_booking_slot(
        p_clinic_id, p_new_starts_at, p_appointment_id
      );
    else
      if not isfinite(p_new_starts_at) or p_new_starts_at <= v_now then
        raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
      end if;

      -- Keep the reserved resources and duration snapshot. Exclude this
      -- appointment so moving within its current interval remains possible.
      if not private.crm_resource_slot_available(
        p_clinic_id,
        v_old.resource_doctor_id,
        v_old.booked_service_id,
        p_new_starts_at,
        v_old.duration_minutes,
        v_old.device_id,
        p_appointment_id
      ) then
        raise exception 'BOOKING_RESOURCE_UNAVAILABLE' using errcode = '23P01';
      end if;

      v_ends_at := p_new_starts_at
        + make_interval(mins => v_old.duration_minutes);
    end if;

    v_next := (
      (p_new_starts_at at time zone 'Africa/Cairo')::date::timestamp
      at time zone 'Africa/Cairo'
    );

    update public.appointments
    set starts_at = p_new_starts_at,
        ends_at = v_ends_at,
        status = 'pending',
        confirmed_by = null,
        confirmed_at = null,
        no_answer_count = 0,
        follow_up_at = v_next,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'rescheduled';

  else
    update public.appointments
    set status = 'cancelled',
        follow_up_at = null,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'status_changed';
  end if;

  v_changes := jsonb_build_object(
    'action', p_action,
    'appointment_id', p_appointment_id,
    'old_status', v_old.status,
    'new_status', v_new.status,
    'old_starts_at', v_old.starts_at,
    'new_starts_at', v_new.starts_at,
    'old_follow_up_at', v_old.follow_up_at,
    'new_follow_up_at', v_new.follow_up_at,
    'old_no_answer_count', v_old.no_answer_count,
    'new_no_answer_count', v_new.no_answer_count,
    'resource_doctor_id', v_new.resource_doctor_id,
    'device_id', v_new.device_id,
    'duration_minutes', v_new.duration_minutes,
    'assignment_mode', v_new.assignment_mode,
    'version', v_new.follow_up_version
  );

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type, performed_by,
    old_status, new_status,
    old_starts_at, new_starts_at,
    old_ends_at, new_ends_at,
    reason, details
  )
  values (
    p_clinic_id, p_appointment_id, v_event_type, v_actor,
    v_old.status, v_new.status,
    v_old.starts_at, v_new.starts_at,
    v_old.ends_at, v_new.ends_at,
    trim(p_reason), v_changes
  );

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by,
    contact_channel, contact_outcome, notes, changes
  )
  values (
    p_clinic_id, v_old.lead_id, 'contact_attempted', v_actor,
    'phone',
    case when p_action = 'no_answer' then 'no_answer' else 'reached' end,
    trim(p_reason), v_changes
  );

  return jsonb_build_object(
    'appointment_id', v_new.id,
    'status', v_new.status,
    'starts_at', v_new.starts_at,
    'ends_at', v_new.ends_at,
    'follow_up_at', v_new.follow_up_at,
    'no_answer_count', v_new.no_answer_count,
    'follow_up_version', v_new.follow_up_version,
    'doctor_id', v_new.resource_doctor_id,
    'device_id', v_new.device_id,
    'duration_minutes', v_new.duration_minutes,
    'assignment_mode', v_new.assignment_mode
  );
end;
$$;

revoke all on function public.crm_follow_up_appointment(
  uuid, uuid, integer, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.crm_follow_up_appointment(
  uuid, uuid, integer, text, text, timestamptz
) to authenticated;

commit;

