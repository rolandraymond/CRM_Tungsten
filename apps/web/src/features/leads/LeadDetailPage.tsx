import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGet } from '../../hooks/useGet';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import QueryState from '../../components/QueryState';
import type { Lead, WorkspaceContext } from './types';
import ChoiceSelect from '../../components/ChoiceSelect';

const liveTables = ['leads'] as const;
const statuses = [
  'new',
  'in_progress',
  'no_answer',
  'follow_up',
  'not_interested',
] as const;

type Event = {
  id: string;
  event_type: string;
  performed_by: string;
  performed_at: string;
  notes: string | null;

  changes: {
  old_status?: string;
  new_status?: string;
  starts_at?: string;
};
  actor: { full_name: string } | null;
};

export default function LeadDetailPage() {
  const { leadId } = useParams();
  const { clinic, token } = useOutletContext<WorkspaceContext>();
  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');
  const params = new URLSearchParams({ clinic_id: clinic.id });

  const lead = useGet<{ data: Lead }>(
    leadId ? `/api/leads/${leadId}?${params}` : null,
    token,
  );
  const [historyPage, setHistoryPage] = useState(1);
  const history = useGet<{
    data: Event[];
    pagination: { has_more: boolean };
  }>(
    leadId
      ? `/api/leads/${leadId}/events?${params}&page=${historyPage}&page_size=50`
      : null,
    token,
  );

  const leadRetry = lead.retry;
  const historyRetry = history.retry;
  const [status, setStatus] = useState<string>('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [bookingTime, setBookingTime] = useState('');
const [bookingReason, setBookingReason] = useState('');
const [bookingBusy, setBookingBusy] = useState(false);
const [bookingMessage, setBookingMessage] = useState('');
  const lock = useRef(false);

  const refresh = useCallback(() => {
    leadRetry();
    historyRetry();
  }, [leadRetry, historyRetry]);

  useClinicChanges(clinic.id, liveTables, refresh);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !leadId || !lead.data || !status || !reason.trim()) {
      return;
    }

    lock.current = true;
    setBusy(true);
    setMessage('');

    try {
      const response = await fetch(`/api/leads/${leadId}/status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clinic_id: clinic.id,
          expected_status: lead.data.data.status,
          new_status: status,
          reason: reason.trim(),
        }),
      });

      if (!response.ok) {
        setMessage(
          response.status === 409
            ? ar
              ? 'الحالة اتغيرت من مستخدم تاني. راجع آخر تحديث وحاول تاني.'
              : 'Someone changed this lead. Review the latest status and try again.'
            : response.status === 403
              ? ar
                ? 'مش مسموح لك تغيّر الحالة دي.'
                : 'You cannot change this lead.'
              : ar
                ? 'ما قدرناش نأكد التغيير. راجع السجل قبل ما تحاول تاني.'
                : 'Could not confirm the change. Check history before retrying.',
        );
      } else {
        setStatus('');
        setReason('');
        setMessage(
          ar ? 'تم تسجيل التغيير في السجل.' : 'Change saved in history.',
        );
      }

      lead.retry();
      history.retry();
    } catch {
      setMessage(
        ar
          ? 'ما قدرناش نأكد التغيير. راجع السجل قبل ما تحاول تاني.'
          : 'Could not confirm the change. Check history before retrying.',
      );
      lead.retry();
      history.retry();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (
    lock.current ||
    !leadId ||
    !lead.data ||
    !bookingTime ||
    !bookingReason.trim()
  ) return;

  const startsAt = new Date(bookingTime);

  if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
    setBookingMessage(ar ? 'اختار ميعاد جاي.' : 'Choose a future time.');
    return;
  }

  lock.current = true;
  setBookingBusy(true);
  setBookingMessage('');

  try {
    const response = await fetch(`/api/leads/${leadId}/booking`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clinic_id: clinic.id,
        expected_status: lead.data.data.status,
        starts_at: startsAt.toISOString(),
        reason: bookingReason.trim(),
      }),
    });

    if (response.ok) {
      setBookingTime('');
      setBookingReason('');
      setBookingMessage(
        ar
          ? 'تم تأكيد الحجز وتسجيله في السجل.'
          : 'Booking confirmed and saved in history.',
      );
    } else {
      setBookingMessage(
        response.status === 409
          ? ar
            ? 'العميل اتغير من مستخدم تاني. راجع آخر تحديث.'
            : 'Someone changed this lead. Review the latest status.'
          : ar
            ? 'ما قدرناش نأكد الحجز. راجع السجل قبل ما تحاول تاني.'
            : 'Could not confirm the booking. Check history before retrying.',
      );
    }
  } catch {
    setBookingMessage(
      ar
        ? 'ما قدرناش نأكد الحجز. راجع السجل قبل ما تحاول تاني.'
        : 'Could not confirm the booking. Check history before retrying.',
    );
  } finally {
    lead.retry();
    history.retry();
    lock.current = false;
    setBookingBusy(false);
  }
}

  const current = lead.data?.data;
  const canChange = [
    'clinic_manager',
    'clinic_customer_service',
    'doctor',
    'platform_admin',
  ].includes(clinic.role);
  const canBook = [
  'clinic_manager',
  'clinic_customer_service',
  'platform_admin',
].includes(clinic.role);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/leads" className="control inline-flex">
        {ar ? 'رجوع للـ leads' : 'Back to leads'}
      </Link>

      {lead.error ? (
        <QueryState error retry={lead.retry} />
      ) : !current ? (
        <QueryState />
      ) : (
        <>
          <section className="glass p-6">
            <h1 className="text-3xl font-semibold" dir="auto">
              {current.contact?.full_name}
            </h1>
            <p className="mt-2" dir="ltr">
              {current.contact?.phone}
            </p>
            <p className="mt-2">
              {current.requested_service_name_snapshot}
            </p>
            <p className="mt-3 font-semibold">
              {ar ? 'الحالة الحالية:' : 'Current status:'}{' '}
              {current.status.replaceAll('_', ' ')}
            </p>
          </section>

          {canChange && current.status !== 'converted' && (
            <form className="glass grid gap-4 p-6" onSubmit={submit}>
              <h2 className="text-xl font-semibold">
                {ar ? 'تغيير حالة الـ lead' : 'Change lead status'}
              </h2>

            <ChoiceSelect
            label={ar ? 'الحالة الجديدة' : 'New status'}
            placeholder={ar ? 'اختار الحالة' : 'Select status'}
            value={status}
            disabled={busy}
            onChange={setStatus}
            options={statuses
                .filter(item => item !== current.status)
                .map(item => ({
                value: item,
                label: ({
                    new: ar ? 'جديد' : 'New',
                    in_progress: ar ? 'جاري المتابعة' : 'In progress',
                    no_answer: ar ? 'لم يرد' : 'No answer',
                    follow_up: ar ? 'متابعة لاحقًا' : 'Follow up',
                    not_interested: ar ? 'غير مهتم' : 'Not interested',
                })[item],
                }))}
            />

              <label className="grid gap-2">
                {ar ? 'سبب التغيير' : 'Reason for change'}
                <textarea
                  className="field"
                  required
                  maxLength={2000}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>

              <button className="control justify-center" disabled={busy}>
                {ar ? 'احفظ في السجل' : 'Save to history'}
              </button>
            </form>
          )}


        </>

        
      )}
{current && canBook && current.status !== 'converted' && (  
    <form className="glass grid gap-4 p-6" onSubmit={submitBooking}>
    <h2 className="text-xl font-semibold">
      {ar ? 'تأكيد حجز حقيقي' : 'Confirm booking'}
    </h2>

    <label className="grid gap-2">
      {ar ? 'ميعاد الحجز' : 'Booking time'}
      <input
        className="field"
        type="datetime-local"
        required
        value={bookingTime}
        disabled={bookingBusy}
        onChange={event => setBookingTime(event.target.value)}
      />
    </label>

    <label className="grid gap-2">
      {ar ? 'تفاصيل الحجز' : 'Booking details'}
      <textarea
        className="field"
        required
        maxLength={2000}
        value={bookingReason}
        disabled={bookingBusy}
        onChange={event => setBookingReason(event.target.value)}
      />
    </label>

    <button
      className="control justify-center"
      disabled={bookingBusy || busy}
            >
            {ar ? 'أكد الحجز' : 'Confirm booking'}
            </button>
        </form>
        )}

        

        {bookingMessage && (
        <p role="status" className="glass p-4">
            {bookingMessage}
        </p>
        )}

        {message && (
            <p role="status" className="glass p-4">
              {message}
            </p>
        )}
      <section className="glass p-6">
        <h2 className="mb-5 text-xl font-semibold">
          {ar ? 'سجل التغييرات' : 'History'}
        </h2>

        {history.error ? (
          <QueryState error retry={history.retry} />
        ) : !history.data ? (
          <QueryState />
        ) : history.data.data.length === 0 ? (
          <p>{ar ? 'لسه مفيش أحداث.' : 'No events yet.'}</p>
        ) : (
          <ol className="space-y-3">
            {history.data.data.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-line p-4"
              >
                <p className="font-semibold">
                  {item.event_type === 'status_changed'
                    ? `${item.changes.old_status} → ${item.changes.new_status}`
                    : item.event_type.replaceAll('_', ' ')}
                </p>
                {item.changes.starts_at && (
                <p className="mt-2 text-sm">
                    {ar ? 'ميعاد الحجز:' : 'Booking time:'}{' '}
                    {new Date(item.changes.starts_at).toLocaleString(
                    ar ? 'ar-EG' : 'en-GB',
                    )}
                </p>
                )}
                {item.notes && (
                  <p className="mt-2 whitespace-pre-wrap" dir="auto">
                    {item.notes}
                  </p>
                )}
                <p className="mt-2 text-sm text-muted">
                  {item.actor?.full_name ?? item.performed_by} ·{' '}
                  {new Date(item.performed_at).toLocaleString(
                    ar ? 'ar-EG' : 'en-GB',
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}

        {history.data && (
          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              className="control"
              disabled={historyPage === 1}
              onClick={() => setHistoryPage((value) => value - 1)}
            >
              {ar ? 'الأحدث' : 'Newer'}
            </button>
            <span>{historyPage}</span>
            <button
              type="button"
              className="control"
              disabled={!history.data.pagination.has_more}
              onClick={() => setHistoryPage((value) => value + 1)}
            >
              {ar ? 'الأقدم' : 'Older'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}