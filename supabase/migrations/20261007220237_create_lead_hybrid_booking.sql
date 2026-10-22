begin;

-- Preserve the successful assignment for retries, even if its appointment is
-- later rescheduled or cancelled. Never infer the original result from new settings.
alter table private.lead_creation_requests
  add column hybrid_booking_result jsonb,
  add constraint lead_creation_hybrid_booking_result_check
  check (
    hybrid_booking_result is null
    or (
      jsonb_typeof(hybrid_booking_result) = 'object'
      and appointment_id is not null
      and jsonb_typeof(hybrid_booking_result -> 'appointment_id') is not distinct from 'string'
      and hybrid_booking_result ->> 'appointment_id' = appointment_id::text
    )
  );

create function public.crm_create_lead_with_hybrid_booking(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_actor uuid := auth.uid();
  v_clinic_id uuid;
  v_request_id uuid;
  v_service_id uuid;
  v_ad_id uuid;
  v_result jsonb;
  v_booking jsonb;
  v_saved_booking jsonb;
  v_booking_result jsonb;
  v_appointment_id uuid;
  v_starts_at timestamptz;
  v_mode text;
  v_doctor_id uuid;
  v_device_id uuid;
  v_reason text;
begin
  if v_actor is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'INVALID_LEAD_INPUT' using errcode = '22023';
  end if;

  begin
    v_clinic_id := (p_input ->> 'clinic_id')::uuid;
    v_request_id := (p_input ->> 'request_id')::uuid;
    v_service_id := (p_input ->> 'requested_service_id')::uuid;
    v_ad_id := (p_input ->> 'ad_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'INVALID_LEAD_INPUT' using errcode = '22023';
  end;

  if v_clinic_id is null or v_request_id is null or v_service_id is null then
    raise exception 'INVALID_LEAD_INPUT' using errcode = '22023';
  end if;

  v_booking := nullif(p_input -> 'booking', 'null'::jsonb);

  if v_booking is not null then
    if jsonb_typeof(v_booking) is distinct from 'object' then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end if;

    if exists (
      select 1 from jsonb_object_keys(v_booking) as fields(name)
      where name not in (
        'starts_at', 'assignment_mode', 'doctor_id', 'device_id', 'reason'
      )
    ) or jsonb_typeof(v_booking -> 'starts_at') is distinct from 'string'
       or jsonb_typeof(v_booking -> 'assignment_mode') is distinct from 'string'
       or jsonb_typeof(v_booking -> 'reason') is distinct from 'string'
       or (v_booking ? 'doctor_id' and jsonb_typeof(v_booking -> 'doctor_id') not in ('string', 'null'))
       or (v_booking ? 'device_id' and jsonb_typeof(v_booking -> 'device_id') not in ('string', 'null')) then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end if;

    -- Require an explicit offset; a browser's local timezone is not clinic time.
    if (v_booking ->> 'starts_at') !~* '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end if;

    begin
      v_starts_at := (v_booking ->> 'starts_at')::timestamptz;
      v_doctor_id := (v_booking ->> 'doctor_id')::uuid;
      v_device_id := (v_booking ->> 'device_id')::uuid;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end;

    v_mode := v_booking ->> 'assignment_mode';
    v_reason := trim(v_booking ->> 'reason');
    if v_mode not in ('specific', 'auto')
       or (v_mode = 'specific' and v_doctor_id is null)
       or (v_mode = 'auto' and v_doctor_id is not null)
       or nullif(v_reason, '') is null or length(v_reason) > 2000
       or v_starts_at is null or not isfinite(v_starts_at) then
      raise exception 'INVALID_BOOKING_INPUT' using errcode = '22023';
    end if;

    if private.can_manage_booking_follow_up(v_clinic_id) is not true then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    -- Compare canonical input on retries. Equivalent timezone representations
    -- and omitted optional device IDs describe the same request.
    v_booking := jsonb_build_object(
      'starts_at', v_starts_at,
      'assignment_mode', v_mode,
      'doctor_id', v_doctor_id,
      'device_id', v_device_id,
      'reason', v_reason
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_clinic_id::text, 491)
  );

  -- Reuse the existing contact, phone, clinic-service and ad-attribution rules.
  -- create_lead also holds its actor/clinic/request lock until this RPC finishes.
  v_result := public.create_lead(
    p_request_id => v_request_id,
    p_clinic_id => v_clinic_id,
    p_full_name => p_input ->> 'full_name',
    p_phone => p_input ->> 'phone',
    p_requested_service_id => v_service_id,
    p_source => p_input ->> 'source',
    p_attribution_status => p_input ->> 'attribution_status',
    p_ad_id => v_ad_id,
    p_meta_creative_id => p_input ->> 'meta_creative_id',
    p_notes => p_input ->> 'notes',
    p_allow_inactive_ad => coalesce((p_input ->> 'allow_inactive_ad')::boolean, false)
  );

  select booking_payload, appointment_id, hybrid_booking_result
  into v_saved_booking, v_appointment_id, v_booking_result
  from private.lead_creation_requests
  where clinic_id = v_clinic_id
    and requested_by = v_actor
    and request_id = v_request_id
  for update;

  if not found then
    raise exception 'LEAD_CREATION_RECEIPT_UNAVAILABLE' using errcode = '40001';
  end if;

  if (v_result ->> 'replayed')::boolean then
    if v_saved_booking is distinct from v_booking then
      raise exception 'REQUEST_BOOKING_CHANGED' using errcode = '23505';
    end if;

    return v_result || jsonb_build_object(
      'appointment_id', v_appointment_id,
      'booking', v_booking_result
    );
  end if;

  if v_booking is not null then
    v_booking_result := public.crm_create_hybrid_booking(
      p_clinic_id => v_clinic_id,
      p_lead_id => (v_result ->> 'lead_id')::uuid,
      p_expected_status => 'new',
      p_starts_at => v_starts_at,
      p_assignment_mode => v_mode,
      p_doctor_id => v_doctor_id,
      p_device_id => v_device_id,
      p_reason => v_reason
    );
    v_appointment_id := (v_booking_result ->> 'appointment_id')::uuid;
  end if;

  -- Any booking error rolls back contact/lead creation, touchpoints and history.
  update private.lead_creation_requests
  set booking_payload = v_booking,
      appointment_id = v_appointment_id,
      hybrid_booking_result = v_booking_result
  where clinic_id = v_clinic_id
    and requested_by = v_actor
    and request_id = v_request_id;

  return v_result || jsonb_build_object(
    'appointment_id', v_appointment_id,
    'booking', v_booking_result
  );
end;
$$;

revoke all on function public.crm_create_lead_with_hybrid_booking(jsonb)
from public, anon, authenticated;

grant execute on function public.crm_create_lead_with_hybrid_booking(jsonb)
to authenticated;

commit;
