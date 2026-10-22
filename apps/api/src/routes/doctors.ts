import { Router, type Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const doctorsRouter = Router();

doctorsRouter.use(requireAuth);

const clinicQuery = z.object({
  clinic_id: z.uuid(),
});

const doctorParams = z.object({
  doctorId: z.uuid(),
});

const createSchema = z.object({
  clinic_id: z.uuid(),
  full_name: z.string().trim().min(1).max(200),
  is_active: z.boolean().default(true),
}).strict();

const updateSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
}).strict().refine(
  value => Object.keys(value).length > 0,
  { message: 'Provide at least one field to update' },
);

const columns = 'id,clinic_id,full_name,is_active,created_at';

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
          ? 'DOCTOR_DATA_REJECTED'
          : 'DOCTOR_REQUEST_FAILED',
    },
  });
}

// GET /api/doctors?clinic_id=...
doctorsRouter.get('/', async (req, res) => {
  const parsed = clinicQuery.safeParse(req.query);

  if (!parsed.success) {
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
      .eq('id', parsed.data.clinic_id)
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
      .from('clinic_doctors')
      .select(columns)
      .eq('clinic_id', parsed.data.clinic_id)
      .order('full_name')
      .order('id');

    if (error) {
      databaseError(res, error);
      return;
    }

    res.json({ data: data ?? [] });
  } catch {
    res.status(502).json({
      error: { code: 'DOCTOR_REQUEST_FAILED' },
    });
  }
});

// POST /api/doctors
doctorsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        fields: parsed.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const db = createUserSupabaseClient(
      res.locals.auth!.accessToken,
    );

    // RLS permits creation only for clinic managers/admins.
    const { data, error } = await db
      .from('clinic_doctors')
      .insert(parsed.data)
      .select(columns)
      .single();

    if (error) {
      databaseError(res, error);
      return;
    }

    res.status(201).json({ data });
  } catch {
    res.status(502).json({
      error: { code: 'DOCTOR_REQUEST_FAILED' },
    });
  }
});

// PATCH /api/doctors/:doctorId?clinic_id=...
doctorsRouter.patch('/:doctorId', async (req, res) => {
  const query = clinicQuery.safeParse(req.query);
  const params = doctorParams.safeParse(req.params);
  const body = updateSchema.safeParse(req.body);

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

    // clinic_id cannot be changed through this endpoint.
    const { data, error } = await db
      .from('clinic_doctors')
      .update(body.data)
      .eq('clinic_id', query.data.clinic_id)
      .eq('id', params.data.doctorId)
      .select(columns)
      .maybeSingle();

    if (error) {
      databaseError(res, error);
      return;
    }

    // RLS can hide rows that the user cannot update.
    if (!data) {
      res.status(404).json({
        error: { code: 'DOCTOR_NOT_FOUND_OR_NOT_EDITABLE' },
      });
      return;
    }

    res.json({ data });
  } catch {
    res.status(502).json({
      error: { code: 'DOCTOR_REQUEST_FAILED' },
    });
  }
});


const doctorServiceSchema = z.object({
  service_id: z.uuid(),
  duration_minutes: z.number().int().min(1).max(1440),
  is_active: z.boolean(),
}).strict();

const doctorServiceColumns = [
  'clinic_id',
  'doctor_id',
  'service_id',
  'duration_minutes',
  'is_active',
].join(',');

// GET /api/doctors/:doctorId/services?clinic_id=...
doctorsRouter.get('/:doctorId/services', async (req, res) => {
  const query = clinicQuery.safeParse(req.query);
  const params = doctorParams.safeParse(req.params);

  if (!query.success || !params.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR' },
    });
    return;
  }

  try {
    const db = createUserSupabaseClient(
      res.locals.auth!.accessToken,
    );

    const doctor = await db
      .from('clinic_doctors')
      .select('id')
      .eq('clinic_id', query.data.clinic_id)
      .eq('id', params.data.doctorId)
      .maybeSingle();

    if (doctor.error) {
      databaseError(res, doctor.error);
      return;
    }

    if (!doctor.data) {
      res.status(404).json({
        error: { code: 'DOCTOR_NOT_FOUND' },
      });
      return;
    }

    const { data, error } = await db
      .from('clinic_doctor_services')
      .select(doctorServiceColumns)
      .eq('clinic_id', query.data.clinic_id)
      .eq('doctor_id', params.data.doctorId)
      .order('service_id');

    if (error) {
      databaseError(res, error);
      return;
    }

    res.json({ data: data ?? [] });
  } catch {
    res.status(502).json({
      error: { code: 'DOCTOR_SERVICES_FETCH_FAILED' },
    });
  }
});

// PUT /api/doctors/:doctorId/services?clinic_id=...
// Adds one service or updates its existing configuration.
doctorsRouter.put('/:doctorId/services', async (req, res) => {
  const query = clinicQuery.safeParse(req.query);
  const params = doctorParams.safeParse(req.params);
  const body = doctorServiceSchema.safeParse(req.body);

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

    const doctor = await db
      .from('clinic_doctors')
      .select('id')
      .eq('clinic_id', query.data.clinic_id)
      .eq('id', params.data.doctorId)
      .maybeSingle();

    if (doctor.error) {
      databaseError(res, doctor.error);
      return;
    }

    if (!doctor.data) {
      res.status(404).json({
        error: { code: 'DOCTOR_NOT_FOUND' },
      });
      return;
    }

    // Enabling an offering requires an active clinic service
    // and an active service in the global catalog.
    if (body.data.is_active) {
      const clinicService = await db
        .from('clinic_services')
        .select('service_id')
        .eq('clinic_id', query.data.clinic_id)
        .eq('service_id', body.data.service_id)
        .eq('is_active', true)
        .maybeSingle();

      if (clinicService.error) {
        databaseError(res, clinicService.error);
        return;
      }

      const service = await db
        .from('services')
        .select('id')
        .eq('id', body.data.service_id)
        .eq('is_active', true)
        .maybeSingle();

      if (service.error) {
        databaseError(res, service.error);
        return;
      }

      if (!clinicService.data || !service.data) {
        res.status(400).json({
          error: { code: 'SERVICE_UNAVAILABLE' },
        });
        return;
      }
    }

    // RLS enforces clinic-manager/admin write access.
    const { data, error } = await db
      .from('clinic_doctor_services')
      .upsert(
        {
          clinic_id: query.data.clinic_id,
          doctor_id: params.data.doctorId,
          ...body.data,
        },
        {
          onConflict: 'clinic_id,doctor_id,service_id',
        },
      )
      .select(doctorServiceColumns)
      .single();

    if (error) {
      databaseError(res, error);
      return;
    }

    res.json({ data });
  } catch {
    res.status(502).json({
      error: { code: 'DOCTOR_SERVICE_SAVE_FAILED' },
    });
  }
});