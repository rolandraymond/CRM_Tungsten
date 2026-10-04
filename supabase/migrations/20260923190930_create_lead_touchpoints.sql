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