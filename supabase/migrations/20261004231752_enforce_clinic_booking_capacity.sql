create or replace function public.crm_create_lead_booking(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_starts_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_settings public.clinic_booking_settings%rowtype;

  v_old_status text;
  v_service_id uuid;
  v_appointment_id uuid;

  v_local_start timestamp without time zone;
  v_shift_date date;
  v_local_open timestamp without time zone;
  v_local_close timestamp without time zone;
  v_closes_at timestamptz;
  v_ends_at timestamptz;

  v_slot_seconds integer;
  v_offset_seconds numeric;
  v_occupied bigint;
begin
  -- Authentication and clinic permissions.
  if v_actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  v_role := private.current_clinic_role(p_clinic_id);

  if private.is_platform_admin() is not true
     and coalesce(
       v_role in ('clinic_manager', 'clinic_customer_service'),
       false
     ) = false then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_starts_at is null
     or not isfinite(p_starts_at)
     or p_starts_at <= clock_timestamp()
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000 then
    raise exception 'Future time and reason are required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.clinics
    where id = p_clinic_id
      and archived_at is null
  ) then
    raise exception 'Clinic unavailable'
      using errcode = '22023';
  end if;

  -- A fresh snapshot after the lock is required for capacity checks.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Booking requires read committed isolation'
      using errcode = '22023';
  end if;

  -- Serialize bookings for this clinic.
  -- Also prevent settings from changing during the booking.
  select *
  into v_settings
  from public.clinic_booking_settings
  where clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'BOOKING_SETTINGS_REQUIRED'
      using errcode = '22023';
  end if;

  if not v_settings.enabled then
    raise exception 'BOOKING_DISABLED'
      using errcode = '22023';
  end if;

  if v_settings.timezone <> 'Africa/Cairo'
     or v_settings.slot_minutes not in (10, 20, 30, 60)
     or v_settings.slot_capacity < 1
     or v_settings.opens_at = v_settings.closes_at then
    raise exception 'INVALID_BOOKING_SETTINGS'
      using errcode = '22023';
  end if;

  -- The request may have waited for another booking.
  if p_starts_at <= clock_timestamp() then
    raise exception 'Booking time has passed'
      using errcode = '22023';
  end if;

  v_slot_seconds := v_settings.slot_minutes * 60;
  v_local_start := p_starts_at at time zone 'Africa/Cairo';
  v_shift_date := v_local_start::date;

  -- After-midnight slots belong to the previous working day's shift.
  if v_settings.closes_at < v_settings.opens_at
     and v_local_start::time < v_settings.closes_at then
    v_shift_date := v_shift_date - 1;
  end if;

  if not (
    extract(isodow from v_shift_date)::integer
    = any(v_settings.working_days)
  ) then
    raise exception 'CLINIC_CLOSED'
      using errcode = '22023';
  end if;

  v_local_open := v_shift_date + v_settings.opens_at;
  v_local_close := v_shift_date + v_settings.closes_at;

  if v_settings.closes_at < v_settings.opens_at then
    v_local_close := v_local_close + interval '1 day';
  end if;

  -- Validate the local slot grid, including fractional seconds.
  v_offset_seconds := extract(
    epoch from (v_local_start - v_local_open)
  );

  if v_local_start < v_local_open
     or v_local_start >= v_local_close
     or mod(v_offset_seconds, v_slot_seconds) <> 0
     or v_local_start + make_interval(
       mins => v_settings.slot_minutes
     ) > v_local_close then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  v_closes_at := v_local_close at time zone 'Africa/Cairo';

  -- Reject a closing clock time skipped by a DST transition.
  if (v_closes_at at time zone 'Africa/Cairo')
     is distinct from v_local_close then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(
    mins => v_settings.slot_minutes
  );

  if v_ends_at > v_closes_at then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  -- Preserve the existing lead concurrency and service checks.
  select status, requested_service_id
  into v_old_status, v_service_id
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable'
      using errcode = '22023';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user'
      using errcode = '40001';
  end if;

  if v_old_status = 'converted'
     or not exists (
       select 1
       from public.clinic_services cs
       join public.services s on s.id = cs.service_id
       where cs.clinic_id = p_clinic_id
         and cs.service_id = v_service_id
         and cs.is_active
         and s.is_active
     ) then
    raise exception 'Lead cannot be booked'
      using errcode = '22023';
  end if;

  -- Count overlapping non-cancelled appointments.
  -- Legacy appointments without ends_at use the current slot duration.
  select count(*)
  into v_occupied
  from public.appointments a
  where a.clinic_id = p_clinic_id
    and a.archived_at is null
    and a.status <> 'cancelled'
    and a.starts_at < v_ends_at
    and coalesce(
      a.ends_at,
      a.starts_at + make_interval(
        mins => v_settings.slot_minutes
      )
    ) > p_starts_at;

  if v_occupied >= v_settings.slot_capacity then
    raise exception 'BOOKING_SLOT_FULL'
      using errcode = '40001';
  end if;

  insert into public.appointments (
    clinic_id,
    lead_id,
    booked_service_id,
    starts_at,
    ends_at,
    status,
    booking_origin,
    created_by,
    confirmed_by,
    confirmed_at,
    notes
  )
  values (
    p_clinic_id,
    p_lead_id,
    v_service_id,
    p_starts_at,
    v_ends_at,
    'confirmed',
    'clinic',
    v_actor,
    v_actor,
    now(),
    trim(p_reason)
  )
  returning id into v_appointment_id;

  insert into public.appointment_events (
    clinic_id,
    appointment_id,
    event_type,
    performed_by,
    new_status,
    new_starts_at,
    reason
  )
  values (
    p_clinic_id,
    v_appointment_id,
    'created',
    v_actor,
    'confirmed',
    p_starts_at,
    trim(p_reason)
  );

  update public.leads
  set status = 'converted'
  where id = p_lead_id
    and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id,
    lead_id,
    event_type,
    performed_by,
    notes,
    changes
  )
  values (
    p_clinic_id,
    p_lead_id,
    'status_changed',
    v_actor,
    trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', 'converted',
      'appointment_id', v_appointment_id,
      'starts_at', p_starts_at,
      'ends_at', v_ends_at
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