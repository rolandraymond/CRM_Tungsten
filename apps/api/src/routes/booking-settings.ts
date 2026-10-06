import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const bookingSettingsRouter = Router();

const clinicQuery = z.object({
  clinic_id: z.uuid(),
});

const timeSchema = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
);

const settingsSchema = z.object({
  clinic_id: z.uuid(),
  working_days: z.array(
    z.number().int().min(1).max(7),
  ).max(7),
  opens_at: timeSchema,
  closes_at: timeSchema,
  slot_minutes: z.union([
    z.literal(10),
    z.literal(20),
    z.literal(30),
    z.literal(60),
  ]),
  slot_capacity: z.number().int().min(1).max(100),
  enabled: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.opens_at === value.closes_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['closes_at'],
      message: 'Opening and closing times must differ',
    });
  }

  if (
    new Set(value.working_days).size !==
    value.working_days.length
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['working_days'],
      message: 'Working days must be unique',
    });
  }

  if (value.enabled && value.working_days.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['working_days'],
      message: 'Select at least one working day',
    });
  }

  const minutes = (time: string) => {
    const [hours, mins] = time.split(':').map(Number);
    return hours * 60 + mins;
  };

  const duration = (
    minutes(value.closes_at) -
    minutes(value.opens_at) +
    1440
  ) % 1440;

  if (duration < value.slot_minutes) {
    ctx.addIssue({
      code: 'custom',
      path: ['slot_minutes'],
      message: 'Working hours must fit at least one slot',
    });
  }
});

const settingsColumns = [
  'clinic_id',
  'timezone',
  'working_days',
  'opens_at',
  'closes_at',
  'slot_minutes',
  'slot_capacity',
  'enabled',
  'updated_at',
].join(',');

bookingSettingsRouter.get(
  '/',
  requireAuth,
  async (req, res) => {
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

      // Clinic visibility is checked using the user's RLS access.
      const clinic = await db
        .from('clinics')
        .select('id')
        .eq('id', parsed.data.clinic_id)
        .maybeSingle();

      if (clinic.error) throw clinic.error;

      if (!clinic.data) {
        res.status(403).json({
          error: { code: 'FORBIDDEN' },
        });
        return;
      }

      const { data, error } = await db
        .from('clinic_booking_settings')
        .select(settingsColumns)
        .eq('clinic_id', parsed.data.clinic_id)
        .maybeSingle();

      if (error) throw error;

      res.json({ data: data ?? null });
    } catch {
      res.status(502).json({
        error: { code: 'BOOKING_SETTINGS_FETCH_FAILED' },
      });
    }
  },
);

bookingSettingsRouter.put(
  '/',
  requireAuth,
  async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);

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

      // The database enforces clinic-manager/admin permissions.
      const { data, error } = await db
        .from('clinic_booking_settings')
        .upsert(
          {
            ...parsed.data,
            timezone: 'Africa/Cairo',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clinic_id' },
        )
        .select(settingsColumns)
        .single();

      if (error) {
        const status = error.code === '42501'
          ? 403
          : ['23503', '23514', '22023'].includes(error.code)
            ? 400
            : 502;

        res.status(status).json({
          error: {
            code: status === 403
              ? 'FORBIDDEN'
              : status === 400
                ? 'BOOKING_SETTINGS_REJECTED'
                : 'BOOKING_SETTINGS_SAVE_FAILED',
          },
        });
        return;
      }

      res.json({ data });
    } catch {
      res.status(502).json({
        error: { code: 'BOOKING_SETTINGS_SAVE_FAILED' },
      });
    }
  },
);