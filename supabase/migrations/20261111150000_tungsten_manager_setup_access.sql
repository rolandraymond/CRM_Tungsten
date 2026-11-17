-- Migration 57: Allow Tungsten Owner and Manager read access on clinics, services, and profiles for setup and internal CRM

create policy clinics_select_owner_manager
on public.clinics
for select
to authenticated
using (
  archived_at is null
  and (select private.is_tungsten_owner_or_manager())
);

create policy services_select_owner_manager
on public.services
for select
to authenticated
using (
  (select private.is_tungsten_owner_or_manager())
);

create policy clinic_services_select_owner_manager
on public.clinic_services
for select
to authenticated
using (
  (select private.is_tungsten_owner_or_manager())
);

create policy profiles_select_owner_manager
on public.profiles
for select
to authenticated
using (
  (select private.is_tungsten_owner_or_manager())
);
