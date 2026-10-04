alter table public.leads
  add column contact_type_at_creation text not null
    constraint leads_contact_type_at_creation_check
    check (
      contact_type_at_creation in (
        'new_contact',
        'existing_contact'
      )
    );

comment on column public.leads.contact_type_at_creation is
  'Contact classification when this lead was created. '
  'Set by the lead creation function and preserved for historical reporting.';