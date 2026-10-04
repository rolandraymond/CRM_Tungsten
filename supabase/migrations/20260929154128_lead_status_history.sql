-- A status change and its audit event must commit together.
create function public.crm_change_lead_status(
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
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_new_status is null
     or p_new_status not in ('new', 'in_progress', 'no_answer', 'follow_up', 'not_interested')
     or nullif(trim(p_reason), '') is null
     or length(p_reason) > 2000 then
    raise exception 'Status and reason are required' using errcode = '22023';
  end if;

  v_role := private.current_clinic_role(p_clinic_id);
  if private.is_platform_admin() is not true
     and coalesce(v_role in ('clinic_manager', 'clinic_customer_service', 'doctor'), false) = false then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select status into v_old_status
  from public.leads
  where id = p_lead_id and clinic_id = p_clinic_id and archived_at is null
  for update;

  if not found then
    raise exception 'Lead unavailable' using errcode = '22023';
  end if;

  if v_role = 'doctor' and private.is_platform_admin() is not true
     and not exists (
       select 1 from public.appointments a
       where a.clinic_id = p_clinic_id and a.lead_id = p_lead_id
         and a.doctor_id = v_actor and a.archived_at is null
     ) then
    raise exception 'Not assigned to this lead' using errcode = '42501';
  end if;

  if v_old_status is distinct from p_expected_status then
    raise exception 'Lead was changed by another user' using errcode = '40001';
  end if;

  if v_old_status = p_new_status or v_old_status = 'converted' then
    raise exception 'Invalid status transition' using errcode = '22023';
  end if;

  update public.leads set status = p_new_status
  where id = p_lead_id and clinic_id = p_clinic_id;

  insert into public.lead_events (
    clinic_id, lead_id, event_type, performed_by, notes, changes
  ) values (
    p_clinic_id, p_lead_id, 'status_changed', v_actor, trim(p_reason),
    jsonb_build_object('old_status', v_old_status, 'new_status', p_new_status)
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.crm_change_lead_status(uuid, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.crm_change_lead_status(uuid, uuid, text, text, text)
to authenticated;