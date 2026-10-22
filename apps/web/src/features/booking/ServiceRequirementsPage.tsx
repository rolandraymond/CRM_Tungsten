import { useState, type FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import type { WorkspaceContext } from '../leads/types';

type ServiceRequirement = {
  service_id: string;
  service_name: string;
  is_active: boolean;
  requires_device: boolean | null;
  required_device_type: string | null;
};

type FormProps = {
  service: ServiceRequirement;
  clinicId: string;
  token: string;
  ar: boolean;
};

function RequirementForm({
  service,
  clinicId,
  token,
  ar,
}: FormProps) {
  const [requirement, setRequirement] = useState(
    service.requires_device === null
      ? ''
      : service.requires_device
        ? 'device'
        : 'none',
  );

  const [deviceType, setDeviceType] = useState(
    service.required_device_type ?? '',
  );

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !requirement) return;

    const normalizedType = deviceType.trim().toLowerCase();

    if (requirement === 'device' && !normalizedType) {
      setMessage(ar
        ? 'اكتب نوع الجهاز المطلوب.'
        : 'Enter the required device type.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const response = await fetch(
        `/api/clinic-service-requirements/${
          encodeURIComponent(service.service_id)
        }?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requires_device: requirement === 'device',
            required_device_type: requirement === 'device'
              ? normalizedType
              : null,
          }),
        },
      );

      if (!response.ok) {
        setMessage(response.status === 403
          ? ar
            ? 'معندكش صلاحية تعديل إعداد الخدمة.'
            : 'You cannot edit this service’s settings.'
          : response.status === 400
            ? ar
              ? 'راجع نوع الجهاز المطلوب.'
              : 'Check the required device type.'
            : response.status === 404
              ? ar
                ? 'الخدمة غير متاحة للتعديل.'
                : 'This service is unavailable for editing.'
              : ar
                ? 'تعذر تأكيد الحفظ. أعد فتح الصفحة للتحقق.'
                : 'Could not confirm the save. Reopen the page to verify.');
        return;
      }

      if (requirement === 'device') {
        setDeviceType(normalizedType);
      } else {
        setDeviceType('');
      }

      setMessage(ar ? 'تم حفظ الإعداد.' : 'Settings saved.');
    } catch {
      setMessage(ar
        ? 'تعذر تأكيد الحفظ. أعد فتح الصفحة للتحقق.'
        : 'Could not confirm the save. Reopen the page to verify.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="glass space-y-4 p-6" onSubmit={save}>
      <header>
        <h2 className="text-lg font-semibold" dir="auto">
          {service.service_name}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {service.is_active
            ? ar ? 'الخدمة نشطة في العيادة' : 'Service active in clinic'
            : ar ? 'الخدمة غير نشطة' : 'Service inactive'}
        </p>
      </header>

      <fieldset disabled={busy} className="grid gap-4">
        <label className="grid gap-2">
          <span>{ar ? 'احتياج الخدمة للجهاز' : 'Device requirement'}</span>
          <select
            className="field"
            value={requirement}
            required
            onChange={event => {
              setRequirement(event.target.value);
              setMessage('');
            }}
          >
            <option value="">
              {ar ? 'غير محدد — اختار الإعداد' : 'Not configured — select an option'}
            </option>
            <option value="device">
              {ar ? 'تحتاج جهاز' : 'Requires a device'}
            </option>
            <option value="none">
              {ar ? 'بدون جهاز' : 'No device required'}
            </option>
          </select>
        </label>

        {requirement === 'device' && (
          <label className="grid gap-2">
            <span>{ar ? 'نوع الجهاز المطلوب' : 'Required device type'}</span>
            <input
              className="field"
              value={deviceType}
              onChange={event => {
                setDeviceType(event.target.value);
                setMessage('');
              }}
              placeholder="laser / onda"
              required
              maxLength={100}
              dir="ltr"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={busy || !requirement}
          className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-50"
        >
          {busy
            ? ar ? 'جاري الحفظ…' : 'Saving…'
            : ar ? 'حفظ الإعداد' : 'Save settings'}
        </button>
      </fieldset>

      {message && <p role="status">{message}</p>}
    </form>
  );
}

export default function ServiceRequirementsPage() {
  const { clinic, token, isAdmin } =
    useOutletContext<WorkspaceContext>();

  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language)
    .startsWith('ar');

  const canManage = Boolean(isAdmin)
    || clinic.role === 'platform_admin'
    || clinic.role === 'clinic_manager';

  const query = useGet<{ data: ServiceRequirement[] }>(
    canManage
      ? `/api/clinic-service-requirements?clinic_id=${
          encodeURIComponent(clinic.id)
        }`
      : null,
    token,
  );

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
          {ar
            ? 'متطلبات الأجهزة للخدمات'
            : 'Service device requirements'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {ar
            ? 'الإعداد ده يسري على كل الدكاترة اللي بيقدموا الخدمة في العيادة.'
            : 'These requirements apply to every doctor performing the service in this clinic.'}
        </p>
      </header>

      {query.error || !query.data ? (
        <QueryState error={query.error} retry={query.retry} />
      ) : query.data.data.length === 0 ? (
        <p className="glass p-6">
          {ar
            ? 'مفيش خدمات مرتبطة بالعيادة.'
            : 'No services assigned to this clinic.'}
        </p>
      ) : (
        query.data.data.map(service => (
          <RequirementForm
            key={`${clinic.id}:${token}:${service.service_id}`}
            service={service}
            clinicId={clinic.id}
            token={token}
            ar={ar}
          />
        ))
      )}
    </div>
  );
}