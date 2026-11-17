import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';
export const internalClientsRouter = Router();
internalClientsRouter.use(requireAuth);
const clientSchema = z.strictObject({
    client_name: z.string().trim().min(1).max(200),
    phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
    company_name: z.string().trim().max(200).nullable().optional(),
    service_requested: z.string().trim().max(200).nullable().optional(),
    deal_value: z.number().min(0).default(0),
    status: z.enum([
        'new',
        'contacted',
        'qualified',
        'proposal',
        'negotiation',
        'won',
        'lost',
    ]).default('new'),
    notes: z.string().max(2000).nullable().optional(),
    sales_id: z.string().uuid().optional(),
});
const updateClientSchema = z.strictObject({
    client_name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
    company_name: z.string().trim().max(200).nullable().optional(),
    service_requested: z.string().trim().max(200).nullable().optional(),
    deal_value: z.number().min(0).optional(),
    status: z.enum([
        'new',
        'contacted',
        'qualified',
        'proposal',
        'negotiation',
        'won',
        'lost',
    ]).optional(),
    notes: z.string().max(2000).nullable().optional(),
    sales_id: z.string().uuid().optional(),
});
// GET /api/internal/clients
internalClientsRouter.get('/', async (_req, res) => {
    const auth = res.locals.auth;
    const db = createUserSupabaseClient(auth.accessToken);
    try {
        const { data, error } = await db
            .from('tungsten_clients')
            .select(`
        id,
        client_name,
        phone,
        email,
        company_name,
        service_requested,
        deal_value,
        status,
        notes,
        sales_id,
        created_by,
        created_at,
        updated_at,
        creator:profiles!tungsten_clients_created_by_fkey (id, full_name),
        sales_rep:profiles!tungsten_clients_sales_id_fkey (id, full_name)
      `)
            .order('created_at', { ascending: false });
        if (error) {
            res.status(error.code === '42501' ? 403 : 502).json({
                error: { code: 'CLIENTS_FETCH_FAILED', message: error.message },
            });
            return;
        }
        res.json({ data: data ?? [] });
    }
    catch {
        res.status(502).json({ error: { code: 'CLIENTS_FETCH_FAILED' } });
    }
});
// POST /api/internal/clients
internalClientsRouter.post('/', async (req, res) => {
    const auth = res.locals.auth;
    const parsed = clientSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } });
        return;
    }
    const db = createUserSupabaseClient(auth.accessToken);
    try {
        const payload = {
            ...parsed.data,
            created_by: auth.userId,
            sales_id: parsed.data.sales_id || auth.userId,
            updated_at: new Date().toISOString(),
        };
        const { data, error } = await db
            .from('tungsten_clients')
            .insert(payload)
            .select(`
        id,
        client_name,
        phone,
        email,
        company_name,
        service_requested,
        deal_value,
        status,
        notes,
        sales_id,
        created_by,
        created_at,
        creator:profiles!tungsten_clients_created_by_fkey (id, full_name),
        sales_rep:profiles!tungsten_clients_sales_id_fkey (id, full_name)
      `)
            .single();
        if (error) {
            res.status(error.code === '42501' ? 403 : 502).json({
                error: { code: 'CLIENT_CREATE_FAILED', message: error.message },
            });
            return;
        }
        res.status(201).json({ data });
    }
    catch {
        res.status(502).json({ error: { code: 'CLIENT_CREATE_FAILED' } });
    }
});
// PUT /api/internal/clients/:id
internalClientsRouter.put('/:id', async (req, res) => {
    const auth = res.locals.auth;
    const idParsed = z.string().uuid().safeParse(req.params.id);
    const parsed = updateClientSchema.safeParse(req.body);
    if (!idParsed.success || !parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
        return;
    }
    const db = createUserSupabaseClient(auth.accessToken);
    try {
        const { data, error } = await db
            .from('tungsten_clients')
            .update({
            ...parsed.data,
            updated_at: new Date().toISOString(),
        })
            .eq('id', idParsed.data)
            .select(`
        id,
        client_name,
        phone,
        email,
        company_name,
        service_requested,
        deal_value,
        status,
        notes,
        sales_id,
        created_by,
        updated_at,
        creator:profiles!tungsten_clients_created_by_fkey (id, full_name),
        sales_rep:profiles!tungsten_clients_sales_id_fkey (id, full_name)
      `)
            .single();
        if (error) {
            res.status(error.code === '42501' ? 403 : 502).json({
                error: { code: 'CLIENT_UPDATE_FAILED', message: error.message },
            });
            return;
        }
        res.json({ data });
    }
    catch {
        res.status(502).json({ error: { code: 'CLIENT_UPDATE_FAILED' } });
    }
});
//# sourceMappingURL=internal-clients.js.map