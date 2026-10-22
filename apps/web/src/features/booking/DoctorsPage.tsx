import { useState, type FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import type { WorkspaceContext } from '../leads/types';
import DoctorServicesEditor from './DoctorServicesEditor';

type Doctor = {
  id: string;
  clinic_id: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
};

type Props = {
  clinicId: string;
  token: string;
  ar: boolean;
};

function DoctorsManager({ clinicId, token, ar }: Props) {
  const query = useGet<{ data: Doctor[] }>(
    `/api/doctors?clinic_id=${encodeURIComponent(clinicId)}`,
    token,
  );

  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [servicesDoctor, setServicesDoctor] =
  useState<Doctor | null>(null);

  function resetForm() {
    setName('');
    setEditingId(null);
  }

  async function save(
    method: 'POST' | 'PATCH',
    doctorId: string | null,
    body: Record<string, unknown>,
  ) {
    if (busy) return;

    setBusy(true);
    setMessage('');

    const path = doctorId
      ? `/api/doctors/${encodeURIComponent(doctorId)}?clinic_id=${
          encodeURIComponent(clinicId)
        }`
      : '/api/doctors';

    try {
      const response = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setMessage(
          response.status === 403
            ? ar
              ? 'معندكش صلاحية إدارة الدكاترة.'
              : 'You cannot manage doctors.'
            : response.status === 400
              ? ar
                ? 'راجع البيانات المدخلة.'
                : 'Check the entered information.'
              : response.status === 404
                ? ar
                  ? 'الدكتور غير متاح للتعديل.'
                  : 'This doctor is unavailable for editing.'
                : ar
                  ? 'تعذر تأكيد الحفظ. حدّث القائمة للتحقق.'
                  : 'Could not confirm the save. Refresh the list to verify.',
        );
        return;
      }

      resetForm();
      query.retry();
      setMessage(ar ? 'تم الحفظ.' : 'Saved.');
    } catch {
      setMessage(
        ar
          ? 'تعذر تأكيد الحفظ. حدّث القائمة للتحقق.'
          : 'Could not confirm the save. Refresh the list to verify.',
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const fullName = name.trim();
    if (!fullName || busy) return;

    void save(
      editingId ? 'PATCH' : 'POST',
      editingId,
      editingId
        ? { full_name: fullName }
        : {
            clinic_id: clinicId,
            full_name: fullName,
            is_active: true,
          },
    );
  }

  return (
    <div className="space-y-5">
      <form
        className="glass grid gap-4 p-6"
        onSubmit={submit}
      >



        <h2 className="text-lg font-semibold">
          {editingId
            ? ar ? 'تعديل الدكتور' : 'Edit doctor'
            : ar ? 'إضافة دكتور' : 'Add doctor'}
        </h2>

        <label className="grid gap-2">
          <span>{ar ? 'اسم الدكتور' : 'Doctor name'}</span>
          <input
            className="field"
            value={name}
            onChange={event => setName(event.target.value)}
            required
            maxLength={200}
            disabled={busy}
            dir="auto"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-50"
          >
            {busy
              ? ar ? 'جاري الحفظ…' : 'Saving…'
              : ar ? 'حفظ' : 'Save'}
          </button>

          {editingId && (
            <button
              type="button"
              className="control"
              disabled={busy}
              onClick={resetForm}
            >
              {ar ? 'إلغاء التعديل' : 'Cancel edit'}
            </button>
          )}
        </div>
      </form>

      {message && (
        <p className="glass p-4" role="status">
          {message}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {ar ? 'دكاترة العيادة' : 'Clinic doctors'}
        </h2>
        <button
          type="button"
          className="control"
          disabled={busy}
          onClick={query.retry}
        >
          {ar ? 'تحديث القائمة' : 'Refresh list'}
        </button>
      </div>

      {query.error || !query.data ? (
        <QueryState error={query.error} retry={query.retry} />
      ) : query.data.data.length === 0 ? (
        <p className="glass p-6">
          {ar ? 'لسه مفيش دكاترة مضافين.' : 'No doctors added yet.'}
        </p>
      ) : (
        <div className="grid gap-3">
          {query.data.data.map(doctor => (
            <article
              key={doctor.id}
              className="glass flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div>
                <h3 className="font-semibold" dir="auto">
                  {doctor.full_name}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {doctor.is_active
                    ? ar ? 'نشط' : 'Active'
                    : ar ? 'غير نشط' : 'Inactive'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">

                <button
                type="button"
                className="control"
                disabled={busy}
                onClick={() => setServicesDoctor(doctor)}
                >
                {ar ? 'الخدمات والمدد' : 'Services and durations'}
                </button>
                <button
                  type="button"
                  className="control"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(doctor.id);
                    setName(doctor.full_name);
                    setMessage('');
                  }}
                >
                  {ar ? 'تعديل الاسم' : 'Edit name'}
                </button>

                <button
                  type="button"
                  className="control"
                  disabled={busy}
                  onClick={() => {
                    void save('PATCH', doctor.id, {
                      is_active: !doctor.is_active,
                    });
                  }}
                >
                  {doctor.is_active
                    ? ar ? 'تعطيل' : 'Deactivate'
                    : ar ? 'تفعيل' : 'Activate'}
                </button>
              </div>
          </article>
        ))}
      </div>
    )}

    {servicesDoctor && (
      <DoctorServicesEditor
        key={servicesDoctor.id}
        clinicId={clinicId}
        doctorId={servicesDoctor.id}
        doctorName={servicesDoctor.full_name}
        token={token}
        ar={ar}
        onClose={() => setServicesDoctor(null)}
      />
    )}
  </div>
);
}

export default function DoctorsPage() {
  const { clinic, token, isAdmin } =
    useOutletContext<WorkspaceContext>();

  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language)
    .startsWith('ar');

  const canManage = Boolean(isAdmin)
    || clinic.role === 'platform_admin'
    || clinic.role === 'clinic_manager';

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
      <Link to="/booking/settings" className="control inline-flex">
        {ar ? 'إعدادات الحجز' : 'Booking settings'}
      </Link>

      <header>
        <p className="eyebrow" dir="auto">{clinic.name}</p>
        <h1 className="mt-3 text-3xl font-semibold">
          {ar ? 'إدارة الدكاترة' : 'Manage doctors'}
        </h1>
      </header>

      <DoctorsManager
        key={`${clinic.id}:${token}`}
        clinicId={clinic.id}
        token={token}
        ar={ar}
      />
    </div>
  );
}
