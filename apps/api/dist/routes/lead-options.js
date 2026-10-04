import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';
export const leadOptionsRouter = Router();
leadOptionsRouter.get('/', requireAuth, async (req, res) => {
    const auth = res.locals.auth;
    if (!auth) {
        res.status(401).json({
            error: { code: 'UNAUTHENTICATED' },
        });
        return;
    }
    const parsed = z.uuid().safeParse(req.query.clinic_id);
    if (!parsed.success) {
        res.status(400).json({
            error: { code: 'VALIDATION_ERROR' },
        });
        return;
    }
    const db = createUserSupabaseClient(auth.accessToken);
    try {
        const clinic = await db
            .from('clinics')
            .select('id')
            .eq('id', parsed.data)
            .is('archived_at', null)
            .maybeSingle();
        if (clinic.error) {
            throw new Error('Clinic lookup failed');
        }
        if (!clinic.data) {
            res.status(403).json({
                error: { code: 'FORBIDDEN' },
            });
            return;
        }
        const [services, ads] = await Promise.all([
            db
                .from('clinic_services')
                .select('service_id, service:services!inner(service_name)')
                .eq('clinic_id', parsed.data)
                .eq('is_active', true)
                .eq('service.is_active', true)
                .order('service_id')
                .limit(201),
            db
                .from('clinic_ads')
                .select('id, ad_name, caption, thumbnail_url, creative_variants')
                .eq('clinic_id', parsed.data)
                .eq('is_selectable', true)
                .eq('meta_effective_status', 'ACTIVE')
                .is('archived_at', null)
                .order('ad_name')
                .order('id')
                .limit(201),
        ]);
        if (services.error || ads.error) {
            throw new Error('Catalog lookup failed');
        }
        res.json({
            data: {
                services: (services.data ?? [])
                    .slice(0, 200)
                    .flatMap(row => {
                    const service = Array.isArray(row.service)
                        ? row.service[0]
                        : row.service;
                    return service
                        ? [{
                                id: row.service_id,
                                name: service.service_name,
                            }]
                        : [];
                }),
                ads: (ads.data ?? []).slice(0, 200),
                limited: (services.data?.length ?? 0) > 200 ||
                    (ads.data?.length ?? 0) > 200,
            },
        });
    }
    catch {
        res.status(502).json({
            error: { code: 'OPTIONS_UNAVAILABLE' },
        });
    }
});
//# sourceMappingURL=lead-options.js.map