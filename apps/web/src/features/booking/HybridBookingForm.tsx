import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import ChoiceSelect from '../../components/ChoiceSelect';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import { useGet } from '../../hooks/useGet';

const liveTables = ['appointments'] as const;
const buttonClass = 'rounded-full bg-black px-6 py-3 text-white disabled:opacity-50';

interface Doctor {
  id: string;
  full_name: string;
  is_active: boolean;
}

interface Setup {
  doctors: Doctor[];
  doctor_services: {
    doctor_id: string;
    service_id: string;
    is_active: boolean;
  }[];
}

interface Slot {
  doctor_id: string;
  doctor_name: string;
  duration_minutes: number;
  starts_at: string;
  ends_at: string;
  device_ids: string[];
}

interface Props {
  clinicId: string;
  leadId: string;
  serviceId: string;
  serviceName: string;
  expectedStatus: string;
  token: string;
  ar: boolean;
  disabled: boolean;
  acquireLock: () => boolean;
  releaseLock: () => void;
  onOutcome: (message: string, saved: boolean) => void;
}

function cairoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function errorMessage(code: string, ar: boolean) {
  switch (code) {
    case 'UNASSIGNED_APPOINTMENTS':
    case 'LEGACY_BOOKING_REQUIRES_RESOURCE_ASSIGNMENT':
      return ar
        ? 'في حجوزات قديمة بدون دكتور محدد بتمنع حساب التوفر بأمان. راجع مدير العيادة.'
        : 'Unassigned legacy bookings prevent safe availability. Contact the clinic manager.';
    case 'SERVICE_DEVICE_REQUIREMENT_NOT_CONFIGURED':
      return ar
        ? 'لازم مدير العيادة يحدد أجهزة الخدمة أو يسجّل إنها بدون جهاز.'
        : 'The clinic manager must configure the service device requirement.';
    case 'BOOKING_RESOURCE_UNAVAILABLE':
      return ar
        ? 'الدكتور أو الجهاز مش متاح للموعد ده دلوقتي. حدّث المواعيد واختار من جديد.'
        : 'The doctor or device is unavailable now. Refresh and select another time.';
    case 'STALE_LEAD':
    case 'LEAD_ALREADY_BOOKED':
      return ar
        ? 'بيانات العميل اتغيرت. راجع آخر حالة قبل الحجز.'
        : 'This lead has changed. Review its latest status before booking.';
    case 'FORBIDDEN':
      return ar
        ? 'حسابك مش مسموح له يعمل الحجز ده.'
        : 'Your account cannot create this booking.';
    case 'INVALID_OR_AMBIGUOUS_SCHEDULE_TIME':
      return ar
        ? 'في وقت بجدول الدكتور محتاج مراجعة بسبب التوقيت الصيفي.'
        : 'A doctor schedule time needs review because of daylight saving time.';
    case 'BOOKING_RETRY_REQUIRED':
    case 'BOOKING_CONFIGURATION_CHANGED':
      return ar
        ? 'البيانات اتغيرت أثناء الحفظ. حدّث المواعيد قبل المحاولة تاني.'
        : 'Data changed while saving. Refresh availability before retrying.';
    case 'SERVICE_UNAVAILABLE':
    case 'DOCTOR_UNAVAILABLE':
    case 'LEAD_UNAVAILABLE':
      return ar
        ? 'العميل أو الخدمة أو الدكتور غير متاح. حدّث البيانات.'
        : 'The lead, service, or doctor is unavailable. Refresh the data.';
    default:
      return ar
        ? 'تعذر تحميل أو حفظ الموعد. حدّث البيانات وراجع اختيارك.'
        : 'Could not load or save the appointment. Refresh and check your selection.';
  }
}

function hasPassed(value: string) {
  return new Date(value).getTime() <= Date.now();
}

export default function HybridBookingForm(props: Props) {
  const { clinicId, leadId, serviceId, serviceName, expectedStatus, token, ar } = props;
  const radioName = useId();
  const [mode, setMode] = useState<'auto' | 'specific'>('auto');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(cairoToday);
  const [selectedStart, setSelectedStart] = useState('');
  const [reason, setReason] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  const [availability, setAvailability] = useState<{
    key: string;
    slots: Slot[];
    error?: string;
  } | null>(null);

  const setup = useGet<{ data: Setup }>(
    `/api/booking-setup?clinic_id=${encodeURIComponent(clinicId)}`,
    token,
  );
  const offerings = setup.data?.data.doctor_services ?? [];
  const doctors = (setup.data?.data.doctors ?? []).filter(
    (doctor) =>
      doctor.is_active &&
      offerings.some(
        (offering) =>
          offering.doctor_id === doctor.id &&
          offering.service_id === serviceId &&
          offering.is_active,
      ),
  );

  const query = new URLSearchParams({
    clinic_id: clinicId,
    service_id: serviceId,
    date,
    assignment_mode: mode,
  });
  if (mode === 'specific') query.set('doctor_id', doctorId);
  const path =
    serviceId && date && (mode === 'auto' || doctorId)
      ? `/api/booking-resource-availability?${query}`
      : null;
  const requestKey = JSON.stringify([path, token, attempt]);
  const current = availability?.key === requestKey ? availability : null;
  const slots = current?.slots ?? [];
  const loading = Boolean(path) && !current;
  const disabled = props.disabled || saving || checking;

  const refreshAvailability = useCallback(() => {
    setSelectedStart('');
    setAttempt((value) => value + 1);
  }, []);
  useClinicChanges(clinicId, liveTables, refreshAvailability);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(path!, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setAvailability({
            key: requestKey,
            slots: [],
            error: result.error?.code ?? 'AVAILABILITY_UNAVAILABLE',
          });
          return;
        }
        if (!Array.isArray(result.data?.slots)) throw new Error('Invalid availability');
        setAvailability({ key: requestKey, slots: result.data.slots });
      } catch {
        if (!controller.signal.aborted) {
          setAvailability({
            key: requestKey,
            slots: [],
            error: 'AVAILABILITY_UNAVAILABLE',
          });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [path, token, requestKey]);

  const startTimes = [...new Set(slots.map((slot) => slot.starts_at))];
  const selected = slots.find((slot) => slot.starts_at === selectedStart);
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(ar ? 'ar-EG' : 'en-GB', {
      timeZone: 'Africa/Cairo',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));

  function changeSelection(action: () => void) {
    action();
    setSelectedStart('');
    setMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submitting.current ||
      disabled ||
      unconfirmed ||
      !selected ||
      !reason.trim() ||
      loading ||
      current?.error
    )
      return;
    if (hasPassed(selected.starts_at)) {
      setMessage(
        ar
          ? 'الموعد ده عدى. اختار موعد جديد.'
          : 'This time has passed. Select another slot.',
      );
      refreshAvailability();
      return;
    }
    if (!props.acquireLock()) return;
    submitting.current = true;
    setSaving(true);
    setMessage('');

    try {
      const response = await fetch(`/api/hybrid-booking/${encodeURIComponent(leadId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_id: clinicId,
          expected_status: expectedStatus,
          starts_at: selected.starts_at,
          assignment_mode: mode,
          doctor_id: mode === 'specific' ? doctorId : null,
          device_id: null,
          reason: reason.trim(),
        }),
      });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.data?.appointment_id) {
        const booking = result.data;
        const doctorName = setup.data?.data.doctors.find(
          (doctor) => doctor.id === booking.doctor_id,
        )?.full_name;
        const savedMessage = ar
          ? `تم الحجز${doctorName ? ` مع ${doctorName}` : ''}. مدة الجلسة ${booking.duration_minutes} دقيقة.`
          : `Booked${doctorName ? ` with ${doctorName}` : ''}. Session duration: ${booking.duration_minutes} min.`;
        setReason('');
        setUnconfirmed(true); // Block repeat submission while the lead refreshes.
        setMessage(savedMessage);
        props.onOutcome(savedMessage, true);
        return;
      }
      const code = result?.error?.code;
      if (!code || code === 'BOOKING_RESULT_UNCONFIRMED' || response.status >= 500) {
        setUnconfirmed(true);
        setMessage(
          ar
            ? 'تعذر تأكيد نتيجة الحجز. راجع حالة العميل قبل إعادة الإرسال.'
            : 'Could not confirm the booking result. Check the lead before submitting again.',
        );
      } else {
        const failure = errorMessage(code, ar);
        setMessage(failure);
        if (code === 'STALE_LEAD' || code === 'LEAD_ALREADY_BOOKED')
          props.onOutcome(failure, false);
      }
      refreshAvailability();
    } catch {
      setUnconfirmed(true);
      setMessage(
        ar
          ? 'تعذر تأكيد نتيجة الحجز. راجع حالة العميل قبل إعادة الإرسال.'
          : 'Could not confirm the booking result. Check the lead before submitting again.',
      );
    } finally {
      submitting.current = false;
      setSaving(false);
      props.releaseLock();
    }
  }

  async function checkLead() {
    if (checking || saving || !props.acquireLock()) return;
    setChecking(true);
    try {
      const params = new URLSearchParams({ clinic_id: clinicId });
      const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok || !result.data?.status) throw new Error('Lead unavailable');
      if (result.data.status === 'converted') {
        props.onOutcome(
          ar
            ? 'العميل محجوز بالفعل. راجع سجل الحجز.'
            : 'This lead is already booked. Review its history.',
          true,
        );
        return;
      }
      if (
        result.data.status !== expectedStatus ||
        result.data.requested_service_id !== serviceId
      ) {
        props.onOutcome(
          ar
            ? 'بيانات العميل اتغيرت. راجع آخر تحديث.'
            : 'The lead has changed. Review its latest data.',
          false,
        );
        return;
      }
      setUnconfirmed(false);
      setMessage(
        ar
          ? 'العميل لسه غير محجوز. اختار موعد من القائمة المحدّثة.'
          : 'The lead is still unbooked. Select from the refreshed slots.',
      );
      refreshAvailability();
    } catch {
      setMessage(
        ar
          ? 'تعذر مراجعة حالة العميل. حاول التحقق مرة تانية قبل الحجز.'
          : 'Could not check the lead. Verify again before booking.',
      );
    } finally {
      setChecking(false);
      props.releaseLock();
    }
  }

  return (
    <form className="glass space-y-5 p-6" onSubmit={submit}>
      <header>
        <h2 className="text-xl font-semibold">{ar ? 'إنشاء حجز' : 'Create booking'}</h2>
        <p className="mt-2 text-muted" dir="auto">
          {serviceName}
        </p>
      </header>
      <fieldset disabled={disabled || unconfirmed} className="grid min-w-0 gap-5">
        <fieldset className="grid gap-3">
          <legend className="mb-2 font-medium">
            {ar ? 'اختيار الدكتور' : 'Doctor selection'}
          </legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={radioName}
                checked={mode === 'auto'}
                onChange={() => changeSelection(() => setMode('auto'))}
              />
              {ar ? 'اختيار تلقائي' : 'Auto Assign'}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={radioName}
                checked={mode === 'specific'}
                onChange={() => changeSelection(() => setMode('specific'))}
              />
              {ar ? 'دكتور محدد' : 'Specific Doctor'}
            </label>
          </div>
        </fieldset>
        {mode === 'specific' && (
          <ChoiceSelect
            label={ar ? 'الدكتور' : 'Doctor'}
            value={doctorId}
            options={doctors.map((doctor) => ({
              value: doctor.id,
              label: doctor.full_name,
            }))}
            disabled={disabled || unconfirmed}
            onChange={(value) => changeSelection(() => setDoctorId(value))}
          />
        )}
        {mode === 'specific' && setup.loading && (
          <p role="status">{ar ? 'جاري تحميل الدكاترة…' : 'Loading doctors…'}</p>
        )}
        {mode === 'specific' && setup.error && (
          <button type="button" className="control" onClick={setup.retry}>
            {ar ? 'إعادة تحميل الدكاترة' : 'Reload doctors'}
          </button>
        )}
        <label className="grid gap-2">
          <span>{ar ? 'اليوم — بتوقيت القاهرة' : 'Date — Cairo timezone'}</span>
          <input
            className="field"
            type="date"
            required
            min={cairoToday()}
            value={date}
            onChange={(event) => changeSelection(() => setDate(event.target.value))}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium">{ar ? 'المواعيد المتاحة' : 'Available times'}</h3>
          <button
            type="button"
            className="control"
            onClick={refreshAvailability}
            disabled={!path || loading}
          >
            {ar ? 'تحديث المواعيد' : 'Refresh times'}
          </button>
        </div>
        {loading && (
          <p role="status">{ar ? 'جاري حساب المواعيد…' : 'Calculating availability…'}</p>
        )}
        {current?.error && <p role="alert">{errorMessage(current.error, ar)}</p>}
        {!loading && current && !current.error && startTimes.length === 0 && (
          <p>
            {ar
              ? 'مفيش مواعيد متاحة للاختيار ده. جرّب يوم تاني أو دكتور تاني.'
              : 'No slots for this selection. Try another date or doctor.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {startTimes.map((start) => {
            const slot = slots.find((value) => value.starts_at === start)!;
            return (
              <button
                key={start}
                type="button"
                aria-pressed={selectedStart === start}
                className={selectedStart === start ? buttonClass : 'control flex-col'}
                onClick={() => setSelectedStart(start)}
              >
                <span>{formatTime(start)}</span>
                {mode === 'specific' && (
                  <span className="text-sm">
                    {slot.duration_minutes} {ar ? 'دقيقة' : 'min'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {selected && (
          <p className="rounded-xl border border-line p-4">
            {ar ? 'الموعد المختار: ' : 'Selected time: '}
            {formatTime(selected.starts_at)}
            {mode === 'specific'
              ? ` · ${selected.doctor_name} · ${selected.duration_minutes} ${ar ? 'دقيقة' : 'min'}`
              : ar
                ? ' · الدكتور ومدة الجلسة بيتحددوا تلقائيًا عند الحفظ.'
                : ' · Doctor and duration are assigned when saved.'}
          </p>
        )}
        <label className="grid gap-2">
          <span>{ar ? 'تفاصيل الحجز' : 'Booking details'}</span>
          <textarea
            className="field"
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className={buttonClass}
          disabled={!selected || !reason.trim() || loading || Boolean(current?.error)}
        >
          {saving
            ? ar
              ? 'جاري الحجز…'
              : 'Booking…'
            : ar
              ? 'تأكيد الحجز'
              : 'Book appointment'}
        </button>
      </fieldset>
      {message && <p role="status">{message}</p>}
      {unconfirmed && (
        <button
          type="button"
          className="control"
          disabled={disabled}
          onClick={() => void checkLead()}
        >
          {checking
            ? ar
              ? 'جاري التحقق…'
              : 'Checking…'
            : ar
              ? 'راجع حالة العميل'
              : 'Check lead status'}
        </button>
      )}
    </form>
  );
}
