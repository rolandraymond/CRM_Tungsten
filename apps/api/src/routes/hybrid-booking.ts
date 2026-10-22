import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const hybridBookingRouter = Router();
hybridBookingRouter.use(requireAuth);

export const hybridBookingInputSchema = z
  .strictObject({
    clinic_id: z.uuid(),
    expected_status: z.enum([
      'new',
      'in_progress',
      'no_answer',
      'follow_up',
      'not_interested',
    ]),
    starts_at: z.iso
      .datetime({ offset: true })
      .refine((value) => DateTime.fromISO(value, { setZone: true }).isValid),
    assignment_mode: z.enum(['specific', 'auto']),
    doctor_id: z.uuid().nullable(),
    device_id: z.uuid().nullable().optional(),
    reason: z.string().trim().min(1).max(2000),
  })
  .refine((input) =>
    input.assignment_mode === 'specific'
      ? input.doctor_id !== null
      : input.doctor_id === null,
  );

const bookingResultSchema = z.object({
  appointment_id: z.uuid(),
  doctor_id: z.uuid(),
  device_id: z.uuid().nullable(),
  duration_minutes: z.number().int().min(1).max(1440),
  assignment_mode: z.enum(['specific', 'auto']),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
});

interface DatabaseError {
  code: string;
  message: string;
}

interface BookingFailure {
  status: number;
  code: string;
}

export function hybridBookingFailure(error: DatabaseError): BookingFailure {
  if (error.code === '42501') {
    return { status: 403, code: 'FORBIDDEN' };
  }

  if (error.code === '40001') {
    return {
      status: 409,
      code: error.message === 'LEAD_CHANGED' ? 'STALE_LEAD' : 'BOOKING_RETRY_REQUIRED',
    };
  }

  if (error.code === '40P01') {
    return { status: 409, code: 'BOOKING_RETRY_REQUIRED' };
  }

  if (error.code === '23P01') {
    return {
      status: 409,
      code:
        error.message === 'LEGACY_BOOKING_REQUIRES_RESOURCE_ASSIGNMENT'
          ? 'LEGACY_BOOKING_REQUIRES_RESOURCE_ASSIGNMENT'
          : 'BOOKING_RESOURCE_UNAVAILABLE',
    };
  }

  if (error.code === '23503') {
    return { status: 409, code: 'BOOKING_CONFIGURATION_CHANGED' };
  }

  if (error.code === '23514') {
    return { status: 400, code: 'BOOKING_DATA_REJECTED' };
  }

  if (error.code === '22023') {
    switch (error.message) {
      case 'LEAD_UNAVAILABLE':
      case 'SERVICE_UNAVAILABLE':
        return { status: 404, code: error.message };
      case 'LEAD_ALREADY_BOOKED':
      case 'SERVICE_DEVICE_REQUIREMENT_NOT_CONFIGURED':
      case 'INVALID_OR_AMBIGUOUS_SCHEDULE_TIME':
        return { status: 409, code: error.message };
      case 'SERVICE_DOES_NOT_USE_DEVICE':
      case 'INVALID_BOOKING_INPUT':
        return { status: 400, code: error.message };
      default:
        return { status: 400, code: 'BOOKING_REJECTED' };
    }
  }

  // A network failure may happen after the database commits.
  // The caller must refresh the lead before retrying an uncertain result.
  return { status: 502, code: 'BOOKING_RESULT_UNCONFIRMED' };
}

hybridBookingRouter.post('/:leadId', async (req, res) => {
  const auth = res.locals.auth;

  if (!auth) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
    return;
  }

  const leadId = z.uuid().safeParse(req.params.leadId);
  const parsed = hybridBookingInputSchema.safeParse(req.body);

  if (!leadId.success || !parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
    return;
  }

  const input = parsed.data;
  const startsAt = DateTime.fromISO(input.starts_at, { setZone: true }).toUTC().toISO()!;

  try {
    // Use the user's token so Supabase auth.uid() identifies the staff member.
    // The RPC checks permissions and derives service/duration from stored data.
    const db = createUserSupabaseClient(auth.accessToken);
    const { data, error } = await db.rpc('crm_create_hybrid_booking', {
      p_clinic_id: input.clinic_id,
      p_lead_id: leadId.data,
      p_expected_status: input.expected_status,
      p_starts_at: startsAt,
      p_assignment_mode: input.assignment_mode,
      p_doctor_id: input.doctor_id,
      p_device_id: input.device_id ?? null,
      p_reason: input.reason,
    });

    if (error) {
      const failure = hybridBookingFailure(error);
      res.status(failure.status).json({ error: { code: failure.code } });
      return;
    }

    const booking = bookingResultSchema.safeParse(data);

    if (!booking.success) {
      res.status(502).json({ error: { code: 'BOOKING_RESULT_UNCONFIRMED' } });
      return;
    }

    res.status(201).json({ data: booking.data });
  } catch {
    res.status(502).json({ error: { code: 'BOOKING_RESULT_UNCONFIRMED' } });
  }
});
