create function public.set_clinic_service(
  p_clinic_id uuid,
  p_service_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_is_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if private.is_platform_admin() is not true then
    raise exception 'Only platform admins can manage clinic services'
      using errcode = '42501';
  end if;

  if p_clinic_id is null
     or p_service_id is null
     or p_is_active is null then
    raise exception 'Clinic, service and active status are required'
      using errcode = '22023';
  end if;

  -- Keep the clinic available throughout this operation.
  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Clinic not found or archived'
      using errcode = '22023';
  end if;

  -- Read and lock the service while validating its status.
  select service.is_active
  into v_service_is_active
  from public.services as service
  where service.id = p_service_id
  for share;

  if not found then
    raise exception 'Service not found'
      using errcode = '22023';
  end if;

  if p_is_active and not v_service_is_active then
    raise exception 'Cannot enable an inactive service'
      using errcode = '22023';
  end if;

  insert into public.clinic_services (
    clinic_id,
    service_id,
    is_active
  )
  values (
    p_clinic_id,
    p_service_id,
    p_is_active
  )
  on conflict (clinic_id, service_id)
  do update
    set is_active = excluded.is_active;
end;
$$;

revoke all on function public.set_clinic_service(uuid, uuid, boolean)
from public, anon, authenticated;

grant execute
on function public.set_clinic_service(uuid, uuid, boolean)
to authenticated;