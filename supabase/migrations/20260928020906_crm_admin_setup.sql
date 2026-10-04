begin;

create or replace function public.crm_admin_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin();
$$;


create or replace function public.crm_activate_finance_client(
  p_finance_id bigint,
  p_name text,
  p_clinic_id uuid default null,
  p_services jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
  v_count integer;
  v_service uuid;
  v_item jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  if p_finance_id is null
     or p_finance_id < 1
     or nullif(btrim(p_name), '') is null
     or p_services is null
     or jsonb_typeof(p_services) <> 'array' then
    raise exception 'Invalid input'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crm-finance-client:' || p_finance_id::text,
      0
    )
  );

  select
    count(*),
    (array_agg(clinic_id))[1]
  into v_count, v_clinic
  from public.clinic_finance_links
  where finance_client_id = p_finance_id;

  if v_count > 1 then
    raise exception
      'Multiple existing clinic mappings require review'
      using errcode = '22023';
  end if;

  if v_clinic is not null
     and p_clinic_id is not null
     and v_clinic <> p_clinic_id then
    raise exception 'Client already linked to another clinic'
      using errcode = '22023';
  end if;

  if v_clinic is null then
    if p_clinic_id is null then
      insert into public.clinics(name)
      values (btrim(p_name))
      returning id into v_clinic;
    else
      v_clinic := p_clinic_id;
    end if;

    perform 1
    from public.clinics
    where id = v_clinic
      and archived_at is null
    for update;

    if not found then
      raise exception 'Clinic unavailable'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.clinic_finance_links
      where clinic_id = v_clinic
    ) then
      raise exception 'Clinic already linked'
        using errcode = '22023';
    end if;

    insert into public.clinic_finance_links(
      clinic_id,
      finance_client_id,
      created_by
    )
    values (
      v_clinic,
      p_finance_id,
      auth.uid()
    );

  else
    perform 1
    from public.clinics
    where id = v_clinic
      and archived_at is null
    for update;

    if not found then
      raise exception 'Clinic unavailable'
        using errcode = '22023';
    end if;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_services)
    order by (value->>'id')::bigint
  loop
    if coalesce((v_item->>'id')::bigint, 0) < 1
       or nullif(btrim(v_item->>'service_code'), '') is null
       or nullif(btrim(v_item->>'service_name'), '') is null then
      raise exception 'Invalid service'
        using errcode = '22023';
    end if;

    insert into public.services(
      finance_service_id,
      service_code,
      service_name,
      is_active
    )
    values (
      (v_item->>'id')::bigint,
      lower(btrim(v_item->>'service_code')),
      btrim(v_item->>'service_name'),
      true
    )
    on conflict (finance_service_id)
    do update set
      service_code = excluded.service_code,
      service_name = excluded.service_name,
      is_active = true
    returning id into v_service;

    insert into public.clinic_services(
      clinic_id,
      service_id,
      is_active
    )
    values (
      v_clinic,
      v_service,
      true
    )
    on conflict (clinic_id, service_id)
    do update set is_active = true;
  end loop;

  return v_clinic;
end;
$$;


create or replace function public.crm_add_local_service(
  p_clinic_id uuid,
  p_code text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_name), '') is null
     or p_code is null
     or p_code !~ '^[a-z0-9][a-z0-9_]{0,63}$' then
    raise exception 'Invalid service'
      using errcode = '22023';
  end if;

  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Clinic unavailable'
      using errcode = '22023';
  end if;

  insert into public.services(
    service_code,
    service_name
  )
  values (
    p_code,
    btrim(p_name)
  )
  returning id into v_id;

  insert into public.clinic_services(
    clinic_id,
    service_id
  )
  values (
    p_clinic_id,
    v_id
  );

  return v_id;
end;
$$;


create or replace function public.crm_set_clinic_service(
  p_clinic_id uuid,
  p_service_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'Invalid state'
      using errcode = '22023';
  end if;

  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Clinic unavailable'
      using errcode = '22023';
  end if;

  perform 1
  from public.services
  where id = p_service_id
    and is_active = true
  for share;

  if not found then
    raise exception 'Service unavailable'
      using errcode = '22023';
  end if;

  insert into public.clinic_services(
    clinic_id,
    service_id,
    is_active
  )
  values (
    p_clinic_id,
    p_service_id,
    p_enabled
  )
  on conflict (clinic_id, service_id)
  do update set is_active = excluded.is_active;
end;
$$;


revoke all on function public.crm_admin_status()
from public, anon, authenticated;

revoke all on function
public.crm_activate_finance_client(bigint,text,uuid,jsonb)
from public, anon, authenticated;

revoke all on function
public.crm_add_local_service(uuid,text,text)
from public, anon, authenticated;

revoke all on function
public.crm_set_clinic_service(uuid,uuid,boolean)
from public, anon, authenticated;


grant execute on function public.crm_admin_status()
to authenticated;

grant execute on function
public.crm_activate_finance_client(bigint,text,uuid,jsonb)
to authenticated;

grant execute on function
public.crm_add_local_service(uuid,text,text)
to authenticated;

grant execute on function
public.crm_set_clinic_service(uuid,uuid,boolean)
to authenticated;

commit;