import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useGet } from '../../hooks/useGet';
import { useClinicChanges } from '../../hooks/useClinicChanges';

const liveTables = ['appointments'] as const;

type DayState = 'available' | 'unavailable' | 'unknown' | 'booked' | 'empty' | 'past';

interface CalendarDay {
  date: string;
  state: DayState;
  booked_clients: number;
}

interface Props {
  clinicId: string;
  serviceId: string;
  doctorId?: string;
  ready: boolean;
  token: string;
  ar: boolean;
  date: string;
  onDateChange: (date: string) => void;
  children: ReactNode;
}

const colors: Record<DayState, string> = {
  available: 'bg-emerald-500',
  unavailable: 'bg-rose-500',
  unknown: 'bg-amber-400',
  booked: 'bg-amber-400',
  empty: 'bg-gray-200',
  past: 'bg-gray-300',
};

function shiftMonth(month: string, amount: number) {
  const [year, number] = month.split('-').map(Number);
  const value = new Date(Date.UTC(year, number - 1 + amount, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function BookingCalendarLayout(props: Props) {
  const { clinicId, serviceId, doctorId, ready, token, ar, date, onDateChange } = props;
  const [month, setMonth] = useState(() => date.slice(0, 7));
  const locale = ar ? 'ar-EG' : 'en-GB';
  const firstDay = new Date(`${month}-01T12:00:00Z`);
  const blankDays = (firstDay.getUTCDay() + 6) % 7;
  const [year, number] = month.split('-').map(Number);
  const dayCount = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const weekdays = ar
    ? ['اث', 'ثل', 'أر', 'خم', 'جم', 'سب', 'أح']
    : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const params = new URLSearchParams({ clinic_id: clinicId, service_id: serviceId, month });
  if (doctorId) params.set('doctor_id', doctorId);
  const calendar = useGet<{ data: { days: CalendarDay[] } }>(
    ready ? `/api/booking-resource-calendar?${params}` : null,
    token,
  );
  useClinicChanges(clinicId, liveTables, calendar.retry);

  const labels: Record<DayState, string> = {
    available: ar ? 'متاح' : 'Available',
    unavailable: ar ? 'غير متاح' : 'Unavailable',
    unknown: ar ? 'يحتاج مراجعة' : 'Needs review',
    booked: ar ? 'عليه حجوزات' : 'Has bookings',
    empty: ar ? 'بدون حجوزات' : 'No bookings',
    past: ar ? 'انتهى' : 'Past',
  };

  function changeMonth(amount: number) {
    setMonth(current => shiftMonth(current, amount));
    onDateChange('');
  }

  return (
    <section
      dir={ar ? 'rtl' : 'ltr'}
      className="min-w-0 rounded-[28px] p-3 text-[#171717] sm:rounded-[36px] sm:p-5"
      style={{ background: 'linear-gradient(120deg, #e8e9e7 0%, #eeeee8 55%, #e9e1c6 100%)' }}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <span className="rounded-full bg-black px-4 py-2.5 text-xs font-medium text-white">
          {ar ? 'الحجوزات' : 'Bookings'}
        </span>
        <span className="text-xs text-black/55">
          {ar ? 'المواعيد بتوقيت القاهرة' : 'Times in Cairo'}
        </span>
      </header>

      <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-[24px] bg-white/90 p-4 backdrop-blur-xl sm:p-5">
          <div className="mb-5 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {new Intl.DateTimeFormat(locale, {
                month: 'long', year: 'numeric', timeZone: 'UTC',
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
              <span key={index} className="pb-2 text-center text-[10px] text-black/40">{day}</span>
            ))}
            {Array.from({ length: blankDays }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden="true" />
            ))}
            {Array.from({ length: dayCount }, (_, index) => {
              const value = `${month}-${String(index + 1).padStart(2, '0')}`;
              const day = calendar.data?.data.days.find(item => item.date === value);
              const selected = date === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  aria-label={day
                    ? `${value}: ${day.booked_clients} ${ar ? 'عميل' : 'clients'}, ${labels[day.state]}`
                    : value}
                  onClick={() => onDateChange(value)}
                  className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full py-2 transition ${
                    selected ? 'bg-black text-white' : 'text-black hover:bg-[#f2f2ef]'
                  }`}
                >
                  <span className={`text-[9px] ${selected ? 'text-white/65' : 'text-black/40'}`}>
                    {index + 1}
                  </span>
                  <span className="text-sm font-semibold leading-5">{day?.booked_clients ?? '—'}</span>
                  <span className={`size-1 rounded-full ${selected ? 'bg-white' : colors[day?.state ?? 'unknown']}`} />
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
              {(['available', 'unavailable', 'unknown'] as const).map(state => (
                <span key={state} className="flex items-center gap-1.5 text-[10px] text-black/55">
                  <span className={`size-1.5 rounded-full ${colors[state]}`} />
                  {labels[state]}
                </span>
              ))}
            </div>
            {calendar.loading && <p role="status" className="mt-3 text-xs">{ar ? 'جاري تحميل الأيام…' : 'Loading days…'}</p>}
            {calendar.error && (
              <button type="button" onClick={calendar.retry} className="mt-3 flex items-center gap-2 text-xs underline">
                <RefreshCw size={12} />
                {ar ? 'إعادة تحميل التقويم' : 'Reload calendar'}
              </button>
            )}
          </div>
        </aside>

        <div className="min-w-0 rounded-[24px] bg-white/90 p-4 backdrop-blur-xl sm:p-6">
          {date ? (
            <>
              <h3 className="mb-2 text-lg font-semibold">
                {new Intl.DateTimeFormat(locale, {
                  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
                }).format(new Date(`${date}T12:00:00Z`))}
              </h3>
              {props.children}
            </>
          ) : (
            <p className="py-16 text-center text-sm text-black/45">
              {ar ? 'اختار يوم عشان تظهر المواعيد المتاحة.' : 'Choose a day to see available times.'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
