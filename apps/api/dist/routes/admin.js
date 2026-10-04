import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';
import { adminTeamRouter } from './admin-team.js';
import { adminAdsRouter } from './admin-ads.js';
import { randomUUID } from 'node:crypto';
export const adminRouter = Router();
const financeId = z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER);
const financeSchema = z.object({
    clients: z.array(z.object({
        id: financeId,
        name: z.string().trim().min(1),
        client_code: z.string().nullable(),
    })),
    services: z.array(z.object({
        id: financeId,
        service_code: z.string().trim().min(1),
        service_name: z.string().trim().min(1),
    })),
});
async function readFinance() {
    const url = process.env.FINANCE_CRM_URL;
    const key = process.env.FINANCE_CRM_TOKEN;
    if (!url || !key) {
        throw new Error('Finance is not configured');
    }
    const response = await fetch(`${url.replace(/\/$/, '')}/crm/catalog`, {
        headers: {
            Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
    });
    if (!response.ok) {
        throw new Error('Finance unavailable');
    }
    return financeSchema.parse(await response.json());
}
adminRouter.use(requireAuth);
adminRouter.get('/status', async (_req, res) => {
    try {
        const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken).rpc('crm_admin_status');
        if (error) {
            res.status(503).json({ error: { code: 'ADMIN_CHECK_FAILED' } });
            return;
        }
        res.json({ is_admin: data === true });
    }
    catch {
        res.status(503).json({ error: { code: 'ADMIN_CHECK_FAILED' } });
    }
});
adminRouter.use(async (_req, res, next) => {
    try {
        const auth = res.locals.auth;
        if (!auth) {
            res.status(401).json({
                error: { code: 'UNAUTHENTICATED' },
            });
            return;
        }
        const { data, error } = await createUserSupabaseClient(auth.accessToken).rpc('crm_admin_status');
        if (error) {
            console.error('[ADMIN CHECK FAILED]', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
            });
            res.status(503).json({
                error: { code: 'ADMIN_CHECK_FAILED' },
            });
            return;
        }
        if (data !== true) {
            res.status(403).json({
                error: { code: 'FORBIDDEN' },
            });
            return;
        }
        next();
    }
    catch {
        res.status(503).json({
            error: { code: 'ADMIN_CHECK_FAILED' },
        });
    }
});
adminRouter.get('/setup', async (_req, res) => {
    const db = createUserSupabaseClient(res.locals.auth.accessToken);
    try {
        const [clinics, services, links, assignments, finance] = await Promise.all([
            db
                .from('clinics')
                .select('id,name')
                .is('archived_at', null)
                .order('name'),
            db
                .from('services')
                .select('id,service_name,service_code,finance_service_id')
                .eq('is_active', true)
                .order('service_name'),
            db
                .from('clinic_finance_links')
                .select('clinic_id,finance_client_id'),
            db
                .from('clinic_services')
                .select('clinic_id,service_id,is_active'),
            readFinance().catch(() => null),
        ]);
        if ([clinics, services, links, assignments]
            .some(result => result.error)) {
            throw new Error('Setup lookup failed');
        }
        res.json({
            data: {
                clinics: clinics.data,
                services: services.data,
                links: links.data,
                assignments: assignments.data,
                finance,
            },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'SETUP_UNAVAILABLE' },
        });
    }
});
const activateSchema = z.strictObject({
    finance_client_id: financeId,
    clinic_id: z.uuid().nullable(),
    service_ids: z.array(financeId).max(200),
});
adminRouter.post('/finance/activate', async (req, res) => {
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR' },
        });
        return;
    }
    try {
        const catalog = await readFinance();
        const client = catalog.clients.find(item => item.id === parsed.data.finance_client_id);
        const ids = [...new Set(parsed.data.service_ids)];
        const services = catalog.services.filter(item => ids.includes(item.id));
        if (!client || services.length !== ids.length) {
            res.status(400).json({
                error: { code: 'FINANCE_RECORD_UNAVAILABLE' },
            });
            return;
        }
        const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken).rpc('crm_activate_finance_client', {
            p_finance_id: client.id,
            p_name: client.name,
            p_clinic_id: parsed.data.clinic_id,
            p_services: services,
        });
        if (error) {
            const status = error.code === '42501'
                ? 403
                : ['22023', '23505'].includes(error.code)
                    ? 409
                    : 502;
            res.status(status).json({
                error: { code: 'ACTIVATION_FAILED' },
            });
            return;
        }
        res.json({
            data: { clinic_id: data },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'FINANCE_UNAVAILABLE' },
        });
    }
});
const serviceSchema = z.strictObject({
    clinic_id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    // Temporary compatibility with the existing form.
    code: z.string().optional(),
});
adminRouter.post('/services', async (req, res) => {
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR' },
        });
        return;
    }
    try {
        const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken).rpc('crm_add_local_service', {
            p_clinic_id: parsed.data.clinic_id,
            p_code: `local_${randomUUID().replace(/-/g, '')}`,
            p_name: parsed.data.name,
        });
        if (error) {
            const status = error.code === '23505'
                ? 409
                : error.code === '42501'
                    ? 403
                    : error.code === '22023'
                        ? 400
                        : 502;
            res.status(status).json({
                error: { code: 'SERVICE_SAVE_FAILED' },
            });
            return;
        }
        res.status(201).json({
            data: { service_id: data },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'SERVICE_SAVE_FAILED' },
        });
    }
});
const assignmentSchema = z.strictObject({
    clinic_id: z.uuid(),
    service_id: z.uuid(),
    enabled: z.boolean(),
});
adminRouter.post('/services/assign', async (req, res) => {
    const parsed = assignmentSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR' },
        });
        return;
    }
    try {
        const { error } = await createUserSupabaseClient(res.locals.auth.accessToken).rpc('crm_set_clinic_service', {
            p_clinic_id: parsed.data.clinic_id,
            p_service_id: parsed.data.service_id,
            p_enabled: parsed.data.enabled,
        });
        if (error) {
            const status = error.code === '42501'
                ? 403
                : error.code === '22023'
                    ? 400
                    : 502;
            res.status(status).json({
                error: { code: 'SERVICE_SAVE_FAILED' },
            });
            return;
        }
        res.json({
            data: { saved: true },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'SERVICE_SAVE_FAILED' },
        });
    }
});
adminRouter.use('/team', adminTeamRouter);
adminRouter.use('/ads', adminAdsRouter);
//# sourceMappingURL=admin.js.map