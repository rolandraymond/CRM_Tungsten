-- Employees can read memberships, but cannot manage them.
revoke all privileges
on table public.clinic_memberships
from anon, authenticated;

grant select
on table public.clinic_memberships
to authenticated;

create policy memberships_select_own_active
on public.clinic_memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  and is_active = true
);


-- Employees can read their assigned clinics.
revoke all privileges
on table public.clinics
from anon, authenticated;

grant select
on table public.clinics
to authenticated;

create policy clinics_select_assigned
on public.clinics
for select
to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.clinic_memberships as membership
    where membership.clinic_id = clinics.id
      and membership.user_id = (select auth.uid())
      and membership.is_active = true
  )
);