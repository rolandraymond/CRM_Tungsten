-- Move a follow-up time forward to the next working period.
-- Booking availability being disabled does not disable customer follow-up.

create function private.next_clinic_follow_up_time(
  p_clinic_id uuid,
  p_candidate timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.clinic_booking_settings%rowtype;
  v_first_date date;
  v_shift_date date;
  v_local_open timestamp without time zone;
  v_local_close timestamp without time zone;
  v_open timestamptz;
  v_close timestamptz;
  v_offset integer;
begin
  if p_candidate is null or not isfinite(p_candidate) then
    raise exception 'Invalid follow-up time'
      using errcode = '22023';
  end if;

  select *
  into v_settings
  from public.clinic_booking_settings
  where clinic_id = p_clinic_id;

  if not found then
    raise exception 'BOOKING_SETTINGS_REQUIRED'
      using errcode = '22023';
  end if;

  if v_settings.timezone <> 'Africa/Cairo'
     or coalesce(cardinality(v_settings.working_days), 0) = 0
     or v_settings.opens_at = v_settings.closes_at then
    raise exception 'INVALID_BOOKING_SETTINGS'
      using errcode = '22023';
  end if;

  -- Include the previous day because a shift can cross midnight.
  v_first_date :=
    (p_candidate at time zone 'Africa/Cairo')::date - 1;

  for v_offset in 0..8 loop
    v_shift_date := v_first_date + v_offset;

    if not (
      extract(isodow from v_shift_date)::integer
      = any(v_settings.working_days)
    ) then
      continue;
    end if;

    v_local_open := v_shift_date + v_settings.opens_at;
    v_local_close := v_shift_date + v_settings.closes_at;

    if v_settings.closes_at < v_settings.opens_at then
      v_local_close := v_local_close + interval '1 day';
    end if;

    v_open := v_local_open at time zone 'Africa/Cairo';
    v_close := v_local_close at time zone 'Africa/Cairo';

    -- Reject nonexistent opening/closing times during DST changes.
    if (v_open at time zone 'Africa/Cairo')
         is distinct from v_local_open
       or (v_close at time zone 'Africa/Cairo')
         is distinct from v_local_close
       or v_close <= v_open then
      raise exception 'INVALID_BOOKING_SETTINGS'
        using errcode = '22023';
    end if;

    if p_candidate >= v_close then
      continue;
    end if;

    -- If already inside working hours, preserve the requested time.
    -- Otherwise move forward to this shift's opening time.
    return greatest(p_candidate, v_open);
  end loop;

  raise exception 'No working period found'
    using errcode = '22023';
end;
$$;

revoke all on function private.next_clinic_follow_up_time(
  uuid, timestamptz
) from public, anon, authenticated;


-- Normalize the appointment follow-up before the existing workflow
-- receives its updated row and writes the history.
create function private.normalize_appointment_no_answer_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.no_answer_count > old.no_answer_count then
    new.follow_up_at := private.next_clinic_follow_up_time(
      new.clinic_id,
      new.follow_up_at
    );
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_appointment_no_answer_time()
from public, anon, authenticated;

create trigger appointments_normalize_no_answer_time
before update on public.appointments
for each row
when (new.no_answer_count > old.no_answer_count)
execute function private.normalize_appointment_no_answer_time();


-- Apply the same rule to inquiries without a booking.
create function private.normalize_inquiry_no_answer_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.no_answer_count > old.no_answer_count then
    new.next_follow_up_at := private.next_clinic_follow_up_time(
      new.clinic_id,
      new.next_follow_up_at
    );
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_inquiry_no_answer_time()
from public, anon, authenticated;

create trigger leads_normalize_no_answer_time
before update on public.leads
for each row
when (new.no_answer_count > old.no_answer_count)
execute function private.normalize_inquiry_no_answer_time();