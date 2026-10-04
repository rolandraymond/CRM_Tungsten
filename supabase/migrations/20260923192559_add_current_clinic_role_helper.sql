create function private.current_clinic_role(
  p_clinic_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from public.clinic_memberships as membership
  join public.clinics as clinic
    on clinic.id = membership.clinic_id
  where membership.clinic_id = p_clinic_id
    and membership.user_id = (select auth.uid())
    and membership.is_active = true
    and clinic.archived_at is null;
$$;

revoke all on function private.current_clinic_role(uuid)
from public, anon, authenticated;

grant execute
on function private.current_clinic_role(uuid)
to authenticated;