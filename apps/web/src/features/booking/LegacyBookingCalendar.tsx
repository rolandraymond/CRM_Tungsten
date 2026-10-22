import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Clock3, RefreshCw, Settings2 } from 'lucide-react';

import type { WorkspaceContext } from '../leads/types';
import { useGet } from '../../hooks/useGet';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import QueryState from '../../components/QueryState';

type Slot = {
  starts_at: string;
  ends_at: string;
  local_time: string;
  booked_count: number;
  remaining_capacity: number;
  capacity: number;
  available: boolean;
  state: 'available' | 'limited' | 'full' | 'past';
};

type Day = {
  date: string;
  booked_clients: number;
  total_capacity: number;
  remaining_capacity: number;
  available_slots: number;
  state: 'closed' | 'past' | 'available' | 'limited' | 'full';
  slots: Slot[];
};

type CalendarResponse = {
  data: {
    clinic_id: string;
    month: string;
    timezone: string;
    enabled: boolean;
    days: Day[];
  };
};

type State = Day['state'];

const liveTables = ['appointments'] as const;

const dotColors: Record<State, string> = {
  available: 'bg-emerald-500',
  limited: 'bg-amber-400',
  full: 'bg-rose-500',
  past: 'bg-gray-300',
  closed: 'bg-gray-200',
};

const countColors: Record<State, string> = {
  available: 'text-emerald-700',
  limited: 'text-amber-700',
  full: 'text-rose-600',
  past: 'text-gray-400',
  closed: 'text-gray-400',
};

function cairoToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return `${read('year')}-${read('month')}-${read('day')}`;
}

function moveMonth(month: string, amount: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + amount, 1));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

type BookingCalendarProps = {
  onSelect?: (startsAt: string) => void;
};

export default function BookingCalendarPage({ onSelect }: BookingCalendarProps = {}) {
  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');

  const locale = ar ? 'ar-EG' : 'en-GB';
  const { token, clinic, isAdmin } = useOutletContext<WorkspaceContext>();

  const [month, setMonth] = useState(() => cairoToday().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(() => cairoToday());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const canView = isAdmin === true || clinic.role !== 'doctor';
  const canManage =
    isAdmin === true ||
    clinic.role === 'platform_admin' ||
    clinic.role === 'clinic_manager';

  const query = useGet<CalendarResponse>(
    canView
      ? `/api/booking-availability?clinic_id=${encodeURIComponent(
          clinic.id,
        )}&month=${encodeURIComponent(month)}`
      : null,
    token,
  );

  useClinicChanges(clinic.id, liveTables, query.retry);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);

    return () => window.clearInterval(timer);
  }, []);

  const calendar = query.data?.data;
  const selectedDay = calendar?.days.find((day) => day.date === selectedDate);

  const chosenSlot = selectedDay?.slots.find(
    (slot) =>
      slot.starts_at === selectedSlot &&
      slot.available &&
      Date.parse(slot.starts_at) > now,
  );

  const chosenStartsAt = chosenSlot?.starts_at ?? '';

  useEffect(() => {
    onSelect?.(chosenStartsAt);
  }, [onSelect, chosenStartsAt]);

  const firstDay = new Date(`${month}-01T12:00:00Z`);
  const blankDays = (firstDay.getUTCDay() + 6) % 7;

  const weekdays = ar
    ? ['اث', 'ثل', 'أر', 'خم', 'جم', 'سب', 'أح']
    : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const labels: Record<State, string> = {
    available: ar ? 'متاح' : 'Available',
    limited: ar ? 'جزئي' : 'Partly booked',
    full: ar ? 'مكتمل' : 'Full',
    past: ar ? 'انتهى' : 'Past',
    closed: ar ? 'مغلق' : 'Closed',
  };

  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const availableSlots =
    selectedDay?.slots.filter(
      (slot) => slot.available && Date.parse(slot.starts_at) > now,
    ).length ?? 0;

  function changeMonth(amount: number) {
    setMonth((current) => moveMonth(current, amount));
    setSelectedDate(null);
    setSelectedSlot(null);
  }

  if (!canView) {
    return (
      <p className="glass p-6">
        {ar
          ? 'التقويم الكامل غير متاح لحساب الدكتور حاليًا.'
          : 'The full calendar is not available to doctors yet.'}
      </p>
    );
  }

  return (
    <section
      dir={ar ? 'rtl' : 'ltr'}
      className="min-w-0 rounded-[28px] p-3 text-[#171717] sm:rounded-[36px] sm:p-5"
      style={{
        background: 'linear-gradient(120deg, #e8e9e7 0%, #eeeee8 55%, #e9e1c6 100%)',
      }}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-full bg-black px-4 py-2.5 text-xs font-medium text-white">
            {ar ? 'الحجوزات' : 'Bookings'}
          </span>

          <span className="truncate text-xs text-black/55">{clinic.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={query.retry}
            aria-label={ar ? 'تحديث التقويم' : 'Refresh calendar'}
            title={ar ? 'تحديث التقويم' : 'Refresh calendar'}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white transition hover:bg-white/70"
          >
            <RefreshCw size={15} />
          </button>

          {canManage && (
            <Link
              to="/booking/settings"
              className="flex min-h-10 items-center gap-2 rounded-full bg-black px-4 text-xs text-white transition hover:bg-black/80"
            >
              <Settings2 size={14} />
              {ar ? 'الإعدادات' : 'Settings'}
            </Link>
          )}
        </div>
      </header>

      {query.error || !calendar ? (
        <div className="rounded-[24px] bg-white p-5">
          <QueryState error={query.error} retry={query.retry} />
        </div>
      ) : (
        <>
          {!calendar.enabled && (
            <p className="mb-3 rounded-2xl bg-white/80 px-4 py-3 text-xs leading-6 text-black/60">
              {ar
                ? 'الحجز غير مفعّل. فعّله من إعدادات العيادة لإظهار المواعيد المتاحة.'
                : 'Booking is disabled. Enable it in clinic settings to show available times.'}
            </p>
          )}

          <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[270px_minmax(0,1fr)]">
            <aside className="min-w-0 rounded-[24px] bg-white p-4 sm:p-5">
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
                    onClick={() => changeMonth(-1)}
                    aria-label={ar ? 'الشهر السابق' : 'Previous month'}
                    className="grid size-9 place-items-center rounded-full bg-[#f5f5f3] hover:bg-black hover:text-white"
                  >
                    {ar ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => changeMonth(1)}
                    aria-label={ar ? 'الشهر التالي' : 'Next month'}
                    className="grid size-9 place-items-center rounded-full bg-[#f5f5f3] hover:bg-black hover:text-white"
                  >
                    {ar ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-x-1 gap-y-1.5">
                {weekdays.map((day, index) => (
                  <span
                    key={index}
                    className="pb-2 text-center text-[10px] text-black/40"
                  >
                    {day}
                  </span>
                ))}

                {Array.from({ length: blankDays }, (_, index) => (
                  <span key={`blank-${index}`} aria-hidden="true" />
                ))}

                {calendar.days.map((day) => {
                  const selected = day.date === selectedDate;

                  return (
                    <button
                      key={day.date}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${day.date}: ${day.booked_clients} ${
                        ar ? 'عميل' : 'clients'
                      }, ${labels[day.state]}`}
                      onClick={() => {
                        setSelectedDate(day.date);
                        setSelectedSlot(null);
                      }}
                      className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full py-2 transition ${
                        selected ? 'bg-black text-white' : 'text-black hover:bg-[#f2f2ef]'
                      }`}
                    >
                      <span
                        className={`text-[9px] ${
                          selected ? 'text-white/65' : 'text-black/40'
                        }`}
                      >
                        {Number(day.date.slice(-2))}
                      </span>

                      <span
                        className={`text-sm font-semibold leading-5 ${
                          selected ? 'text-white' : countColors[day.state]
                        }`}
                      >
                        {day.booked_clients}
                      </span>

                      <span
                        className={`size-1 rounded-full ${
                          selected ? 'bg-white' : dotColors[day.state]
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 border-t border-black/5 pt-4">
                <p className="text-[11px] leading-5 text-black/45">
                  {ar
                    ? 'الرقم الصغير هو التاريخ، والرقم الكبير هو عدد العملاء الحاجزين.'
                    : 'Small numbers show dates. Large numbers show booked clients.'}
                </p>

                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
                  {(['available', 'limited', 'full', 'closed'] as const).map((state) => (
                    <span
                      key={state}
                      className="flex items-center gap-1.5 text-[10px] text-black/55"
                    >
                      <span className={`size-1.5 rounded-full ${dotColors[state]}`} />
                      {labels[state]}
                    </span>
                  ))}
                </div>
              </div>
            </aside>

            <div className="min-w-0 rounded-[24px] bg-white p-4 sm:p-6">
              {!selectedDay ? (
                <div className="grid min-h-64 place-items-center text-center">
                  <div>
                    <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-[#f5f5f2]">
                      <Clock3 size={20} />
                    </span>
                    <p className="text-sm font-medium">
                      {ar ? 'اختار يوم' : 'Choose a day'}
                    </p>
                    <p className="mt-2 text-xs text-black/45">
                      {ar
                        ? 'المواعيد المتاحة هتظهر هنا.'
                        : 'Available times will appear here.'}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h1 className="text-lg font-semibold tracking-tight">
                        {new Intl.DateTimeFormat(locale, {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          timeZone: 'UTC',
                        }).format(new Date(`${selectedDay.date}T12:00:00Z`))}
                      </h1>

                      <p className="mt-1.5 text-xs text-black/45">
                        {ar ? 'المواعيد بتوقيت القاهرة' : 'Times in Cairo'}
                      </p>
                    </div>

                    <span className="rounded-full bg-[#f5f5f2] px-3 py-2 text-[11px]">
                      {ar
                        ? `${selectedDay.booked_clients} عميل حاجز`
                        : `${selectedDay.booked_clients} booked clients`}
                    </span>
                  </div>

                  <div className="my-5 flex items-center justify-between border-y border-black/5 py-3">
                    <span className="text-xs font-medium">
                      {ar ? 'مواعيد اليوم' : 'Daily schedule'}
                    </span>
                    <span className="text-[11px] text-black/45">
                      {ar
                        ? `${availableSlots} معاد متاح`
                        : `${availableSlots} available slots`}
                    </span>
                  </div>

                  {selectedDay.slots.length === 0 ? (
                    <p className="rounded-2xl bg-[#f7f7f4] px-4 py-8 text-center text-xs text-black/45">
                      {ar
                        ? 'مفيش مواعيد عمل في اليوم ده.'
                        : 'No working slots on this day.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                      {selectedDay.slots.map((slot) => {
                        const expired = Date.parse(slot.starts_at) <= now;
                        const state = expired ? 'past' : slot.state;
                        const available = slot.available && !expired;
                        const selected =
                          available && chosenSlot?.starts_at === slot.starts_at;

                        return (
                          <button
                            key={slot.starts_at}
                            type="button"
                            disabled={!available}
                            aria-pressed={selected}
                            onClick={() => setSelectedSlot(slot.starts_at)}
                            className={`min-w-0 rounded-2xl border px-2 py-3 text-center transition disabled:cursor-not-allowed ${
                              selected
                                ? 'border-black bg-black text-white'
                                : available
                                  ? 'border-black/10 bg-white text-black hover:border-black'
                                  : 'border-transparent bg-[#f5f5f2] text-black/35'
                            }`}
                          >
                            <span className="block text-xs font-medium">
                              {timeFormatter.format(new Date(slot.starts_at))}
                            </span>

                            <span className="mt-2 flex items-center justify-center gap-1.5 text-[10px]">
                              <span
                                className={`size-1.5 shrink-0 rounded-full ${
                                  selected ? 'bg-white' : dotColors[state]
                                }`}
                              />
                              {state === 'past'
                                ? labels.past
                                : state === 'full'
                                  ? labels.full
                                  : ar
                                    ? `${slot.remaining_capacity} من ${slot.capacity} متاح`
                                    : `${slot.remaining_capacity}/${slot.capacity} available`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {chosenSlot && (
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f5f5f2] p-4">
                      <div>
                        <p className="text-[11px] text-black/45">
                          {ar ? 'المعاد المختار' : 'Selected time'}
                        </p>
                        <p className="mt-1 text-sm font-semibold">
                          {timeFormatter.format(new Date(chosenSlot.starts_at))}
                        </p>
                      </div>
                      <span className="text-[11px] text-black/45">
                        {ar ? 'لم يتم إنشاء حجز' : 'No booking created'}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
