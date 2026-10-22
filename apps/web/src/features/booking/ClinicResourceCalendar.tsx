import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RefreshCw, Settings2 } from 'lucide-react';
import type { WorkspaceContext } from '../leads/types';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import ChoiceSelect from '../../components/ChoiceSelect';

interface Appointment {
  id: string;
  lead_id: string;
  doctor_name: string | null;
  device_name: string | null;
  duration_minutes: number | null;
  service_name: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  patient_name: string;
  phone: string;
}

interface Slot {
  doctor_id: string;
  doctor_name: string;
  duration_minutes: number;
  starts_at: string;
  ends_at: string;
}

type DayState = 'available' | 'unavailable' | 'unknown' | 'booked' | 'empty' | 'past';
interface Day {
  date: string;
  state: DayState;
  booked_clients: number;
  appointments_count: number;
  available_starts: number | null;
  availability_error: string | null;
  appointments: Appointment[];
  slots: Slot[];
}
interface Calendar {
  month: string;
  doctors: { id: string; full_name: string; is_active: boolean }[];
  services: { service_id: string; service_name: string; is_active: boolean }[];
  days: Day[];
}

const liveTables = ['appointments'] as const;
const dotColors: Record<DayState, string> = {
  available: 'bg-emerald-500',
  unavailable: 'bg-rose-500',
  unknown: 'bg-amber-400',
  booked: 'bg-blue-500',
  empty: 'bg-gray-200',
  past: 'bg-gray-300',
};

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

function moveMonth(month: string, amount: number) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function availabilityError(code: string, ar: boolean) {
  switch (code) {
    case 'UNASSIGNED_APPOINTMENTS':
      return ar
        ? 'توجد حجوزات قديمة بدون دكتور محدد؛ التوفر محتاج مراجعة.'
        : 'Unassigned legacy bookings prevent safe availability.';
    case 'SERVICE_DEVICE_REQUIREMENT_NOT_CONFIGURED':
      return ar
        ? 'حدد أجهزة الخدمة أو سجّل إنها بدون جهاز من إعدادات الحجز.'
        : 'Configure the service device requirement in booking settings.';
    case 'INVALID_OR_AMBIGUOUS_SCHEDULE_TIME':
      return ar
        ? 'وقت بجدول الدكتور محتاج مراجعة بسبب التوقيت الصيفي.'
        : 'A doctor schedule time needs review because of daylight saving time.';
    case 'SERVICE_UNAVAILABLE':
      return ar
        ? 'الخدمة غير نشطة؛ الحجوزات المسجّلة لسه ظاهرة.'
        : 'The service is inactive. Recorded appointments remain visible.';
    default:
      return ar
        ? 'تعذر حساب التوفر. حدّث التقويم وراجع إعدادات الحجز.'
        : 'Availability could not be calculated. Refresh and review booking settings.';
  }
}

function CalendarWorkspace({ token, clinic, isAdmin }: WorkspaceContext) {
  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');
  const locale = ar ? 'ar-EG' : 'en-GB';
  const [month, setMonth] = useState(() => cairoToday().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(cairoToday);
  const [serviceId, setServiceId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [selectedStart, setSelectedStart] = useState('');
  const canView = isAdmin === true || clinic.role !== 'doctor';
  const canManage =
    isAdmin === true || ['platform_admin', 'clinic_manager'].includes(clinic.role);
  const params = new URLSearchParams({ clinic_id: clinic.id, month });
  if (serviceId) params.set('service_id', serviceId);
  if (doctorId) params.set('doctor_id', doctorId);
  const query = useGet<{ data: Calendar }>(
    canView ? `/api/booking-resource-calendar?${params}` : null,
    token,
  );
  useClinicChanges(clinic.id, liveTables, query.retry);
  const calendar = query.data?.data;
  const selectedDay = calendar?.days.find((day) => day.date === selectedDate);
  const starts = [...new Set(selectedDay?.slots.map((slot) => slot.starts_at) ?? [])];
  const selectedOptions =
    selectedDay?.slots.filter((slot) => slot.starts_at === selectedStart) ?? [];
  const firstDay = new Date(`${month}-01T12:00:00Z`);
  const blankDays = (firstDay.getUTCDay() + 6) % 7;
  const weekdays = ar
    ? ['اث', 'ثل', 'أر', 'خم', 'جم', 'سب', 'أح']
    : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const labels: Record<DayState, string> = {
    available: ar ? 'في مواعيد متاحة' : 'Available times',
    unavailable: ar ? 'مفيش مواعيد متاحة' : 'No available times',
    unknown: ar ? 'التوفر محتاج مراجعة' : 'Availability needs review',
    booked: ar ? 'في حجوزات' : 'Has appointments',
    empty: ar ? 'بدون حجوزات' : 'No appointments',
    past: ar ? 'يوم سابق' : 'Past date',
  };
  const statuses: Record<string, string> = {
    pending: ar ? 'بانتظار التأكيد' : 'Pending confirmation',
    confirmed: ar ? 'مؤكد' : 'Confirmed',
    attended: ar ? 'حضر' : 'Attended',
    no_show: ar ? 'لم يحضر' : 'No show',
  };
  const time = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: 'Africa/Cairo',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value));
  const timeWithDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: 'Africa/Cairo',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value));

  function changeMonth(amount: number) {
    setMonth((value) => moveMonth(value, amount));
    setSelectedDate(null);
    setSelectedStart('');
  }

  if (!canView)
    return (
      <p className="glass p-6">
        {ar
          ? 'التقويم الكامل غير متاح لحساب الدكتور حاليًا.'
          : 'The full calendar is not available to doctor accounts yet.'}
      </p>
    );

  return (
    <section
      dir={ar ? 'rtl' : 'ltr'}
      className="min-w-0 rounded-[28px] p-3 text-[#171717] sm:p-5"
      style={{
        background: 'linear-gradient(120deg, #e8e9e7 0%, #eeeee8 55%, #e9e1c6 100%)',
      }}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-black px-4 py-2.5 text-xs text-white">
            {ar ? 'الحجوزات' : 'Bookings'}
          </span>
          <span className="text-xs text-black/55" dir="auto">
            {clinic.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full bg-white"
            onClick={() => {
              setSelectedStart('');
              query.retry();
            }}
            aria-label={ar ? 'تحديث التقويم' : 'Refresh calendar'}
          >
            <RefreshCw size={15} />
          </button>
          {canManage && (
            <Link
              to="/booking/settings"
              className="flex min-h-10 items-center gap-2 rounded-full bg-black px-4 text-xs text-white"
            >
              <Settings2 size={14} />
              {ar ? 'الإعدادات' : 'Settings'}
            </Link>
          )}
        </div>
      </header>
      <div className="mb-3 grid gap-3 rounded-[24px] bg-white p-4 sm:grid-cols-2">
        <ChoiceSelect
          label={ar ? 'الخدمة' : 'Service'}
          value={serviceId}
          options={[
            {
              value: '',
              label: ar ? 'كل الخدمات — عرض الحجوزات' : 'All services — appointments',
            },
            ...(calendar?.services ?? []).map((service) => ({
              value: service.service_id,
              label: service.service_name,
            })),
          ]}
          onChange={(value) => {
            setServiceId(value);
            setSelectedStart('');
          }}
        />
        <ChoiceSelect
          label={ar ? 'الدكتور' : 'Doctor'}
          value={doctorId}
          options={[
            { value: '', label: ar ? 'كل الدكاترة' : 'All doctors' },
            ...(calendar?.doctors ?? []).map((doctor) => ({
              value: doctor.id,
              label: doctor.full_name,
            })),
          ]}
          onChange={(value) => {
            setDoctorId(value);
            setSelectedStart('');
          }}
        />
      </div>
      {query.error || !calendar ? (
        <div className="rounded-[24px] bg-white p-5">
          <QueryState error={query.error} retry={query.retry} />
        </div>
      ) : (
        <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[270px_minmax(0,1fr)]">
          <aside className="rounded-[24px] bg-white p-4 sm:p-5">
            <div className="mb-5 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {new Intl.DateTimeFormat(locale, {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(firstDay)}
              </h2>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="grid size-9 place-items-center rounded-full bg-[#f5f5f3]"
                  onClick={() => changeMonth(-1)}
                  aria-label={ar ? 'الشهر السابق' : 'Previous month'}
                >
                  {ar ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                </button>
                <button
                  type="button"
                  className="grid size-9 place-items-center rounded-full bg-[#f5f5f3]"
                  onClick={() => changeMonth(1)}
                  aria-label={ar ? 'الشهر التالي' : 'Next month'}
                >
                  {ar ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-x-1 gap-y-1.5">
              {weekdays.map((day, index) => (
                <span key={index} className="pb-2 text-center text-[10px] text-black/40">
                  {day}
                </span>
              ))}
              {Array.from({ length: blankDays }, (_, index) => (
                <span key={`blank-${index}`} aria-hidden="true" />
              ))}
              {calendar.days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  aria-pressed={day.date === selectedDate}
                  aria-label={`${day.date}: ${day.booked_clients} ${ar ? 'عميل' : 'clients'}, ${labels[day.state]}`}
                  onClick={() => {
                    setSelectedDate(day.date);
                    setSelectedStart('');
                  }}
                  className={`flex flex-col items-center gap-0.5 rounded-full py-2 ${day.date === selectedDate ? 'bg-black text-white' : 'hover:bg-[#f2f2ef]'}`}
                >
                  <span className="text-[9px] opacity-60">
                    {Number(day.date.slice(-2))}
                  </span>
                  <span className="text-sm font-semibold">{day.booked_clients}</span>
                  <span
                    className={`size-1 rounded-full ${day.date === selectedDate ? 'bg-white' : dotColors[day.state]}`}
                  />
                </button>
              ))}
            </div>
            <p className="mt-5 border-t border-black/5 pt-4 text-[11px] leading-5 text-black/45">
              {ar
                ? 'الرقم الصغير هو التاريخ، والكبير عدد العملاء الحاجزين حسب الفلاتر.'
                : 'Small numbers show dates. Large numbers show booked clients for the selected filters.'}
            </p>
            <p className="mt-2 text-[11px] leading-5 text-black/45">
              {serviceId
                ? ar
                  ? 'الألوان بتوضح توفر الخدمة مع الدكتور المختار.'
                  : 'Colors indicate availability for the selected service and doctor.'
                : ar
                  ? 'اختار خدمة لعرض المواعيد المتاحة. الأزرق يعني وجود حجوزات.'
                  : 'Select a service to view availability. Blue means appointments exist.'}
            </p>
          </aside>
          <div className="min-w-0 rounded-[24px] bg-white p-4 sm:p-6">
            {!selectedDay ? (
              <p className="py-16 text-center text-sm">
                {ar
                  ? 'اختار يوم لعرض حجوزاته.'
                  : 'Choose a day to view its appointments.'}
              </p>
            ) : (
              <>
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h1 className="text-lg font-semibold">
                      {new Intl.DateTimeFormat(locale, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        timeZone: 'UTC',
                      }).format(new Date(`${selectedDay.date}T12:00:00Z`))}
                    </h1>
                    <p className="mt-2 text-xs text-black/45">
                      {ar ? 'الأوقات بتوقيت القاهرة' : 'Times use Cairo timezone'}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#f5f5f2] px-3 py-2 text-[11px]">
                    {selectedDay.appointments_count} {ar ? 'حجز' : 'appointments'}
                  </span>
                </header>
                <h2 className="my-5 border-y border-black/5 py-3 text-sm font-semibold">
                  {ar ? 'حجوزات اليوم' : 'Today’s appointments'}
                </h2>
                {selectedDay.appointments.length === 0 && (
                  <p className="text-sm text-black/45">
                    {ar
                      ? 'مفيش حجوزات حسب الفلاتر المختارة.'
                      : 'No appointments for these filters.'}
                  </p>
                )}
                <div className="space-y-3">
                  {selectedDay.appointments.map((appointment) => (
                    <article
                      key={appointment.id}
                      className="rounded-2xl border border-black/10 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold" dir="auto">
                            {appointment.patient_name}
                          </h3>
                          <p className="mt-1 text-sm" dir="auto">
                            {appointment.service_name}
                          </p>
                        </div>
                        <span className="rounded-full bg-[#f5f5f2] px-3 py-1 text-xs">
                          {statuses[appointment.status] ?? appointment.status}
                        </span>
                      </div>
                      <p className="mt-3 text-sm">
                        {time(appointment.starts_at)}
                        {appointment.ends_at
                          ? ` — ${timeWithDate(appointment.ends_at)}`
                          : ''}
                      </p>
                      <p className="mt-2 text-sm" dir="auto">
                        {ar ? 'الدكتور: ' : 'Doctor: '}
                        {appointment.doctor_name ??
                          (ar
                            ? 'حجز قديم بدون دكتور محدد'
                            : 'Legacy booking — doctor unassigned')}
                      </p>
                      {appointment.device_name && (
                        <p className="mt-1 text-sm" dir="auto">
                          {ar ? 'الجهاز: ' : 'Device: '}
                          {appointment.device_name}
                        </p>
                      )}
                      {appointment.duration_minutes !== null && (
                        <p className="mt-1 text-sm">
                          {ar ? 'مدة الجلسة: ' : 'Session duration: '}
                          {appointment.duration_minutes} {ar ? 'دقيقة' : 'min'}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-black/55" dir="ltr">
                          {appointment.phone}
                        </span>
                        <Link to={`/leads/${appointment.lead_id}`} className="control">
                          {ar ? 'فتح العميل والسجل' : 'Open lead and history'}
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
                {serviceId && (
                  <section className="mt-6 border-t border-black/5 pt-5">
                    <h2 className="mb-3 text-sm font-semibold">
                      {ar ? 'المواعيد المتاحة للخدمة' : 'Available service times'}
                    </h2>
                    {selectedDay.availability_error ? (
                      <p role="alert" className="text-sm">
                        {availabilityError(selectedDay.availability_error, ar)}
                      </p>
                    ) : starts.length === 0 ? (
                      <p className="text-sm text-black/45">{labels[selectedDay.state]}</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {starts.map((start) => (
                          <button
                            key={start}
                            type="button"
                            aria-pressed={selectedStart === start}
                            className={`rounded-2xl border px-3 py-3 text-sm ${selectedStart === start ? 'border-black bg-black text-white' : 'border-black/10'}`}
                            onClick={() => setSelectedStart(start)}
                          >
                            {time(start)}
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedOptions.length > 0 && (
                      <div className="mt-4 rounded-2xl bg-[#f5f5f2] p-4">
                        {selectedOptions.map((slot) => (
                          <p key={slot.doctor_id} className="text-sm" dir="auto">
                            {slot.doctor_name} · {slot.duration_minutes}{' '}
                            {ar ? 'دقيقة' : 'min'}
                          </p>
                        ))}
                        <p className="mt-3 text-xs text-black/55">
                          {ar
                            ? 'الحجز بيتم من صفحة العميل، والتوفر بيتراجع مرة تانية عند الحفظ.'
                            : 'Book from the lead page. Availability is checked again when saving.'}
                        </p>
                        <Link to="/leads" className="control mt-3 inline-flex">
                          {ar ? 'اختيار العميل للحجز' : 'Choose a lead to book'}
                        </Link>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function ClinicResourceCalendar() {
  const context = useOutletContext<WorkspaceContext>();
  return <CalendarWorkspace key={`${context.clinic.id}:${context.token}`} {...context} />;
}
