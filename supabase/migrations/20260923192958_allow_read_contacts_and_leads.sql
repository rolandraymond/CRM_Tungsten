-- Leads.
grant select on table public.leads
to authenticated;

create policy leads_select_authorized
on public.leads
for select
to authenticated
using (
  (select private.is_platform_admin())

  or private.current_clinic_role(clinic_id) in (
    'moderator',
    'agency_follow_up',
    'clinic_customer_service',
    'clinic_manager'
  )

  or (
    private.current_clinic_role(clinic_id) = 'doctor'
    and exists (
      select 1
      from public.appointments as appointment
      where appointment.clinic_id = leads.clinic_id
        and appointment.lead_id = leads.id
        and appointment.doctor_id = (select auth.uid())
    )
  )
);


-- Contact details.
grant select on table public.contacts
to authenticated;

create policy contacts_select_authorized
on public.contacts
for select
to authenticated
using (
  (select private.is_platform_admin())

  or private.current_clinic_role(clinic_id) in (
    'moderator',
    'agency_follow_up',
    'clinic_customer_service',
    'clinic_manager'
  )

  or (
    private.current_clinic_role(clinic_id) = 'doctor'
    and exists (
      select 1
      from public.leads as lead
      where lead.clinic_id = contacts.clinic_id
        and lead.contact_id = contacts.id
    )
  )
);


-- Follow-up history.
grant select on table public.lead_events
to authenticated;

create policy lead_events_select_authorized
on public.lead_events
for select
to authenticated
using (
  exists (
    select 1
    from public.leads as lead
    where lead.clinic_id = lead_events.clinic_id
      and lead.id = lead_events.lead_id
  )
);


-- Attribution and touchpoint history.
grant select on table public.lead_touchpoints
to authenticated;

create policy lead_touchpoints_select_authorized
on public.lead_touchpoints
for select
to authenticated
using (
  exists (
    select 1
    from public.leads as lead
    where lead.clinic_id = lead_touchpoints.clinic_id
      and lead.id = lead_touchpoints.lead_id
  )
);