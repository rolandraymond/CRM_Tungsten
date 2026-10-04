import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createUserSupabaseClient } from '../lib/supabase.js';
// Mounted inside adminRouter, after its authentication/admin checks.
export const adminTeamRouter = Router();
adminTeamRouter.get('/', async (_req, res) => {
    try {
        const { data, error } = await createUserSupabaseClient(res.locals.auth.accessToken).rpc('crm_team_directory');
        if (error) {
            res.status(error.code === '42501' ? 403 : 502).json({
                error: { code: 'TEAM_LOAD_FAILED' },
            });
            return;
        }
        res.json({ data });
    }
    catch {
        res.status(502).json({
            error: { code: 'TEAM_LOAD_FAILED' },
        });
    }
});
const accountSchema = z.strictObject({
    full_name: z.string().trim().min(1).max(200),
    email: z.email().trim().toLowerCase(),
    password: z.string().min(12).max(128),
});
adminTeamRouter.post('/users', async (req, res) => {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR' },
        });
        return;
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        res.status(503).json({
            error: { code: 'ACCOUNT_CREATION_NOT_CONFIGURED' },
        });
        return;
    }
    try {
        const admin = createClient(url, key, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        });
        const { data, error } = await admin.auth.admin.createUser({
            email: parsed.data.email,
            password: parsed.data.password,
            email_confirm: true,
            user_metadata: {
                full_name: parsed.data.full_name,
            },
        });
        if (error || !data.user) {
            const duplicate = [
                'email_exists',
                'user_already_exists',
            ].includes(error?.code ?? '');
            res.status(duplicate ? 409 : 502).json({
                error: {
                    code: duplicate ? 'USER_EXISTS' : 'USER_CREATE_FAILED',
                },
            });
            return;
        }
        res.status(201).json({
            data: { id: data.user.id },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'USER_CREATE_FAILED' },
        });
    }
});
const membershipSchema = z.strictObject({
    clinic_id: z.uuid(),
    user_id: z.uuid(),
    role: z.enum([
        'moderator',
        'agency_follow_up',
        'clinic_customer_service',
        'doctor',
        'clinic_manager',
    ]),
    is_active: z.boolean(),
});
adminTeamRouter.put('/membership', async (req, res) => {
    const parsed = membershipSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR' },
        });
        return;
    }
    try {
        const { data: input } = parsed;
        const { error } = await createUserSupabaseClient(res.locals.auth.accessToken).rpc('crm_set_membership', {
            p_clinic_id: input.clinic_id,
            p_user_id: input.user_id,
            p_role: input.role,
            p_active: input.is_active,
        });
        if (error) {
            const status = error.code === '42501'
                ? 403
                : error.code === '22023'
                    ? 400
                    : 502;
            res.status(status).json({
                error: { code: 'MEMBERSHIP_SAVE_FAILED' },
            });
            return;
        }
        res.json({
            data: { saved: true },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'MEMBERSHIP_SAVE_FAILED' },
        });
    }
});
//# sourceMappingURL=admin-team.js.map