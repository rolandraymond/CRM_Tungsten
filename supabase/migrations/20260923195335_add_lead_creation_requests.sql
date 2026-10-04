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