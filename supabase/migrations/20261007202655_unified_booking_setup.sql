begin;

-- Run after the doctor_scheduling and clinic_service_device_requirements migrations.
create table public.clinic_service_devices (
  clinic_id uuid not null,
  service_id uuid not null,
  device_id uuid not null,
  is_active boolean not null default true,
  primary key (clinic_id, service_id, device_id),
  foreign key (clinic_id, service_id)
    references public.clinic_services(clinic_id, service_id) on delete restrict,
  foreign key (clinic_id, device_id)
    references public.clinic_devices(clinic_id, id) on delete restrict
);

-- Preserve the old type-based configuration as physical device links.
insert into public.clinic_service_devices (clinic_id, service_id, device_id)
select cs.clinic_id, cs.service_id, d.id
from public.clinic_services cs
join public.clinic_devices d on d.clinic_id = cs.clinic_id
  and d.device_type = cs.required_device_type
where cs.requires_device is true
on conflict do nothing;

-- Preserve all existing doctor links, including inactive ones.
insert into public.clinic_service_devices (clinic_id, service_id, device_id, is_active)
select ds.clinic_id, ds.service_id, ds.device_id,
       coalesce(cs.requires_device is true and d.device_type = cs.required_device_type, false)
from public.clinic_doctor_service_devices ds
join public.clinic_services cs on cs.clinic_id = ds.clinic_id and cs.service_id = ds.service_id
join public.clinic_devices d on d.clinic_id = ds.clinic_id and d.id = ds.device_id
on conflict do nothing;

alter table public.clinic_doctor_service_devices
  add constraint doctor_device_belongs_to_service_fk
  foreign key (clinic_id, service_id, device_id)
  references public.clinic_service_devices(clinic_id, service_id, device_id)
  on delete restrict;

alter table public.clinic_services
  drop constraint if exists clinic_service_device_requirement_check;

comment on column public.clinic_services.required_device_type is
  'Legacy field retained for compatibility. New setup uses clinic_service_devices.';

alter table public.clinic_service_devices enable row level security;
revoke all on public.clinic_service_devices from public, anon, authenticated;
grant select on public.clinic_service_devices to authenticated;
create policy clinic_service_devices_read on public.clinic_service_devices
for select to authenticated using (
  (select private.is_platform_admin())
  or private.current_clinic_role(clinic_id) is not null
);

create function public.crm_setup_set_service_devices(
  p_clinic_id uuid, p_service_id uuid,
  p_requires_device boolean, p_device_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := coalesce(p_device_ids, '{}'::uuid[]);
begin
  if auth.uid() is null or (
    private.is_platform_admin() is not true
    and coalesce(private.current_clinic_role(p_clinic_id) = 'clinic_manager', false) is false
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic_id::text, 491));
  perform 1 from public.clinic_services
    where clinic_id = p_clinic_id and service_id = p_service_id for update;
  if not found then
    raise exception 'Clinic service not found' using errcode = '22023';
  end if;
  if p_requires_device is null
     or array_position(v_ids, null) is not null
     or (p_requires_device and cardinality(v_ids) = 0)
     or (not p_requires_device and cardinality(v_ids) <> 0)
     or cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) as ids(id))
     or exists (
       select 1 from unnest(v_ids) as ids(id)
       where not exists (
         select 1 from public.clinic_devices d
         where d.clinic_id = p_clinic_id and d.id = ids.id and d.is_active
       )
     ) then
    raise exception 'Invalid service device selection' using errcode = '22023';
  end if;

  update public.clinic_services
    set requires_device = p_requires_device, required_device_type = null
    where clinic_id = p_clinic_id and service_id = p_service_id;
  update public.clinic_service_devices set is_active = false
    where clinic_id = p_clinic_id and service_id = p_service_id;
  insert into public.clinic_service_devices (clinic_id, service_id, device_id, is_active)
    select p_clinic_id, p_service_id, id, true from unnest(v_ids) as ids(id)
    on conflict (clinic_id, service_id, device_id) do update set is_active = true;

  -- Remove permission for devices no longer allowed by this service.
  update public.clinic_doctor_service_devices set is_active = false
    where clinic_id = p_clinic_id and service_id = p_service_id
      and not (device_id = any(v_ids));
end;
$$;

create function public.crm_setup_set_doctor_service(
  p_clinic_id uuid, p_doctor_id uuid, p_service_id uuid,
  p_duration_minutes integer, p_is_active boolean, p_device_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_requires boolean;
  v_ids uuid[] := coalesce(p_device_ids, '{}'::uuid[]);
begin
  if auth.uid() is null or (
    private.is_platform_admin() is not true
    and coalesce(private.current_clinic_role(p_clinic_id) = 'clinic_manager', false) is false
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic_id::text, 491));
  if p_duration_minutes is null or p_duration_minutes not between 1 and 1440
     or p_is_active is null
     or not exists (select 1 from public.clinic_doctors
       where clinic_id = p_clinic_id and id = p_doctor_id) then
    raise exception 'Invalid doctor or duration' using errcode = '22023';
  end if;
  select requires_device into v_requires from public.clinic_services
    where clinic_id = p_clinic_id and service_id = p_service_id for update;
  if not found then
    raise exception 'Clinic service not found' using errcode = '22023';
  end if;
  if p_is_active and not exists (
    select 1 from public.clinic_services cs join public.services s on s.id = cs.service_id
    where cs.clinic_id = p_clinic_id and cs.service_id = p_service_id and cs.is_active and s.is_active
  ) then
    raise exception 'Service inactive' using errcode = '22023';
  end if;
  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) as ids(id))
     or (v_requires is not true and cardinality(v_ids) > 0)
     or (p_is_active and v_requires is true and cardinality(v_ids) = 0)
     or exists (
       select 1 from unnest(v_ids) as ids(id)
       where not exists (
         select 1 from public.clinic_service_devices sd
         join public.clinic_devices d on d.clinic_id = sd.clinic_id and d.id = sd.device_id
         where sd.clinic_id = p_clinic_id and sd.service_id = p_service_id
           and sd.device_id = ids.id and sd.is_active and d.is_active
       )
     ) then
    raise exception 'Devices must belong to this clinic service' using errcode = '22023';
  end if;
  insert into public.clinic_doctor_services (
    clinic_id, doctor_id, service_id, duration_minutes, is_active
  ) values (p_clinic_id, p_doctor_id, p_service_id, p_duration_minutes, p_is_active)
  on conflict (clinic_id, doctor_id, service_id) do update
    set duration_minutes = excluded.duration_minutes, is_active = excluded.is_active;
  update public.clinic_doctor_service_devices set is_active = false
    where clinic_id = p_clinic_id and doctor_id = p_doctor_id and service_id = p_service_id;
  insert into public.clinic_doctor_service_devices (
    clinic_id, doctor_id, service_id, device_id, is_active
  ) select p_clinic_id, p_doctor_id, p_service_id, id, true from unnest(v_ids) as ids(id)
  on conflict (clinic_id, doctor_id, service_id, device_id) do update set is_active = true;
end;
$$;

revoke all on function public.crm_setup_set_service_devices(uuid, uuid, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.crm_setup_set_service_devices(uuid, uuid, boolean, uuid[])
  to authenticated;
revoke all on function public.crm_setup_set_doctor_service(uuid, uuid, uuid, integer, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.crm_setup_set_doctor_service(uuid, uuid, uuid, integer, boolean, uuid[])
  to authenticated;
commit;
