import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

import {
  buildBookingMonth,
  getBookingMonthRange,
  type BookingSettings,
  type CalendarAppointment,
} from '../services/booking-availability.js';

export const bookingAvailabilityRouter = Router();

const querySchema = z.object({
  clinic_id: z.uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

const contactSchema = z.object({
  contact_id: z.uuid(),
});

const appointmentSchema = z.object({
  id: z.uuid(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  status: z.enum([
    'pending',
    'confirmed',
    'attended',
    'no_show',
    'cancelled',
  ]),
  archived_at: z.string().nullable(),
  lead: z.union([
    contactSchema,
    z.array(contactSchema),
  ]).nullable(),
});

const appointmentsSchema = z.array(appointmentSchema);

const settingsSchema = z.object({
  timezone: z.literal('Africa/Cairo'),
  working_days: z.array(z.number().int().min(1).max(7)),
  opens_at: z.string(),
  closes_at: z.string(),
  slot_minutes: z.union([
    z.literal(10),
    z.literal(20),
    z.literal(30),
    z.literal(60),
  ]),
  slot_capacity: z.number().int().min(1).max(100),
  enabled: z.boolean(),
});

const allowedRoles = new Set([
  'moderator',
  'agency_follow_up',
  'clinic_customer_service',
  'clinic_manager',
]);

const PAGE_SIZE = 500;
const MAX_APPOINTMENTS = 10000;

const appointmentFields = `
  id,
  starts_at,
  ends_at,
  status,
  archived_at,
  lead:leads!appointments_lead_same_clinic_fk(
    contact_id
  )
`;

async function readAppointments(
  db: ReturnType<typeof createUserSupabaseClient>,
  clinicId: string,
  start: string,
  end: string,
): Promise<CalendarAppointment[]> {
  // Legacy bookings without ends_at use the configured duration.
  // The maximum supported duration is 60 minutes.
  const lookback = DateTime.fromISO(start)
    .minus({ minutes: 60 })
    .toUTC()
    .toISO();

  if (!lookback) {
    throw new Error('Invalid calendar range');
  }

  const appointments: CalendarAppointment[] = [];
  let offset = 0;
  let total: number | null = null;

  do {
    const { data, error, count } = await db
      .from('appointments')
      .select(
        appointmentFields,
        offset === 0 ? { count: 'exact' } : undefined,
      )
      .eq('clinic_id', clinicId)
      .is('archived_at', null)
      .neq('status', 'cancelled')
      .lt('starts_at', end)
      .or(
        `ends_at.gt.${start},starts_at.gte.${lookback}`,
      )
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('[Booking appointments fetch failed]', {
        code: error.code,
      });

      throw new Error('Appointments unavailable');
    }

    if (offset === 0) {
      if (count === null) {
        throw new Error('Appointment count unavailable');
      }

      total = count;

      // Return an error rather than show incomplete availability.
      if (total > MAX_APPOINTMENTS) {
        throw new Error('Calendar appointment limit exceeded');
      }
    }

    const parsed = appointmentsSchema.safeParse(data);

    if (!parsed.success) {
      throw new Error('Invalid appointment data');
    }

    for (const row of parsed.data) {
      const lead = Array.isArray(row.lead)
        ? row.lead.length === 1
          ? row.lead[0]
          : null
        : row.lead;

      if (!lead) {
        throw new Error('Appointment contact unavailable');
      }

      appointments.push({
        id: row.id,
        contact_id: lead.contact_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: row.status,
        archived_at: row.archived_at,
      });
    }

    if (parsed.data.length === 0 && offset < (total ?? 0)) {
      throw new Error('Incomplete appointment results');
    }

    offset += parsed.data.length;
  } while (offset < (total ?? 0));

  return appointments;
}

bookingAvailabilityRouter.get(
  '/',
  requireAuth,
  async (req, res) => {
    const auth = res.locals.auth;

    if (!auth) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED' },
      });
      return;
    }

    const parsed = querySchema.safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR' },
      });
      return;
    }

    const { clinic_id: clinicId, month } = parsed.data;

    let range: ReturnType<typeof getBookingMonthRange>;

    try {
      range = getBookingMonthRange(month);
    } catch {
      res.status(400).json({
        error: { code: 'INVALID_BOOKING_MONTH' },
      });
      return;
    }

    const db = createUserSupabaseClient(auth.accessToken);

    try {
      const [clinic, membership, admin] = await Promise.all([
        db
          .from('clinics')
          .select('id')
          .eq('id', clinicId)
          .is('archived_at', null)
          .maybeSingle(),

        db
          .from('clinic_memberships')
          .select('role')
          .eq('clinic_id', clinicId)
          .eq('user_id', auth.userId)
          .eq('is_active', true)
          .maybeSingle(),

        db.rpc('crm_admin_status'),
      ]);

      if (clinic.error || membership.error || admin.error) {
        throw new Error('Clinic authorization unavailable');
      }

      if (
        !clinic.data ||
        (
          admin.data !== true &&
          !allowedRoles.has(membership.data?.role ?? '')
        )
      ) {
        res.status(403).json({
          error: { code: 'FORBIDDEN' },
        });
        return;
      }

      const [settingsResult, appointments] = await Promise.all([
        db
          .from('clinic_booking_settings')
          .select(
            'timezone,working_days,opens_at,closes_at,' +
            'slot_minutes,slot_capacity,enabled',
          )
          .eq('clinic_id', clinicId)
          .maybeSingle(),

        readAppointments(
          db,
          clinicId,
          range.start,
          range.end,
        ),
      ]);

      if (settingsResult.error) {
        console.error('[Booking settings fetch failed]', {
          code: settingsResult.error.code,
        });

        throw new Error('Booking settings unavailable');
      }

      let settings: BookingSettings | null = null;

      if (settingsResult.data) {
        settings = settingsSchema.parse(settingsResult.data);
      }

      const calendar = buildBookingMonth(
        month,
        settings,
        appointments,
      );

      res.status(200).json({
        data: {
          clinic_id: clinicId,
          ...calendar,
        },
      });
    } catch {
      res.status(502).json({
        error: {
          code: 'BOOKING_AVAILABILITY_UNAVAILABLE',
          message: 'Unable to load booking availability',
        },
      });
    }
  },
);