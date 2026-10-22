begin;

-- Required for equality comparisons in GiST exclusion constraints.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = pg_catalog, public, extensions;

-- doctor_id already references a clinic user account.
-- resource_doctor_id references the doctor added in booking setup.
-- Existing appointments retain NULL resource fields until explicitly assigned.
alter table public.appointments
  add column resource_doctor_id uuid,
  add column device_id uuid,
  add column duration_minutes integer,
  add column assignment_mode text;

comment on column public.appointments.resource_doctor_id is
  'Scheduling doctor from clinic_doctors; independent of legacy doctor_id.';

comment on column public.appointments.device_id is
  'One physical device reserved for this appointment, or NULL for a service without a device.';

comment on column public.appointments.duration_minutes is
  'Duration snapshot when booked. Changing doctor service settings does not change existing appointments.';

comment on column public.appointments.assignment_mode is
  'specific or auto; NULL for legacy appointments without assigned scheduling resources.';

alter table public.appointments
  add constraint appointments_resource_fields_check
  check (
    (
      resource_doctor_id is null
      and device_id is null
      and duration_minutes is null
      and assignment_mode is null
    )
    or
    (
      resource_doctor_id is not null
      and duration_minutes is not null
      and duration_minutes between 1 and 1440
      and assignment_mode is not null
      and assignment_mode in ('specific', 'auto')
      and ends_at is not null
      and ends_at - starts_at = make_interval(mins => duration_minutes)
    )
  ),

  add constraint appointments_resource_doctor_same_clinic_fk
  foreign key (clinic_id, resource_doctor_id)
  references public.clinic_doctors (clinic_id, id)
  on delete restrict,

  add constraint appointments_resource_doctor_service_fk
  foreign key (clinic_id, resource_doctor_id, booked_service_id)
  references public.clinic_doctor_services (clinic_id, doctor_id, service_id)
  on delete restrict,

  add constraint appointments_device_same_clinic_fk
  foreign key (clinic_id, device_id)
  references public.clinic_devices (clinic_id, id)
  on delete restrict,

  add constraint appointments_resource_doctor_service_device_fk
  foreign key (
    clinic_id,
    resource_doctor_id,
    booked_service_id,
    device_id
  )
  references public.clinic_doctor_service_devices (
    clinic_id,
    doctor_id,
    service_id,
    device_id
  )
  on delete restrict;

-- [start, end): another appointment may start exactly when this one ends.
-- Pending appointments reserve resources too, before phone confirmation.
-- Cancelled or archived appointments release their reservation.
-- GiST exclusions also protect against simultaneous booking requests.
alter table public.appointments
  add constraint appointments_resource_doctor_no_overlap
  exclude using gist (
    clinic_id with =,
    resource_doctor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    resource_doctor_id is not null
    and archived_at is null
    and status <> 'cancelled'
  ),

  add constraint appointments_device_no_overlap
  exclude using gist (
    clinic_id with =,
    device_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    device_id is not null
    and archived_at is null
    and status <> 'cancelled'
  );

commit;
