begin;

-- Each referral is preserved as a separate event.
-- No referral means unknown attribution, not automatically organic.
create table public.chat_referrals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  conversation_id uuid not null,
  channel_id uuid not null,
  meta_ad_id text,
  source text,
  referral_type text,
  referral_ref text,
  ad_title text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  event_key text not null,

  constraint chat_referrals_conversation_same_clinic_fk
    foreign key (conversation_id, clinic_id)
    references public.chat_conversations (id, clinic_id),

  constraint chat_referrals_channel_same_clinic_fk
    foreign key (channel_id, clinic_id)
    references public.chat_channels (id, clinic_id),

  constraint chat_referrals_ad_id_check
    check (
      meta_ad_id is null
      or (
        length(meta_ad_id) between 1 and 100
        and meta_ad_id ~ '^[0-9]+$'
      )
    ),

  constraint chat_referrals_event_unique
    unique (channel_id, event_key)
);

create index chat_referrals_conversation_time_idx
  on public.chat_referrals (
    clinic_id,
    conversation_id,
    occurred_at desc,
    id desc
  );

create index chat_referrals_ad_idx
  on public.chat_referrals (clinic_id, meta_ad_id)
  where meta_ad_id is not null;

alter table public.chat_referrals enable row level security;

revoke all on public.chat_referrals
  from public, anon, authenticated;

grant select on public.chat_referrals to authenticated;
grant all on public.chat_referrals to service_role;

create policy chat_referrals_read
  on public.chat_referrals
  for select
  to authenticated
  using (private.can_read_chats(clinic_id));

-- Replace the existing consumer without changing its RPC name.
create or replace function public.crm_process_meta_inbox()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox record;
  v_entry jsonb;
  v_event jsonb;
  v_referral jsonb;
  v_candidate jsonb;

  v_channel public.chat_channels;
  v_platform text;
  v_customer text;
  v_mid text;
  v_time timestamptz;
  v_conversation uuid;

  v_echo boolean;
  v_has_message boolean;
  v_ad_id text;
  v_source text;
  v_referral_type text;
  v_ref text;
  v_ad_title text;
  v_event_key text;

  v_count integer := 0;
begin
  for v_inbox in
    select *
    from public.meta_webhook_inbox
    where processed_at is null
      and retry_at <= now()
    order by received_at
    limit 25
    for update skip locked
  loop
    begin
      v_platform := case v_inbox.payload ->> 'object'
        when 'page' then 'facebook'
        when 'instagram' then 'instagram'
        else null
      end;

      for v_entry in
        select value
        from jsonb_array_elements(
          coalesce(v_inbox.payload -> 'entry', '[]'::jsonb)
        )
      loop
        for v_event in
          select value
          from jsonb_array_elements(
            coalesce(v_entry -> 'messaging', '[]'::jsonb)
          )
        loop
          v_has_message :=
            jsonb_typeof(v_event -> 'message') = 'object';

          v_has_message := coalesce(v_has_message, false);
          v_referral := null;

          -- Supported referral locations.
          -- Select an actual object rather than a JSON null.
          foreach v_candidate in array array[
            v_event -> 'referral',
            v_event -> 'message' -> 'referral',
            v_event -> 'postback' -> 'referral'
          ]
          loop
            if jsonb_typeof(v_candidate) = 'object'
              and v_candidate <> '{}'::jsonb
            then
              v_referral := v_candidate;
              exit;
            end if;
          end loop;

          -- Ignore receipts and unrelated events.
          if not v_has_message and v_referral is null then
            continue;
          end if;

          if v_has_message
            and coalesce(
              v_event -> 'message' ->> 'is_deleted',
              'false'
            ) = 'true'
          then
            continue;
          end if;

          v_mid := null;

          if v_has_message then
            v_mid := v_event -> 'message' ->> 'mid';

            if v_mid is null or length(v_mid) = 0 then
              raise exception 'MESSAGE_ID_MISSING';
            end if;
          end if;

          select *
          into v_channel
          from public.chat_channels
          where platform = v_platform
            and asset_id = v_entry ->> 'id'
            and is_active;

          if not found then
            raise exception 'CHANNEL_NOT_CONFIGURED';
          end if;

          perform pg_advisory_xact_lock(
            hashtextextended(v_channel.id::text, 0)
          );

          v_echo := coalesce(
            (v_event -> 'message' ->> 'is_echo')::boolean,
            false
          );

          if (
            not v_echo
            and v_event -> 'recipient' ->> 'id'
              is distinct from v_channel.asset_id
          ) or (
            v_echo
            and v_event -> 'sender' ->> 'id'
              is distinct from v_channel.asset_id
          ) then
            raise exception 'ASSET_MISMATCH';
          end if;

          v_customer := case
            when v_echo then v_event -> 'recipient' ->> 'id'
            else v_event -> 'sender' ->> 'id'
          end;

          if v_customer is null or length(v_customer) = 0 then
            raise exception 'CUSTOMER_ID_MISSING';
          end if;

          v_time := to_timestamp(
            (v_event ->> 'timestamp')::double precision / 1000
          );

          if v_time is null
            or not isfinite(v_time)
            or v_time > now() + interval '5 minutes'
          then
            raise exception 'INVALID_EVENT_TIME';
          end if;

          -- Referral-only events can create a conversation,
          -- but cannot open the customer-message reply window.
          insert into public.chat_conversations (
            clinic_id,
            channel_id,
            customer_id,
            last_message_at,
            last_customer_message_at
          )
          values (
            v_channel.clinic_id,
            v_channel.id,
            v_customer,
            v_time,
            case
              when v_has_message and not v_echo then v_time
              else null
            end
          )
          on conflict (channel_id, customer_id)
          do update set
            last_message_at = greatest(
              chat_conversations.last_message_at,
              excluded.last_message_at
            ),
            last_customer_message_at = greatest(
              chat_conversations.last_customer_message_at,
              excluded.last_customer_message_at
            )
          returning id into v_conversation;

          -- Preserve incoming referral history.
          -- An outgoing echo must not attribute the customer to an ad.
          if v_referral is not null and not v_echo then
            v_ad_id := nullif(
              trim(v_referral ->> 'ad_id'),
              ''
            );

            -- Invalid ad identifiers remain unknown.
            if v_ad_id is not null and (
              length(v_ad_id) > 100
              or v_ad_id !~ '^[0-9]+$'
            ) then
              v_ad_id := null;
            end if;

            v_source := nullif(
              left(trim(v_referral ->> 'source'), 100),
              ''
            );

            v_referral_type := nullif(
              left(trim(v_referral ->> 'type'), 100),
              ''
            );

            v_ref := nullif(
              left(v_referral ->> 'ref', 2000),
              ''
            );

            v_ad_title := nullif(
              left(
                v_referral -> 'ads_context_data' ->> 'ad_title',
                500
              ),
              ''
            );

            -- Stable dedupe across repeated webhook deliveries.
            v_event_key := md5(
              jsonb_build_array(
                v_customer,
                v_event ->> 'timestamp',
                v_ad_id,
                v_source,
                v_referral_type,
                v_ref
              )::text
            );

            insert into public.chat_referrals (
              clinic_id,
              conversation_id,
              channel_id,
              meta_ad_id,
              source,
              referral_type,
              referral_ref,
              ad_title,
              occurred_at,
              event_key
            )
            values (
              v_channel.clinic_id,
              v_conversation,
              v_channel.id,
              v_ad_id,
              v_source,
              v_referral_type,
              v_ref,
              v_ad_title,
              v_time,
              v_event_key
            )
            on conflict (channel_id, event_key)
            do nothing;
          end if;

          -- Keep the existing message storage and dedupe behavior.
          if v_has_message then
            insert into public.chat_messages (
              clinic_id,
              conversation_id,
              channel_id,
              provider_message_id,
              direction,
              text,
              attachments,
              status,
              occurred_at
            )
            values (
              v_channel.clinic_id,
              v_conversation,
              v_channel.id,
              v_mid,
              case when v_echo then 'outgoing' else 'incoming' end,
              v_event -> 'message' ->> 'text',
              coalesce(
                v_event -> 'message' -> 'attachments',
                '[]'::jsonb
              ),
              case when v_echo then 'sent' else 'received' end,
              v_time
            )
            on conflict (channel_id, provider_message_id)
            do nothing;
          end if;
        end loop;
      end loop;

      update public.meta_webhook_inbox
      set processed_at = now(),
          last_error = null
      where id = v_inbox.id;

      v_count := v_count + 1;

    exception when others then
      -- Roll back this payload's writes and retain it for retry.
      update public.meta_webhook_inbox
      set attempts = attempts + 1,
          retry_at = now() + interval '1 minute',
          last_error = left(sqlerrm, 200)
      where id = v_inbox.id;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.crm_process_meta_inbox()
  from public, anon, authenticated;

grant execute on function public.crm_process_meta_inbox()
  to service_role;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime
      add table public.chat_referrals;
  end if;
end;
$$;

commit;