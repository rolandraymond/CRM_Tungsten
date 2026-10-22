import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const bookingFollowUpRouter = Router();

bookingFollowUpRouter.use(requireAuth);

const commonFields = {
  clinic_id: z.uuid(),
  expected_version: z.number().int().min(0).max(2147483647),
  reason: z.string().trim().min(1).max(2000),
};

const appointmentActionSchema = z
  .strictObject({
    ...commonFields,
    action: z.enum([
      'confirm',
      'no_answer',
      'reschedule',
      'cancel',
    ]),
    new_starts_at: z.iso
      .datetime({ offset: true })
      .refine(value => DateTime.fromISO(value, { setZone: true }).isValid)
      .nullable()
      .optional(),
  })
  .superRefine((input, context) => {
    if (input.action === 'reschedule' && !input.new_starts_at) {
      context.addIssue({
        code: 'custom',
        path: ['new_starts_at'],
        message: 'A new appointment time is required.',
      });
    }

    if (input.action !== 'reschedule' && input.new_starts_at != null) {
      context.addIssue({
        code: 'custom',
        path: ['new_starts_at'],
        message: 'A new time is only allowed when rescheduling.',
      });
    }
  });

const inquiryActionSchema = z
  .strictObject({
    ...commonFields,
    action: z.enum([
      'schedule',
      'no_answer',
      'not_interested',
    ]),
    next_follow_up_at: z.iso
      .datetime({ offset: true })
      .refine(value => DateTime.fromISO(value, { setZone: true }).isValid)
      .nullable()
      .optional(),
  })
  .superRefine((input, context) => {
    if (input.action === 'schedule' && !input.next_follow_up_at) {
      context.addIssue({
        code: 'custom',
        path: ['next_follow_up_at'],
        message: 'The next follow-up time is required.',
      });
    }

    if (
      input.action !== 'schedule' &&
      input.next_follow_up_at != null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['next_follow_up_at'],
        message: 'A follow-up time is only allowed when scheduling.',
      });
    }
  });

type DatabaseError = {
  code: string;
  message: string;
};

const validationErrors = new Set([
  'BOOKING_SETTINGS_REQUIRED',
  'BOOKING_DISABLED',
  'INVALID_BOOKING_SETTINGS',
  'INVALID_BOOKING_SLOT',
  'CLINIC_CLOSED',
  'APPOINTMENT_NOT_ACTIONABLE',
  'CONFIRM_VISIT_DAY_ONLY',
  'PENDING_APPOINTMENT_REQUIRED',
  'FOLLOW_UP_NOT_DUE',
  'MANUAL_REVIEW_REQUIRED',
  'INQUIRY_NOT_ACTIONABLE',
  'INVALID_BOOKING_INPUT',
  'SERVICE_DEVICE_REQUIREMENT_NOT_CONFIGURED',
  'INVALID_OR_AMBIGUOUS_SCHEDULE_TIME',
]);

function mapError(error: DatabaseError): {
  status: number;
  code: string;
} {
  if (error.code === '42501') {
    return { status: 403, code: 'FORBIDDEN' };
  }

  if (error.code === '23P01') {
    return {
      status: 409,
      code: error.message === 'LEGACY_BOOKING_REQUIRES_RESOURCE_ASSIGNMENT'
        ? 'LEGACY_BOOKING_REQUIRES_RESOURCE_ASSIGNMENT'
        : 'BOOKING_RESOURCE_UNAVAILABLE',
    };
  }

  if (error.code === '23503') {
    return { status: 409, code: 'BOOKING_CONFIGURATION_CHANGED' };
  }

  if (error.code === 'P0002') {
    return { status: 404, code: 'RECORD_NOT_FOUND' };
  }

  if (error.code === '40001') {
    if (
      [
        'BOOKING_SLOT_FULL',
        'STALE_APPOINTMENT',
        'STALE_LEAD',
      ].includes(error.message)
    ) {
      return { status: 409, code: error.message };
    }

    return { status: 503, code: 'RETRY_REQUIRED' };
  }

  if (error.code === '40P01') {
    return { status: 503, code: 'RETRY_REQUIRED' };
  }

  if (error.code === '22023') {
    return {
      status: 400,
      code: validationErrors.has(error.message)
        ? error.message
        : 'INVALID_FOLLOW_UP_ACTION',
    };
  }

  console.error('[Follow-up database error]', {
    code: error.code,
  });

  return { status: 502, code: 'FOLLOW_UP_FAILED' };
}

bookingFollowUpRouter.post(
  '/appointments/:appointmentId/actions',
  async (req, res) => {
    const auth = res.locals.auth;

    if (!auth) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED' },
      });
      return;
    }

    const appointmentId = z.uuid().safeParse(req.params.appointmentId);
    const input = appointmentActionSchema.safeParse(req.body);

    if (!appointmentId.success || !input.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR' },
      });
      return;
    }

    try {
      const db = createUserSupabaseClient(auth.accessToken);

      const { data, error } = await db.rpc(
        'crm_follow_up_appointment',
        {
          p_clinic_id: input.data.clinic_id,
          p_appointment_id: appointmentId.data,
          p_expected_version: input.data.expected_version,
          p_action: input.data.action,
          p_reason: input.data.reason,
          p_new_starts_at: input.data.new_starts_at ?? null,
        },
      );

      if (error) {
        const failure = mapError(error);

        res.status(failure.status).json({
          error: { code: failure.code },
        });
        return;
      }

      if (!data || typeof data.appointment_id !== 'string') {
        res.status(502).json({
          error: { code: 'INVALID_DATABASE_RESPONSE' },
        });
        return;
      }

      res.status(200).json({ data });
    } catch {
      res.status(502).json({
        error: { code: 'FOLLOW_UP_UNAVAILABLE' },
      });
    }
  },
);

bookingFollowUpRouter.post(
  '/inquiries/:leadId/actions',
  async (req, res) => {
    const auth = res.locals.auth;

    if (!auth) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED' },
      });
      return;
    }

    const leadId = z.uuid().safeParse(req.params.leadId);
    const input = inquiryActionSchema.safeParse(req.body);

    if (!leadId.success || !input.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR' },
      });
      return;
    }

    try {
      const db = createUserSupabaseClient(auth.accessToken);

      const { data, error } = await db.rpc(
        'crm_follow_up_inquiry',
        {
          p_clinic_id: input.data.clinic_id,
          p_lead_id: leadId.data,
          p_expected_version: input.data.expected_version,
          p_action: input.data.action,
          p_reason: input.data.reason,
          p_next_follow_up_at: input.data.next_follow_up_at ?? null,
        },
      );

      if (error) {
        const failure = mapError(error);

        res.status(failure.status).json({
          error: { code: failure.code },
        });
        return;
      }

      if (!data || typeof data.lead_id !== 'string') {
        res.status(502).json({
          error: { code: 'INVALID_DATABASE_RESPONSE' },
        });
        return;
      }

      res.status(200).json({ data });
    } catch {
      res.status(502).json({
        error: { code: 'FOLLOW_UP_UNAVAILABLE' },
      });
    }
  },
);