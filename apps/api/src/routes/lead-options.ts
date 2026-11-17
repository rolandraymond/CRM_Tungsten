import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient, getSupabaseAdmin } from '../lib/supabase.js';


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

    let serviceList = (services.data ?? [])
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
      });

    // If the clinic has no active service, auto-ensure a default service so clinic staff can add leads
    if (serviceList.length === 0) {
      try {
        const adminClient = getSupabaseAdmin();

        // 1. Check if any service exists in services table
        let { data: defaultService } = await adminClient
          .from('services')
          .select('id, service_name')
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!defaultService) {
          const { data: createdService } = await adminClient
            .from('services')
            .insert({
              service_name: 'كشف عام / استشارة',
              service_code: 'GENERAL',
              is_active: true,
            })
            .select('id, service_name')
            .maybeSingle();
          defaultService = createdService;
        }

        if (defaultService) {
          // 2. Link this service to clinic_services with is_active = true
          await adminClient
            .from('clinic_services')
            .upsert({
              clinic_id: parsed.data,
              service_id: defaultService.id,
              is_active: true,
            }, { onConflict: 'clinic_id,service_id' });

          serviceList = [{
            id: defaultService.id,
            name: defaultService.service_name,
          }];
        }
      } catch (autoErr) {
        console.error('[LeadOptions] Auto-provision service error:', autoErr);
      }
    }

    res.json({
      data: {
        services: serviceList,

        ads: (ads.data ?? []).slice(0, 200),

        limited:
          (services.data?.length ?? 0) > 200 ||
          (ads.data?.length ?? 0) > 200,
      },
    });
  } catch {
    res.status(502).json({
      error: { code: 'OPTIONS_UNAVAILABLE' },
    });
  }
});