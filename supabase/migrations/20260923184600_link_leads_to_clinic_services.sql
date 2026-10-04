alter table public.leads
  add column requested_service_id uuid;

alter table public.leads
  add constraint leads_requested_service_same_clinic_fk
  foreign key (clinic_id, requested_service_id)
  references public.clinic_services (clinic_id, service_id)
  on delete restrict;

create index leads_requested_service_idx
  on public.leads (clinic_id, requested_service_id);