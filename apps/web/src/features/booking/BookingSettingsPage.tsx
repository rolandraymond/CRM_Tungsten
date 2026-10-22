import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import type { WorkspaceContext } from '../leads/types';

type Settings = {
  clinic_id: string;
  timezone: string;
  working_days: number[];
  opens_at: string;
  closes_at: string;
  slot_minutes: number;
  slot_capacity: number;
  enabled: boolean;
  updated_at: string;
};

type Draft = {
  working_days: number[];
  opens_at: string;
  closes_at: string;
  slot_minutes: number;
  slot_capacity: number;
  enabled: boolean;
};

type FormProps = {
  settings: Settings | null;
  clinicId: string;
  token: string;
  ar: boolean;
  onSaved: () => void;
};

function SettingsForm({
  settings,
  clinicId,
  token,
  ar,
  onSaved,
}: FormProps) {
  const [draft, setDraft] = useState<Draft>(() => ({
    working_days: settings?.working_days ?? [1, 2, 3, 4, 5, 6],
    opens_at: settings?.opens_at.slice(0, 5) ?? '13:00',
    closes_at: settings?.closes_at.slice(0, 5) ?? '01:00',
    slot_minutes: settings?.slot_minutes ?? 30,
    slot_capacity: settings?.slot_capacity ?? 1,
    enabled: settings?.enabled ?? false,
  }));

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const weekdays = ar
    ? ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس',
       'الجمعة', 'السبت', 'الأحد']
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday',
       'Friday', 'Saturday', 'Sunday'];

  function toggleDay(day: number) {
    setDraft(previous => ({
      ...previous,
      working_days: previous.working_days.includes(day)
        ? previous.working_days.filter(value => value !== day)
        : [...previous.working_days, day].sort((a, b) => a - b),
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (draft.enabled && draft.working_days.length === 0) {
      setMessage(ar
        ? 'اختار يوم عمل واحد على الأقل.'
        : 'Select at least one working day.');
      return;
    }

    if (draft.opens_at === draft.closes_at) {
      setMessage(ar
        ? 'وقت الفتح والقفل لازم يكونوا مختلفين.'
        : 'Opening and closing times must differ.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const response = await fetch('/api/booking-settings', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clinic_id: clinicId,
          ...draft,
        }),
      });

      if (!response.ok) {
        setMessage(response.status === 403
          ? ar
            ? 'حفظ الإعدادات متاح لمدير العيادة فقط.'
            : 'Only the clinic manager can save these settings.'
          : response.status === 400
            ? ar
              ? 'راجع أيام العمل والساعات والمدة والسعة.'
              : 'Check working days, hours, duration and capacity.'
            : ar
              ? 'تعذر تأكيد الحفظ. أعد تحميل الصفحة للتحقق.'
              : 'Could not confirm the save. Reload to verify.');
        return;
      }

      onSaved();
    } catch {
      setMessage(ar
        ? 'تعذر تأكيد الحفظ. أعد تحميل الصفحة للتحقق.'
        : 'Could not confirm the save. Reload to verify.');
    } finally {
      setBusy(false);
    }
  }

  const overnight = draft.closes_at < draft.opens_at;

  return (
    <form className="glass grid gap-6 p-6 sm:p-8" onSubmit={save}>
      <fieldset disabled={busy} className="grid gap-6">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={event => setDraft(previous => ({
              ...previous,
              enabled: event.target.checked,
            }))}
          />
          <span className="font-semibold">
            {ar ? 'تفعيل مواعيد الحجز' : 'Enable booking schedule'}
          </span>
        </label>

        <div>
          <p className="mb-3 font-semibold">
            {ar ? 'أيام العمل' : 'Working days'}
          </p>

          <div className="flex flex-wrap gap-2">
            {weekdays.map((label, index) => {
              const day = index + 1;
              const selected = draft.working_days.includes(day);

              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleDay(day)}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    selected
                      ? 'border-black bg-black text-white'
                      : 'border-line bg-white text-black'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2">
            <span>{ar ? 'وقت الفتح' : 'Opening time'}</span>
            <input
              className="field"
              type="time"
              required
              value={draft.opens_at}
              onChange={event => setDraft(previous => ({
                ...previous,
                opens_at: event.target.value,
              }))}
            />
          </label>

          <label className="grid gap-2">
            <span>{ar ? 'وقت القفل' : 'Closing time'}</span>
            <input
              className="field"
              type="time"
              required
              value={draft.closes_at}
              onChange={event => setDraft(previous => ({
                ...previous,
                closes_at: event.target.value,
              }))}
            />
          </label>
        </div>

        <p className="text-sm text-muted">
          {ar ? 'كل المواعيد بتوقيت القاهرة.' : 'All times use Cairo timezone.'}
          {' '}
          {overnight && (ar
            ? 'الشيفت بيكمل بعد منتصف الليل لليوم التالي.'
            : 'The shift continues past midnight into the next day.')}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2">
            <span>{ar ? 'مدة الموعد' : 'Slot duration'}</span>
            <select
              className="field"
              value={draft.slot_minutes}
              onChange={event => setDraft(previous => ({
                ...previous,
                slot_minutes: Number(event.target.value),
              }))}
            >
              {[10, 20, 30, 60].map(minutes => (
                <option key={minutes} value={minutes}>
                  {minutes} {ar ? 'دقيقة' : 'minutes'}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span>
              {ar ? 'السعة لكل موعد' : 'Capacity per slot'}
            </span>
            <input
              className="field"
              type="number"
              min={1}
              max={100}
              step={1}
              required
              value={draft.slot_capacity}
              onChange={event => setDraft(previous => ({
                ...previous,
                slot_capacity: Number(event.target.value),
              }))}
            />
          </label>
        </div>

        <p className="text-sm text-muted">
          {ar
            ? 'مثال: سعة 3 تسمح بثلاثة حجوزات في نفس الموعد للعيادة كلها.'
            : 'Example: capacity 3 allows three bookings in the same slot across the clinic.'}
        </p>

        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-50"
        >
          {busy
            ? ar ? 'جاري الحفظ…' : 'Saving…'
            : ar ? 'حفظ الإعدادات' : 'Save settings'}
        </button>
      </fieldset>

      {message && <p role="alert">{message}</p>}
    </form>
  );
}

export default function BookingSettingsPage() {
  const { clinic, token, isAdmin } =
    useOutletContext<WorkspaceContext>();
  const { i18n } = useTranslation();

  const ar = (i18n.resolvedLanguage ?? i18n.language)
    .startsWith('ar');

  const canManage = Boolean(isAdmin)
    || clinic.role === 'platform_admin'
    || clinic.role === 'clinic_manager';

  const query = useGet<{ data: Settings | null }>(
    canManage
      ? `/api/booking-settings?clinic_id=${encodeURIComponent(clinic.id)}`
      : null,
    token,
  );

  const [savedClinic, setSavedClinic] = useState<string | null>(null);

  if (!canManage) {
    return (
      <p className="glass p-6" role="alert">
        {ar
          ? 'الصفحة دي متاحة لمدير العيادة فقط.'
          : 'This page is available to the clinic manager only.'}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/leads" className="control inline-flex">
        {ar ? 'رجوع للعملاء' : 'Back to leads'}
      </Link>
      <Link to="/booking/doctors" className="control inline-flex">
        {ar ? 'إدارة الدكاترة' : 'Manage doctors'}
      </Link>

      <Link
  to="/booking/service-requirements"
  className="control inline-flex"
>
  {ar ? 'متطلبات أجهزة الخدمات' : 'Service device requirements'}
</Link>


<Link to="/booking/devices" className="control inline-flex">
  {ar ? 'إدارة الأجهزة' : 'Manage devices'}
</Link>
      <header>
        <p className="eyebrow" dir="auto">{clinic.name}</p>
        <h1 className="mt-3 text-3xl font-semibold">
          {ar ? 'إعدادات مواعيد العيادة' : 'Clinic booking settings'}
        </h1>
      </header>

      {savedClinic === clinic.id && (
        <p className="glass p-4" role="status">
          {ar ? 'تم حفظ الإعدادات.' : 'Settings saved.'}
        </p>
      )}

      {query.error || !query.data ? (
        <QueryState error={query.error} retry={query.retry} />
      ) : (
        <SettingsForm
          key={`${clinic.id}:${query.data.data?.updated_at ?? 'new'}`}
          settings={query.data.data}
          clinicId={clinic.id}
          token={token}
          ar={ar}
          onSaved={() => {
            setSavedClinic(clinic.id);
            query.retry();
          }}
        />
      )}
    </div>
  );
}