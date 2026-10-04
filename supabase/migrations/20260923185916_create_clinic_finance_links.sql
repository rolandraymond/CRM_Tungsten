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