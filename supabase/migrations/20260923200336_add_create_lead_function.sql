-- Copy into a new migration created AFTER finalize_lead_service_reference
-- and add_lead_creation_requests. Do not run against production before tests.
-- Public RPC: create a contact if needed, a lead, its first touchpoint,
-- its creation event, and an idempotency receipt in one transaction.
create function public.create_lead(
  p_request_id uuid,
  p_clinic_id uuid,
  p_full_name text,
  p_phone text,
  p_requested_service_id uuid,
  p_source text,
  p_attribution_status text,
  p_ad_id uuid default null,
  p_meta_creative_id text default null,
  p_notes text default null,
  p_allow_inactive_ad boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_name text := nullif(trim(p_full_name), '');
  v_phone text := nullif(trim(p_phone), '');
  v_notes text := nullif(trim(p_notes), '');
  v_service_name text;
  v_payload jsonb;
  v_receipt private.lead_creation_requests%rowtype;
  v_contact public.contacts%rowtype;
  v_ad public.clinic_ads%rowtype;
  v_lead_id uuid;
  v_contact_type text;
  v_creative_id text;
begin
  -- 1. Authentication and authorization. Never trust an actor from the client.
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_request_id is null or p_clinic_id is null then
    raise exception 'Request ID and clinic are required' using errcode = '22023';
  end if;

  -- Lock active membership so it cannot be disabled mid-operation.
  select membership.role into v_role
  from public.clinic_memberships as membership
  where membership.clinic_id = p_clinic_id
    and membership.user_id = v_actor
    and membership.is_active = true
  for share;

  if private.is_platform_admin() is not true
     and coalesce(v_role in (
       'moderator', 'agency_follow_up',
       'clinic_customer_service', 'clinic_manager'
     ), false) = false then
    raise exception 'Not authorized to create leads for this clinic'
      using errcode = '42501';
  end if;

  perform 1 from public.clinics
  where id = p_clinic_id and archived_at is null
  for share;
  if not found then
    raise exception 'Clinic not found or archived' using errcode = '22023';
  end if;

  -- 2. Canonical input contract: the UI must send an international phone.
  if v_name is null or v_phone is null
     or p_requested_service_id is null
     or p_allow_inactive_ad is null then
    raise exception 'Name, phone, service and ad-selection flag are required'
      using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Phone must use international format, for example +201012345678'
      using errcode = '22023';
  end if;
  if p_source is null or p_source not in (
    'paid_instagram', 'paid_facebook', 'tiktok', 'whatsapp',
    'organic_instagram', 'organic_facebook', 'website', 'other'
  ) then
    raise exception 'Invalid source' using errcode = '22023';
  end if;
  if p_attribution_status is null or p_attribution_status not in (
    'exact_ad', 'creative_only', 'unknown', 'not_applicable'
  ) then
    raise exception 'Invalid attribution status' using errcode = '22023';
  end if;

  -- The receipt compares canonical user input, not mutable catalog values.
  v_payload := jsonb_build_object(
    'full_name', v_name, 'phone', v_phone,
    'requested_service_id', p_requested_service_id,
    'source', p_source, 'attribution_status', p_attribution_status,
    'ad_id', p_ad_id, 'meta_creative_id', p_meta_creative_id,
    'notes', v_notes, 'allow_inactive_ad', p_allow_inactive_ad
  );

  -- 3. Serialize retries for this actor/clinic/request until commit or rollback.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      jsonb_build_array('create_lead', p_clinic_id, v_actor, p_request_id)::text,
      0
    )
  );

  select receipt.* into v_receipt
  from private.lead_creation_requests as receipt
  where receipt.clinic_id = p_clinic_id
    and receipt.requested_by = v_actor
    and receipt.request_id = p_request_id;

  if found then
    if v_receipt.request_payload is distinct from v_payload then
      raise exception 'Request ID was already used with different data'
        using errcode = '22023';
    end if;
    return jsonb_build_object('lead_id', v_receipt.lead_id, 'replayed', true);
  end if;

  -- 4. The requested service must be active globally AND at this clinic.
  select service.service_name into v_service_name
  from public.services as service
  join public.clinic_services as clinic_service
    on clinic_service.service_id = service.id
  where service.id = p_requested_service_id
    and clinic_service.clinic_id = p_clinic_id
    and service.is_active = true
    and clinic_service.is_active = true
  for share of service, clinic_service;

  if not found then
    raise exception 'Service is not available at this clinic' using errcode = '22023';
  end if;

  -- 5. Attribution: exact ad, known creative, unknown, or non-ad contact.
  if p_attribution_status = 'exact_ad' then
    if p_ad_id is null or p_meta_creative_id is not null then
      raise exception 'Select an ad; its creative ID is populated by the server'
        using errcode = '22023';
    end if;
    select ad.* into v_ad
    from public.clinic_ads as ad
    where ad.id = p_ad_id and ad.clinic_id = p_clinic_id
      and ad.archived_at is null and ad.is_selectable = true
    for share;
    if not found then
      raise exception 'Ad is not selectable for this clinic' using errcode = '22023';
    end if;
    if not p_allow_inactive_ad
       and v_ad.meta_effective_status is distinct from 'ACTIVE' then
      raise exception 'Use the previous-ads option to select a non-active ad'
        using errcode = '22023';
    end if;
    v_creative_id := v_ad.meta_creative_id;

  elsif p_attribution_status = 'creative_only' then
    if p_ad_id is not null or p_meta_creative_id is null
       or p_meta_creative_id !~ '^[0-9]+$' then
      raise exception 'Creative-only attribution requires a valid creative ID and no ad ID'
        using errcode = '22023';
    end if;
    -- Deterministic candidate used ONLY to validate clinic access;
    -- do not assign its ad ID or claim exact-ad attribution.
    perform 1 from public.clinic_ads as ad
    where ad.clinic_id = p_clinic_id
      and ad.meta_creative_id = p_meta_creative_id
      and ad.archived_at is null and ad.is_selectable = true
      and (p_allow_inactive_ad or ad.meta_effective_status = 'ACTIVE')
    order by ad.id
    limit 1
    for share;
    if not found then
      raise exception 'Creative is not selectable for this clinic'
        using errcode = '22023';
    end if;
    v_creative_id := p_meta_creative_id;

  else
    if p_ad_id is not null or p_meta_creative_id is not null then
      raise exception 'Unknown and non-ad attribution must not contain ad or creative IDs'
        using errcode = '22023';
    end if;
    if p_attribution_status = 'not_applicable'
       and p_source in ('paid_instagram', 'paid_facebook') then
      raise exception 'For an unidentified paid ad, select unknown attribution'
        using errcode = '22023';
    end if;
  end if;

  -- 6. Reuse the contact without overwriting their name.
  -- The unique clinic/phone constraint arbitrates concurrent inserts.
  insert into public.contacts (clinic_id, full_name, phone, created_by)
  values (p_clinic_id, v_name, v_phone, v_actor)
  on conflict (clinic_id, phone) do nothing
  returning * into v_contact;

  if found then
    v_contact_type := 'new_contact';
  else
    select contact.* into v_contact
    from public.contacts as contact
    where contact.clinic_id = p_clinic_id and contact.phone = v_phone
    for update;
    if not found then
      -- Safe failure if a concurrent administrative change removed the row.
      raise exception 'Contact changed concurrently; retry with the same request ID'
        using errcode = '40001';
    end if;
    if v_contact.archived_at is not null then
      raise exception 'Contact is archived; restore it before creating a lead'
        using errcode = '22023';
    end if;
    v_contact_type := 'existing_contact';
  end if;

  -- 7. Create the independent inquiry and snapshot its requested service name.
  insert into public.leads (
    clinic_id, contact_id, requested_service_id,
    requested_service_name_snapshot, source, notes,
    created_by, contact_type_at_creation
  ) values (
    p_clinic_id, v_contact.id, p_requested_service_id,
    v_service_name, p_source, v_notes, v_actor, v_contact_type
  ) returning id into v_lead_id;

  insert into public.lead_touchpoints (
    clinic_id, lead_id, source, attribution_status,
    ad_id, meta_creative_id, created_by
  ) values (
    p_clinic_id, v_lead_id, p_source, p_attribution_status,
    p_ad_id, v_creative_id, v_actor
  );

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by, changes
  ) values (
    p_clinic_id, v_lead_id, 'created', v_actor,
    jsonb_build_object(
      'contact_type_at_creation', v_contact_type,
      'requested_service_id', p_requested_service_id
    )
  );

  -- 8. Persist the successful receipt in the same transaction.
  insert into private.lead_creation_requests (
    clinic_id, requested_by, request_id, request_payload, lead_id
  ) values (
    p_clinic_id, v_actor, p_request_id, v_payload, v_lead_id
  );

  return jsonb_build_object('lead_id', v_lead_id, 'replayed', false);
end;
$$;

revoke all on function public.create_lead(
  uuid, uuid, text, text, uuid, text, text, uuid, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.create_lead(
  uuid, uuid, text, text, uuid, text, text, uuid, text, text, boolean
) to authenticated;
