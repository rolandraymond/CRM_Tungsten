begin;

create table private.clinic_membership_audit (
  id bigint generated always as identity primary key,

  clinic_id uuid not null
    references public.clinics(id),

  user_id uuid not null
    references public.profiles(id),

  changed_by uuid not null
    references public.profiles(id),

  previous_role text,
  previous_active boolean,
  new_role text not null,
  new_active boolean not null,

  changed_at timestamptz not null default now()
);

alter table private.clinic_membership_audit
  enable row level security;

revoke all on private.clinic_membership_audit
from public, anon, authenticated;


create function public.crm_team_directory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_platform_admin() is not true then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'full_name', p.full_name,
          'email', u.email
        )
        order by p.full_name, p.id
      )
      from public.profiles p
      join auth.users u on u.id = p.id
      where not exists (
        select 1
        from private.platform_admins a
        where a.user_id = p.id
      )
    ), '[]'::jsonb),

    'clinics',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name
        )
        order by name, id
      )
      from public.clinics
      where archived_at is null
    ), '[]'::jsonb),

    'memberships',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'clinic_id', m.clinic_id,
          'user_id', m.user_id,
          'role', m.role,
          'is_active', m.is_active
        )
      )
      from public.clinic_memberships m
      join public.clinics c
        on c.id = m.clinic_id
        and c.archived_at is null
      where not exists (
        select 1
        from private.platform_admins a
        where a.user_id = m.user_id
      )
    ), '[]'::jsonb)
  );
end;
$$;


create function public.crm_set_membership(
  p_clinic_id uuid,
  p_user_id uuid,
  p_role text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.clinic_memberships%rowtype;
begin
  if private.is_platform_admin() is not true then
    raise exception 'Admin required'
      using errcode = '42501';
  end if;

  if p_clinic_id is null
     or p_user_id is null
     or p_active is null
     or p_role is null
     or p_role not in (
       'moderator',
       'agency_follow_up',
       'clinic_customer_service',
       'doctor',
       'clinic_manager'
     ) then
    raise exception 'Invalid membership'
      using errcode = '22023';
  end if;

  perform 1
  from public.clinics
  where id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Clinic unavailable'
      using errcode = '22023';
  end if;

  perform 1
  from public.profiles
  where id = p_user_id
  for share;

  if not found then
    raise exception 'User unavailable'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from private.platform_admins
    where user_id = p_user_id
  ) then
    raise exception 'Platform admins are managed separately'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crm-membership:'
      || p_clinic_id::text
      || ':'
      || p_user_id::text,
      0
    )
  );

  select *
  into v_previous
  from public.clinic_memberships
  where clinic_id = p_clinic_id
    and user_id = p_user_id
  for update;

  if found
     and v_previous.role = p_role
     and v_previous.is_active = p_active then
    return;
  end if;

  insert into public.clinic_memberships(
    clinic_id,
    user_id,
    role,
    is_active
  )
  values (
    p_clinic_id,
    p_user_id,
    p_role,
    p_active
  )
  on conflict (clinic_id, user_id)
  do update set
    role = excluded.role,
    is_active = excluded.is_active;

  insert into private.clinic_membership_audit(
    clinic_id,
    user_id,
    changed_by,
    previous_role,
    previous_active,
    new_role,
    new_active
  )
  values (
    p_clinic_id,
    p_user_id,
    auth.uid(),
    v_previous.role,
    v_previous.is_active,
    p_role,
    p_active
  );
end;
$$;


revoke all on function public.crm_team_directory()
from public, anon, authenticated;

revoke all on function
public.crm_set_membership(uuid, uuid, text, boolean)
from public, anon, authenticated;

grant execute on function public.crm_team_directory()
to authenticated;

grant execute on function
public.crm_set_membership(uuid, uuid, text, boolean)
to authenticated;

commit;