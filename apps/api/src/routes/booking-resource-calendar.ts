import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';
import {
  AvailabilityError,
  buildResourceAvailability,
  getAvailabilityRange,
  type AvailabilityData,
} from '../services/booking-availability-engine.js';

export const bookingResourceCalendarRouter = Router();
bookingResourceCalendarRouter.use(requireAuth);

const querySchema = z.strictObject({
  clinic_id: z.uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  service_id: z.uuid().optional(),
  doctor_id: z.uuid().optional(),
});
const allowedRoles = new Set([
  'moderator',
  'agency_follow_up',
  'clinic_customer_service',
  'clinic_manager',
]);
const doctorSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  is_active: z.boolean(),
});
const deviceSchema = z.object({
  id: z.uuid(),
  device_name: z.string(),
  is_active: z.boolean(),
});
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
const serviceSchema = z.object({ service_name: z.string(), is_active: z.boolean() });
const clinicServiceSchema = z.object({
  service_id: z.uuid(),
  is_active: z.boolean(),
  requires_device: z.boolean().nullable(),
  service: z.union([serviceSchema, z.array(serviceSchema).length(1)]),
});
const contactSchema = z.object({ full_name: z.string(), phone: z.string() });
const leadSchema = z.object({
  contact_id: z.uuid(),
  requested_service_name_snapshot: z.string(),
  contact: z.union([contactSchema, z.array(contactSchema).length(1)]),
});
const appointmentSchema = z.object({
  id: z.uuid(),
  lead_id: z.uuid(),
  booked_service_id: z.uuid(),
  resource_doctor_id: z.uuid().nullable(),
  device_id: z.uuid().nullable(),
  duration_minutes: z.number().int().min(1).max(1440).nullable(),
  assignment_mode: z.enum(['specific', 'auto']).nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  status: z.enum(['pending', 'confirmed', 'attended', 'no_show']),
  lead: z.union([leadSchema, z.array(leadSchema).length(1)]),
});

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
  const output: T[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const result = await fetchPage(offset, offset + 499);
    if (result.error) throw result.error;
    const page = z.array(schema).parse(result.data);
    output.push(...page);
    if (page.length < 500) return output;
  }
  throw new AvailabilityError('CALENDAR_TOO_LARGE');
}

bookingResourceCalendarRouter.get('/', async (req, res) => {
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
  const input = parsed.data;
  const month = DateTime.fromISO(`${input.month}-01`, { zone: 'Africa/Cairo' });
  if (!month.isValid || month.toFormat('yyyy-MM') !== input.month) {
    res.status(400).json({ error: { code: 'INVALID_BOOKING_MONTH' } });
    return;
  }
  const start = month.startOf('day').toUTC().toISO()!;
  const end = month.plus({ months: 1, minutes: 1440 }).toUTC().toISO()!;
  const db = createUserSupabaseClient(auth.accessToken);
  const clinicId = input.clinic_id;

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
    if (clinic.error || membership.error || admin.error)
      throw new Error('Authorization unavailable');
    if (
      !clinic.data ||
      (admin.data !== true && !allowedRoles.has(membership.data?.role ?? ''))
    ) {
      res.status(403).json({ error: { code: 'FORBIDDEN' } });
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
      rawServices,
      rawAppointments,
    ] = await Promise.all([
      readRows(doctorSchema, (a, b) =>
        db
          .from('clinic_doctors')
          .select('id,full_name,is_active')
          .eq('clinic_id', clinicId)
          .order('id')
          .range(a, b),
      ),
      readRows(deviceSchema, (a, b) =>
        db
          .from('clinic_devices')
          .select('id,device_name,is_active')
          .eq('clinic_id', clinicId)
          .order('id')
          .range(a, b),
      ),
      readRows(offeringSchema, (a, b) =>
        db
          .from('clinic_doctor_services')
          .select('doctor_id,service_id,duration_minutes,is_active')
          .eq('clinic_id', clinicId)
          .order('doctor_id')
          .order('service_id')
          .range(a, b),
      ),
      readRows(deviceLinkSchema, (a, b) =>
        db
          .from('clinic_service_devices')
          .select('service_id,device_id,is_active')
          .eq('clinic_id', clinicId)
          .order('service_id')
          .order('device_id')
          .range(a, b),
      ),
      readRows(doctorDeviceSchema, (a, b) =>
        db
          .from('clinic_doctor_service_devices')
          .select('doctor_id,service_id,device_id,is_active')
          .eq('clinic_id', clinicId)
          .order('doctor_id')
          .order('service_id')
          .order('device_id')
          .range(a, b),
      ),
      readRows(periodSchema, (a, b) =>
        db
          .from('clinic_resource_working_periods')
          .select('doctor_id,iso_weekday,starts_at,ends_at,end_day_offset,is_active')
          .eq('clinic_id', clinicId)
          .not('doctor_id', 'is', null)
          .order('id')
          .range(a, b),
      ),
      readRows(blockSchema, (a, b) =>
        db
          .from('clinic_resource_blocks')
          .select('doctor_id,starts_at,ends_at')
          .eq('clinic_id', clinicId)
          .not('doctor_id', 'is', null)
          .lt('starts_at', end)
          .gt('ends_at', start)
          .order('id')
          .range(a, b),
      ),
      readRows(clinicServiceSchema, (a, b) =>
        db
          .from('clinic_services')
          .select(
            'service_id,is_active,requires_device,service:services!inner(service_name,is_active)',
          )
          .eq('clinic_id', clinicId)
          .order('service_id')
          .range(a, b),
      ),
      readRows(appointmentSchema, (a, b) =>
        db
          .from('appointments')
          .select(
            `
        id,lead_id,booked_service_id,resource_doctor_id,device_id,duration_minutes,
        assignment_mode,starts_at,ends_at,status,
        lead:leads!appointments_lead_same_clinic_fk(
          contact_id,requested_service_name_snapshot,contact:contacts(full_name,phone)
        )
      `,
          )
          .eq('clinic_id', clinicId)
          .is('archived_at', null)
          .neq('status', 'cancelled')
          .lt('starts_at', end)
          .or(`ends_at.gt.${start},ends_at.is.null`)
          .order('starts_at')
          .order('id')
          .range(a, b),
      ),
    ]);
    const services = rawServices.map((row) => {
      const service = Array.isArray(row.service) ? row.service[0] : row.service;
      return {
        service_id: row.service_id,
        service_name: service.service_name,
        is_active: row.is_active && service.is_active,
        requires_device: row.requires_device,
      };
    });
    if (
      input.service_id &&
      !services.some((service) => service.service_id === input.service_id)
    ) {
      res.status(404).json({ error: { code: 'SERVICE_UNAVAILABLE' } });
      return;
    }
    if (input.doctor_id && !doctors.some((doctor) => doctor.id === input.doctor_id)) {
      res.status(404).json({ error: { code: 'DOCTOR_UNAVAILABLE' } });
      return;
    }
    const appointments = rawAppointments.map((row) => {
      const lead = Array.isArray(row.lead) ? row.lead[0] : row.lead;
      const contact = Array.isArray(lead.contact) ? lead.contact[0] : lead.contact;
      return {
        id: row.id,
        lead_id: row.lead_id,
        contact_id: lead.contact_id,
        service_id: row.booked_service_id,
        service_name: lead.requested_service_name_snapshot,
        doctor_id: row.resource_doctor_id,
        doctor_name:
          doctors.find((doctor) => doctor.id === row.resource_doctor_id)?.full_name ??
          null,
        device_id: row.device_id,
        device_name:
          devices.find((device) => device.id === row.device_id)?.device_name ?? null,
        duration_minutes: row.duration_minutes,
        assignment_mode: row.assignment_mode,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: row.status,
        patient_name: contact.full_name,
        phone: contact.phone,
      };
    });
    const data: AvailabilityData = {
      doctors,
      devices,
      offerings,
      serviceDevices,
      doctorDevices,
      periods,
      blocks,
      appointments: rawAppointments,
    };
    const selectedService = services.find(
      (service) => service.service_id === input.service_id,
    );
    const now = Date.now();
    const today = DateTime.fromMillis(now, { zone: 'Africa/Cairo' }).toISODate()!;
    const days = [];
    let totalSlots = 0;
    for (let index = 0; index < month.daysInMonth!; index++) {
      const date = month.plus({ days: index }).toISODate()!;
      const dayAppointments = appointments.filter(
        (row) =>
          DateTime.fromISO(row.starts_at).setZone('Africa/Cairo').toISODate() === date &&
          (!input.service_id || row.service_id === input.service_id) &&
          (!input.doctor_id || row.doctor_id === input.doctor_id),
      );
      let slots: ReturnType<typeof buildResourceAvailability> = [];
      let availabilityError: string | null = null;
      if (selectedService) {
        if (!selectedService.is_active) availabilityError = 'SERVICE_UNAVAILABLE';
        else if (selectedService.requires_device === null)
          availabilityError = 'SERVICE_DEVICE_REQUIREMENT_NOT_CONFIGURED';
        else {
          const range = getAvailabilityRange(date);
          const dayReservations = rawAppointments.filter(
            (row) =>
              timestamp(row.starts_at) < timestamp(range.end) &&
              (!row.ends_at || timestamp(row.ends_at) > timestamp(range.start)),
          );
          try {
            slots = buildResourceAvailability({
              date,
              serviceId: selectedService.service_id,
              doctorId: input.doctor_id,
              requiresDevice: selectedService.requires_device,
              data: { ...data, appointments: dayReservations },
              now,
            });
          } catch (error) {
            if (
              !(error instanceof AvailabilityError) ||
              error.code === 'AVAILABILITY_TOO_LARGE'
            )
              throw error;
            availabilityError = error.code;
          }
        }
      }
      totalSlots += slots.length;
      if (totalSlots > 20000) throw new AvailabilityError('CALENDAR_TOO_LARGE');
      const availableStarts = new Set(slots.map((slot) => slot.starts_at)).size;
      const state =
        date < today
          ? 'past'
          : availabilityError
            ? 'unknown'
            : selectedService
              ? availableStarts > 0
                ? 'available'
                : 'unavailable'
              : dayAppointments.length > 0
                ? 'booked'
                : 'empty';
      days.push({
        date,
        state,
        booked_clients: new Set(dayAppointments.map((row) => row.contact_id)).size,
        appointments_count: dayAppointments.length,
        available_starts: selectedService ? availableStarts : null,
        availability_error: availabilityError,
        appointments: dayAppointments,
        slots,
      });
    }
    res.json({
      data: {
        clinic_id: clinicId,
        month: input.month,
        timezone: 'Africa/Cairo',
        doctors,
        services,
        days,
      },
    });
  } catch (error) {
    res.status(error instanceof AvailabilityError ? 409 : 502).json({
      error: {
        code:
          error instanceof AvailabilityError
            ? error.code
            : 'RESOURCE_CALENDAR_UNAVAILABLE',
      },
    });
  }
});

function timestamp(value: string): number {
  const time = DateTime.fromISO(value, { setZone: true });
  if (!time.isValid) throw new Error('Invalid appointment timestamp');
  return time.toMillis();
}
