alter table public.chat_conversations
  add column lead_id uuid,
  add column lead_linked_at timestamptz,
  add column lead_linked_by uuid references public.profiles(id),

  add constraint chat_conversations_lead_same_clinic_fk
    foreign key (clinic_id, lead_id)
    references public.leads (clinic_id, id);

create index chat_conversations_lead_idx
  on public.chat_conversations (clinic_id, lead_id)
  where lead_id is not null;

create function public.crm_link_chat_lead(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.chat_conversations;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if not (
    private.is_platform_admin()
    or coalesce(
      private.current_clinic_role(p_clinic_id) in (
        'moderator',
        'agency_follow_up',
        'clinic_customer_service',
        'clinic_manager'
      ),
      false
    )
  ) then
    raise exception 'FORBIDDEN'
      using errcode = '42501';
  end if;

  select *
  into v_conversation
  from public.chat_conversations
  where id = p_conversation_id
    and clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_conversation.lead_id = p_lead_id then
    return jsonb_build_object(
      'conversation_id', v_conversation.id,
      'lead_id', v_conversation.lead_id,
      'replayed', true
    );
  end if;

  if v_conversation.lead_id is not null then
    raise exception 'CONVERSATION_ALREADY_LINKED'
      using errcode = '23505';
  end if;

  perform 1
  from public.leads
  where id = p_lead_id
    and clinic_id = p_clinic_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'LEAD_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  update public.chat_conversations
  set lead_id = p_lead_id,
      lead_linked_at = now(),
      lead_linked_by = auth.uid()
  where id = p_conversation_id
    and clinic_id = p_clinic_id;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'lead_id', p_lead_id,
    'replayed', false
  );
end;
$$;

revoke all
on function public.crm_link_chat_lead(uuid, uuid, uuid)
from public, anon;

grant execute
on function public.crm_link_chat_lead(uuid, uuid, uuid)
to authenticated;