import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';
export const dashboardRouter = Router();
dashboardRouter.get('/', requireAuth, async (req, res) => {
    const auth = res.locals.auth;
    const clinicId = z.uuid().safeParse(req.query.clinic_id);
    if (!auth) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
        return;
    }
    if (!clinicId.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
        return;
    }
    const db = createUserSupabaseClient(auth.accessToken);
    try {
        // A user-scoped client keeps the existing clinic RLS rules in force.
        const clinic = await db
            .from('clinics')
            .select('id')
            .eq('id', clinicId.data)
            .is('archived_at', null)
            .maybeSingle();
        if (clinic.error)
            throw clinic.error;
        if (!clinic.data) {
            res.status(403).json({ error: { code: 'FORBIDDEN' } });
            return;
        }
        const leads = () => db
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('clinic_id', clinicId.data)
            .is('archived_at', null);
        const [total, fresh, follow, converted, uninterested, recent, bookings, ads] = await Promise.all([
            leads(),
            leads().eq('status', 'new'),
            leads().in('status', ['in_progress', 'follow_up', 'no_answer']),
            leads().eq('status', 'converted'),
            leads().eq('status', 'not_interested'),
            db.from('leads')
                .select(`
            id, status, source, created_at,
            requested_service_name_snapshot, contact_type_at_creation,
            contact:contacts (full_name, phone)
          `)
                .eq('clinic_id', clinicId.data)
                .is('archived_at', null)
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .limit(4),
            db.from('appointments')
                .select('id, lead_id, starts_at, status')
                .eq('clinic_id', clinicId.data)
                .is('archived_at', null)
                .in('status', ['pending', 'confirmed'])
                .gte('starts_at', new Date().toISOString())
                .order('starts_at', { ascending: true })
                .limit(5),
            db.from('clinic_ads')
                .select('id', { count: 'exact', head: true })
                .eq('clinic_id', clinicId.data)
                .eq('is_selectable', true)
                .eq('meta_effective_status', 'ACTIVE')
                .is('archived_at', null),
        ]);
        if ([total, fresh, follow, converted, uninterested, recent, bookings, ads]
            .some(result => result.error)) {
            throw new Error('Dashboard query failed');
        }
        res.status(200).json({
            data: {
                counts: {
                    total: total.count ?? 0,
                    new: fresh.count ?? 0,
                    follow: follow.count ?? 0,
                    converted: converted.count ?? 0,
                    uninterested: uninterested.count ?? 0,
                    active_ads: ads.count ?? 0,
                },
                recent_leads: recent.data ?? [],
                upcoming_bookings: bookings.data ?? [],
            },
        });
    }
    catch {
        res.status(502).json({ error: { code: 'DASHBOARD_UNAVAILABLE' } });
    }
});
//# sourceMappingURL=dashboard.js.map