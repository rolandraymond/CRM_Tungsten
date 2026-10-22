begin;

-- Serialize resource configuration and reservations within each clinic.
-- Uses the same lock key as the existing booking-setup RPCs.
create function private.crm_lock_booking_resources()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  -- Clinic IDs are immutable in the setup API, but lock both if SQL moves a row.
  for v_clinic_id in
    select distinct id
    from unnest(array[
      case when tg_op <> 'INSERT' then old.clinic_id else null end,
      case when tg_op <> 'DELETE' then new.clinic_id else null end
    ]) as clinics(id)
    where id is not null
    order by id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_clinic_id::text, 491)
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.crm_lock_booking_resources()
from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinic_doctors',
    'clinic_devices',
    'clinic_services',
    'clinic_doctor_services',
    'clinic_service_devices',
    'clinic_doctor_service_devices',
    'clinic_resource_working_periods',
    'clinic_resource_blocks',
    'appointments'
  ] loop
    execute format(
      'create trigger crm_resource_lock before insert or update or delete on public.%I '
      'for each row execute function private.crm_lock_booking_resources()',
      v_table
    );
  end loop;
end;
$$;

-- Private helper; caller holds the clinic transaction lock.
-- A service uses one physical device. Device working periods are not consulted.
create function private.crm_resource_slot_available(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_device_id uuid,
  p_exclude_appointment_id uuid default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_requires_device boolean;
  v_ends_at timestamptz;
  v_day date;
  v_work tstzmultirange;
  v_blocks tstzmultirange;
  v_invalid_schedule boolean;
begin
  if p_starts_at is null or not isfinite(p_starts_at)
     or p_duration_minutes is null
     or p_duration_minutes not between 1 and 1440 then
    return false;
  end if;

  select cs.requires_device
  into v_requires_device
  from public.clinic_services cs
  join public.services s on s.id = cs.service_id
  join public.clinic_doctor_services ds
    on ds.clinic_id = cs.clinic_id
    and ds.service_id = cs.service_id
    and ds.doctor_id = p_doctor_id
  join public.clinic_doctors d
    on d.clinic_id = ds.clinic_id and d.id = ds.doctor_id
  where cs.clinic_id = p_clinic_id
    and cs.service_id = p_service_id
    and cs.is_active and s.is_active and ds.is_active and d.is_active;

  if not found or v_requires_device is null then
    return false;
  end if;

  if v_requires_device then
    if p_device_id is null or not exists (
      select 1
      from public.clinic_doctor_service_devices dd
      join public.clinic_service_devices sd
        on sd.clinic_id = dd.clinic_id
        and sd.service_id = dd.service_id
        and sd.device_id = dd.device_id
      join public.clinic_devices d
        on d.clinic_id = dd.clinic_id and d.id = dd.device_id
      where dd.clinic_id = p_clinic_id
        and dd.doctor_id = p_doctor_id
        and dd.service_id = p_service_id
        and dd.device_id = p_device_id
        and dd.is_active and sd.is_active and d.is_active
    ) then
      return false;
    end if;
  elsif p_device_id is not null then
    return false;
  end if;

  v_ends_at := p_starts_at + make_interval(mins => p_duration_minutes);
  v_day := (p_starts_at at time zone 'Africa/Cairo')::date;

  -- Merge connected working periods. Keep overnight periods from the day before.
  -- Reject missing or repeated Cairo clock times instead of guessing a DST offset.
  with local_periods as (
    select
      (v_day + days.offset_day) + w.starts_at as local_start,
      (v_day + days.offset_day + w.end_day_offset) + w.ends_at as local_end
    from generate_series(-1, 1) as days(offset_day)
    join public.clinic_resource_working_periods w
      on w.iso_weekday = extract(isodow from (v_day + days.offset_day))
    where w.clinic_id = p_clinic_id
      and w.doctor_id = p_doctor_id
      and w.is_active
  ), utc_periods as (
    select *,
      local_start at time zone 'Africa/Cairo' as utc_start,
      local_end at time zone 'Africa/Cairo' as utc_end
    from local_periods
  )
  select
    coalesce(range_agg(tstzrange(utc_start, utc_end, '[)')), '{}'::tstzmultirange),
    coalesce(bool_or(
      (utc_start at time zone 'Africa/Cairo') <> local_start
      or (utc_end at time zone 'Africa/Cairo') <> local_end
      or ((utc_start - interval '1 hour') at time zone 'Africa/Cairo') = local_start
      or ((utc_start + interval '1 hour') at time zone 'Africa/Cairo') = local_start
      or ((utc_end - interval '1 hour') at time zone 'Africa/Cairo') = local_end
      or ((utc_end + interval '1 hour') at time zone 'Africa/Cairo') = local_end
    ), false)
  into v_work, v_invalid_schedule
  from utc_periods;

  if v_invalid_schedule then
    raise exception 'INVALID_OR_AMBIGUOUS_SCHEDULE_TIME' using errcode = '22023';
  end if;

  select coalesce(range_agg(tstzrange(starts_at, ends_at, '[)')), '{}'::tstzmultirange)
  into v_blocks
  from public.clinic_resource_blocks
  where clinic_id = p_clinic_id
    and doctor_id = p_doctor_id
    and starts_at < v_ends_at
    and ends_at > p_starts_at;

  if not ((v_work - v_blocks) @> tstzrange(p_starts_at, v_ends_at, '[)')) then
    return false;
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.clinic_id = p_clinic_id
      and a.archived_at is null
      and a.status <> 'cancelled'
      and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
      and a.starts_at < v_ends_at
      and (a.ends_at is null or a.ends_at > p_starts_at)
      and (
        a.resource_doctor_id is null
        or a.resource_doctor_id = p_doctor_id
        or (p_device_id is not null and a.device_id = p_device_id)
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function private.crm_resource_slot_available(
  uuid, uuid, uuid, timestamptz, integer, uuid, uuid
) from public, anon, authenticated;

-- Validate resource changes even if a legacy reschedule RPC writes the row.
-- Phone confirmation and follow-up updates do not run this trigger.
create function private.crm_validate_resource_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.resource_doctor_id is null then
    -- During UI migration, do not let an unassigned legacy write overlap
    -- a reservation that already owns a doctor/device. Its owner is unknown.
    if new.archived_at is null and new.status <> 'cancelled' and exists (
      select 1 from public.appointments a
      where a.clinic_id = new.clinic_id
        and a.id <> new.id
        and a.resource_doctor_id is not null
        and a.archived_at is null and a.status <> 'cancelled'
        and (new.ends_at is null or a.starts_at < new.ends_at)
        and a.ends_at > new.starts_at
    ) then
      raise exception 'LEGACY_BOOKING_REQUIRES_RESOURCE_ASSIGNMENT'
        using errcode = '23P01';
    end if;
    return new;
  end if;

  if not private.crm_resource_slot_available(
    new.clinic_id,
    new.resource_doctor_id,
    new.booked_service_id,
    new.starts_at,
    new.duration_minutes,
    new.device_id,
    new.id
  ) then
    raise exception 'BOOKING_RESOURCE_UNAVAILABLE' using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function private.crm_validate_resource_appointment()
from public, anon, authenticated;

create trigger crm_resource_validate
before insert or update of
  clinic_id, booked_service_id, resource_doctor_id, device_id,
  duration_minutes, starts_at, ends_at
on public.appointments
for each row execute function private.crm_validate_resource_appointment();

-- Adds a new RPC; the old booking endpoint stays available until UI migration.
create function public.crm_create_hybrid_booking(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_starts_at timestamptz,
  p_assignment_mode text,
  p_doctor_id uuid,
  p_device_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old_status text;
  v_service_id uuid;
  v_requires_device boolean;
  v_candidate record;
  v_device_id uuid;
  v_doctor_id uuid;
  v_duration integer;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_follow_up_at timestamptz;
begin
  -- Preserve existing booking permissions rather than grant a new role implicitly.
  if v_actor is null
     or private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_expected_status is null
     or p_starts_at is null
     or not isfinite(p_starts_at)
     or p_starts_at < statement_timestamp()
     or p_assignment_mode is null
     or p_assignment_mode not in ('specific', 'auto')
     or (p_assignment_mode = 'specific' and p_doctor_id is null)
     or (p_assignment_mode = 'auto' and p_doctor_id is not null)
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000 then
    raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_clinic_id::text, 491)
  );

  select status, requested_service_id
  into v_old_status, v_service_id
  from public.leads
  where id = p_lead_id and clinic_id = p_clinic_id and archived_at is null
  for update;

  if not found then
    raise exception 'LEAD_UNAVAILABLE' using errcode = '22023';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'LEAD_CHANGED' using errcode = '40001';
  end if;

  if v_old_status = 'converted' then
    raise exception 'LEAD_ALREADY_BOOKED' using errcode = '22023';
  end if;

  -- Protect catalog activation against a concurrent global service edit.
  perform 1
  from public.services s
  join public.clinic_services cs on cs.service_id = s.id
  where cs.clinic_id = p_clinic_id and cs.service_id = v_service_id
    and cs.is_active and s.is_active
  for share of s;

  if not found then
    raise exception 'SERVICE_UNAVAILABLE' using errcode = '22023';
  end if;

  select requires_device into v_requires_device
  from public.clinic_services
  where clinic_id = p_clinic_id and service_id = v_service_id;

  if v_requires_device is null then
    raise exception 'SERVICE_DEVICE_REQUIREMENT_NOT_CONFIGURED' using errcode = '22023';
  end if;
  if not v_requires_device and p_device_id is not null then
    raise exception 'SERVICE_DOES_NOT_USE_DEVICE' using errcode = '22023';
  end if;

  -- The requested start is fixed. Auto tries eligible doctors in stable ID order.
  -- No balancing rule or automatic change to the requested time is applied.
  for v_candidate in
    select d.id as doctor_id, ds.duration_minutes
    from public.clinic_doctors d
    join public.clinic_doctor_services ds
      on ds.clinic_id = d.clinic_id and ds.doctor_id = d.id
    where d.clinic_id = p_clinic_id and d.is_active
      and ds.service_id = v_service_id and ds.is_active
      and (p_assignment_mode = 'auto' or d.id = p_doctor_id)
    order by d.id
  loop
    if v_requires_device then
      for v_device_id in
        select dd.device_id
        from public.clinic_doctor_service_devices dd
        join public.clinic_service_devices sd
          on sd.clinic_id = dd.clinic_id
          and sd.service_id = dd.service_id and sd.device_id = dd.device_id
        join public.clinic_devices d
          on d.clinic_id = dd.clinic_id and d.id = dd.device_id
        where dd.clinic_id = p_clinic_id
          and dd.doctor_id = v_candidate.doctor_id
          and dd.service_id = v_service_id
          and dd.is_active and sd.is_active and d.is_active
          and (p_device_id is null or dd.device_id = p_device_id)
        order by dd.device_id
      loop
        if private.crm_resource_slot_available(
          p_clinic_id, v_candidate.doctor_id, v_service_id,
          p_starts_at, v_candidate.duration_minutes, v_device_id
        ) then
          v_doctor_id := v_candidate.doctor_id;
          v_duration := v_candidate.duration_minutes;
          exit;
        end if;
      end loop;
    elsif private.crm_resource_slot_available(
      p_clinic_id, v_candidate.doctor_id, v_service_id,
      p_starts_at, v_candidate.duration_minutes, null
    ) then
      v_doctor_id := v_candidate.doctor_id;
      v_duration := v_candidate.duration_minutes;
      v_device_id := null;
    end if;

    exit when v_doctor_id is not null;
  end loop;

  if v_doctor_id is null then
    raise exception 'BOOKING_RESOURCE_UNAVAILABLE' using errcode = '23P01';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration);
  v_follow_up_at := (
    (p_starts_at at time zone 'Africa/Cairo')::date::timestamp
    at time zone 'Africa/Cairo'
  );

  insert into public.appointments (
    clinic_id, lead_id, booked_service_id,
    resource_doctor_id, device_id, duration_minutes, assignment_mode,
    starts_at, ends_at, status, booking_origin, created_by,
    notes, follow_up_at
  ) values (
    p_clinic_id, p_lead_id, v_service_id,
    v_doctor_id, v_device_id, v_duration, p_assignment_mode,
    p_starts_at, v_ends_at, 'pending', 'clinic', v_actor,
    trim(p_reason), v_follow_up_at
  ) returning id into v_appointment_id;

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type, performed_by, new_status,
    new_starts_at, new_ends_at, reason, details
  ) values (
    p_clinic_id, v_appointment_id, 'created', v_actor, 'pending',
    p_starts_at, v_ends_at, trim(p_reason),
    jsonb_build_object(
      'resource_doctor_id', v_doctor_id, 'device_id', v_device_id,
      'duration_minutes', v_duration, 'assignment_mode', p_assignment_mode,
      'follow_up_at', v_follow_up_at
    )
  );

  update public.leads
  set status = 'converted', next_follow_up_at = null,
      follow_up_version = follow_up_version + 1
  where clinic_id = p_clinic_id and id = p_lead_id;

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by, notes, changes
  ) values (
    p_clinic_id, p_lead_id, 'status_changed', v_actor, trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status, 'new_status', 'converted',
      'appointment_id', v_appointment_id, 'appointment_status', 'pending',
      'starts_at', p_starts_at, 'ends_at', v_ends_at,
      'resource_doctor_id', v_doctor_id, 'device_id', v_device_id,
      'duration_minutes', v_duration, 'assignment_mode', p_assignment_mode
    )
  );

  return jsonb_build_object(
    'appointment_id', v_appointment_id,
    'doctor_id', v_doctor_id, 'device_id', v_device_id,
    'duration_minutes', v_duration, 'assignment_mode', p_assignment_mode,
    'starts_at', p_starts_at, 'ends_at', v_ends_at
  );
end;
$$;

revoke all on function public.crm_create_hybrid_booking(
  uuid, uuid, text, timestamptz, text, uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.crm_create_hybrid_booking(
  uuid, uuid, text, timestamptz, text, uuid, uuid, text
) to authenticated;

commit;
