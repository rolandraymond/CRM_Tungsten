import { Router, type Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const clinicServiceRequirementsRouter = Router();

clinicServiceRequirementsRouter.use(requireAuth);

const clinicQuery = z.object({
  clinic_id: z.uuid(),
});

const serviceParams = z.object({
  serviceId: z.uuid(),
});

const requirementsSchema = z.discriminatedUnion(
  'requires_device',
  [
    z.object({
      requires_device: z.literal(false),
      required_device_type: z.null(),
    }).strict(),

    z.object({
      requires_device: z.literal(true),
      required_device_type: z.string()
        .trim()
        .min(1)
        .max(100)
        .transform(value => value.toLowerCase()),
    }).strict(),
  ],
);

function databaseError(
  res: Response,
  error: { code?: string },
) {
  const status = error.code === '42501'
    ? 403
    : ['23503', '23514', '22023'].includes(error.code ?? '')
      ? 400
      : 502;

  res.status(status).json({
    error: {
      code: status === 403
        ? 'FORBIDDEN'
        : status === 400
          ? 'SERVICE_REQUIREMENTS_REJECTED'
          : 'SERVICE_REQUIREMENTS_REQUEST_FAILED',
    },
  });
}

// GET /api/clinic-service-requirements?clinic_id=...
clinicServiceRequirementsRouter.get('/', async (req, res) => {
  const query = clinicQuery.safeParse(req.query);

  if (!query.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR' },
    });
    return;
  }

  try {
    const db = createUserSupabaseClient(
      res.locals.auth!.accessToken,
    );

    const clinic = await db
      .from('clinics')
      .select('id')
      .eq('id', query.data.clinic_id)
      .is('archived_at', null)
      .maybeSingle();

    if (clinic.error) {
      databaseError(res, clinic.error);
      return;
    }

    if (!clinic.data) {
      res.status(403).json({
        error: { code: 'FORBIDDEN' },
      });
      return;
    }

    const { data, error } = await db
      .from('clinic_services')
      .select(`
        service_id,
        is_active,
        requires_device,
        required_device_type,
        service:services!inner(service_name, is_active)
      `)
      .eq('clinic_id', query.data.clinic_id)
      .order('service_id');

    if (error) {
      databaseError(res, error);
      return;
    }

    res.json({
      data: (data ?? []).flatMap(row => {
        const service = Array.isArray(row.service)
          ? row.service[0]
          : row.service;

        return service ? [{
          service_id: row.service_id,
          service_name: service.service_name,
          is_active: row.is_active && service.is_active,
          requires_device: row.requires_device,
          required_device_type: row.required_device_type,
        }] : [];
      }),
    });
  } catch {
    res.status(502).json({
      error: { code: 'SERVICE_REQUIREMENTS_REQUEST_FAILED' },
    });
  }
});

// PATCH /api/clinic-service-requirements/:serviceId?clinic_id=...
clinicServiceRequirementsRouter.patch(
  '/:serviceId',
  async (req, res) => {
    const query = clinicQuery.safeParse(req.query);
    const params = serviceParams.safeParse(req.params);
    const body = requirementsSchema.safeParse(req.body);

    if (!query.success || !params.success || !body.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR' },
      });
      return;
    }

    try {
      const db = createUserSupabaseClient(
        res.locals.auth!.accessToken,
      );

      // RLS restricts writes to clinic managers/admins.
      // Only these two fields may be updated.
      const { data, error } = await db
        .from('clinic_services')
        .update(body.data)
        .eq('clinic_id', query.data.clinic_id)
        .eq('service_id', params.data.serviceId)
        .select('service_id,requires_device,required_device_type')
        .maybeSingle();

      if (error) {
        databaseError(res, error);
        return;
      }

      if (!data) {
        res.status(404).json({
          error: {
            code: 'SERVICE_NOT_FOUND_OR_NOT_EDITABLE',
          },
        });
        return;
      }

      res.json({ data });
    } catch {
      res.status(502).json({
        error: { code: 'SERVICE_REQUIREMENTS_REQUEST_FAILED' },
      });
    }
  },
);