create table public.clinics (
  id uuid primary key default gen_random_uuid(),

  name text not null
    check (length(trim(name)) > 0),

  created_at timestamptz not null default now(),

  archived_at timestamptz
);

alter table public.clinics enable row level security;