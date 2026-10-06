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