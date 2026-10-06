import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export const bookingFollowUpBoardRouter = Router();

bookingFollowUpBoardRouter.use(requireAuth);

const querySchema = z.strictObject({
  clinic_id: z.uuid(),
  lane: z.enum([
    'new',
    'today',
    'confirmed',
    'follow_up_1',
    'follow_up_2',
    'follow_up_3',
    'follow_up',
    'inquiries',
    'cancelled',
  ]),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
});

const appointmentFields = `
  id,
  clinic_id,
  lead_id,
  status,
  starts_at,
  ends_at,
  follow_up_at,
  no_answer_count,
  last_contact_at,
  follow_up_version,
lead:leads!appointments_lead_same_clinic_fk(
  id,
  status,
  source,
  created_at,
  requested_service_name_snapshot,
  contact:contacts(full_name,phone)
)
`;

const inquiryFields = `
  id,
  clinic_id,
  status,
  source,
  created_at,
  requested_service_name_snapshot,
  next_follow_up_at,
  no_answer_count,
  last_contact_at,
  follow_up_version,
  contact:contacts(full_name,phone)
`;

const allowedRoles = new Set([
  'clinic_manager',
  'clinic_customer_service',
  'moderator',
]);

bookingFollowUpBoardRouter.get('/', async (req, res) => {
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

  const {
    clinic_id: clinicId,
    lane,
    page,
    page_size: pageSize,
  } = parsed.data;

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
      throw new Error('Authorization unavailable');
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

    const now = DateTime.now().setZone('Africa/Cairo');
    const dayStart = now.startOf('day').toUTC().toISO();
    const dayEnd = now.startOf('day').plus({ days: 1 }).toUTC().toISO();

    if (!dayStart || !dayEnd) {
      throw new Error('Invalid date range');
    }

    const from = (page - 1) * pageSize;

        if (lane === 'new' || lane === 'inquiries') {
            let inquiryQuery = db
        .from('leads')
        .select(inquiryFields)
        .eq('clinic_id', clinicId)
        .is('archived_at', null);

      if (lane === 'new') {
        inquiryQuery = inquiryQuery
          .eq('status', 'new')
          .eq('no_answer_count', 0);
      } else {
        inquiryQuery = inquiryQuery
          .in('status', [
            'new',
            'in_progress',
            'no_answer',
            'follow_up',
          ])
          .or(
            `next_follow_up_at.is.null,next_follow_up_at.gte.${dayEnd}`,
          );
      }

      const { data, error } = await inquiryQuery
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, from + pageSize);

      if (error) throw error;

      const rows = data ?? [];

      res.json({
        data: {
          lane,
          today: now.toISODate(),
          server_now: now.toUTC().toISO(),
          appointments: [],
          inquiries: rows.slice(0, pageSize),
        },
        pagination: {
          page,
          page_size: pageSize,
          appointments_has_more: false,
          inquiries_has_more: rows.length > pageSize,
        },
      });
      return;
    }
      const attemptCount =
      lane === 'follow_up_1' ? 1
      : lane === 'follow_up_2' ? 2
      : lane === 'follow_up_3' ? 3
      : null;
    let appointmentsQuery = db
      .from('appointments')
      .select(appointmentFields)
      .eq('clinic_id', clinicId)
      .is('archived_at', null);

    if (lane === 'today') {
      appointmentsQuery = appointmentsQuery
        .eq('status', 'pending')
        .eq('no_answer_count', 0)
        .gte('starts_at', dayStart)
        .lt('starts_at', dayEnd);
    } else if (lane === 'confirmed') {
      appointmentsQuery = appointmentsQuery
        .eq('status', 'confirmed')
        .gte('starts_at', dayStart)
        .lt('starts_at', dayEnd);
    } else if (attemptCount !== null) {
      appointmentsQuery = appointmentsQuery
        .eq('status', 'pending')
        .eq('no_answer_count', attemptCount);
    } else {
      // Follow-ups scheduled for today, plus overdue follow-ups.
      // Also include pending visits from previous days that were missed.
      appointmentsQuery = appointmentsQuery
        .eq('status', 'pending')
        .or(
          [
            `and(no_answer_count.gt.0,follow_up_at.lt.${dayEnd})`,
            `and(starts_at.lt.${dayStart},follow_up_at.is.null)`,
            `and(starts_at.lt.${dayStart},follow_up_at.lt.${dayEnd})`,
          ].join(','),
        );
    }

    const appointmentsRequest = appointmentsQuery
      .order(
        lane === 'follow_up' || attemptCount !== null
          ? 'follow_up_at'
          : lane === 'cancelled'
            ? 'last_contact_at'
            : 'starts_at',
        {
          ascending: lane !== 'cancelled',
          nullsFirst: true,
        },
      )
      .order('id')
      .range(from, from + pageSize);

    let inquiryFollowUpQuery = db
      .from('leads')
      .select(inquiryFields)
      .eq('clinic_id', clinicId)
      .is('archived_at', null)
      .in('status', [
        'new',
        'in_progress',
        'no_answer',
        'follow_up',
      ]);

    if (attemptCount !== null) {
      inquiryFollowUpQuery = inquiryFollowUpQuery
        .eq('no_answer_count', attemptCount);
    } else {
      inquiryFollowUpQuery = inquiryFollowUpQuery
        .lt('next_follow_up_at', dayEnd);
    }

    const inquiriesRequest =
      lane === 'follow_up' || attemptCount !== null
        ? inquiryFollowUpQuery
            .order('next_follow_up_at', {
              ascending: true,
              nullsFirst: true,
            })
            .order('id')
            .range(from, from + pageSize)
        : Promise.resolve({ data: [], error: null });

    const [appointments, inquiries] = await Promise.all([
      appointmentsRequest,
      inquiriesRequest,
    ]);

    if (appointments.error || inquiries.error) {
      throw new Error('Board data unavailable');
    }

    const appointmentRows = appointments.data ?? [];
    const inquiryRows = inquiries.data ?? [];

    res.json({
      data: {
        lane,
        today: now.toISODate(),
        server_now: now.toUTC().toISO(),
        appointments: appointmentRows.slice(0, pageSize),
        inquiries: inquiryRows.slice(0, pageSize),
      },
      pagination: {
        page,
        page_size: pageSize,
        appointments_has_more: appointmentRows.length > pageSize,
        inquiries_has_more: inquiryRows.length > pageSize,
      },
    });
  } catch {
    res.status(502).json({
      error: { code: 'FOLLOW_UP_BOARD_UNAVAILABLE' },
    });
  }
});