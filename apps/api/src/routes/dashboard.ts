import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';
import { DateTime } from 'luxon';

export const dashboardRouter = Router();

dashboardRouter.get('/', requireAuth, async (req, res) => {
  const auth = res.locals.auth;
  const clinicId = z.uuid().safeParse(req.query.clinic_id);

  if (!auth) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
    return;
  }

  if (!clinicId.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
    return;
  }

  const db = createUserSupabaseClient(auth.accessToken);

  try {
    // A user-scoped client keeps the existing clinic RLS rules in force.
    const clinic = await db
      .from('clinics')
      .select('id')
      .eq('id', clinicId.data)
      .is('archived_at', null)
      .maybeSingle();

    if (clinic.error) throw clinic.error;
    if (!clinic.data) {
      res.status(403).json({ error: { code: 'FORBIDDEN' } });
      return;
    }

    const leads = () => db
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId.data)
      .is('archived_at', null);

    const [total, fresh, follow, converted, uninterested, recent, bookings, ads] =
      await Promise.all([
        leads(),
        leads().eq('status', 'new'),
        leads().in('status', ['in_progress', 'follow_up', 'no_answer']),
        leads().eq('status', 'converted'),
        leads().eq('status', 'not_interested'),
        db.from('leads')
          .select(`
            id, status, source, created_at,
            requested_service_name_snapshot, contact_type_at_creation,
            contact:contacts (full_name, phone)
          `)
          .eq('clinic_id', clinicId.data)
          .is('archived_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(4),
        db.from('appointments')
          .select(`
              id,
              lead_id,
              starts_at,
              ends_at,
              status,
              follow_up_at,
              no_answer_count,
              follow_up_version,
              lead:leads!appointments_lead_same_clinic_fk (
                requested_service_name_snapshot,
                contact:contacts (
                  full_name,
                  phone
                )
              )
            `)
          .eq('clinic_id', clinicId.data)
          .is('archived_at', null)
          .eq('status', 'confirmed')
          .gte('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true })
          .limit(5),
        db.from('clinic_ads')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinicId.data)
          .eq('is_selectable', true)
          .eq('meta_effective_status', 'ACTIVE')
          .is('archived_at', null),
      ]);

    if ([total, fresh, follow, converted, uninterested, recent, bookings, ads]
      .some(result => result.error)) {
      throw new Error('Dashboard query failed');
    }
    const reminderNow = DateTime.now();
const reminderNowMs = reminderNow.toMillis();

const pendingQuery = () => db
  .from('appointments')
  .select(`
    id,
    lead_id,
    starts_at,
    ends_at,
    status,
    follow_up_at,
    no_answer_count,
    follow_up_version,
    lead:leads!appointments_lead_same_clinic_fk (
      requested_service_name_snapshot,
      contact:contacts (
        full_name,
        phone
      )
    )
  `)
  .eq('clinic_id', clinicId.data)
  .is('archived_at', null)
  .eq('status', 'pending')
  .order('starts_at', { ascending: true })
  .order('id', { ascending: true });

const firstPendingPage = await pendingQuery().range(0, 499);

if (firstPendingPage.error) {
  throw firstPendingPage.error;
}

const pendingBookings = [...(firstPendingPage.data ?? [])];

let offset = 500;
let lastPageSize = firstPendingPage.data?.length ?? 0;

while (lastPageSize === 500) {
  if (offset >= 10_000) {
    throw new Error('Too many pending bookings for reminders');
  }

  const page = await pendingQuery().range(offset, offset + 499);

  if (page.error) throw page.error;

  pendingBookings.push(...(page.data ?? []));
  lastPageSize = page.data?.length ?? 0;
  offset += 500;
}

const reminders = pendingBookings.map(booking => {
  const visitAt = DateTime.fromISO(booking.starts_at);
  const visitAtMs = visitAt.toMillis();

  // Initial confirmation reminder: one hour before the visit.
  // After no answer: use the follow-up time saved by the workflow.
  const callAt =
    booking.no_answer_count > 0 && booking.follow_up_at
      ? DateTime.fromISO(booking.follow_up_at)
      : visitAt.minus({ hours: 1 });

  const callAtMs = callAt.toMillis();
  const confirmationAtMs = visitAt.minus({ hours: 1 }).toMillis();

  if (
    !Number.isFinite(visitAtMs)
    || !Number.isFinite(callAtMs)
  ) {
    throw new Error('Invalid booking reminder time');
  }

  return {
    ...booking,
    next_call_at: callAt.toUTC().toISO(),
    priority_at: DateTime.fromMillis(
      Math.min(callAtMs, confirmationAtMs),
    ).toUTC().toISO(),
    visit_passed: visitAtMs <= reminderNowMs,
    follow_up_due: callAtMs <= reminderNowMs,
    confirmation_urgent:
      visitAtMs > reminderNowMs
      && confirmationAtMs <= reminderNowMs,
    follow_up_after_visit: callAtMs >= visitAtMs,
    manual_review_required: booking.no_answer_count >= 3,
  };
});

    reminders.sort((left, right) => {
      function rank(item: (typeof reminders)[number]) {
        if (item.confirmation_urgent) return 0;
        if (item.manual_review_required) return 4;
        if (item.visit_passed) return 1;
        if (item.follow_up_due) return 2;
        return 3;
      }

      const rankDifference = rank(left) - rank(right);

      if (rankDifference !== 0) {
        return rankDifference;
      }

      if (left.confirmation_urgent && right.confirmation_urgent) {
        return (
          Date.parse(left.starts_at) - Date.parse(right.starts_at)
          || left.id.localeCompare(right.id)
        );
      }

      return (
        Date.parse(left.priority_at ?? left.starts_at)
          - Date.parse(right.priority_at ?? right.starts_at)
        || Date.parse(left.starts_at) - Date.parse(right.starts_at)
        || left.id.localeCompare(right.id)
      );
    });

    res.status(200).json({
      data: {
        server_now: reminderNow.toUTC().toISO(),
        today: reminderNow.setZone('Africa/Cairo').toISODate(),
        counts: {
          total: total.count ?? 0,
          new: fresh.count ?? 0,
          follow: follow.count ?? 0,
          converted: converted.count ?? 0,
          uninterested: uninterested.count ?? 0,
          active_ads: ads.count ?? 0,
        },
        recent_leads: recent.data ?? [],
        upcoming_bookings: bookings.data ?? [],
        booking_reminders: reminders.slice(0, 20),
        booking_reminders_total: reminders.length,
      },
    });
  } catch {
    res.status(502).json({
      error: { code: 'DASHBOARD_UNAVAILABLE' },
    });
  }
});
