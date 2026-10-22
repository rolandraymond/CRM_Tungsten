begin;

-- Allow updates only to the device requirement fields.
grant update (
  requires_device,
  required_device_type
)
on public.clinic_services
to authenticated;

create policy clinic_services_update_device_requirements
on public.clinic_services
for update
to authenticated
using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) = 'clinic_manager'
)
with check (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) = 'clinic_manager'
);

commit;