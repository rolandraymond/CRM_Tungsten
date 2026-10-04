create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),

  clinic_id uuid not null,

  appointment_id uuid not null,

  event_type text not null
    check (
      event_type in (
        'created',
        'status_changed',
        'rescheduled',
        'archived',
        'restored'
      )
    ),

  performed_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,

  performed_at timestamptz not null default now(),

  old_status text
    check (
      old_status in (
        'pending',
        'confirmed',
        'attended',
        'no_show',
        'cancelled'
      )
    ),

  new_status text
    check (
      new_status in (
        'pending',
        'confirmed',
        'attended',
        'no_show',
        'cancelled'
      )
    ),

  old_starts_at timestamptz,
  new_starts_at timestamptz,

  old_ends_at timestamptz,
  new_ends_at timestamptz,

  reason text
    check (
      reason is null
      or length(trim(reason)) > 0
    ),

  constraint appointment_events_same_clinic_fk
    foreign key (clinic_id, appointment_id)
    references public.appointments (clinic_id, id)
    on delete restrict,

  constraint appointment_events_status_change_check
    check (
      event_type <> 'status_changed'
      or (
        old_status is not null
        and new_status is not null
        and old_status <> new_status
      )
    ),

  constraint appointment_events_reschedule_check
    check (
      event_type <> 'rescheduled'
      or (
        old_starts_at is not null
        and new_starts_at is not null
        and (
          old_starts_at <> new_starts_at
          or old_ends_at is distinct from new_ends_at
        )
        and reason is not null
      )
    ),

  constraint appointment_events_old_time_order_check
    check (
      old_ends_at is null
      or (
        old_starts_at is not null
        and old_ends_at > old_starts_at
      )
    ),

  constraint appointment_events_new_time_order_check
    check (
      new_ends_at is null
      or (
        new_starts_at is not null
        and new_ends_at > new_starts_at
      )
    )
);

create index appointment_events_history_idx
  on public.appointment_events (
    clinic_id,
    appointment_id,
    performed_at,
    id
  );

alter table public.appointment_events
  enable row level security;

revoke all privileges
on table public.appointment_events
from public, anon, authenticated;