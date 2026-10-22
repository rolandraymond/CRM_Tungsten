import { useCallback, useEffect, useId, useState } from 'react';
import BookingCalendarLayout from './BookingCalendarLayout';
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

export interface HybridBookingSelection {
  starts_at: string;
  assignment_mode: 'auto' | 'specific';
  doctor_id: string | null;
  device_id: null;
}

interface Props {
  clinicId: string;
  serviceId: string;
  token: string;
  ar: boolean;
  disabled: boolean;
  onChange: (selection: HybridBookingSelection | null) => void;
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

export default function HybridBookingPicker(props: Props) {
  const { clinicId, serviceId, token, ar, onChange } = props;
  const radioName = useId();
  const [mode, setMode] = useState<'auto' | 'specific'>('auto');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(cairoToday);
  const [selectedStart, setSelectedStart] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(0);
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
  const slots = (current?.slots ?? []).filter(
    (slot) => new Date(slot.starts_at).getTime() > now,
  );
  const hasLoadedSlots = Boolean(current?.slots.length);
  const loading = Boolean(path) && !current;
  const disabled = props.disabled;

  const refreshAvailability = useCallback(() => {
    setSelectedStart('');
    onChange(null);
    setAttempt((value) => value + 1);
  }, [onChange]);
  useClinicChanges(clinicId, liveTables, refreshAvailability);

  useEffect(() => {
    onChange(null);
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
        setNow(Date.now());
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
  }, [path, token, requestKey, onChange]);

  useEffect(() => {
    if (!hasLoadedSlots) return;

    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);

      if (
        selectedStart
        && new Date(selectedStart).getTime() <= currentTime
      ) {
        setSelectedStart('');
        onChange(null);
      }
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [hasLoadedSlots, selectedStart, onChange]);

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
    onChange(null);
  }

  if (!serviceId) {
    return <p role="status">{ar ? 'اختار الخدمة الأول عشان تظهر المواعيد.' : 'Select a service to see available times.'}</p>;
  }

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-4">
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
          disabled={disabled}
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
      <BookingCalendarLayout
        clinicId={clinicId}
        serviceId={serviceId}
        doctorId={mode === 'specific' ? doctorId : undefined}
        ready={mode === 'auto' || Boolean(doctorId)}
        token={token}
        ar={ar}
        date={date}
        onDateChange={value => changeSelection(() => setDate(value))}
      >
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
                className={selectedStart === start
                  ? buttonClass
                  : 'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-[#f5f5f2] px-3 py-3 text-sm hover:bg-black hover:text-white'}
                onClick={() => {
                  setSelectedStart(start);
                  onChange({
                    starts_at: start,
                    assignment_mode: mode,
                    doctor_id: mode === 'specific' ? doctorId : null,
                    device_id: null,
                  });
                }}
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
      </BookingCalendarLayout>
    </fieldset>
  );
}
