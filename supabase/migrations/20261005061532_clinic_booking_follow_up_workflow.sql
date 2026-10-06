-- Follow-up state. Existing appointments retain their current status.
alter table public.appointments
  add column follow_up_at timestamptz,
  add column no_answer_count integer not null default 0
    check (no_answer_count between 0 and 3),
  add column last_contact_at timestamptz,
  add column follow_up_version integer not null default 0
    check (follow_up_version >= 0);

alter table public.leads
  add column no_answer_count integer not null default 0
    check (no_answer_count between 0 and 3),
  add column last_contact_at timestamptz,
  add column follow_up_version integer not null default 0
    check (follow_up_version >= 0);

alter table public.appointment_events
  add column details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object');

alter table public.appointment_events
  drop constraint appointment_events_event_type_check;

alter table public.appointment_events
  add constraint appointment_events_event_type_check
  check (
    event_type in (
      'created',
      'status_changed',
      'rescheduled',
      'archived',
      'restored',
      'contact_attempted'
    )
  );

create index appointments_pending_follow_up_idx
  on public.appointments (clinic_id, follow_up_at)
  where archived_at is null and status = 'pending';

create index leads_follow_up_due_idx
  on public.leads (clinic_id, next_follow_up_at)
  where archived_at is null
    and status in ('new', 'in_progress', 'no_answer', 'follow_up');


-- Shared authorization for the new workflow.
create function private.can_manage_booking_follow_up(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      private.is_platform_admin()
      or coalesce(
        private.current_clinic_role(p_clinic_id) in (
          'clinic_manager',
          'clinic_customer_service',
          'moderator'
        ),
        false
      )
    )
    and exists (
      select 1
      from public.clinics
      where id = p_clinic_id
        and archived_at is null
    );
$$;

revoke all on function private.can_manage_booking_follow_up(uuid)
from public, anon, authenticated;


-- Validates one slot and returns its end time.
-- Public callers must check permissions before calling this helper.
-- The settings row lock remains held until the transaction finishes.
create function private.check_clinic_booking_slot(
  p_clinic_id uuid,
  p_starts_at timestamptz,
  p_exclude_appointment_id uuid default null
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings public.clinic_booking_settings%rowtype;
  v_local_start timestamp without time zone;
  v_shift_date date;
  v_local_open timestamp without time zone;
  v_local_close timestamp without time zone;
  v_closes_at timestamptz;
  v_ends_at timestamptz;
  v_offset_seconds numeric;
  v_occupied bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Booking requires read committed isolation'
      using errcode = '22023';
  end if;

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

  if p_starts_at is null
     or not isfinite(p_starts_at)
     or p_starts_at <= clock_timestamp() then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  if v_settings.timezone <> 'Africa/Cairo'
     or v_settings.slot_minutes not in (10, 20, 30, 60)
     or v_settings.slot_capacity < 1
     or v_settings.opens_at = v_settings.closes_at then
    raise exception 'INVALID_BOOKING_SETTINGS'
      using errcode = '22023';
  end if;

  v_local_start := p_starts_at at time zone 'Africa/Cairo';
  v_shift_date := v_local_start::date;

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

  v_offset_seconds :=
    extract(epoch from (v_local_start - v_local_open));

  if v_local_start < v_local_open
     or v_local_start >= v_local_close
     or mod(
       v_offset_seconds,
       v_settings.slot_minutes * 60
     ) <> 0
     or v_local_start + make_interval(
       mins => v_settings.slot_minutes
     ) > v_local_close then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  v_closes_at := v_local_close at time zone 'Africa/Cairo';

  if (v_closes_at at time zone 'Africa/Cairo')
     is distinct from v_local_close then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  v_ends_at := p_starts_at
    + make_interval(mins => v_settings.slot_minutes);

  if v_ends_at > v_closes_at then
    raise exception 'INVALID_BOOKING_SLOT'
      using errcode = '22023';
  end if;

  select count(*)
  into v_occupied
  from public.appointments a
  where a.clinic_id = p_clinic_id
    and a.archived_at is null
    and a.status <> 'cancelled'
    and a.id is distinct from p_exclude_appointment_id
    and a.starts_at < v_ends_at
    and coalesce(
      a.ends_at,
      a.starts_at + make_interval(mins => v_settings.slot_minutes)
    ) > p_starts_at;

  if v_occupied >= v_settings.slot_capacity then
    raise exception 'BOOKING_SLOT_FULL'
      using errcode = '40001';
  end if;

  return v_ends_at;
end;
$$;

revoke all on function private.check_clinic_booking_slot(
  uuid, timestamptz, uuid
) from public, anon, authenticated;


-- Both existing-lead and new-lead booking paths use this function.
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
  v_old_status text;
  v_service_id uuid;
  v_appointment_id uuid;
  v_ends_at timestamptz;
  v_follow_up_at timestamptz;
begin
  if private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000 then
    raise exception 'Booking reason is required'
      using errcode = '22023';
  end if;

  v_ends_at := private.check_clinic_booking_slot(
    p_clinic_id, p_starts_at, null
  );

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

  v_follow_up_at := (
    (p_starts_at at time zone 'Africa/Cairo')::date::timestamp
    at time zone 'Africa/Cairo'
  );

  insert into public.appointments (
    clinic_id, lead_id, booked_service_id,
    starts_at, ends_at, status,
    booking_origin, created_by,
    confirmed_by, confirmed_at,
    notes, follow_up_at
  )
  values (
    p_clinic_id, p_lead_id, v_service_id,
    p_starts_at, v_ends_at, 'pending',
    'clinic', v_actor,
    null, null,
    trim(p_reason), v_follow_up_at
  )
  returning id into v_appointment_id;

  insert into public.appointment_events (
    clinic_id, appointment_id, event_type,
    performed_by, new_status,
    new_starts_at, new_ends_at, reason, details
  )
  values (
    p_clinic_id, v_appointment_id, 'created',
    v_actor, 'pending',
    p_starts_at, v_ends_at, trim(p_reason),
    jsonb_build_object('follow_up_at', v_follow_up_at)
  );

  update public.leads
  set status = 'converted',
      next_follow_up_at = null,
      follow_up_version = follow_up_version + 1
  where id = p_lead_id
    and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id, lead_id, event_type,
    performed_by, notes, changes
  )
  values (
    p_clinic_id, p_lead_id, 'status_changed',
    v_actor, trim(p_reason),
    jsonb_build_object(
      'old_status', v_old_status,
      'new_status', 'converted',
      'appointment_id', v_appointment_id,
      'appointment_status', 'pending',
      'starts_at', p_starts_at,
      'ends_at', v_ends_at
    )
  );

  return v_appointment_id;
end;
$$;


-- One action, state update and history entry commit together.
-- expected_version prevents two staff members changing the same version.
create function public.crm_follow_up_appointment(
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

  -- Same lock order as booking: clinic settings, then appointment.
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

    v_ends_at := private.check_clinic_booking_slot(
      p_clinic_id, p_new_starts_at, p_appointment_id
    );

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
    'follow_up_version', v_new.follow_up_version
  );
end;
$$;


-- Follow-up for inquiries that do not have a booking.
create function public.crm_follow_up_inquiry(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason text,
  p_next_follow_up_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.leads%rowtype;
  v_new public.leads%rowtype;
  v_now timestamptz;
  v_next timestamptz;
  v_count integer;
  v_status text;
  v_changes jsonb;
begin
  if private.can_manage_booking_follow_up(p_clinic_id) is not true then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_action is null
     or p_action not in ('schedule', 'no_answer', 'not_interested')
     or p_expected_version is null
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000
     or (p_action <> 'schedule' and p_next_follow_up_at is not null) then
    raise exception 'Invalid inquiry follow-up input'
      using errcode = '22023';
  end if;

  select *
  into v_old
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'LEAD_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_old.follow_up_version <> p_expected_version then
    raise exception 'STALE_LEAD'
      using errcode = '40001';
  end if;

  if v_old.status in ('converted', 'not_interested')
     or exists (
       select 1
       from public.appointments
       where clinic_id = p_clinic_id
         and lead_id = p_lead_id
         and archived_at is null
         and status <> 'cancelled'
     ) then
    raise exception 'INQUIRY_NOT_ACTIONABLE'
      using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  v_count := v_old.no_answer_count;

  if p_action = 'schedule' then
    if p_next_follow_up_at is null
       or not isfinite(p_next_follow_up_at)
       or p_next_follow_up_at <= v_now then
      raise exception 'Future follow-up time required'
        using errcode = '22023';
    end if;

    v_next := p_next_follow_up_at;
    v_count := 0;
    v_status := 'follow_up';

  elsif p_action = 'no_answer' then
    if v_old.next_follow_up_at > v_now then
      raise exception 'FOLLOW_UP_NOT_DUE'
        using errcode = '22023';
    end if;

    if v_count >= 3 then
      raise exception 'MANUAL_REVIEW_REQUIRED'
        using errcode = '22023';
    end if;

    v_count := v_count + 1;
    v_status := 'no_answer';

    v_next := case
      when v_count = 1 then v_now + interval '5 hours'
      else (
        (v_now at time zone 'Africa/Cairo') + interval '1 day'
      ) at time zone 'Africa/Cairo'
    end;

  else
    v_next := null;
    v_status := 'not_interested';
  end if;

  update public.leads
  set status = v_status,
      next_follow_up_at = v_next,
      no_answer_count = v_count,
      last_contact_at = v_now,
      follow_up_version = follow_up_version + 1
  where id = p_lead_id
  returning * into v_new;

  v_changes := jsonb_build_object(
    'action', p_action,
    'old_status', v_old.status,
    'new_status', v_new.status,
    'old_follow_up_at', v_old.next_follow_up_at,
    'new_follow_up_at', v_new.next_follow_up_at,
    'old_no_answer_count', v_old.no_answer_count,
    'new_no_answer_count', v_new.no_answer_count,
    'version', v_new.follow_up_version
  );

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by,
    contact_channel, contact_outcome, notes, changes
  )
  values (
    p_clinic_id, p_lead_id, 'contact_attempted', v_actor,
    'phone',
    case when p_action = 'no_answer' then 'no_answer' else 'reached' end,
    trim(p_reason), v_changes
  );

  if v_old.status is distinct from v_new.status then
    insert into public.lead_events (
      clinic_id, lead_id, event_type,
      performed_by, notes, changes
    )
    values (
      p_clinic_id, p_lead_id, 'status_changed',
      v_actor, trim(p_reason), v_changes
    );
  end if;

  return jsonb_build_object(
    'lead_id', v_new.id,
    'status', v_new.status,
    'next_follow_up_at', v_new.next_follow_up_at,
    'no_answer_count', v_new.no_answer_count,
    'follow_up_version', v_new.follow_up_version
  );
end;
$$;


-- Clients can call the public workflow functions.
-- Writes and permission checks remain inside those transactions.
revoke all on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.crm_create_lead_booking(
  uuid, uuid, text, timestamptz, text
) to authenticated;

revoke all on function public.crm_follow_up_appointment(
  uuid, uuid, integer, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.crm_follow_up_appointment(
  uuid, uuid, integer, text, text, timestamptz
) to authenticated;

revoke all on function public.crm_follow_up_inquiry(
  uuid, uuid, integer, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.crm_follow_up_inquiry(
  uuid, uuid, integer, text, text, timestamptz
) to authenticated;


-- Any update invalidates an older follow-up screen.
-- This also covers updates made through older functions.
create function private.bump_follow_up_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.follow_up_version := old.follow_up_version + 1;
  return new;
end;
$$;

revoke all on function private.bump_follow_up_version()
from public, anon, authenticated;

create trigger leads_bump_follow_up_version
before update on public.leads
for each row
execute function private.bump_follow_up_version();

create trigger appointments_bump_follow_up_version
before update on public.appointments
for each row
execute function private.bump_follow_up_version();


-- Keep basic lead status changes.
-- Follow-up outcomes must use crm_follow_up_inquiry,
-- where scheduling, attempts and history are saved together.
create or replace function public.crm_change_lead_status(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_expected_status text,
  p_new_status text,
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
  v_event_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  v_role := private.current_clinic_role(p_clinic_id);

  if private.is_platform_admin() is not true
     and coalesce(
       v_role in (
         'clinic_manager',
         'clinic_customer_service',
         'moderator',
         'doctor'
       ),
       false
     ) = false then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000
     or p_new_status is null then
    raise exception 'Status and reason are required'
      using errcode = '22023';
  end if;

  if p_new_status not in ('new', 'in_progress') then
    raise exception 'USE_FOLLOW_UP_WORKFLOW'
      using errcode = '22023';
  end if;

  select status
  into v_old_status
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable'
      using errcode = '22023';
  end if;

  if v_role = 'doctor'
     and private.is_platform_admin() is not true
     and not exists (
       select 1
       from public.appointments a
       where a.clinic_id = p_clinic_id
         and a.lead_id = p_lead_id
         and a.doctor_id = v_actor
         and a.archived_at is null
     ) then
    raise exception 'Not assigned to this lead'
      using errcode = '42501';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user'
      using errcode = '40001';
  end if;

  if v_old_status not in ('new', 'in_progress') then
    raise exception 'USE_FOLLOW_UP_WORKFLOW'
      using errcode = '22023';
  end if;

  if v_old_status = p_new_status then
    raise exception 'Invalid status transition'
      using errcode = '22023';
  end if;

  update public.leads
  set status = p_new_status
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
      'new_status', p_new_status
    )
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;