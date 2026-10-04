create table public.lead_events (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null,

  lead_id uuid not null,

  event_type text not null
    check (
      event_type in (
        'created',
        'contact_attempted',
        'status_changed',
        'assignment_changed',
        'follow_up_scheduled',
        'note_added',
        'archived',
        'restored'
      )
    ),

  performed_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  performed_at timestamptz not null default now(),

  contact_channel text
    check (
      contact_channel in (
        'phone',
        'whatsapp',
        'instagram',
        'facebook',
        'tiktok',
        'other'
      )
    ),

  contact_outcome text
    check (
      contact_outcome in (
        'reached',
        'no_answer',
        'unreachable',
        'invalid_number'
      )
    ),

  notes text
    check (
      notes is null
      or length(trim(notes)) > 0
    ),

  changes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(changes) = 'object'),

  constraint lead_events_same_clinic_fk
    foreign key (clinic_id, lead_id)
    references public.leads (clinic_id, id)
    on delete restrict,

  constraint lead_events_contact_details_check
    check (
      (
        event_type = 'contact_attempted'
        and contact_channel is not null
        and contact_outcome is not null
      )
      or
      (
        event_type <> 'contact_attempted'
        and contact_channel is null
        and contact_outcome is null
      )
    ),

  constraint lead_events_note_required_check
    check (
      event_type <> 'note_added'
      or notes is not null
    ),

  constraint lead_events_changes_required_check
    check (
      event_type not in (
        'status_changed',
        'assignment_changed',
        'follow_up_scheduled'
      )
      or changes <> '{}'::jsonb
    )
);

create index lead_events_history_idx
  on public.lead_events (
    clinic_id,
    lead_id,
    performed_at,
    id
  );

create index lead_events_staff_activity_idx
  on public.lead_events (
    clinic_id,
    performed_by,
    performed_at
  );

alter table public.lead_events
  enable row level security;

revoke all privileges
on table public.lead_events
from public, anon, authenticated;