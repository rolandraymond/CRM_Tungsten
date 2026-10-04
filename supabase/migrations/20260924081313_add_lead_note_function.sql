create function public.add_lead_note(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_note text := nullif(trim(p_note), '');
  v_event_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if p_clinic_id is null
     or p_lead_id is null
     or v_note is null then
    raise exception 'Clinic, lead and note are required'
      using errcode = '22023';
  end if;

  if (
    private.is_platform_admin()
    or private.current_clinic_role(p_clinic_id) in (
      'moderator',
      'agency_follow_up',
      'clinic_customer_service',
      'clinic_manager'
    )
  ) is not true then
    raise exception 'Not authorized to add notes for this clinic'
      using errcode = '42501';
  end if;

  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Clinic not found or archived'
      using errcode = '22023';
  end if;

  perform 1
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Lead not found or archived'
      using errcode = '22023';
  end if;

  insert into public.lead_events (
    clinic_id,
    lead_id,
    event_type,
    performed_by,
    notes
  )
  values (
    p_clinic_id,
    p_lead_id,
    'note_added',
    v_actor,
    v_note
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all
on function public.add_lead_note(uuid, uuid, text)
from public, anon, authenticated;

grant execute
on function public.add_lead_note(uuid, uuid, text)
to authenticated;