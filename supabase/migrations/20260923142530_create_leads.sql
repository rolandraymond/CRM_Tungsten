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