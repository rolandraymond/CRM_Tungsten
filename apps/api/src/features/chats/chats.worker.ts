import { createClient } from '@supabase/supabase-js';
import { sendMetaText } from './meta-send.js';
import type { MetaSendConfig } from './meta-send.js';

export function startChatsWorker() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.warn('[Chats worker] Service credentials missing; worker disabled'); return () => {}; }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let stopped = false;
  let running = false;
  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const inbox = await db.rpc('crm_process_meta_inbox');
      if (inbox.error) { console.error('[Chats worker] Inbox failed:', inbox.error.code); return; }
      if (process.env.META_CHAT_SEND_ENABLED !== 'true') return;
      // After a crash a claimed send has an uncertain result, not a safe retry.
      await db.from('chat_messages').update({ status: 'unknown', failure_code: 'WORKER_INTERRUPTED' })
        .eq('status', 'sending').lt('sending_started_at', new Date(Date.now() - 120000).toISOString());
      for (let i = 0; i < 10 && !stopped; i++) {
        const claimed = await db.rpc('crm_claim_chat_reply');
        if (claimed.error) { console.error('[Chats worker] Claim failed:', claimed.error.code); break; }
        const message = claimed.data?.[0];
        if (!message) break;
        const conversation = await db.from('chat_conversations').select('customer_id,last_customer_message_at')
          .eq('id', message.conversation_id).single();
        const channel = await db.from('chat_channels').select('platform,asset_id,is_active').eq('id', message.channel_id).single();
        let result: Awaited<ReturnType<typeof sendMetaText>> = { status: 'failed', code: 'CHANNEL_NOT_CONFIGURED' };
        let configs: Record<string, MetaSendConfig> = {};
        try { configs = JSON.parse(process.env.META_CHAT_CHANNELS_JSON ?? '{}'); } catch { /* Safe failure, never log tokens. */ }
        const config = channel.data && configs[`${channel.data.platform}:${channel.data.asset_id}`];
        if (conversation.error || channel.error) result = { status: 'unknown', code: 'CHANNEL_LOOKUP_FAILED' };
        else if (!channel.data.is_active) result = { status: 'failed', code: 'CHANNEL_INACTIVE' };
        else if (!conversation.data.last_customer_message_at || Date.parse(conversation.data.last_customer_message_at) < Date.now() - 86400000)
          result = { status: 'failed', code: 'REPLY_WINDOW_CLOSED' };
        else if (config) result = await sendMetaText(config, channel.data.platform, conversation.data.customer_id, message.text,
          process.env.META_GRAPH_API_VERSION ?? 'v26.0');
        if (result.status === 'sent') {
          const saved = await db.rpc('crm_complete_chat_reply', { p_message_id: message.id, p_provider_message_id: result.messageId });
          if (saved.error) console.error('[Chats worker] Sent result storage failed:', saved.error.code);
        } else {
          const saved = await db.from('chat_messages').update({ status: result.status, failure_code: result.code })
            .eq('id', message.id).eq('status', 'sending');
          if (saved.error) console.error('[Chats worker] Send result storage failed:', saved.error.code);
        }
      }
    } catch { console.error('[Chats worker] Processing failed'); }
    finally { running = false; }
  }
  const timer = setInterval(() => void tick(), 2000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
