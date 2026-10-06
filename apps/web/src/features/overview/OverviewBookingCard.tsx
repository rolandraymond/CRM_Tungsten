import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import type { WorkspaceContext } from '../leads/types';
import BookingCalendarPage from '../booking/BookingCalendarPage';

type Relation<T> = T | T[] | null;

export type OverviewBooking = {
  id: string;
  lead_id: string;
  starts_at: string;
  ends_at: string | null;
  status: 'pending' | 'confirmed';
  follow_up_at: string | null;
  no_answer_count: number;
  follow_up_version: number;
  next_call_at?: string | null;
  priority_at?: string | null;
  lead: Relation<{
    requested_service_name_snapshot: string;
    contact: Relation<{
      full_name: string;
      phone: string;
    }>;
  }>;
};

type Action = 'confirm' | 'no_answer' | 'reschedule' | 'cancel';

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function cairoDay(value: string | number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));

  const part = (type: string) =>
    parts.find(item => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatDate(value: string | number) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  }).format(new Date(value));
}

function countdown(target: number, now: number, ar: boolean) {
  const difference = target - now;
  const seconds = Math.floor(Math.abs(difference) / 1000);

  const clock = [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map(value => String(value).padStart(2, '0'))
    .join(':');

  return {
    label: difference > 0
      ? (ar ? 'بعد' : 'In')
      : (ar ? 'متأخر' : 'Overdue'),
    clock,
  };
}

export default function OverviewBookingCard({
  booking,
  serverNow,
  onRefresh,
}: {
  booking: OverviewBooking;
  serverNow: string;
  onRefresh: () => void;
}) {
  const { token, clinic, isAdmin } =
    useOutletContext<WorkspaceContext>();

  const { i18n } = useTranslation();
  const ar = (
    i18n.resolvedLanguage ?? i18n.language
  ).startsWith('ar');

  const canManage =
    Boolean(isAdmin)
    || [
      'platform_admin',
      'clinic_manager',
      'clinic_customer_service',
      'moderator',
    ].includes(clinic.role);

  const lead = one(booking.lead);
  const contact = lead ? one(lead.contact) : null;

  const [now, setNow] = useState(() => Date.parse(serverNow));

  useEffect(() => {
    const serverTime = Date.parse(serverNow);
    const receivedAt = performance.now();

    const update = () => {
      setNow(serverTime + performance.now() - receivedAt);
    };

    update();
    const timer = window.setInterval(update, 1_000);

    return () => window.clearInterval(timer);
  }, [serverNow]);

  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [newStartsAt, setNewStartsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mustReview, setMustReview] = useState(false);
  const [calendarVersion, setCalendarVersion] = useState(0);

  const lock = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const pending = booking.status === 'pending';
  const visitAtMs = Date.parse(booking.starts_at);
  const visitToday = cairoDay(booking.starts_at) === cairoDay(now);

  const nextCallAtMs = Date.parse(
    booking.next_call_at
    ?? (
      booking.no_answer_count > 0 && booking.follow_up_at
        ? booking.follow_up_at
        : new Date(visitAtMs - 60 * 60 * 1000).toISOString()
    ),
  );

  const visitPassed = pending && visitAtMs <= now;

  const confirmationUrgent =
    pending
    && visitAtMs > now
    && visitAtMs - now <= 60 * 60 * 1000;

  const callOverdue = pending && nextCallAtMs <= now;
  const manualReview = pending && booking.no_answer_count >= 3;

  const followUpAfterVisit =
    pending
    && booking.no_answer_count > 0
    && nextCallAtMs >= visitAtMs;

  const followUpDue = booking.follow_up_at
    ? Date.parse(booking.follow_up_at) <= now
    : cairoDay(booking.starts_at) <= cairoDay(now);

  const canConfirm = pending && visitToday;

  const canNoAnswer =
    pending
    && followUpDue
    && booking.no_answer_count < 3;

  const timerText = countdown(nextCallAtMs, now, ar);

  const cardTone = manualReview
    ? 'border-neutral-800 bg-neutral-950 text-white'
    : visitPassed || confirmationUrgent || callOverdue
      ? 'border-red-200 bg-red-50/90 text-neutral-950'
      : booking.no_answer_count === 2
        ? 'border-amber-200 bg-amber-50/90 text-neutral-950'
        : 'border-black/10 bg-white/90 text-neutral-950';

  const mutedTone = manualReview
    ? 'text-neutral-300'
    : 'text-neutral-500';

  const panelTone = manualReview
    ? 'border-white/15 bg-white/5'
    : 'border-black/5 bg-white/70';

  const labels: Record<Action, string> = {
    confirm: ar ? 'تأكيد الحضور' : 'Confirm attendance',
    no_answer: ar ? 'لم يرد' : 'No answer',
    reschedule: ar ? 'تغيير المعاد' : 'Reschedule',
    cancel: ar ? 'إلغاء الحجز' : 'Cancel booking',
  };

  useEffect(() => {
    if (!action) return;

    const dialog = dialogRef.current;

    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [action]);

  function openAction(value: Action) {
    if (lock.current) return;

    setReason('');
    setNewStartsAt('');
    setMessage('');
    setMustReview(false);
    setAction(value);
  }

  function closeAction() {
    if (lock.current) return;

    setAction(null);
    setMessage('');
  }

  function errorMessage(code: string) {
    const messages: Record<string, string> = {
      BOOKING_SLOT_FULL: ar
        ? 'المعاد اكتمل. اختار معاد تاني.'
        : 'This slot is full. Choose another slot.',

      INVALID_BOOKING_SLOT: ar
        ? 'المعاد غير متاح. اختار معاد جديد.'
        : 'Invalid slot. Choose a new slot.',

      BOOKING_SLOT_INVALID: ar
        ? 'المعاد غير متاح. اختار معاد جديد.'
        : 'Invalid slot. Choose a new slot.',

      CLINIC_CLOSED: ar
        ? 'العيادة مغلقة في المعاد ده.'
        : 'The clinic is closed at this time.',

      CONFIRM_VISIT_DAY_ONLY: ar
        ? 'تأكيد الحضور متاح يوم الزيارة فقط.'
        : 'Confirm attendance on the visit date only.',

      FOLLOW_UP_NOT_DUE: ar
        ? 'موعد المتابعة لسه مجاش.'
        : 'The follow-up is not due yet.',

      MANUAL_REVIEW_REQUIRED: ar
        ? 'تم تسجيل 3 محاولات. راجع الحالة يدويًا.'
        : 'Three attempts were recorded. Review manually.',

      STALE_APPOINTMENT: ar
        ? 'الحجز اتغيّر. اقفل النافذة وراجع البيانات الجديدة.'
        : 'The booking changed. Close and review the updated data.',

      BOOKING_DISABLED: ar
        ? 'الحجز متوقف حاليًا للعيادة.'
        : 'Booking is currently disabled.',

      BOOKING_SETTINGS_REQUIRED: ar
        ? 'إعدادات مواعيد العيادة مطلوبة.'
        : 'Clinic booking settings are required.',

      INVALID_BOOKING_SETTINGS: ar
        ? 'راجع إعدادات ساعات العمل مع مدير العيادة.'
        : 'Ask the clinic manager to review working hours.',

      FORBIDDEN: ar
        ? 'الحساب غير مسموح له بالإجراء ده.'
        : 'This account cannot perform this action.',
    };

    return messages[code] ?? (
      ar
        ? 'تعذّر تنفيذ الإجراء. اقفل النافذة وراجع الحالة قبل المحاولة تاني.'
        : 'The action failed. Close and review the booking before retrying.'
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!action || lock.current || mustReview) return;

    if (!reason.trim()) {
      setMessage(
        ar ? 'اكتب تفاصيل المكالمة.' : 'Enter call details.',
      );
      return;
    }

    if (
      action === 'reschedule'
      && (
        !newStartsAt
        || !Number.isFinite(Date.parse(newStartsAt))
        || Date.parse(newStartsAt) <= now
        || Date.parse(newStartsAt) === visitAtMs
      )
    ) {
      setMessage(
        ar
          ? 'اختار معاد قادم مختلف من التقويم.'
          : 'Choose a different future calendar slot.',
      );
      return;
    }

    lock.current = true;
    setBusy(true);
    setMessage('');

    try {
      const response = await fetch(
        `/api/booking-follow-up/appointments/${booking.id}/actions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clinic_id: clinic.id,
            expected_version: booking.follow_up_version,
            action,
            reason: reason.trim(),
            ...(action === 'reschedule'
              ? { new_starts_at: newStartsAt }
              : {}),
          }),
        },
      );

      const result: unknown =
        await response.json().catch(() => null);

      if (!response.ok) {
        let code = '';

        if (
          result !== null
          && typeof result === 'object'
          && 'error' in result
          && result.error !== null
          && typeof result.error === 'object'
          && 'code' in result.error
          && typeof result.error.code === 'string'
        ) {
          code = result.error.code;
        }

        const slotError = [
          'BOOKING_SLOT_FULL',
          'INVALID_BOOKING_SLOT',
          'BOOKING_SLOT_INVALID',
          'CLINIC_CLOSED',
        ].includes(code);

        setMessage(errorMessage(code));

        if (slotError && action === 'reschedule') {
          setNewStartsAt('');
          setCalendarVersion(value => value + 1);
        } else {
          setMustReview(true);
        }

        onRefresh();
        return;
      }

      setAction(null);
      setMessage(ar ? 'تم حفظ الإجراء.' : 'Action saved.');
      onRefresh();
    } catch {
      setMustReview(true);
      setMessage(
        ar
          ? 'الاتصال انقطع ونتيجة الطلب غير مؤكدة. اقفل النافذة وراجع الحالة قبل المحاولة تاني.'
          : 'The connection failed and the outcome is uncertain. Close and review the booking before retrying.',
      );
      onRefresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <article
      className={`min-w-0 rounded-[28px] border p-4 shadow-sm transition-shadow hover:shadow-md sm:p-6 ${cardTone}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`/leads/${booking.lead_id}`}
            className="block break-words text-base font-semibold leading-relaxed hover:underline sm:text-lg"
          >
            {contact?.full_name
              ?? (ar ? 'بيانات العميل' : 'Customer details')}
          </Link>

          {lead && (
            <p className={`mt-1 text-sm ${mutedTone}`}>
              {lead.requested_service_name_snapshot}
            </p>
          )}

          {contact?.phone && (
            <a
              href={`tel:${contact.phone}`}
              dir="ltr"
              className={`mt-3 inline-flex min-h-10 items-center rounded-xl border px-3 py-2 text-sm font-medium ${panelTone}`}
            >
              {contact.phone}
            </a>
          )}
        </div>

        <span className="shrink-0 rounded-full border border-black/5 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800">
          {pending
            ? (ar ? 'بانتظار التأكيد' : 'Pending')
            : (ar ? 'مؤكد' : 'Confirmed')}
        </span>
      </div>

      <div className={`mt-4 rounded-2xl border px-4 py-3 ${panelTone}`}>
        <p className={`mb-1 text-xs ${mutedTone}`}>
          {ar ? 'موعد الزيارة' : 'Visit time'}
        </p>

        <time
          dateTime={booking.starts_at}
          className="block text-sm font-medium leading-relaxed"
          dir="ltr"
        >
          {formatDate(booking.starts_at)}
        </time>

        <p className={`mt-1 text-xs ${mutedTone}`}>
          {ar ? 'بتوقيت القاهرة' : 'Cairo time'}
        </p>
      </div>

      {pending && (
        <div className={`mt-3 grid gap-3 rounded-2xl border p-4 ${panelTone}`}>
          {manualReview ? (
            <p className="font-semibold leading-relaxed">
              {ar
                ? '3 محاولات بدون رد — مراجعة يدوية مطلوبة'
                : '3 unanswered attempts — manual review required'}
            </p>
          ) : (
            <>
              <p className={`text-sm ${mutedTone}`}>
                {booking.no_answer_count > 0
                  ? (ar ? 'مكالمة المتابعة القادمة' : 'Next follow-up call')
                  : (ar ? 'تنبيه تأكيد الحضور' : 'Confirmation reminder')}
              </p>

              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">
                  {timerText.label}
                </span>

                <span
                  className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl"
                  dir="ltr"
                >
                  {timerText.clock}
                </span>
              </div>

              <p className={`text-xs ${mutedTone}`} dir="ltr">
                {formatDate(nextCallAtMs)} — Cairo
              </p>
            </>
          )}

          {confirmationUrgent && (
            <p className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium leading-relaxed text-white">
              {ar
                ? 'الزيارة خلال ساعة — لازم تتواصل لتأكيد الحضور'
                : 'Visit within one hour — contact the customer to confirm'}
            </p>
          )}

          {visitPassed && (
            <p className="text-sm font-semibold leading-relaxed">
              {ar
                ? 'موعد الزيارة فات بدون تأكيد — راجع الحالة'
                : 'Visit time passed without confirmation — review this case'}
            </p>
          )}

          {followUpAfterVisit && (
            <p className="text-sm leading-relaxed">
              {ar
                ? 'تنبيه: موعد المتابعة المسجّل بعد موعد الزيارة.'
                : 'Warning: the scheduled follow-up is after the visit time.'}
            </p>
          )}
        </div>
      )}

      {booking.no_answer_count > 0 && (
        <p className={`mt-3 text-sm ${mutedTone}`}>
          {ar ? 'محاولات عدم الرد: ' : 'No-answer attempts: '}
          {booking.no_answer_count}
        </p>
      )}

      {canManage && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {canConfirm && (
            <button
              type="button"
              className="min-h-11 rounded-2xl bg-neutral-900 px-3 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => openAction('confirm')}
            >
              {labels.confirm}
            </button>
          )}

          {canNoAnswer && (
            <button
              type="button"
              className="min-h-11 rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => openAction('no_answer')}
            >
              {labels.no_answer}
            </button>
          )}

          <button
            type="button"
            className="min-h-11 rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => openAction('reschedule')}
          >
            {labels.reschedule}
          </button>

          <button
            type="button"
            className="min-h-11 rounded-2xl border border-red-200 bg-white px-3 py-3 text-sm font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => openAction('cancel')}
          >
            {labels.cancel}
          </button>
        </div>
      )}

      {!action && message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}

      {action && (
        <dialog
          ref={dialogRef}
          className="m-auto max-h-[90dvh] w-[calc(100%-24px)] max-w-4xl overflow-y-auto rounded-[28px] border border-neutral-200 bg-white p-4 text-neutral-950 shadow-xl backdrop:bg-black/40 sm:p-6"
          aria-labelledby={`booking-action-${booking.id}`}
          onCancel={event => {
            event.preventDefault();
            closeAction();
          }}
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2
              id={`booking-action-${booking.id}`}
              className="text-lg font-semibold sm:text-xl"
            >
              {labels[action]}
            </h2>

            <button
              type="button"
              className="control"
              disabled={busy}
              onClick={closeAction}
            >
              {ar ? 'إغلاق' : 'Close'}
            </button>
          </div>

          <p className="mb-4 break-words">
            {contact?.full_name}
          </p>

          <form className="grid gap-4" onSubmit={submit}>
            <fieldset
              disabled={busy || mustReview}
              className="grid min-w-0 gap-4"
            >
              {action === 'reschedule' && (
                <BookingCalendarPage
                  key={calendarVersion}
                  onSelect={setNewStartsAt}
                />
              )}

              <label className="grid gap-2">
                <span className="text-sm">
                  {ar ? 'تفاصيل المكالمة / السبب' : 'Call details / reason'}
                </span>

                <textarea
                  className="field"
                  required
                  maxLength={2000}
                  rows={3}
                  dir="auto"
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                />
              </label>

              <button
                type="submit"
                className="control min-h-11 justify-self-start"
                disabled={
                  busy
                  || mustReview
                  || !reason.trim()
                  || (action === 'reschedule' && !newStartsAt)
                }
              >
                {busy
                  ? (ar ? 'جاري الحفظ…' : 'Saving…')
                  : labels[action]}
              </button>
            </fieldset>

            {message && (
              <p className="text-sm text-danger" role="alert">
                {message}
              </p>
            )}
          </form>
        </dialog>
      )}
    </article>
  );
}