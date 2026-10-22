import { useCallback, useEffect, useState } from 'react';
import LegacyBookingCalendar from './LegacyBookingCalendar';
import { useClinicChanges } from '../../hooks/useClinicChanges';

const liveTables = ['appointments'] as const;
const buttonClass = 'rounded-full bg-black px-6 py-3 text-white disabled:opacity-50';

interface Slot {
  doctor_id: string;
  doctor_name: string;
  duration_minutes: number;
  starts_at: string;
  ends_at: string;
  device_ids: string[];
}

export interface RescheduleAppointment {
  id: string;
  booked_service_id: string;
  resource_doctor_id: string | null;
  device_id: string | null;
  duration_minutes: number | null;
}

interface Props {
  clinicId: string;
  appointment: RescheduleAppointment;
  token: string;
  ar: boolean;
  disabled: boolean;
  onSelect: (startsAt: string) => void;
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

function ResourceReschedulePicker(props: Props) {
  const { clinicId, appointment, token, ar, onSelect } = props;
  const serviceId = appointment.booked_service_id;
  const doctorId = appointment.resource_doctor_id!;
  const [date, setDate] = useState(cairoToday);
  const [selectedStart, setSelectedStart] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(0);
  const [availability, setAvailability] = useState<{
    key: string;
    slots: Slot[];
    error?: string;
  } | null>(null);

  const query = new URLSearchParams({
    clinic_id: clinicId,
    service_id: serviceId,
    date,
    assignment_mode: 'specific',
    doctor_id: doctorId,
    reschedule_appointment_id: appointment.id,
  });
  const path =
    serviceId && date && doctorId
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
    onSelect('');
    setAttempt((value) => value + 1);
  }, [onSelect]);
  useClinicChanges(clinicId, liveTables, refreshAvailability);

  useEffect(() => {
    onSelect('');
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
  }, [path, token, requestKey, onSelect]);

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
        onSelect('');
      }
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [hasLoadedSlots, selectedStart, onSelect]);

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
    onSelect('');
  }

  if (!serviceId) {
    return (
      <p role="alert">
        {ar ? 'بيانات خدمة الحجز ناقصة. حدّث القائمة.' : 'The booking service is missing. Refresh the list.'}
      </p>
    );
  }

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-4">
      <p className="text-sm text-muted">
        {ar
          ? 'نقل الموعد بيحافظ على نفس الدكتور والجهاز ومدة الحجز: '
          : 'Rescheduling keeps the same doctor, device and booked duration: '}
        {appointment.duration_minutes} {ar ? 'دقيقة' : 'min'}
      </p>
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
            ? 'مفيش مواعيد متاحة للدكتور والجهاز دول. جرّب يوم تاني.'
            : 'No times are available for this doctor and device. Try another date.'}
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
              onClick={() => {
                setSelectedStart(start);
                onSelect(start);
              }}
            >
              <span>{formatTime(start)}</span>
              <span className="text-sm">
                {slot.duration_minutes} {ar ? 'دقيقة' : 'min'}
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="rounded-xl border border-line p-4">
          {ar ? 'الموعد المختار: ' : 'Selected time: '}
          {formatTime(selected.starts_at)}
          {` · ${selected.doctor_name} · ${selected.duration_minutes} ${ar ? 'دقيقة' : 'min'}`}
        </p>
      )}
    </fieldset>
  );
}

export default function AppointmentReschedulePicker(props: Props) {
  if (!props.appointment.resource_doctor_id) {
    return (
      <fieldset disabled={props.disabled}>
        <LegacyBookingCalendar onSelect={props.onSelect} />
      </fieldset>
    );
  }

  return <ResourceReschedulePicker {...props} />;
}
