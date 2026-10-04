grant select on table public.appointments
to authenticated;

create policy appointments_select_authorized
on public.appointments
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
    and doctor_id = (select auth.uid())
  )
);


grant select on table public.appointment_events
to authenticated;

create policy appointment_events_select_authorized
on public.appointment_events
for select
to authenticated
using (
  exists (
    select 1
    from public.appointments as appointment
    where appointment.id = appointment_events.appointment_id
      and appointment.clinic_id = appointment_events.clinic_id
  )
);