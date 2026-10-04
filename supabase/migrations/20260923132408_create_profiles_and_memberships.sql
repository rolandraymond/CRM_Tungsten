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