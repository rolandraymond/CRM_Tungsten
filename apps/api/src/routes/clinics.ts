import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const clinicsRouter = Router();

clinicsRouter.get('/', requireAuth, async (_req, res) => {
  const auth = res.locals.auth;

  if (!auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
    return;
  }

  const supabase = createUserSupabaseClient(auth.accessToken);

  const { data, error } = await supabase
    .from('clinics')
    .select('id, name')
    .is('archived_at', null)
    .order('name');

  if (error) {
    console.error('Failed to list clinics:', error.code);

    res.status(502).json({
      error: {
        code: 'CLINICS_FETCH_FAILED',
        message: 'Unable to load clinics',
      },
    });
    return;
  }

  const memberships = await supabase
    .from('clinic_memberships')
    .select('clinic_id, role')
    .eq('user_id', auth.userId)
    .eq('is_active', true);

  if (memberships.error) {
    res.status(502).json({ error: { code: 'CLINICS_FETCH_FAILED' } });
    return;
  }

  const roles = new Map(
    (memberships.data ?? []).map(item => [item.clinic_id, item.role]),
  );

  res.status(200).json({
    data: (data ?? []).map(clinic => ({
      ...clinic,
      role: roles.get(clinic.id) ?? 'platform_admin',
    })),
  });
});
