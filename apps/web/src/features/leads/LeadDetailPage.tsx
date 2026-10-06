import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGet } from '../../hooks/useGet';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import QueryState from '../../components/QueryState';
import type { Lead, WorkspaceContext } from './types';
import ChoiceSelect from '../../components/ChoiceSelect';
import BookingCalendarPage from '../booking/BookingCalendarPage';


const liveTables = ['leads'] as const;
const statuses = ['new', 'in_progress'] as const;

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
  const { clinic, token, isAdmin } = useOutletContext<WorkspaceContext>();
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
const [bookingCalendarVersion, setBookingCalendarVersion] = useState(0);
  const lock = useRef(false);

  const [note, setNote] = useState('');
const [noteBusy, setNoteBusy] = useState(false);
const [noteMessage, setNoteMessage] = useState('');

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
  ) {
    return;
  }

const startsAt = new Date(bookingTime);

if (
  Number.isNaN(startsAt.getTime())
  || startsAt <= new Date()
) {
  setBookingMessage(
    ar
      ? 'اختار معاد قادم من التقويم.'
      : 'Choose a future calendar slot.',
  );
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
  setBookingCalendarVersion(value => value + 1);

  setBookingMessage(
    ar
      ? 'تم إنشاء الحجز. تأكيد الحضور يتم يوم الزيارة من متابعة العملاء.'
      : 'Booking created. Confirm attendance on the visit date from Customer follow-up.',
  );

  return;
}

    const payload: unknown = await response.json().catch(() => null);

    const errorObject =
      payload && typeof payload === 'object' && 'error' in payload
        ? payload.error
        : null;

    const code =
      errorObject &&
      typeof errorObject === 'object' &&
      'code' in errorObject &&
      typeof errorObject.code === 'string'
        ? errorObject.code
        : '';

    const messages: Record<string, string> = {
      BOOKING_SLOT_FULL: ar
        ? 'المعاد اكتمل. اختار معاد تاني من التقويم.'
        : 'This slot is full. Choose another time.',

      BOOKING_SETTINGS_REQUIRED: ar
        ? 'مدير العيادة لازم يضبط إعدادات المواعيد الأول.'
        : 'The clinic manager must configure booking settings first.',

      BOOKING_DISABLED: ar
        ? 'الحجز متوقف حاليًا في العيادة.'
        : 'Booking is currently disabled for this clinic.',

      CLINIC_CLOSED: ar
        ? 'العيادة مغلقة في المعاد ده. اختار معاد تاني.'
        : 'The clinic is closed at this time. Choose another slot.',

      INVALID_BOOKING_SLOT: ar
        ? 'المعاد مش مطابق لإعدادات العيادة. اختار من التقويم تاني.'
        : 'This time does not match the clinic schedule. Select another slot.',

      INVALID_BOOKING_SETTINGS: ar
        ? 'إعدادات المواعيد محتاجة مراجعة من مدير العيادة.'
        : 'The clinic manager needs to review the booking settings.',

      STALE_LEAD: ar
        ? 'بيانات العميل اتغيرت. راجع آخر حالة قبل الحجز.'
        : 'This lead has changed. Review the latest status before booking.',

      FORBIDDEN: ar
        ? 'حسابك مش مسموح له ينشئ الحجز ده.'
        : 'Your account cannot create this booking.',
    };

    setBookingMessage(
      messages[code] ??
        (ar
          ? 'ما قدرناش نأكد الحجز. راجع السجل قبل ما تحاول تاني.'
          : 'Could not confirm the booking. Check history before retrying.'),
    );

    if (
      [
        'BOOKING_SLOT_FULL',
        'BOOKING_SETTINGS_REQUIRED',
        'BOOKING_DISABLED',
        'CLINIC_CLOSED',
        'INVALID_BOOKING_SLOT',
        'INVALID_BOOKING_SETTINGS',
      ].includes(code)
    ) {
      setBookingTime('');
      setBookingCalendarVersion(value => value + 1);
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

async function submitNote(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  const value = note.trim();

  if (lock.current || !leadId || !lead.data || !value) {
    return;
  }

  lock.current = true;
  setNoteBusy(true);
  setNoteMessage('');

  try {
    const response = await fetch(`/api/leads/${leadId}/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clinic_id: clinic.id,
        note: value,
      }),
    });

    if (response.status === 201) {
      setNote('');
      setNoteMessage(
        ar ? 'تم حفظ الملاحظة في السجل.' : 'Note saved in history.',
      );

      setHistoryPage(1);
      history.retry();
      return;
    }

    setNoteMessage(
      response.status === 403
        ? ar
          ? 'حسابك غير مسموح له بإضافة ملاحظات لهذا العميل.'
          : 'Your account cannot add notes to this lead.'
        : response.status === 400
          ? ar
            ? 'راجع الملاحظة وبيانات العميل.'
            : 'Check the note and lead details.'
          : ar
            ? 'تعذر تأكيد الحفظ. راجع السجل قبل إعادة الإرسال.'
            : 'Could not confirm saving. Check history before submitting again.',
    );

    history.retry();
  } catch {
    setNoteMessage(
      ar
        ? 'تعذر تأكيد الحفظ. راجع السجل قبل إعادة الإرسال.'
        : 'Could not confirm saving. Check history before submitting again.',
    );

    history.retry();
  } finally {
    lock.current = false;
    setNoteBusy(false);
  }
}

const current = lead.data?.data;
const canChange = isAdmin === true || [
  'clinic_manager',
  'clinic_customer_service',
  'moderator',
  'doctor',
  'platform_admin',
].includes(clinic.role);

const canBook = isAdmin === true || [
  'clinic_manager',
  'clinic_customer_service',
  'moderator',
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

{current && canChange && (
  <form
    className="glass min-w-0 rounded-3xl p-4 sm:p-6"
    onSubmit={submitNote}
  >
    <label
      htmlFor="lead-note"
      className="mb-3 block text-lg font-semibold"
    >
      {ar ? 'إضافة ملاحظة' : 'Add a note'}
    </label>

    <textarea
      id="lead-note"
      className="field min-h-32 w-full resize-y"
      placeholder={
        ar
          ? 'اكتب نتيجة المكالمة أو تفاصيل متابعة العميل…'
          : 'Write the call outcome or customer follow-up details…'
      }
      value={note}
      onChange={event => setNote(event.target.value)}
      maxLength={5000}
      required
      disabled={noteBusy || busy || bookingBusy}
      dir="auto"
    />

    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted">
        {note.length} / 5000
      </span>

      <button
        type="submit"
        className="control min-h-11 justify-center"
        disabled={
          noteBusy || busy || bookingBusy || !note.trim()
        }
      >
        {noteBusy
          ? ar ? 'جاري الحفظ…' : 'Saving…'
          : ar ? 'حفظ الملاحظة' : 'Save note'}
      </button>
    </div>

    {noteMessage && (
      <p className="mt-3 text-sm" role="status">
        {noteMessage}
      </p>
    )}
  </form>
)}
<section className="glass min-w-0 rounded-3xl p-4 sm:p-6">
  <div className="flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0">
      <h1
        className="break-words text-2xl font-semibold sm:text-3xl"
        dir="auto"
      >
        {current.contact?.full_name || (ar ? 'عميل' : 'Client')}
      </h1>

      {current.contact?.phone && (
        <a
          href={`tel:${current.contact.phone}`}
          dir="ltr"
          className="mt-3 inline-flex min-h-11 max-w-full items-center rounded-xl border border-line px-4 text-sm hover:bg-surface"
        >
          {current.contact.phone}
        </a>
      )}
    </div>

    <span className="rounded-full border border-line bg-surface px-3 py-2 text-xs">
      {current.status.replaceAll('_', ' ')}
    </span>
  </div>

  <dl className="mt-6 grid min-w-0 gap-4 border-t border-line pt-5 sm:grid-cols-2">
    <div className="min-w-0">
      <dt className="text-xs text-muted">
        {ar ? 'الخدمة المطلوبة' : 'Requested service'}
      </dt>
      <dd className="mt-1 break-words text-sm" dir="auto">
        {current.requested_service_name_snapshot || '—'}
      </dd>
    </div>

    <div className="min-w-0">
      <dt className="text-xs text-muted">
        {ar ? 'المصدر' : 'Source'}
      </dt>
      <dd className="mt-1 break-words text-sm" dir="auto">
        {current.source || (ar ? 'غير معروف' : 'Unknown')}
      </dd>
    </div>

    <div className="min-w-0">
      <dt className="text-xs text-muted">
        {ar ? 'تاريخ الإضافة' : 'Created'}
      </dt>
      <dd className="mt-1 text-sm">
        {current.created_at
        && !Number.isNaN(Date.parse(current.created_at))
          ? new Intl.DateTimeFormat(ar ? 'ar-EG' : 'en-GB', {
              timeZone: 'Africa/Cairo',
              dateStyle: 'medium',
              timeStyle: 'short',
              hour12: true,
            }).format(new Date(current.created_at))
          : '—'}
      </dd>
    </div>

    <div className="min-w-0">
      <dt className="text-xs text-muted">
        {ar ? 'رقم العميل داخل النظام' : 'Lead ID'}
      </dt>
      <dd className="mt-1 break-all text-xs" dir="ltr">
        {current.id}
      </dd>
    </div>
  </dl>
</section>

          {canChange && ['new', 'in_progress'].includes(current.status) && (
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
                    disabled={busy || bookingBusy}
                    onChange={event => setReason(event.target.value)}
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
      {ar ? 'إنشاء حجز' : 'Create booking'}
    </h2>

    <fieldset
      disabled={bookingBusy || busy}
      className="min-w-0 border-0 p-0"
    >
      <legend className="mb-3 text-sm font-medium">
        {ar ? 'اختار معاد الحجز' : 'Choose a booking time'}
      </legend>

      <BookingCalendarPage
        key={`${clinic.id}:${leadId}:${bookingCalendarVersion}`}
        onSelect={setBookingTime}
      />
    </fieldset>

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
      disabled={bookingBusy || busy || !bookingTime}
            >
            {ar ? 'احجز المعاد' : 'Book appointment'}
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