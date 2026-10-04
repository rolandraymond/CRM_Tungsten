create table public.clinic_ads (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  finance_ad_id bigint
    check (finance_ad_id > 0),

  meta_ad_id text not null
    check (meta_ad_id ~ '^[0-9]+$'),

  meta_ad_account_id text not null
    check (meta_ad_account_id ~ '^[0-9]+$'),

  meta_campaign_id text
    check (meta_campaign_id ~ '^[0-9]+$'),

  meta_adset_id text
    check (meta_adset_id ~ '^[0-9]+$'),

  meta_creative_id text
    check (meta_creative_id ~ '^[0-9]+$'),

  ad_name text not null
    check (length(trim(ad_name)) > 0),

  caption text,

  thumbnail_url text,

  preview_url text,

  creative_variants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(creative_variants) = 'array'),

  advertised_service_id uuid,

  meta_effective_status text,

  is_selectable boolean not null default true,

  last_synced_at timestamptz,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  archived_at timestamptz,

constraint clinic_ads_meta_ad_unique
  unique (meta_ad_id),

constraint clinic_ads_finance_ad_unique
  unique (finance_ad_id),

  constraint clinic_ads_clinic_id_id_unique
    unique (clinic_id, id),

  constraint clinic_ads_service_same_clinic_fk
    foreign key (clinic_id, advertised_service_id)
    references public.clinic_services (clinic_id, service_id)
    on delete restrict
);

create index clinic_ads_campaign_idx
  on public.clinic_ads (clinic_id, meta_campaign_id);

create index clinic_ads_service_idx
  on public.clinic_ads (clinic_id, advertised_service_id);

create index clinic_ads_picker_idx
  on public.clinic_ads (clinic_id, ad_name)
  where archived_at is null
    and is_selectable = true
    and meta_effective_status = 'ACTIVE';

alter table public.clinic_ads
  enable row level security;

revoke all privileges
on table public.clinic_ads
from public, anon, authenticated;