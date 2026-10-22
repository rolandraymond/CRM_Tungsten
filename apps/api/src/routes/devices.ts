import { Router, type Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const devicesRouter = Router();

devicesRouter.use(requireAuth);

const clinicQuery = z.object({
  clinic_id: z.uuid(),
});

const deviceParams = z.object({
  deviceId: z.uuid(),
});

const deviceTypeSchema = z.string()
  .trim()
  .min(1)
  .max(100)
  .transform(value => value.toLowerCase());

const createSchema = z.object({
  clinic_id: z.uuid(),
  device_name: z.string().trim().min(1).max(200),
  device_type: deviceTypeSchema,
  is_active: z.boolean().default(true),
}).strict();

const updateSchema = z.object({
  device_name: z.string().trim().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
}).strict().refine(
  value => Object.keys(value).length > 0,
  { message: 'Provide at least one field to update' },
);

const columns = 'id,clinic_id,device_name,device_type,is_active,created_at';

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
          ? 'DEVICE_DATA_REJECTED'
          : 'DEVICE_REQUEST_FAILED',
    },
  });
}

// GET /api/devices?clinic_id=...
devicesRouter.get('/', async (req, res) => {
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
      .from('clinic_devices')
      .select(columns)
      .eq('clinic_id', query.data.clinic_id)
      .order('device_name')
      .order('id');

    if (error) {
      databaseError(res, error);
      return;
    }

    res.json({ data: data ?? [] });
  } catch {
    res.status(502).json({
      error: { code: 'DEVICE_REQUEST_FAILED' },
    });
  }
});

// POST /api/devices
devicesRouter.post('/', async (req, res) => {
  const body = createSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        fields: body.error.issues.map(issue => ({
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

    // RLS permits writes only for clinic managers/admins.
    const { data, error } = await db
      .from('clinic_devices')
      .insert(body.data)
      .select(columns)
      .single();

    if (error) {
      databaseError(res, error);
      return;
    }

    res.status(201).json({ data });
  } catch {
    res.status(502).json({
      error: { code: 'DEVICE_REQUEST_FAILED' },
    });
  }
});

// PATCH /api/devices/:deviceId?clinic_id=...
devicesRouter.patch('/:deviceId', async (req, res) => {
  const query = clinicQuery.safeParse(req.query);
  const params = deviceParams.safeParse(req.params);
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

    const { data, error } = await db
      .from('clinic_devices')
      .update(body.data)
      .eq('clinic_id', query.data.clinic_id)
      .eq('id', params.data.deviceId)
      .select(columns)
      .maybeSingle();

    if (error) {
      databaseError(res, error);
      return;
    }

    if (!data) {
      res.status(404).json({
        error: { code: 'DEVICE_NOT_FOUND_OR_NOT_EDITABLE' },
      });
      return;
    }

    res.json({ data });
  } catch {
    res.status(502).json({
      error: { code: 'DEVICE_REQUEST_FAILED' },
    });
  }
});