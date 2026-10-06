import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/require-auth.js';
import { createUserSupabaseClient } from '../../lib/supabase.js';
import { getFacebookCustomerProfile } from './meta-profile.js';
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
chatsRouter.get('/conversations/:id/profile', async (req, res) => {
    const clinicId = z.uuid().safeParse(req.query.clinic_id);
    const conversationId = z.uuid().safeParse(req.params.id);
    if (!clinicId.success || !conversationId.success) {
        res.status(400).json({ error: { code: 'INVALID_INPUT' } });
        return;
    }
    const db = createUserSupabaseClient(res.locals.auth.accessToken);
    try {
        // Check conversation access before using any server-side Meta token.
        const conversation = await db
            .from('chat_conversations')
            .select('id,customer_id,channel_id')
            .eq('clinic_id', clinicId.data)
            .eq('id', conversationId.data)
            .maybeSingle();
        if (conversation.error)
            throw conversation.error;
        if (!conversation.data) {
            res.status(404).json({
                error: { code: 'CONVERSATION_NOT_FOUND' },
            });
            return;
        }
        const channel = await db
            .from('chat_channels')
            .select('platform,asset_id,is_active')
            .eq('clinic_id', clinicId.data)
            .eq('id', conversation.data.channel_id)
            .maybeSingle();
        if (channel.error)
            throw channel.error;
        const unavailable = {
            customer_id: conversation.data.customer_id,
            name: null,
            photo_url: null,
        };
        res.setHeader('Cache-Control', 'no-store');
        if (!channel.data?.is_active
            || channel.data.platform !== 'facebook') {
            res.json({ data: unavailable });
            return;
        }
        let configs;
        try {
            configs = JSON.parse(process.env.META_CHAT_CHANNELS_JSON ?? '{}');
        }
        catch {
            res.json({ data: unavailable });
            return;
        }
        const key = `facebook:${channel.data.asset_id}`;
        const candidate = configs
            && typeof configs === 'object'
            && !Array.isArray(configs)
            ? configs[key]
            : undefined;
        const configSchema = z.object({
            token: z.string().trim().min(1),
            endpoint_id: z.string().regex(/^[0-9]+$/),
            host: z.enum(['facebook', 'instagram']).optional(),
        });
        const parsed = configSchema.safeParse(candidate);
        if (!parsed.success
            || parsed.data.endpoint_id !== channel.data.asset_id
            || parsed.data.host === 'instagram') {
            res.json({ data: unavailable });
            return;
        }
        const config = parsed.data;
        const profile = await getFacebookCustomerProfile(config, conversation.data.customer_id, process.env.META_GRAPH_VERSION ?? 'v26.0');
        res.json({
            data: {
                customer_id: conversation.data.customer_id,
                name: profile.name,
                photo_url: profile.photo_url,
            },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'CHAT_PROFILE_FETCH_FAILED' },
        });
    }
});
chatsRouter.get('/conversations/:id/referrals', async (req, res) => {
    const input = pageSchema.safeParse(req.query);
    const id = z.uuid().safeParse(req.params.id);
    if (!input.success || !id.success) {
        res.status(400).json({ error: { code: 'INVALID_INPUT' } });
        return;
    }
    const db = createUserSupabaseClient(res.locals.auth.accessToken);
    try {
        // Check access using the signed-in user's RLS permissions.
        const conversation = await db
            .from('chat_conversations')
            .select('id')
            .eq('clinic_id', input.data.clinic_id)
            .eq('id', id.data)
            .maybeSingle();
        if (conversation.error)
            throw conversation.error;
        if (!conversation.data) {
            res.status(404).json({
                error: { code: 'CONVERSATION_NOT_FOUND' },
            });
            return;
        }
        const from = (input.data.page - 1) * 20;
        const referrals = await db
            .from('chat_referrals')
            .select(`
        id,
        meta_ad_id,
        source,
        referral_type,
        referral_ref,
        ad_title,
        occurred_at
      `)
            .eq('clinic_id', input.data.clinic_id)
            .eq('conversation_id', id.data)
            .order('occurred_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + 20);
        if (referrals.error)
            throw referrals.error;
        const rows = referrals.data ?? [];
        res.json({
            data: rows.slice(0, 20),
            pagination: {
                has_more: rows.length > 20,
            },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'CHAT_REFERRALS_FETCH_FAILED' },
        });
    }
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