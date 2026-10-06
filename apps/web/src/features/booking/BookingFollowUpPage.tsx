import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { canCreateLeads } from '../leads/types';
import type { WorkspaceContext } from '../leads/types';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import BookingCalendarPage from './BookingCalendarPage';

type Lane =
  | 'new'
  | 'today'
  | 'follow_up_1'
  | 'follow_up_2'
  | 'follow_up_3'
  | 'confirmed'
  | 'inquiries'
  | 'cancelled';

type Action =
  | 'confirm'
  | 'no_answer'
  | 'reschedule'
  | 'cancel'
  | 'schedule'
  | 'not_interested';

type Relation<T> = T | T[] | null;

type Contact = {
  full_name: string;
  phone: string;
};

type BoardResponse = {
  data: {
    lane: Lane;
    today: string;
    server_now: string;
    appointments: Appointment[];
    inquiries: Inquiry[];
  };
  pagination: {
    page: number;
    page_size: number;
    appointments_has_more: boolean;
    inquiries_has_more: boolean;
  };
};

type Target = {
  kind: 'appointment' | 'inquiry';
  id: string;
  version: number;
  name: string;
  action: Action;
};

const lanes: Lane[] = [
  'new',
  'today',
  'follow_up_1',
  'follow_up_2',
  'follow_up_3',
  'confirmed',
  'inquiries',
  'cancelled',
];

const liveTables = ['appointments', 'leads'] as const;

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function text(ar: boolean, arabic: string, english: string) {
  return ar ? arabic : english;
}

function formatTime(value: string | null, ar: boolean) {
  if (!value) return text(ar, 'غير محدد', 'Not set');

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';

  return new Intl.DateTimeFormat(ar ? 'ar-EG' : 'en-US', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function cairoDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const part = (type: string) =>
    parts.find(item => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function actionLabel(action: Action, ar: boolean) {
  const labels: Record<Action, [string, string]> = {
    confirm: ['تأكيد الحضور', 'Confirm attendance'],
    no_answer: ['لم يرد', 'No answer'],
    reschedule: ['تغيير الموعد', 'Reschedule'],
    cancel: ['إلغاء الحجز', 'Cancel booking'],
    schedule: ['موعد متابعة', 'Schedule follow-up'],
    not_interested: ['غير مهتم', 'Not interested'],
  };

  return labels[action][ar ? 0 : 1];
}

function errorMessage(code: string, ar: boolean) {
  const messages: Record<string, [string, string]> = {
    STALE_APPOINTMENT: [
      'الحجز اتعدل. اقفل النافذة وراجع أحدث بيانات.',
      'This booking changed. Close this window and review the latest data.',
    ],
    STALE_LEAD: [
      'العميل اتعدل. اقفل النافذة وراجع أحدث بيانات.',
      'This inquiry changed. Close this window and review the latest data.',
    ],
    BOOKING_SLOT_FULL: [
      'الموعد اكتمل. اختار موعد تاني.',
      'This slot is full. Choose another time.',
    ],
    INVALID_BOOKING_SLOT: [
      'اختار موعد متاح من التقويم.',
      'Choose an available calendar slot.',
    ],
    CLINIC_CLOSED: [
      'العيادة مغلقة في الموعد المختار.',
      'The clinic is closed at the selected time.',
    ],
    CONFIRM_VISIT_DAY_ONLY: [
      'تأكيد الحضور متاح يوم الزيارة فقط.',
      'Attendance can only be confirmed on the visit date.',
    ],
    FOLLOW_UP_NOT_DUE: [
      'موعد الاتصال القادم لسه مجاش.',
      'The next follow-up is not due yet.',
    ],
    MANUAL_REVIEW_REQUIRED: [
      'تم تسجيل ٣ محاولات. الحالة محتاجة مراجعة.',
      'Three attempts have been recorded. Manual review is required.',
    ],
    BOOKING_DISABLED: [
      'الحجز متوقف في إعدادات العيادة.',
      'Booking is disabled in clinic settings.',
    ],
    BOOKING_SETTINGS_REQUIRED: [
      'اضبط إعدادات مواعيد العيادة الأول.',
      'Configure clinic booking settings first.',
    ],
    INVALID_BOOKING_SETTINGS: [
      'راجع إعدادات مواعيد العيادة.',
      'Review the clinic booking settings.',
    ],
    FORBIDDEN: [
      'حسابك مش مسموح له بالإجراء ده.',
      'Your account cannot perform this action.',
    ],
    APPOINTMENT_NOT_ACTIONABLE: [
      'حالة الحجز لا تسمح بالإجراء. راجع أحدث بيانات.',
      'The booking status does not allow this action. Review the latest data.',
    ],
    INQUIRY_NOT_ACTIONABLE: [
      'حالة العميل اتغيرت أو أصبح له حجز.',
      'This inquiry changed or already has a booking.',
    ],
    VALIDATION_ERROR: [
      'راجع البيانات المطلوبة.',
      'Check the required fields.',
    ],
    INVALID_FOLLOW_UP_ACTION: [
      'راجع الموعد والبيانات المطلوبة.',
      'Check the time and required fields.',
    ],
  };

  return messages[code]?.[ar ? 0 : 1] ?? text(
    ar,
    'تعذر تأكيد النتيجة. راجع البيانات والسجل قبل المحاولة.',
    'Could not confirm the result. Review the data and history before retrying.',
  );
}
type Inquiry = {
  id: string;
  status: string;
  source: string | null;
  created_at: string;
  requested_service_name_snapshot: string;
  next_follow_up_at: string | null;
  last_contact_at: string | null;
  no_answer_count: number;
  follow_up_version: number;
  contact: Relation<Contact>;
};

type Appointment = {
  id: string;
  lead_id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  follow_up_at: string | null;
  last_contact_at: string | null;
  no_answer_count: number;
  follow_up_version: number;
  lead: Relation<{
    id: string;
    status: string;
    source: string | null;
    created_at: string;
    requested_service_name_snapshot: string;
    contact: Relation<Contact>;
  }>;
};
function responseCode(value: unknown): string {
  if (!value || typeof value !== 'object' || !('error' in value)) {
    return '';
  }

  const error = value.error;

  if (!error || typeof error !== 'object' || !('code' in error)) {
    return '';
  }

  return typeof error.code === 'string' ? error.code : '';
}

function ActionDialog({
  target,
  ar,
  clinicId,
  token,
  onClose,
  onRefresh,
  onSaved,
}: {
  target: Target;
  ar: boolean;
  clinicId: string;
  token: string;
  onClose: () => void;
  onRefresh: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [reason, setReason] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mustReview, setMustReview] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (lock.current || mustReview || !reason.trim()) return;

    const body: Record<string, unknown> = {
      clinic_id: clinicId,
      expected_version: target.version,
      action: target.action,
      reason: reason.trim(),
    };

    if (target.action === 'reschedule') {
      const selected = new Date(startsAt);

      if (
        !startsAt
        || !Number.isFinite(selected.getTime())
        || selected.getTime() <= Date.now()
      ) {
        setError(text(
          ar,
          'اختار موعد زيارة قادم من التقويم.',
          'Choose a future visit time from the calendar.',
        ));
        return;
      }

      body.new_starts_at = selected.toISOString();
    }

    if (target.action === 'schedule') {
      const selected = new Date(followUp);

      if (
        !followUp
        || !Number.isFinite(selected.getTime())
        || selected.getTime() <= Date.now()
      ) {
        setError(text(
          ar,
          'اختار وقت متابعة قادم.',
          'Choose a future follow-up time.',
        ));
        return;
      }

      body.next_follow_up_at = selected.toISOString();
    }

    lock.current = true;
    setBusy(true);
    setError('');

    const resource = target.kind === 'appointment'
      ? 'appointments'
      : 'inquiries';

    try {
      const response = await fetch(
        `/api/booking-follow-up/${resource}/${target.id}/actions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      const result: unknown = await response.json().catch(() => null);

      if (response.ok) {
        if (
          !result
          || typeof result !== 'object'
          || !('data' in result)
          || !result.data
        ) {
          setError(errorMessage('', ar));
          setMustReview(true);
          onRefresh();
          return;
        }

        onSaved();
        return;
      }

      const code = responseCode(result);
      setError(errorMessage(code, ar));
      onRefresh();

      if (
        target.action === 'reschedule'
        && ['BOOKING_SLOT_FULL', 'INVALID_BOOKING_SLOT', 'CLINIC_CLOSED']
          .includes(code)
      ) {
        setStartsAt('');
        setCalendarVersion(value => value + 1);
      } else if (
        response.status === 409
        || response.status >= 500
        || response.status === 404
        || ['APPOINTMENT_NOT_ACTIONABLE', 'INQUIRY_NOT_ACTIONABLE']
          .includes(code)
      ) {
        setMustReview(true);
      }
    } catch {
      setError(errorMessage('', ar));
      setMustReview(true);
      onRefresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      dir={ar ? 'rtl' : 'ltr'}
      aria-labelledby="follow-up-dialog-title"
      onCancel={event => {
        event.preventDefault();
        if (!lock.current) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-24px)] max-w-3xl overflow-y-auto rounded-3xl border-0 bg-white p-5 text-black shadow-xl backdrop:bg-black/40 sm:p-7"
    >
      <form onSubmit={submit} className="grid gap-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="follow-up-dialog-title" className="text-xl font-semibold">
              {actionLabel(target.action, ar)}
            </h2>
            <p className="mt-1 text-sm text-black/55">{target.name}</p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-11 rounded-full bg-black/5 px-4 text-sm"
          >
            {text(ar, 'إغلاق', 'Close')}
          </button>
        </div>

        {target.action === 'reschedule' && (
          <fieldset disabled={busy || mustReview} className="min-w-0">
            <BookingCalendarPage
              key={calendarVersion}
              onSelect={setStartsAt}
            />
          </fieldset>
        )}

        {target.action === 'schedule' && (
          <label className="grid gap-2 text-sm">
            {text(ar, 'موعد الاتصال القادم', 'Next call time')}
            <input
              type="datetime-local"
              className="field"
              value={followUp}
              onChange={event => setFollowUp(event.target.value)}
              required
              disabled={busy || mustReview}
            />
            <span className="text-xs text-black/50">
              {text(ar, 'الإدخال بتوقيت جهازك: ', 'Enter your device time: ')}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
          </label>
        )}

        <label className="grid gap-2 text-sm">
          {text(ar, 'تفاصيل المكالمة / سبب الإجراء', 'Call details / reason')}
          <textarea
            className="field"
            value={reason}
            onChange={event => setReason(event.target.value)}
            required
            maxLength={2000}
            rows={3}
            disabled={busy || mustReview}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={
            busy
            || mustReview
            || !reason.trim()
            || (target.action === 'reschedule' && !startsAt)
            || (target.action === 'schedule' && !followUp)
          }
          className="min-h-12 rounded-2xl bg-black px-5 text-sm text-white disabled:opacity-40"
        >
          {busy
            ? text(ar, 'جاري الحفظ…', 'Saving…')
            : text(ar, 'حفظ الإجراء', 'Save action')}
        </button>
        
      
      </form>
    </dialog>
  );
}

function LaneColumn({
  lane,
  title,
  ar,
  clinicId,
  token,
  revision,
  now,
  onAction,
}: {
  lane: Lane;
  title: string;
  ar: boolean;
  clinicId: string;
  token: string;
  revision: number;
  now: number;
  onAction: (target: Target) => void;
}) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    response: BoardResponse;
    receivedAt: number;
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const key = JSON.stringify([
    clinicId, token, lane, page, revision, attempt,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const params = new URLSearchParams({
          clinic_id: clinicId,
          lane,
          page: String(page),
          page_size: '10',
        });

        const response = await fetch(
          `/api/booking-follow-up-board?${params}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );

        if (!response.ok) throw new Error('Board fetch failed');

        const body = await response.json() as BoardResponse;

        if (
          !Array.isArray(body.data?.appointments)
          || !Array.isArray(body.data?.inquiries)
          || !body.pagination
          || !Number.isFinite(Date.parse(body.data.server_now))
        ) {
          throw new Error('Invalid board response');
        }

        if (!controller.signal.aborted) {
          setResult({
            key,
            response: body,
            receivedAt: Date.now(),
          });
          setFailedKey(null);
        }
      } catch {
        if (!controller.signal.aborted) setFailedKey(key);
      }
    }

    void load();
    return () => controller.abort();
  }, [clinicId, token, lane, page, key]);

  const current = result?.key === key ? result : null;
  const response = current?.response;
  const error = failedKey === key;

  const serverNow = current
    ? Date.parse(current.response.data.server_now)
      + Math.max(0, now - current.receivedAt)
    : now;

  const today = cairoDate(new Date(serverNow).toISOString());

  function urgency(item: Appointment) {
    const visit = Date.parse(item.starts_at);

    return (
      item.status === 'pending'
      && visit > serverNow
      && visit - serverNow <= 3_600_000
    );
  }

  const appointments = [...(response?.data.appointments ?? [])]
    .sort((left, right) =>
      Number(urgency(right)) - Number(urgency(left))
      || Date.parse(left.starts_at) - Date.parse(right.starts_at)
      || left.id.localeCompare(right.id),
    );

  const inquiries = response?.data.inquiries ?? [];

  function buttons(
    target: Omit<Target, 'action'>,
    actions: Action[],
  ) {
    if (!actions.length) return null;

    return (
      <div className="mt-4 grid grid-cols-2 gap-2">
        {actions.map(action => (
          <button
            key={action}
            type="button"
            onClick={() => onAction({ ...target, action })}
            className={
              `min-h-11 rounded-xl border px-2 py-2 text-xs transition hover:opacity-75 ${
                action === 'confirm'
                  ? 'border-neutral-800 bg-neutral-800 text-white'
                  : 'border-current/20'
              }`
            }
          >
            {actionLabel(action, ar)}
          </button>
        ))}
      </div>
    );
  }

  function cardStyle(count: number, urgent = false) {
    if (count >= 3) return 'border-neutral-800 bg-neutral-950 text-white';
    if (urgent) return 'border-red-200 bg-red-50 text-neutral-950';
    if (count === 2) return 'border-amber-200 bg-amber-50 text-neutral-950';
    return 'border-black/10 bg-white text-neutral-950';
  }

  function contactDetails(
    name: string,
    phone: string | undefined,
    leadId: string,
    service: string | undefined,
  ) {
    return (
      <>
        <Link
          to={`/leads/${leadId}`}
          className="block break-words text-sm font-semibold hover:underline"
        >
          {name}
        </Link>

        {phone && (
          <a
            href={`tel:${phone}`}
            dir="ltr"
            className="mt-2 inline-flex min-h-11 max-w-full items-center rounded-xl border border-current/15 px-3 text-xs"
          >
            {phone}
          </a>
        )}

        <p className="mt-2 break-words text-xs opacity-65">{service}</p>
      </>
    );
  }

  return (
    <section className="max-h-[70dvh] min-w-0 overflow-y-auto rounded-2xl bg-white/60 p-3">
      <h2 className="sticky top-0 z-10 mb-3 rounded-xl bg-neutral-100 px-3 py-3 text-sm font-semibold">
        {title}
      </h2>

      {error ? (
        <div role="alert" className="rounded-2xl bg-white p-4 text-sm">
          <p>{text(ar, 'تعذر تحميل القائمة.', 'Could not load this list.')}</p>
          <button
            type="button"
            onClick={() => setAttempt(value => value + 1)}
            className="mt-3 min-h-11 underline"
          >
            {text(ar, 'إعادة المحاولة', 'Retry')}
          </button>
        </div>
      ) : !response ? (
        <p role="status" className="rounded-2xl bg-white/70 p-4 text-sm">
          {text(ar, 'جاري التحميل…', 'Loading…')}
        </p>
      ) : (
        <div className="grid gap-3">
          {appointments.map(item => {
            const lead = one(item.lead);
            const contact = lead ? one(lead.contact) : null;
            const name = contact?.full_name ?? text(ar, 'عميل', 'Client');
            const urgent = urgency(item);

            const due = item.follow_up_at
              ? Date.parse(item.follow_up_at) <= serverNow
              : cairoDate(item.starts_at) <= today;

            const actions: Action[] = [];

            if (item.status === 'pending') {
              if (cairoDate(item.starts_at) === today) {
                actions.push('confirm');
              }
              if (due && item.no_answer_count < 3) {
                actions.push('no_answer');
              }
            }

            if (['pending', 'confirmed'].includes(item.status)) {
              actions.push('reschedule', 'cancel');
            }

            return (
              <article
                key={item.id}
                className={
                  `min-w-0 rounded-3xl border p-4 shadow-sm ${
                    cardStyle(item.no_answer_count, urgent)
                  }`
                }
              >
                {contactDetails(
                  name,
                  contact?.phone,
                  item.lead_id,
                  lead?.requested_service_name_snapshot,
                )}
                <div className="mt-3 grid gap-2 text-xs">
                  <p className="break-words">
                    {text(ar, 'المصدر: ', 'Source: ')}
                    {lead?.source || '—'}
                  </p>

                  <p>
                    {text(ar, 'تاريخ الإضافة: ', 'Created: ')}
                    {lead?.created_at ? formatTime(lead.created_at, ar) : '—'}
                  </p>

                  <p>
                    {text(ar, 'آخر تواصل مسجل: ', 'Last recorded contact: ')}
                    {item.last_contact_at
                      ? formatTime(item.last_contact_at, ar)
                      : '—'}
                  </p>
                </div>

                <span className="mt-3 inline-block rounded-full border border-current/15 px-2 py-1 text-[11px]">
                  {item.status}
                </span>

                <p className="mt-3 text-xs">
                  {text(ar, 'الزيارة: ', 'Visit: ')}
                  {formatTime(item.starts_at, ar)}
                </p>

                {urgent && (
                  <p className="mt-3 rounded-xl bg-red-600 p-3 text-xs text-white">
                    {text(
                      ar,
                      'الزيارة خلال ساعة — اتصل لتأكيد الحضور',
                      'Visit within one hour — contact the customer to confirm',
                    )}
                  </p>
                )}

                {item.status === 'pending' && item.no_answer_count > 0 && (
                  <p className="mt-2 text-xs">
                    {text(ar, 'الاتصال القادم: ', 'Next call: ')}
                    {formatTime(item.follow_up_at, ar)}
                  </p>
                )}

                {item.no_answer_count > 0 && (
                  <p className="mt-2 text-xs opacity-75">
                    {text(ar, 'محاولات بدون رد: ', 'Unanswered attempts: ')}
                    {item.no_answer_count}
                    {item.no_answer_count >= 3 && text(
                      ar,
                      ' — محتاج مراجعة',
                      ' — review required',
                    )}
                  </p>
                )}

                {buttons({
                  kind: 'appointment',
                  id: item.id,
                  version: item.follow_up_version,
                  name,
                }, actions)}
              </article>
            );
          })}

          {inquiries.map(item => {
            const contact = one(item.contact);
            const name = contact?.full_name ?? text(ar, 'عميل', 'Client');
            const due = !item.next_follow_up_at
              || Date.parse(item.next_follow_up_at) <= serverNow;

            const actions: Action[] = ['schedule', 'not_interested'];

            if (due && item.no_answer_count < 3) {
              actions.unshift('no_answer');
            }

            return (
              <article
                key={item.id}
                className={
                  `min-w-0 rounded-3xl border p-4 shadow-sm ${
                    cardStyle(item.no_answer_count)
                  }`
                }
              >
                {contactDetails(
                  name,
                  contact?.phone,
                  item.id,
                  item.requested_service_name_snapshot,
                )}
                <div className="mt-3 grid gap-2 text-xs">
                 
                      <p className="break-words">
                        {text(ar, 'الحالة: ', 'Status: ')}
                        {item.status.replace(/_/g, ' ')}
                      </p>

                      <p className="break-words">
                        {text(ar, 'المصدر: ', 'Source: ')}
                        {item.source || '—'}
                      </p>

                      <p>
                        {text(ar, 'تاريخ الإضافة: ', 'Created: ')}
                        {item.created_at ? formatTime(item.created_at, ar) : '—'}
                      </p>

                      <p>
                        {text(ar, 'آخر تواصل مسجل: ', 'Last recorded contact: ')}
                        {item.last_contact_at
                          ? formatTime(item.last_contact_at, ar)
                          : '—'}
                      </p>
                    </div>
                    
                <p className="mt-3 text-xs">
                  {text(ar, 'بدون حجز', 'No booking')}
                </p>

                {item.next_follow_up_at && (
                  <p className="mt-2 text-xs">
                    {text(ar, 'المتابعة: ', 'Follow-up: ')}
                    {formatTime(item.next_follow_up_at, ar)}
                  </p>
                )}

                {item.no_answer_count > 0 && (
                  <p className="mt-2 text-xs opacity-75">
                    {text(ar, 'محاولات بدون رد: ', 'Unanswered attempts: ')}
                    {item.no_answer_count}
                    {item.no_answer_count >= 3 && text(
                      ar,
                      ' — محتاج مراجعة',
                      ' — review required',
                    )}
                  </p>
                )}

                <Link
                  to={`/leads/${item.id}`}
                  className="mt-3 inline-flex min-h-11 items-center text-xs underline"
                >
                  {text(ar, 'البيانات والحجز والسجل', 'Details, booking and history')}
                </Link>

                {buttons({
                  kind: 'inquiry',
                  id: item.id,
                  version: item.follow_up_version,
                  name,
                }, actions)}
              </article>
            );
          })}

          {!appointments.length && !inquiries.length && (
            <p className="rounded-2xl bg-white/60 p-5 text-xs text-black/50">
              {text(ar, 'مفيش نتائج في الصفحة دي.', 'No results on this page.')}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => setPage(value => value - 1)}
          className="min-h-11 rounded-xl bg-white px-3 disabled:opacity-35"
        >
          {text(ar, 'السابق', 'Previous')}
        </button>

        <span>{page}</span>

        <button
          type="button"
          disabled={
            error
            || !response
            || !(
              response.pagination.appointments_has_more
              || response.pagination.inquiries_has_more
            )
          }
          onClick={() => setPage(value => value + 1)}
          className="min-h-11 rounded-xl bg-white px-3 disabled:opacity-35"
        >
          {text(ar, 'التالي', 'Next')}
        </button>
      </div>
    </section>
  );
}

export default function BookingFollowUpPage() {
  const { clinic, token, isAdmin } = useOutletContext<WorkspaceContext>();
  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');

  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [target, setTarget] = useState<Target | null>(null);
  const [message, setMessage] = useState('');
  const [selectedLane, setSelectedLane] = useState<Lane>('today');

  const refresh = useCallback(() => {
    setRevision(value => value + 1);
  }, []);

  useClinicChanges(clinic.id, liveTables, refresh);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const day = cairoDate(new Date(now).toISOString());
  const previousDay = useRef(day);

  useEffect(() => {
    if (previousDay.current !== day) {
      previousDay.current = day;
      refresh();
    }
  }, [day, refresh]);

  const canManage = isAdmin === true || [
    'platform_admin',
    'clinic_manager',
    'clinic_customer_service',
    'moderator',
  ].includes(clinic.role);

  const titles: Record<Lane, string> = {
    new: text(ar, 'جديد', 'New'),
    today: text(ar, 'حجوزات اليوم — للتأكيد', 'Pending today'),
    follow_up_1: text(ar, 'متابعة ١', 'Follow-up 1'),
    follow_up_2: text(ar, 'متابعة ٢', 'Follow-up 2'),
    follow_up_3: text(ar, 'متابعة ٣ — مراجعة', 'Follow-up 3 — review'),
    confirmed: text(ar, 'مؤكد اليوم', 'Confirmed today'),
    inquiries: text(ar, 'استفسارات أخرى', 'Other inquiries'),
    cancelled: text(ar, 'أُلغيت اليوم', 'Cancelled today'),
  };

  if (!canManage) {
    return (
      <p className="glass p-5">
        {text(ar, 'حسابك مش مسموح له بصفحة المتابعة.', 'You cannot access this page.')}
      </p>
    );
  }

  return (
    <section dir={ar ? 'rtl' : 'ltr'} className="min-w-0">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {text(ar, 'العملاء والحجوزات', 'Leads and bookings')}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {clinic.name} · {text(
              ar,
              'المواعيد بتوقيت القاهرة',
              'Times shown in Cairo time',
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(isAdmin || canCreateLeads(clinic.role)) && (
            <Link
              to="/leads/new"
              className="control bg-black! text-white!"
            >
              {text(ar, '+ إضافة عميل', '+ Create lead')}
            </Link>
          )}

          <Link to="/booking/calendar" className="control">
            {text(ar, 'التقويم', 'Calendar')}
          </Link>


        </div>
      </header>

      {message && (
        <p role="status" className="glass mb-4 p-4 text-sm">{message}</p>
      )}

      <div className="mb-4 md:hidden">
        <label
          htmlFor="lead-board-column"
          className="mb-2 block text-sm font-medium"
        >
          {text(ar, 'القائمة', 'Column')}
        </label>

        <select
          id="lead-board-column"
          value={selectedLane}
          onChange={event => setSelectedLane(event.target.value as Lane)}
          className="min-h-12 w-full rounded-2xl border border-line bg-surface px-4 text-ink"
        >
          {lanes.map(lane => (
            <option key={lane} value={lane}>{titles[lane]}</option>
          ))}
        </select>
      </div>

      <div className="max-w-full overflow-x-auto rounded-3xl bg-neutral-100 p-3 text-neutral-950">
        <div className="flex items-start gap-4">
          {lanes.map(lane => (
            <div
              key={`${clinic.id}:${lane}`}
              className={
                `min-w-0 w-full shrink-0 md:block md:w-80 ${
                  selectedLane === lane ? 'block' : 'hidden'
                }`
              }
            >
              <LaneColumn
                lane={lane}
                title={titles[lane]}
                ar={ar}
                clinicId={clinic.id}
                token={token}
                revision={revision}
                now={now}
                onAction={item => {
                  setMessage('');
                  setTarget(item);
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {target && (
        <ActionDialog
          key={`${target.kind}:${target.id}:${target.action}`}
          target={target}
          ar={ar}
          clinicId={clinic.id}
          token={token}
          onClose={() => setTarget(null)}
          onRefresh={refresh}
          onSaved={() => {
            setTarget(null);
            setMessage(text(
              ar,
              'تم حفظ الإجراء في السجل.',
              'Action saved in history.',
            ));
            refresh();
          }}
        />
      )}
    </section>
  );
}