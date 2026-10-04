begin;

create or replace function public.crm_sync_finance_ads(
  p_clinic_id uuid,
  p_finance_id bigint,
  p_ads jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  affected integer;
  total integer := 0;
begin
  if not private.is_platform_admin() then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  perform 1
  from public.clinic_finance_links
  where clinic_id = p_clinic_id
    and finance_client_id = p_finance_id
  for update;

  if not found or not exists (
    select 1
    from public.clinics
    where id = p_clinic_id
      and archived_at is null
  ) then
    raise exception 'Clinic link is unavailable'
      using errcode = '22023';
  end if;

  if p_ads is null or jsonb_typeof(p_ads) <> 'array' then
    raise exception 'Expected ads array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_ads) > 10000 then
    raise exception 'Too many ads'
      using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_ads)
  loop
    if (item->>'finance_client_id')::bigint
         is distinct from p_finance_id
      or item->>'finance_ad_id' is null
      or item->>'meta_synced_at' is null
    then
      raise exception 'Invalid ad source'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.clinic_ads
      where (
        meta_ad_id = item->>'meta_ad_id'
        or finance_ad_id = (item->>'finance_ad_id')::bigint
      )
      and (
        clinic_id <> p_clinic_id
        or meta_ad_id <> item->>'meta_ad_id'
        or (
          finance_ad_id is not null
          and finance_ad_id <> (item->>'finance_ad_id')::bigint
        )
      )
    ) then
      raise exception 'Ad is already linked elsewhere'
        using errcode = '23505';
    end if;

    insert into public.clinic_ads as existing (
      clinic_id,
      finance_ad_id,
      meta_ad_id,
      meta_ad_account_id,
      meta_campaign_id,
      meta_adset_id,
      meta_creative_id,
      ad_name,
      caption,
      thumbnail_url,
      creative_variants,
      meta_effective_status,
      last_synced_at
    )
    values (
      p_clinic_id,
      (item->>'finance_ad_id')::bigint,
      item->>'meta_ad_id',
      item->>'meta_ad_account_id',
      item->>'meta_campaign_id',
      item->>'meta_adset_id',
      item->>'meta_creative_id',
      item->>'ad_name',
      item->>'caption',
      item->>'thumbnail_url',
      coalesce(item->'caption_variants', '[]'::jsonb),
      item->>'meta_effective_status',
      (item->>'meta_synced_at')::timestamptz
    )
    on conflict (meta_ad_id) do update set
      finance_ad_id = excluded.finance_ad_id,
      meta_ad_account_id = excluded.meta_ad_account_id,
      meta_campaign_id = excluded.meta_campaign_id,
      meta_adset_id = excluded.meta_adset_id,
      meta_creative_id = excluded.meta_creative_id,
      ad_name = excluded.ad_name,
      caption = excluded.caption,
      thumbnail_url = excluded.thumbnail_url,
      creative_variants = excluded.creative_variants,
      meta_effective_status = excluded.meta_effective_status,
      last_synced_at = excluded.last_synced_at
    where existing.clinic_id = p_clinic_id
      and (
        existing.last_synced_at is null
        or excluded.last_synced_at >= existing.last_synced_at
      );

    get diagnostics affected = row_count;
    total := total + affected;
  end loop;

  return total;
end;
$$;

revoke all
on function public.crm_sync_finance_ads(uuid, bigint, jsonb)
from public, anon, authenticated;

grant execute
on function public.crm_sync_finance_ads(uuid, bigint, jsonb)
to authenticated;

commit;