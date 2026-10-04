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