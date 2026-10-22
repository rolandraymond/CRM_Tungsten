begin;

alter table public.clinic_services
  add column requires_device boolean,
  add column required_device_type text;

-- NULL: not configured yet.
-- FALSE: the service does not require a device.
-- TRUE: a device type must be specified.
alter table public.clinic_services
  add constraint clinic_service_device_requirement_check
  check (
    (
      requires_device is null
      and required_device_type is null
    )
    or
    (
      requires_device is false
      and required_device_type is null
    )
    or
    (
      requires_device is true
      and required_device_type is not null
      and length(trim(required_device_type)) between 1 and 100
      and required_device_type = lower(trim(required_device_type))
    )
  );

comment on column public.clinic_services.requires_device is
  'Clinic-wide service requirement. NULL means not configured.';

comment on column public.clinic_services.required_device_type is
  'Required device type, e.g. laser or onda. Applies to every doctor performing this clinic service.';

-- Retained temporarily for compatibility with the current API.
comment on column public.clinic_doctor_services.requires_device is
  'Deprecated. Use clinic_services.requires_device after API and UI migration.';

commit;