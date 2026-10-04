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