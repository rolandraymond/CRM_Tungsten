create function public.crm_create_lead_booking(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_starts_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_old_status text;
  v_service_id uuid;
  v_appointment_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := private.current_clinic_role(p_clinic_id);
  if private.is_platform_admin() is not true
     and coalesce(v_role in ('clinic_manager', 'clinic_customer_service'), false) = false then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_starts_at is null or p_starts_at <= now()
     or nullif(trim(p_reason), '') is null or length(p_reason) > 2000 then
    raise exception 'Future time and reason are required' using errcode = '22023';
  end if;

  select status, requested_service_id into v_old_status, v_service_id
  from public.leads
  where id = p_lead_id and clinic_id = p_clinic_id and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable' using errcode = '22023';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user' using errcode = '40001';
  end if;

  if v_old_status = 'converted' or not exists (
    select 1 from public.clinic_services cs
    join public.services s on s.id = cs.service_id
    where cs.clinic_id = p_clinic_id and cs.service_id = v_service_id
      and cs.is_active and s.is_active
  ) then
    raise exception 'Lead cannot be booked' using errcode = '22023';
  end if;

  insert into public.appointments (
    clinic_id, lead_id, booked_service_id, starts_at, status,
    booking_origin, created_by, confirmed_by, confirmed_at, notes
  ) values (
    p_clinic_id, p_lead_id, v_service_id, p_starts_at, 'confirmed',
    'clinic', v_actor, v_actor, now(), trim(p_reason)
  ) returning id into v_appointment_id;

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type, performed_by,
    new_status, new_starts_at, reason
  ) values (
    p_clinic_id, v_appointment_id, 'created', v_actor,
    'confirmed', p_starts_at, trim(p_reason)
  );

  update public.leads set status = 'converted'
  where id = p_lead_id and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by, notes, changes
  ) values (
    p_clinic_id, p_lead_id, 'status_changed', v_actor, trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', 'converted',
      'appointment_id', v_appointment_id,
      'starts_at', p_starts_at
    )
  );

  return v_appointment_id;
end;
$$;

revoke all on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) to authenticated;