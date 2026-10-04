-- Channels belong to one clinic. Access tokens stay in the API environment.
create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  platform text not null check (platform in ('facebook', 'instagram')),
  asset_id text not null check (length(asset_id) between 1 and 100),
  name text not null check (length(trim(name)) between 1 and 200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (platform, asset_id),
  unique (id, clinic_id)
);

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  channel_id uuid not null,
  customer_id text not null,
  last_message_at timestamptz not null,
  last_customer_message_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (channel_id, clinic_id) references public.chat_channels(id, clinic_id),
  unique (channel_id, customer_id),
  unique (id, clinic_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  conversation_id uuid not null,
  channel_id uuid not null,
  provider_message_id text,
  request_id uuid,
  direction text not null check (direction in ('incoming', 'outgoing')),
  text text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null check (status in ('received', 'queued', 'sending', 'sent', 'failed', 'unknown')),
  failure_code text,
  sending_started_at timestamptz,
  sent_by uuid references public.profiles(id),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, clinic_id) references public.chat_conversations(id, clinic_id),
  foreign key (channel_id, clinic_id) references public.chat_channels(id, clinic_id),
  unique (channel_id, provider_message_id),
  unique (request_id),
  check (jsonb_typeof(attachments) = 'array')
);

create index chat_conversations_clinic_time on public.chat_conversations(clinic_id, last_message_at desc, id desc);
create index chat_messages_conversation_time on public.chat_messages(conversation_id, occurred_at desc, id desc);
create index chat_messages_outbox on public.chat_messages(created_at) where status = 'queued';
alter table public.meta_webhook_inbox add column attempts integer not null default 0;
alter table public.meta_webhook_inbox add column retry_at timestamptz not null default now();
alter table public.meta_webhook_inbox add column last_error text;

create function private.can_read_chats(p_clinic_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() or private.current_clinic_role(p_clinic_id) is not null;
$$;
revoke all on function private.can_read_chats(uuid) from public, anon;
grant execute on function private.can_read_chats(uuid) to authenticated;

alter table public.chat_channels enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_channels, public.chat_conversations, public.chat_messages from public, anon, authenticated;
grant select on public.chat_channels, public.chat_conversations, public.chat_messages to authenticated;
grant all on public.chat_channels, public.chat_conversations, public.chat_messages to service_role;
create policy chat_channels_read on public.chat_channels for select to authenticated using (private.can_read_chats(clinic_id));
create policy chat_conversations_read on public.chat_conversations for select to authenticated using (private.can_read_chats(clinic_id));
create policy chat_messages_read on public.chat_messages for select to authenticated using (private.can_read_chats(clinic_id));

-- Only an admin can bind a Meta asset. Never move existing history to another clinic.
create function public.crm_add_chat_channel(p_clinic_id uuid, p_platform text, p_asset_id text, p_name text)
returns public.chat_channels language plpgsql security definer set search_path = '' as $$
declare v_channel public.chat_channels;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id and archived_at is null) then
    raise exception 'CLINIC_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.chat_channels(clinic_id, platform, asset_id, name)
  values (p_clinic_id, p_platform, trim(p_asset_id), trim(p_name)) returning * into v_channel;
  return v_channel;
end;
$$;
revoke all on function public.crm_add_chat_channel(uuid,text,text,text) from public, anon;
grant execute on function public.crm_add_chat_channel(uuid,text,text,text) to authenticated;

-- A durable inbox consumer. Every payload is one transaction/savepoint, including dedupe.
-- Unmapped assets remain pending so registering a channel later can recover the events.
create function public.crm_process_meta_inbox() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_inbox record; v_entry jsonb; v_event jsonb; v_channel public.chat_channels;
  v_platform text; v_customer text; v_mid text; v_time timestamptz;
  v_conversation uuid; v_echo boolean; v_count integer := 0;
begin
  for v_inbox in select * from public.meta_webhook_inbox
    where processed_at is null and retry_at <= now()
    order by received_at limit 25 for update skip locked
  loop
    begin
      v_platform := case v_inbox.payload->>'object' when 'page' then 'facebook' when 'instagram' then 'instagram' end;
      for v_entry in select value from jsonb_array_elements(v_inbox.payload->'entry') loop
        for v_event in select value from jsonb_array_elements(coalesce(v_entry->'messaging', '[]'::jsonb)) loop
          -- Read/delivery receipts do not create fake customer messages.
          if not (v_event ? 'message') or coalesce(v_event->'message'->>'is_deleted','false') = 'true' then continue; end if;
          v_mid := v_event->'message'->>'mid';
          if v_mid is null or length(v_mid) = 0 then raise exception 'MESSAGE_ID_MISSING'; end if;
          select * into v_channel from public.chat_channels
            where platform = v_platform and asset_id = v_entry->>'id' and is_active;
          if not found then raise exception 'CHANNEL_NOT_CONFIGURED'; end if;
          perform pg_advisory_xact_lock(hashtextextended(v_channel.id::text, 0));
          v_echo := coalesce((v_event->'message'->>'is_echo')::boolean, false);
          if (not v_echo and v_event->'recipient'->>'id' is distinct from v_channel.asset_id)
            or (v_echo and v_event->'sender'->>'id' is distinct from v_channel.asset_id) then
            raise exception 'ASSET_MISMATCH';
          end if;
          v_customer := case when v_echo then v_event->'recipient'->>'id' else v_event->'sender'->>'id' end;
          if v_customer is null or length(v_customer) = 0 then raise exception 'CUSTOMER_ID_MISSING'; end if;
          v_time := to_timestamp((v_event->>'timestamp')::double precision / 1000);
          if v_time is null or v_time > now() + interval '5 minutes' then raise exception 'INVALID_EVENT_TIME'; end if;
          insert into public.chat_conversations(clinic_id, channel_id, customer_id, last_message_at, last_customer_message_at)
            values (v_channel.clinic_id, v_channel.id, v_customer, v_time, case when not v_echo then v_time end)
            on conflict (channel_id, customer_id) do update set
              last_message_at = greatest(chat_conversations.last_message_at, excluded.last_message_at),
              last_customer_message_at = greatest(chat_conversations.last_customer_message_at, excluded.last_customer_message_at)
            returning id into v_conversation;
          insert into public.chat_messages(clinic_id, conversation_id, channel_id, provider_message_id, direction, text, attachments, status, occurred_at)
            values (v_channel.clinic_id, v_conversation, v_channel.id, v_mid,
              case when v_echo then 'outgoing' else 'incoming' end,
              v_event->'message'->>'text', coalesce(v_event->'message'->'attachments','[]'::jsonb),
              case when v_echo then 'sent' else 'received' end, v_time)
            on conflict (channel_id, provider_message_id) do nothing;
        end loop;
      end loop;
      update public.meta_webhook_inbox set processed_at = now(), last_error = null where id = v_inbox.id;
      v_count := v_count + 1;
    exception when others then
      update public.meta_webhook_inbox set attempts = attempts + 1,
        retry_at = now() + interval '1 minute', last_error = left(sqlerrm, 200) where id = v_inbox.id;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.crm_process_meta_inbox() from public, anon, authenticated;
grant execute on function public.crm_process_meta_inbox() to service_role;

create function public.crm_queue_chat_reply(p_clinic_id uuid, p_conversation_id uuid, p_request_id uuid, p_text text)
returns public.chat_messages language plpgsql security definer set search_path = '' as $$
declare v_conversation public.chat_conversations; v_message public.chat_messages;
begin
  if not (private.is_platform_admin() or coalesce(private.current_clinic_role(p_clinic_id)
    in ('moderator','agency_follow_up','clinic_customer_service','clinic_manager'), false)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_text is null or length(trim(p_text)) not between 1 and 1000 or p_request_id is null then raise exception 'INVALID_REPLY' using errcode = '22023'; end if;
  select * into v_conversation from public.chat_conversations where id = p_conversation_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_message from public.chat_messages where request_id = p_request_id;
  if found then
    if v_message.conversation_id <> p_conversation_id or v_message.sent_by <> auth.uid() or v_message.text <> trim(p_text) then
      raise exception 'REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_message;
  end if;
  if not exists (select 1 from public.chat_channels where id = v_conversation.channel_id and is_active) then
    raise exception 'CHANNEL_INACTIVE' using errcode = '22023';
  end if;
  if v_conversation.last_customer_message_at is null or v_conversation.last_customer_message_at < now() - interval '24 hours' then
    raise exception 'REPLY_WINDOW_CLOSED' using errcode = '22023';
  end if;
  insert into public.chat_messages(clinic_id, conversation_id, channel_id, request_id, direction, text, status, sent_by, occurred_at)
    values (p_clinic_id, p_conversation_id, v_conversation.channel_id, p_request_id, 'outgoing', trim(p_text), 'queued', auth.uid(), now())
    returning * into v_message;
  return v_message;
end;
$$;
revoke all on function public.crm_queue_chat_reply(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.crm_queue_chat_reply(uuid,uuid,uuid,text) to authenticated;

-- A claim prevents two API workers sending one queued reply.
create function public.crm_claim_chat_reply() returns setof public.chat_messages
language sql security definer set search_path = '' as $$
  update public.chat_messages set status = 'sending', sending_started_at = now()
  where id = (select id from public.chat_messages where status = 'queued' order by created_at limit 1 for update skip locked)
  returning *;
$$;
revoke all on function public.crm_claim_chat_reply() from public, anon, authenticated;
grant execute on function public.crm_claim_chat_reply() to service_role;

-- Echoes can arrive before the Send API response. Reconcile them atomically.
create function public.crm_complete_chat_reply(p_message_id uuid, p_provider_message_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_message public.chat_messages; v_echo public.chat_messages;
begin
  select * into v_message from public.chat_messages where id = p_message_id;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_message.channel_id::text, 0));
  if p_provider_message_id is null or length(p_provider_message_id) = 0 then raise exception 'MESSAGE_ID_MISSING'; end if;
  select * into v_echo from public.chat_messages where channel_id = v_message.channel_id
    and provider_message_id = p_provider_message_id;
  if found and v_echo.id <> p_message_id then
    if v_echo.direction <> 'outgoing' or v_echo.conversation_id <> v_message.conversation_id or v_echo.sent_by is not null then
      raise exception 'MESSAGE_ID_CONFLICT';
    end if;
    delete from public.chat_messages where id = v_echo.id;
  end if;
  update public.chat_messages set status = 'sent', provider_message_id = p_provider_message_id, failure_code = null
    where id = p_message_id;
  update public.chat_conversations set last_message_at = greatest(last_message_at, v_message.occurred_at)
    where id = v_message.conversation_id;
end;
$$;
revoke all on function public.crm_complete_chat_reply(uuid,text) from public, anon, authenticated;
grant execute on function public.crm_complete_chat_reply(uuid,text) to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_channels, public.chat_conversations, public.chat_messages;
  end if;
end $$;
