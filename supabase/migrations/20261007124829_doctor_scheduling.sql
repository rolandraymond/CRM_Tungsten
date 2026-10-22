begin;

-- Doctors can exist without a CRM login account.
create table public.clinic_doctors (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  full_name text not null
    check (length(trim(full_name)) between 1 and 200),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  unique (clinic_id, id)
);

-- Each row represents one physical device.
-- Example: Laser 1 and Laser 2 are separate rows.
create table public.clinic_devices (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  device_name text not null
    check (length(trim(device_name)) between 1 and 200),

  device_type text not null
    check (length(trim(device_type)) between 1 and 100),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  unique (clinic_id, id)
);

-- Duration belongs to the doctor + service combination.
create table public.clinic_doctor_services (
  clinic_id uuid not null,

  doctor_id uuid not null,

  service_id uuid not null,

  duration_minutes integer not null
    check (duration_minutes between 1 and 1440),

  requires_device boolean not null default false,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  primary key (clinic_id, doctor_id, service_id),

  foreign key (clinic_id, doctor_id)
    references public.clinic_doctors(clinic_id, id)
    on delete restrict,

  foreign key (clinic_id, service_id)
    references public.clinic_services(clinic_id, service_id)
    on delete restrict
);

-- Physical devices this doctor may use for this service.
-- Booking will select one available device from these rows.
create table public.clinic_doctor_service_devices (
  clinic_id uuid not null,

  doctor_id uuid not null,

  service_id uuid not null,

  device_id uuid not null,

  is_active boolean not null default true,

  primary key (
    clinic_id,
    doctor_id,
    service_id,
    device_id
  ),

  foreign key (clinic_id, doctor_id, service_id)
    references public.clinic_doctor_services(
      clinic_id,
      doctor_id,
      service_id
    )
    on delete restrict,

  foreign key (clinic_id, device_id)
    references public.clinic_devices(clinic_id, id)
    on delete restrict
);

-- Weekly working periods for a doctor OR a device.
-- ISO weekdays: Monday = 1, Sunday = 7.
-- Multiple rows per day allow split shifts and breaks.
create table public.clinic_resource_working_periods (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  doctor_id uuid,

  device_id uuid,

  iso_weekday integer not null
    check (iso_weekday between 1 and 7),

  starts_at time not null,

  ends_at time not null,

  -- 0: ends on the same day.
  -- 1: ends on the following day.
  end_day_offset integer not null default 0
    check (end_day_offset in (0, 1)),

  is_active boolean not null default true,

  constraint working_period_one_resource check (
    (doctor_id is not null and device_id is null)
    or
    (doctor_id is null and device_id is not null)
  ),

  constraint working_period_valid_times check (
    (
      end_day_offset = 0
      and ends_at > starts_at
    )
    or
    (
      end_day_offset = 1
      and ends_at <= starts_at
    )
  ),

  foreign key (clinic_id, doctor_id)
    references public.clinic_doctors(clinic_id, id)
    on delete restrict,

  foreign key (clinic_id, device_id)
    references public.clinic_devices(clinic_id, id)
    on delete restrict
);

-- Dated exceptions: leave, breaks, maintenance, etc.
-- Times are stored as absolute timestamps.
create table public.clinic_resource_blocks (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null
    references public.clinics(id) on delete restrict,

  doctor_id uuid,

  device_id uuid,

  starts_at timestamptz not null,

  ends_at timestamptz not null,

  reason text not null
    check (length(trim(reason)) between 1 and 1000),

  created_at timestamptz not null default now(),

  constraint resource_block_one_resource check (
    (doctor_id is not null and device_id is null)
    or
    (doctor_id is null and device_id is not null)
  ),

  constraint resource_block_valid_times check (
    ends_at > starts_at
  ),

  foreign key (clinic_id, doctor_id)
    references public.clinic_doctors(clinic_id, id)
    on delete restrict,

  foreign key (clinic_id, device_id)
    references public.clinic_devices(clinic_id, id)
    on delete restrict
);

create index doctor_services_by_service_idx
  on public.clinic_doctor_services (
    clinic_id,
    service_id,
    doctor_id
  )
  where is_active;

create index doctor_service_devices_by_device_idx
  on public.clinic_doctor_service_devices (
    clinic_id,
    device_id
  );

create index working_periods_doctor_idx
  on public.clinic_resource_working_periods (
    clinic_id,
    doctor_id,
    iso_weekday
  )
  where doctor_id is not null;

create index working_periods_device_idx
  on public.clinic_resource_working_periods (
    clinic_id,
    device_id,
    iso_weekday
  )
  where device_id is not null;

create index resource_blocks_doctor_idx
  on public.clinic_resource_blocks (
    clinic_id,
    doctor_id,
    starts_at,
    ends_at
  )
  where doctor_id is not null;

create index resource_blocks_device_idx
  on public.clinic_resource_blocks (
    clinic_id,
    device_id,
    starts_at,
    ends_at
  )
  where device_id is not null;

-- Apply the same clinic-scoped permissions to all new tables.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinic_doctors',
    'clinic_devices',
    'clinic_doctor_services',
    'clinic_doctor_service_devices',
    'clinic_resource_working_periods',
    'clinic_resource_blocks'
  ]
  loop
    execute format(
      'alter table public.%I enable row level security',
      v_table
    );

    execute format(
      'revoke all privileges on table public.%I
       from public, anon, authenticated',
      v_table
    );

    execute format(
      'grant select, insert, update, delete
       on table public.%I to authenticated',
      v_table
    );

    execute format(
      'create policy scheduling_read
       on public.%I
       for select
       to authenticated
       using (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id) in (
           ''moderator'',
           ''agency_follow_up'',
           ''clinic_customer_service'',
           ''clinic_manager'',
           ''doctor''
         )
       )',
      v_table
    );

    execute format(
      'create policy scheduling_insert
       on public.%I
       for insert
       to authenticated
       with check (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id)
           = ''clinic_manager''
       )',
      v_table
    );

    execute format(
      'create policy scheduling_update
       on public.%I
       for update
       to authenticated
       using (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id)
           = ''clinic_manager''
       )
       with check (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id)
           = ''clinic_manager''
       )',
      v_table
    );

    execute format(
      'create policy scheduling_delete
       on public.%I
       for delete
       to authenticated
       using (
         (select private.is_platform_admin())
         or private.current_clinic_role(clinic_id)
           = ''clinic_manager''
       )',
      v_table
    );
  end loop;
end;
$$;

commit;