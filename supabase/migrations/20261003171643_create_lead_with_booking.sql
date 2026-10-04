-- One RPC transaction creates an inquiry or a lead with a confirmed appointment.
alter table private.lead_creation_requests
  add column booking_payload jsonb,
  add column appointment_id uuid references public.appointments(id);

create function public.crm_create_lead_with_booking(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_booking jsonb := nullif(p_input -> 'booking', 'null'::jsonb);
  v_clinic uuid;
  v_request uuid;
  v_appointment uuid;
  v_saved_booking jsonb;
  v_starts_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'Input must be an object' using errcode = '22023';
  end if;
  v_clinic := (p_input ->> 'clinic_id')::uuid;
  v_request := (p_input ->> 'request_id')::uuid;
  if v_booking is not null then
    if jsonb_typeof(v_booking) is distinct from 'object'
       or jsonb_typeof(v_booking -> 'starts_at') is distinct from 'string'
       or jsonb_typeof(v_booking -> 'reason') is distinct from 'string' then
      raise exception 'Booking time and reason are required' using errcode = '22023';
    end if;
    begin
      v_starts_at := (v_booking ->> 'starts_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Invalid booking time' using errcode = '22023';
    end;
    v_booking := jsonb_build_object(
      'starts_at', v_starts_at,
      'reason', trim(v_booking ->> 'reason')
    );
  end if;

  -- create_lead checks permissions and serializes retries with an advisory lock.
  v_result := public.create_lead(
    p_request_id => v_request,
    p_clinic_id => v_clinic,
    p_full_name => p_input ->> 'full_name',
    p_phone => p_input ->> 'phone',
    p_requested_service_id => (p_input ->> 'requested_service_id')::uuid,
    p_source => p_input ->> 'source',
    p_attribution_status => p_input ->> 'attribution_status',
    p_ad_id => (p_input ->> 'ad_id')::uuid,
    p_meta_creative_id => p_input ->> 'meta_creative_id',
    p_notes => p_input ->> 'notes',
    p_allow_inactive_ad => coalesce((p_input ->> 'allow_inactive_ad')::boolean, false)
  );

  select booking_payload, appointment_id into v_saved_booking, v_appointment
  from private.lead_creation_requests
  where clinic_id = v_clinic and requested_by = auth.uid() and request_id = v_request;

  if (v_result ->> 'replayed')::boolean then
    if v_saved_booking is distinct from v_booking then
      raise exception 'Request ID was already used with different booking data'
        using errcode = '23505';
    end if;
    return v_result || jsonb_build_object('appointment_id', v_appointment);
  end if;

  if v_booking is not null then
    v_appointment := public.crm_create_lead_booking(
      v_clinic, (v_result ->> 'lead_id')::uuid, 'new',
      v_starts_at, v_booking ->> 'reason'
    );
  end if;
  -- A booking error rolls back the lead, contact, history and receipt too.
  update private.lead_creation_requests
  set booking_payload = v_booking, appointment_id = v_appointment
  where clinic_id = v_clinic and requested_by = auth.uid() and request_id = v_request;

  return v_result || jsonb_build_object('appointment_id', v_appointment);
end;
$$;

revoke all on function public.crm_create_lead_with_booking(jsonb) from public, anon;
grant execute on function public.crm_create_lead_with_booking(jsonb) to authenticated;
