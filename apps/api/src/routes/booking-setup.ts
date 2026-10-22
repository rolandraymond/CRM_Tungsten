import { Router, type Request, type Response } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const bookingSetupRouter = Router();
bookingSetupRouter.use(requireAuth);
const scope = z.object({ clinic_id: z.uuid() });
const idSchema = z.uuid();
const nameSchema = z.string().trim().min(1).max(200);
const deviceIds = z
  .array(z.uuid())
  .max(500)
  .refine((a) => new Set(a).size === a.length);
const doctorScheduleSchema = z.object({ kind: z.literal('doctor'), resource_id: z.uuid() });
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const periodSchema = doctorScheduleSchema
  .extend({
    iso_weekday: z.number().int().min(1).max(7),
    starts_at: timeSchema,
    ends_at: timeSchema,
    end_day_offset: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .refine(
    (v) => (v.end_day_offset === 0 ? v.ends_at > v.starts_at : v.ends_at <= v.starts_at),
    { message: 'Check shift end time and next-day setting' },
  );
const blockSchema = doctorScheduleSchema
  .extend({
    starts_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    ends_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestError(400, 'VALIDATION_ERROR');
  return result.data;
}
function route(action: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await action(req, res);
    } catch (error) {
      if (error instanceof RequestError) {
        res.status(error.status).json({ error: { code: error.code } });
        return;
      }
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : '';
      const status =
        code === '42501' ? 403 : ['23503', '23514', '22023'].includes(code) ? 400 : 502;
      res
        .status(status)
        .json({
          error: {
            code:
              status === 403
                ? 'FORBIDDEN'
                : status === 400
                  ? 'SETUP_DATA_REJECTED'
                  : 'SETUP_REQUEST_FAILED',
          },
        });
    }
  };
}
function context(req: Request, res: Response) {
  return {
    clinicId: parse(scope, req.query).clinic_id,
    db: createUserSupabaseClient(res.locals.auth!.accessToken),
  };
}
async function rows<T>(
  factory: (
    start: number,
    end: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { code?: string } | null;
  }>,
) {
  const output: T[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const result = await factory(offset, offset + 499);
    if (result.error) throw result.error;
    output.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return output;
  }
  throw new RequestError(400, 'SETUP_TOO_LARGE');
}

bookingSetupRouter.get(
  '/',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const clinic = await db
      .from('clinics')
      .select('id')
      .eq('id', clinicId)
      .is('archived_at', null)
      .maybeSingle();
    if (clinic.error) throw clinic.error;
    if (!clinic.data) throw new RequestError(403, 'FORBIDDEN');
    const [
      doctors,
      devices,
      services,
      service_devices,
      doctor_services,
      doctor_devices,
      periods,
      blocks,
    ] = await Promise.all([
      rows((a, b) =>
        db
          .from('clinic_doctors')
          .select('id,full_name,is_active')
          .eq('clinic_id', clinicId)
          .order('id')
          .range(a, b),
      ),
      rows((a, b) =>
        db
          .from('clinic_devices')
          .select('id,device_name,device_type,is_active')
          .eq('clinic_id', clinicId)
          .order('id')
          .range(a, b),
      ),
      rows((a, b) =>
        db
          .from('clinic_services')
          .select(
            'service_id,is_active,requires_device,service:services!inner(service_name,is_active)',
          )
          .eq('clinic_id', clinicId)
          .order('service_id')
          .range(a, b),
      ),
      rows((a, b) =>
        db
          .from('clinic_service_devices')
          .select('service_id,device_id,is_active')
          .eq('clinic_id', clinicId)
          .order('service_id')
          .order('device_id')
          .range(a, b),
      ),
      rows((a, b) =>
        db
          .from('clinic_doctor_services')
          .select('doctor_id,service_id,duration_minutes,is_active')
          .eq('clinic_id', clinicId)
          .order('doctor_id')
          .order('service_id')
          .range(a, b),
      ),
      rows((a, b) =>
        db
          .from('clinic_doctor_service_devices')
          .select('doctor_id,service_id,device_id,is_active')
          .eq('clinic_id', clinicId)
          .order('doctor_id')
          .order('service_id')
          .order('device_id')
          .range(a, b),
      ),
      rows((a, b) =>
        db
          .from('clinic_resource_working_periods')
          .select(
            'id,doctor_id,device_id,iso_weekday,starts_at,ends_at,end_day_offset,is_active',
          )
          .eq('clinic_id', clinicId)
          .not('doctor_id', 'is', null)
          .order('id')
          .range(a, b),
      ),
      rows((a, b) =>
        db
          .from('clinic_resource_blocks')
          .select('id,doctor_id,device_id,starts_at,ends_at,reason')
          .eq('clinic_id', clinicId)
          .not('doctor_id', 'is', null)
          .order('id')
          .range(a, b),
      ),
    ]);
    res.json({
      data: {
        doctors,
        devices,
        service_devices,
        doctor_services,
        doctor_devices,
        periods,
        blocks,
        services: services.flatMap((row) => {
          const service = Array.isArray(row.service) ? row.service[0] : row.service;
          return service
            ? [
                {
                  service_id: row.service_id,
                  service_name: service.service_name,
                  is_active: row.is_active && service.is_active,
                  requires_device: row.requires_device,
                },
              ]
            : [];
        }),
      },
    });
  }),
);

bookingSetupRouter.post(
  '/doctors',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const body = parse(z.object({ full_name: nameSchema }).strict(), req.body);
    const { data, error } = await db
      .from('clinic_doctors')
      .insert({ clinic_id: clinicId, ...body })
      .select('id')
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  }),
);
bookingSetupRouter.patch(
  '/doctors/:id',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const body = parse(
      z
        .object({ full_name: nameSchema.optional(), is_active: z.boolean().optional() })
        .strict()
        .refine((v) => Object.keys(v).length > 0),
      req.body,
    );
    const { data, error } = await db
      .from('clinic_doctors')
      .update(body)
      .eq('clinic_id', clinicId)
      .eq('id', parse(idSchema, req.params.id))
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new RequestError(404, 'NOT_FOUND_OR_NOT_EDITABLE');
    res.json({ data });
  }),
);
bookingSetupRouter.post(
  '/devices',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const body = parse(z.object({ device_name: nameSchema }).strict(), req.body);
    // No device-type text field is needed in the new UI: services select physical IDs.
    const { data, error } = await db
      .from('clinic_devices')
      .insert({ clinic_id: clinicId, device_type: 'device', ...body })
      .select('id')
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  }),
);
bookingSetupRouter.patch(
  '/devices/:id',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const body = parse(
      z
        .object({ device_name: nameSchema.optional(), is_active: z.boolean().optional() })
        .strict()
        .refine((v) => Object.keys(v).length > 0),
      req.body,
    );
    const { data, error } = await db
      .from('clinic_devices')
      .update(body)
      .eq('clinic_id', clinicId)
      .eq('id', parse(idSchema, req.params.id))
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new RequestError(404, 'NOT_FOUND_OR_NOT_EDITABLE');
    res.json({ data });
  }),
);
bookingSetupRouter.put(
  '/services/:id',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const body = parse(
      z.object({ requires_device: z.boolean(), device_ids: deviceIds }).strict(),
      req.body,
    );
    const { error } = await db.rpc('crm_setup_set_service_devices', {
      p_clinic_id: clinicId,
      p_service_id: parse(idSchema, req.params.id),
      p_requires_device: body.requires_device,
      p_device_ids: body.device_ids,
    });
    if (error) throw error;
    res.json({ data: { saved: true } });
  }),
);
bookingSetupRouter.put(
  '/doctors/:id/services/:serviceId',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const body = parse(
      z
        .object({
          duration_minutes: z.number().int().min(1).max(1440),
          is_active: z.boolean(),
          device_ids: deviceIds,
        })
        .strict(),
      req.body,
    );
    const { error } = await db.rpc('crm_setup_set_doctor_service', {
      p_clinic_id: clinicId,
      p_doctor_id: parse(idSchema, req.params.id),
      p_service_id: parse(idSchema, req.params.serviceId),
      p_duration_minutes: body.duration_minutes,
      p_is_active: body.is_active,
      p_device_ids: body.device_ids,
    });
    if (error) throw error;
    res.json({ data: { saved: true } });
  }),
);
bookingSetupRouter.post(
  '/periods',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const body = parse(periodSchema, req.body);
    const { kind: _kind, resource_id: doctorId, ...period } = body;
    const { data, error } = await db
      .from('clinic_resource_working_periods')
      .insert({ clinic_id: clinicId, doctor_id: doctorId, device_id: null, ...period })
      .select('id')
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  }),
);
bookingSetupRouter.post(
  '/blocks',
  route(async (req, res) => {
    const { db, clinicId } = context(req, res);
    const body = parse(blockSchema, req.body);
    const cairo = (value: string) => {
      const time = DateTime.fromISO(value, { zone: 'Africa/Cairo' });
      if (
        !time.isValid ||
        time.toFormat("yyyy-MM-dd'T'HH:mm") !== value ||
        time.getPossibleOffsets().length !== 1
      ) {
        throw new RequestError(400, 'INVALID_OR_AMBIGUOUS_CAIRO_TIME');
      }
      return time;
    };
    const start = cairo(body.starts_local),
      end = cairo(body.ends_local);
    if (end.toMillis() <= start.toMillis())
      throw new RequestError(400, 'INVALID_TIME_ORDER');
    const { data, error } = await db
      .from('clinic_resource_blocks')
      .insert({
        clinic_id: clinicId,
        doctor_id: body.resource_id,
        device_id: null,
        starts_at: start.toUTC().toISO(),
        ends_at: end.toUTC().toISO(),
        reason: body.reason,
      })
      .select('id')
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  }),
);
for (const [path, table] of [
  ['periods', 'clinic_resource_working_periods'],
  ['blocks', 'clinic_resource_blocks'],
]) {
  bookingSetupRouter.delete(
    `/${path}/:id`,
    route(async (req, res) => {
      const { db, clinicId } = context(req, res);
      const { data, error } = await db
        .from(table)
        .delete()
        .eq('clinic_id', clinicId)
        .not('doctor_id', 'is', null)
        .eq('id', parse(idSchema, req.params.id))
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new RequestError(404, 'NOT_FOUND_OR_NOT_EDITABLE');
      res.json({ data });
    }),
  );
}
