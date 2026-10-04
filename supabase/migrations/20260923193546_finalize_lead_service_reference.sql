-- Stop safely if existing leads still need service mapping.
do $$
begin
  if exists (
    select 1
    from public.leads
    where requested_service_id is null
  ) then
    raise exception
      'Map existing leads to clinic services before applying this migration';
  end if;
end;
$$;


-- Every lead must reference a service offered by its clinic.
alter table public.leads
  alter column requested_service_id set not null;


-- Preserve the service name recorded when the lead was created.
alter table public.leads
  rename column service_name
  to requested_service_name_snapshot;

alter table public.leads
  rename constraint leads_service_name_check
  to leads_requested_service_name_snapshot_check;


comment on column public.leads.requested_service_id is
  'Requested service, linked to the clinic service catalog.';

comment on column public.leads.requested_service_name_snapshot is
  'Service name copied by the lead creation function at creation time.';