import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';
import {
  AvailabilityError,
  buildResourceAvailability,
  getAvailabilityRange,
} from '../services/booking-availability-engine.js';

export const bookingResourceAvailabilityRouter = Router();
bookingResourceAvailabilityRouter.use(requireAuth);

const querySchema = z
  .object({
    clinic_id: z.uuid(),
    service_id: z.uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    assignment_mode: z.enum(['specific', 'auto']).default('auto'),
    doctor_id: z.uuid().optional(),
    reschedule_appointment_id: z.uuid().optional(),
  })
  .strict()
  .refine((query) =>
    query.assignment_mode === 'specific'
      ? query.doctor_id !== undefined
      : query.doctor_id === undefined,
  )
  .refine(query => !query.reschedule_appointment_id
    || query.assignment_mode === 'specific');

const rescheduleAppointmentSchema = z.object({
  id: z.uuid(),
  booked_service_id: z.uuid(),
  resource_doctor_id: z.uuid().nullable(),
  device_id: z.uuid().nullable(),
  duration_minutes: z.number().int().min(1).max(1440).nullable(),
  starts_at: z.string(),
  status: z.string(),
});

const doctorSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  is_active: z.boolean(),
});
const deviceSchema = z.object({ id: z.uuid(), is_active: z.boolean() });
const offeringSchema = z.object({
  doctor_id: z.uuid(),
  service_id: z.uuid(),
  duration_minutes: z.number().int().min(1).max(1440),
  is_active: z.boolean(),
});
const deviceLinkSchema = z.object({
  service_id: z.uuid(),
  device_id: z.uuid(),
  is_active: z.boolean(),
});
const doctorDeviceSchema = deviceLinkSchema.extend({ doctor_id: z.uuid() });
const periodSchema = z.object({
  doctor_id: z.uuid(),
  iso_weekday: z.number().int().min(1).max(7),
  starts_at: z.string(),
  ends_at: z.string(),
  end_day_offset: z.number().int().min(0).max(1),
  is_active: z.boolean(),
});
const blockSchema = z.object({
  doctor_id: z.uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
});
const appointmentSchema = z.object({
  resource_doctor_id: z.uuid().nullable(),
  device_id: z.uuid().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
});
const catalogServiceSchema = z.object({ is_active: z.boolean() });
const clinicServiceSchema = z.object({
  is_active: z.boolean(),
  requires_device: z.boolean().nullable(),
  service: z.union([catalogServiceSchema, z.array(catalogServiceSchema).length(1)]),
});

const allowedRoles = new Set([
  'moderator',
  'agency_follow_up',
  'clinic_customer_service',
  'clinic_manager',
]);

async function readRows<T>(
  schema: z.ZodType<T>,
  fetchPage: (
    start: number,
    end: number,
  ) => PromiseLike<{
    data: unknown[] | null;
    error: { code?: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let offset = 0; offset < 10_000; offset += 500) {
    const result = await fetchPage(offset, offset + 499);

    if (result.error) {
      throw result.error;
    }

    const page = z.array(schema).parse(result.data);
    rows.push(...page);

    if (page.length < 500) {
      return rows;
    }
  }

  // Never show availability calculated from a truncated set of reservations.
  throw new AvailabilityError('AVAILABILITY_TOO_LARGE');
}

bookingResourceAvailabilityRouter.get('/', async (req, res) => {
  const auth = res.locals.auth;
  const parsed = querySchema.safeParse(req.query);

  if (!auth) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
    return;
  }

  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
    return;
  }

  const query = parsed.data;
  const db = createUserSupabaseClient(auth.accessToken);

  try {
    const range = getAvailabilityRange(query.date);
    const clinicId = query.clinic_id;
    const serviceId = query.service_id;
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
      throw new Error('Authorization unavailable');
    }

    if (
      !clinic.data ||
      (admin.data !== true && !allowedRoles.has(membership.data?.role ?? ''))
    ) {
      res.status(403).json({ error: { code: 'FORBIDDEN' } });
      return;
    }

    let rescheduling: z.infer<typeof rescheduleAppointmentSchema> | null = null;

    if (query.reschedule_appointment_id) {
      // Verify the reservation belongs to this clinic before excluding it.
      const appointment = await db
        .from('appointments')
        .select('id,booked_service_id,resource_doctor_id,device_id,duration_minutes,starts_at,status')
        .eq('clinic_id', clinicId)
        .eq('id', query.reschedule_appointment_id)
        .is('archived_at', null)
        .maybeSingle();

      if (appointment.error) throw appointment.error;
      if (!appointment.data) {
        res.status(404).json({ error: { code: 'APPOINTMENT_NOT_FOUND' } });
        return;
      }

      rescheduling = rescheduleAppointmentSchema.parse(appointment.data);
      if (!['pending', 'confirmed'].includes(rescheduling.status)) {
        res.status(409).json({ error: { code: 'APPOINTMENT_NOT_ACTIONABLE' } });
        return;
      }
      if (!rescheduling.resource_doctor_id || !rescheduling.duration_minutes) {
        res.status(409).json({ error: { code: 'LEGACY_BOOKING_REQUIRES_RESOURCE_ASSIGNMENT' } });
        return;
      }
      if (rescheduling.booked_service_id !== serviceId
        || rescheduling.resource_doctor_id !== query.doctor_id) {
        res.status(400).json({ error: { code: 'RESCHEDULE_SELECTION_MISMATCH' } });
        return;
      }
    }

    const serviceResult = await db
      .from('clinic_services')
      .select('is_active,requires_device,service:services!inner(is_active)')
      .eq('clinic_id', clinicId)
      .eq('service_id', serviceId)
      .maybeSingle();

    if (serviceResult.error) {
      throw serviceResult.error;
    }

    if (!serviceResult.data) {
      res.status(404).json({ error: { code: 'SERVICE_UNAVAILABLE' } });
      return;
    }

    const clinicService = clinicServiceSchema.parse(serviceResult.data);
    const service = Array.isArray(clinicService.service)
      ? clinicService.service[0]
      : clinicService.service;

    if (!clinicService.is_active || !service.is_active) {
      res.status(404).json({ error: { code: 'SERVICE_UNAVAILABLE' } });
      return;
    }

    if (clinicService.requires_device === null) {
      res
        .status(409)
        .json({ error: { code: 'SERVICE_DEVICE_REQUIREMENT_NOT_CONFIGURED' } });
      return;
    }

    if (rescheduling && clinicService.requires_device !== (rescheduling.device_id !== null)) {
      res.status(409).json({ error: { code: 'BOOKING_CONFIGURATION_CHANGED' } });
      return;
    }

    const [
      doctors,
      devices,
      offerings,
      serviceDevices,
      doctorDevices,
      periods,
      blocks,
      appointments,
    ] = await Promise.all([
      readRows(doctorSchema, (start, end) =>
        db
          .from('clinic_doctors')
          .select('id,full_name,is_active')
          .eq('clinic_id', clinicId)
          .order('id')
          .range(start, end),
      ),
      readRows(deviceSchema, (start, end) =>
        db
          .from('clinic_devices')
          .select('id,is_active')
          .eq('clinic_id', clinicId)
          .order('id')
          .range(start, end),
      ),
      readRows(offeringSchema, (start, end) =>
        db
          .from('clinic_doctor_services')
          .select('doctor_id,service_id,duration_minutes,is_active')
          .eq('clinic_id', clinicId)
          .eq('service_id', serviceId)
          .order('doctor_id')
          .range(start, end),
      ),
      readRows(deviceLinkSchema, (start, end) =>
        db
          .from('clinic_service_devices')
          .select('service_id,device_id,is_active')
          .eq('clinic_id', clinicId)
          .eq('service_id', serviceId)
          .order('device_id')
          .range(start, end),
      ),
      readRows(doctorDeviceSchema, (start, end) =>
        db
          .from('clinic_doctor_service_devices')
          .select('doctor_id,service_id,device_id,is_active')
          .eq('clinic_id', clinicId)
          .eq('service_id', serviceId)
          .order('doctor_id')
          .order('device_id')
          .range(start, end),
      ),
      readRows(periodSchema, (start, end) =>
        db
          .from('clinic_resource_working_periods')
          .select('doctor_id,iso_weekday,starts_at,ends_at,end_day_offset,is_active')
          .eq('clinic_id', clinicId)
          .not('doctor_id', 'is', null)
          .order('id')
          .range(start, end),
      ),
      readRows(blockSchema, (start, end) =>
        db
          .from('clinic_resource_blocks')
          .select('doctor_id,starts_at,ends_at')
          .eq('clinic_id', clinicId)
          .not('doctor_id', 'is', null)
          .lt('starts_at', range.end)
          .gt('ends_at', range.start)
          .order('id')
          .range(start, end),
      ),
      // Fetch every service's reservations: doctors and devices are shared.
      readRows(appointmentSchema, (start, end) => {
        const reservations = db
          .from('appointments')
          .select('resource_doctor_id,device_id,starts_at,ends_at')
          .eq('clinic_id', clinicId)
          .is('archived_at', null)
          .neq('status', 'cancelled')
          .lt('starts_at', range.end)
          .or(`ends_at.gt.${range.start},ends_at.is.null`);

        if (rescheduling) reservations.neq('id', rescheduling.id);
        return reservations.order('id').range(start, end);
      }),
    ]);

    if (query.doctor_id && !doctors.some((doctor) => doctor.id === query.doctor_id)) {
      res.status(404).json({ error: { code: 'DOCTOR_UNAVAILABLE' } });
      return;
    }

    const reservedDoctorId = rescheduling?.resource_doctor_id;
    const reservedDeviceId = rescheduling?.device_id;
    const reservedDuration = rescheduling?.duration_minutes;
    const offeringsForSelection = offerings.map(offering =>
      reservedDuration && offering.doctor_id === reservedDoctorId
        ? { ...offering, duration_minutes: reservedDuration }
        : offering,
    );
    const deviceLinksForSelection = reservedDeviceId
      ? doctorDevices.filter(link => link.device_id === reservedDeviceId)
      : doctorDevices;

    const slots = buildResourceAvailability({
      date: query.date,
      serviceId,
      doctorId: query.doctor_id,
      requiresDevice: clinicService.requires_device,
      data: {
        doctors,
        devices,
        // Rescheduling keeps the appointment's duration and physical device.
        offerings: offeringsForSelection,
        serviceDevices,
        doctorDevices: deviceLinksForSelection,
        periods,
        blocks,
        appointments,
      },
    });

    res.json({
      data: {
        clinic_id: clinicId,
        service_id: serviceId,
        date: query.date,
        timezone: 'Africa/Cairo',
        assignment_mode: query.assignment_mode,
        reschedule_appointment_id: rescheduling?.id ?? null,
        slots: rescheduling
          ? slots.filter(slot => Date.parse(slot.starts_at) !== Date.parse(rescheduling!.starts_at))
          : slots,
      },
    });
  } catch (error) {
    if (error instanceof AvailabilityError) {
      const status = error.code === 'INVALID_BOOKING_DATE' ? 400 : 409;
      res.status(status).json({ error: { code: error.code } });
      return;
    }

    res.status(502).json({ error: { code: 'RESOURCE_AVAILABILITY_UNAVAILABLE' } });
  }
});
