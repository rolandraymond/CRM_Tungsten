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