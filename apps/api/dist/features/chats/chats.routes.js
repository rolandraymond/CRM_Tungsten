import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/require-auth.js';
import { createUserSupabaseClient } from '../../lib/supabase.js';
export const chatsRouter = Router();
chatsRouter.use(requireAuth);
const pageSchema = z.strictObject({
    clinic_id: z.uuid(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
});
const replySchema = z.strictObject({
    clinic_id: z.uuid(), request_id: z.uuid(), text: z.string().trim().min(1).max(1000),
});
chatsRouter.get('/channels', async (req, res) => {
    const clinic = z.uuid().safeParse(req.query.clinic_id);
    if (!clinic.success) {
        res.status(400).json({ error: { code: 'INVALID_INPUT' } });
        return;
    }
    const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken)
        .from('chat_channels').select('id,clinic_id,platform,asset_id,name,is_active').eq('clinic_id', clinic.data).order('name');
    if (error) {
        res.status(502).json({ error: { code: 'CHATS_FETCH_FAILED' } });
        return;
    }
    res.json({ data });
});
chatsRouter.post('/channels', async (req, res) => {
    const input = z.strictObject({ clinic_id: z.uuid(), platform: z.enum(['facebook', 'instagram']),
        asset_id: z.string().trim().regex(/^[0-9]+$/).max(100), name: z.string().trim().min(1).max(200) }).safeParse(req.body);
    if (!input.success) {
        res.status(400).json({ error: { code: 'INVALID_INPUT' } });
        return;
    }
    const { clinic_id, platform, asset_id, name } = input.data;
    const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken).rpc('crm_add_chat_channel', {
        p_clinic_id: clinic_id, p_platform: platform, p_asset_id: asset_id, p_name: name,
    });
    if (error) {
        res.status(error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400)
            .json({ error: { code: error.code === '23505' ? 'CHANNEL_ALREADY_BOUND' : 'CHANNEL_SETUP_FAILED' } });
        return;
    }
    res.status(201).json({ data });
});
chatsRouter.get('/conversations', async (req, res) => {
    const input = pageSchema.safeParse(req.query);
    if (!input.success) {
        res.status(400).json({ error: { code: 'INVALID_INPUT' } });
        return;
    }
    const from = (input.data.page - 1) * 30;
    const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken)
        .from('chat_conversations').select('id,clinic_id,customer_id,last_message_at,last_customer_message_at,channel:chat_channels!chat_conversations_channel_id_clinic_id_fkey(id,name,platform,asset_id,is_active)')
        .eq('clinic_id', input.data.clinic_id).order('last_message_at', { ascending: false }).order('id', { ascending: false }).range(from, from + 30);
    if (error) {
        res.status(502).json({ error: { code: 'CHATS_FETCH_FAILED' } });
        return;
    }
    res.json({ data: data?.slice(0, 30), pagination: { has_more: (data?.length ?? 0) > 30 } });
});
chatsRouter.get('/conversations/:id/messages', async (req, res) => {
    const input = pageSchema.safeParse(req.query);
    const id = z.uuid().safeParse(req.params.id);
    if (!input.success || !id.success) {
        res.status(400).json({ error: { code: 'INVALID_INPUT' } });
        return;
    }
    const from = (input.data.page - 1) * 50;
    const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken)
        .from('chat_messages').select('id,direction,text,attachments,status,failure_code,sent_by,occurred_at')
        .eq('clinic_id', input.data.clinic_id).eq('conversation_id', id.data)
        .order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(from, from + 50);
    if (error) {
        res.status(502).json({ error: { code: 'CHATS_FETCH_FAILED' } });
        return;
    }
    res.json({ data: data?.slice(0, 50), pagination: { has_more: (data?.length ?? 0) > 50 } });
});
chatsRouter.post('/conversations/:id/messages', async (req, res) => {
    const input = replySchema.safeParse(req.body);
    const id = z.uuid().safeParse(req.params.id);
    if (!input.success || !id.success) {
        res.status(400).json({ error: { code: 'INVALID_INPUT' } });
        return;
    }
    if (process.env.META_CHAT_SEND_ENABLED !== 'true') {
        res.status(503).json({ error: { code: 'CHAT_SENDING_DISABLED' } });
        return;
    }
    const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken).rpc('crm_queue_chat_reply', {
        p_clinic_id: input.data.clinic_id, p_conversation_id: id.data, p_request_id: input.data.request_id, p_text: input.data.text,
    });
    if (error) {
        const code = ['REPLY_WINDOW_CLOSED', 'CHANNEL_INACTIVE', 'FORBIDDEN', 'CONVERSATION_NOT_FOUND', 'REQUEST_ID_CONFLICT'].includes(error.message)
            ? error.message : 'CHAT_REPLY_FAILED';
        res.status(error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '23505' ? 409 : 400).json({ error: { code } });
        return;
    }
    res.status(202).json({ data });
});
//# sourceMappingURL=chats.routes.js.map