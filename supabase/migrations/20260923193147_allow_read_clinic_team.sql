-- Active clinic members can read their clinic's team memberships.
create policy memberships_select_clinic_team
on public.clinic_memberships
for select
to authenticated
using (
  private.current_clinic_role(clinic_id) is not null
);


-- Users can read profiles of people sharing an accessible clinic.
create policy profiles_select_clinic_team
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.clinic_memberships as membership
    where membership.user_id = profiles.id
      and private.current_clinic_role(
        membership.clinic_id
      ) is not null
  )
);