begin;

-- Reschedule the existing appointment; do not create another reservation.
-- Doctor, device and booked duration remain unchanged.
create or replace function public.crm_follow_up_appointment(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason text,
  p_new_starts_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.appointments%rowtype;
  v_new public.appointments%rowtype;
  v_now timestamptz;
  v_today date;
  v_due timestamptz;
  v_next timestamptz;
  v_ends_at timestamptz;
  v_count integer;
  v_event_type text;
  v_changes jsonb;
begin
  if private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_action is null
     or p_action not in ('confirm', 'no_answer', 'reschedule', 'cancel')
     or p_expected_version is null
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000
     or (p_action <> 'reschedule' and p_new_starts_at is not null) then
    raise exception 'Invalid follow-up input'
      using errcode = '22023';
  end if;

  -- Match the resource booking lock order before locking individual rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_clinic_id::text, 491)
  );

  -- Preserve the settings lock for unassigned legacy appointments.
  perform 1
  from public.clinic_booking_settings
  where clinic_id = p_clinic_id
  for update;

  select *
  into v_old
  from public.appointments
  where id = p_appointment_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_old.follow_up_version <> p_expected_version then
    raise exception 'STALE_APPOINTMENT'
      using errcode = '40001';
  end if;

  if v_old.status not in ('pending', 'confirmed') then
    raise exception 'APPOINTMENT_NOT_ACTIONABLE'
      using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Africa/Cairo')::date;

  if p_action = 'confirm' then
    if v_old.status <> 'pending'
       or (v_old.starts_at at time zone 'Africa/Cairo')::date
          <> v_today then
      raise exception 'CONFIRM_VISIT_DAY_ONLY'
        using errcode = '22023';
    end if;

    update public.appointments
    set status = 'confirmed',
        confirmed_by = v_actor,
        confirmed_at = v_now,
        follow_up_at = null,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'status_changed';

  elsif p_action = 'no_answer' then
    if v_old.status <> 'pending' then
      raise exception 'PENDING_APPOINTMENT_REQUIRED'
        using errcode = '22023';
    end if;

    v_due := coalesce(
      v_old.follow_up_at,
      (
        (v_old.starts_at at time zone 'Africa/Cairo')::date::timestamp
        at time zone 'Africa/Cairo'
      )
    );

    if v_due > v_now then
      raise exception 'FOLLOW_UP_NOT_DUE'
        using errcode = '22023';
    end if;

    if v_old.no_answer_count >= 3 then
      raise exception 'MANUAL_REVIEW_REQUIRED'
        using errcode = '22023';
    end if;

    v_count := v_old.no_answer_count + 1;

    v_next := case
      when v_count = 1 then v_now + interval '5 hours'
      else (
        (v_now at time zone 'Africa/Cairo') + interval '1 day'
      ) at time zone 'Africa/Cairo'
    end;

    update public.appointments
    set no_answer_count = v_count,
        follow_up_at = v_next,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'contact_attempted';

  elsif p_action = 'reschedule' then
    if p_new_starts_at is null
       or p_new_starts_at = v_old.starts_at then
      raise exception 'Choose a different appointment time'
        using errcode = '22023';
    end if;

    if v_old.resource_doctor_id is null then
      -- Existing unassigned appointments keep the legacy validation path.
      v_ends_at := private.check_clinic_booking_slot(
        p_clinic_id, p_new_starts_at, p_appointment_id
      );
    else
      if not isfinite(p_new_starts_at) or p_new_starts_at <= v_now then
        raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
      end if;

      -- Keep the reserved resources and duration snapshot. Exclude this
      -- appointment so moving within its current interval remains possible.
      if not private.crm_resource_slot_available(
        p_clinic_id,
        v_old.resource_doctor_id,
        v_old.booked_service_id,
        p_new_starts_at,
        v_old.duration_minutes,
        v_old.device_id,
        p_appointment_id
      ) then
        raise exception 'BOOKING_RESOURCE_UNAVAILABLE' using errcode = '23P01';
      end if;

      v_ends_at := p_new_starts_at
        + make_interval(mins => v_old.duration_minutes);
    end if;

    v_next := (
      (p_new_starts_at at time zone 'Africa/Cairo')::date::timestamp
      at time zone 'Africa/Cairo'
    );

    update public.appointments
    set starts_at = p_new_starts_at,
        ends_at = v_ends_at,
        status = 'pending',
        confirmed_by = null,
        confirmed_at = null,
        no_answer_count = 0,
        follow_up_at = v_next,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'rescheduled';

  else
    update public.appointments
    set status = 'cancelled',
        follow_up_at = null,
        last_contact_at = v_now,
        follow_up_version = follow_up_version + 1,
        updated_at = v_now
    where id = p_appointment_id
    returning * into v_new;

    v_event_type := 'status_changed';
  end if;

  v_changes := jsonb_build_object(
    'action', p_action,
    'appointment_id', p_appointment_id,
    'old_status', v_old.status,
    'new_status', v_new.status,
    'old_starts_at', v_old.starts_at,
    'new_starts_at', v_new.starts_at,
    'old_follow_up_at', v_old.follow_up_at,
    'new_follow_up_at', v_new.follow_up_at,
    'old_no_answer_count', v_old.no_answer_count,
    'new_no_answer_count', v_new.no_answer_count,
    'resource_doctor_id', v_new.resource_doctor_id,
    'device_id', v_new.device_id,
    'duration_minutes', v_new.duration_minutes,
    'assignment_mode', v_new.assignment_mode,
    'version', v_new.follow_up_version
  );

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type, performed_by,
    old_status, new_status,
    old_starts_at, new_starts_at,
    old_ends_at, new_ends_at,
    reason, details
  )
  values (
    p_clinic_id, p_appointment_id, v_event_type, v_actor,
    v_old.status, v_new.status,
    v_old.starts_at, v_new.starts_at,
    v_old.ends_at, v_new.ends_at,
    trim(p_reason), v_changes
  );

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by,
    contact_channel, contact_outcome, notes, changes
  )
  values (
    p_clinic_id, v_old.lead_id, 'contact_attempted', v_actor,
    'phone',
    case when p_action = 'no_answer' then 'no_answer' else 'reached' end,
    trim(p_reason), v_changes
  );

  return jsonb_build_object(
    'appointment_id', v_new.id,
    'status', v_new.status,
    'starts_at', v_new.starts_at,
    'ends_at', v_new.ends_at,
    'follow_up_at', v_new.follow_up_at,
    'no_answer_count', v_new.no_answer_count,
    'follow_up_version', v_new.follow_up_version,
    'doctor_id', v_new.resource_doctor_id,
    'device_id', v_new.device_id,
    'duration_minutes', v_new.duration_minutes,
    'assignment_mode', v_new.assignment_mode
  );
end;
$$;

revoke all on function public.crm_follow_up_appointment(
  uuid, uuid, integer, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.crm_follow_up_appointment(
  uuid, uuid, integer, text, text, timestamptz
) to authenticated;

commit;
