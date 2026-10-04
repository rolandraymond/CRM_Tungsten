create table public.meta_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  payload_hash text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.meta_webhook_inbox
  enable row level security;

revoke all on public.meta_webhook_inbox
  from anon, authenticated;

grant select, insert, update
  on public.meta_webhook_inbox
  to service_role;