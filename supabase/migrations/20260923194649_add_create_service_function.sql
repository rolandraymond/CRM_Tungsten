create function public.create_service(
  p_service_code text,
  p_service_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_code text;
  v_service_name text;
  v_service_id uuid;
begin
  -- Require a signed-in user.
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  -- Require explicit service-management permission.
  if private.can_manage_services() is not true then
    raise exception 'You do not have permission to manage services'
      using errcode = '42501';
  end if;

  -- Normalize and validate inputs.
  v_service_code := lower(trim(p_service_code));
  v_service_name := trim(p_service_name);

  if v_service_code is null or v_service_code = '' then
    raise exception 'Service code is required'
      using errcode = '22023';
  end if;

  if v_service_name is null or v_service_name = '' then
    raise exception 'Service name is required'
      using errcode = '22023';
  end if;

  -- Insert the service and return its ID.
  insert into public.services (
    service_code,
    service_name
  )
  values (
    v_service_code,
    v_service_name
  )
  returning id into v_service_id;

  return v_service_id;
end;
$$;

revoke all on function public.create_service(text, text)
from public, anon, authenticated;

grant execute on function public.create_service(text, text)
to authenticated;