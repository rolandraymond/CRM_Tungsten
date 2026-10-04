-- Clinic service assignments.
grant select on table public.clinic_services
to authenticated;

create policy clinic_services_select_authorized
on public.clinic_services
for select
to authenticated
using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) is not null
);


-- Service definitions available to the user's clinics.
grant select on table public.services
to authenticated;

create policy services_select_authorized
on public.services
for select
to authenticated
using (
  (select private.is_platform_admin())
  or exists (
    select 1
    from public.clinic_services as clinic_service
    where clinic_service.service_id = services.id
      and private.current_clinic_role(
        clinic_service.clinic_id
      ) is not null
  )
);


-- Ads belonging to the user's clinics.
grant select on table public.clinic_ads
to authenticated;

create policy clinic_ads_select_authorized
on public.clinic_ads
for select
to authenticated
using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) is not null
);


-- Finance mappings are readable by platform admins only.
grant select on table public.clinic_finance_links
to authenticated;

create policy clinic_finance_links_select_platform_admin
on public.clinic_finance_links
for select
to authenticated
using (
  (select private.is_platform_admin())
);