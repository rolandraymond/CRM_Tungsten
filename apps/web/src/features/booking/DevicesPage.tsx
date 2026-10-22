import { useState, type FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import type { WorkspaceContext } from '../leads/types';

type Device = {
  id: string;
  device_name: string;
  device_type: string;
  is_active: boolean;
};

type Props = {
  clinicId: string;
  token: string;
  ar: boolean;
};

function DevicesManager({ clinicId, token, ar }: Props) {
  const query = useGet<{ data: Device[] }>(
    `/api/devices?clinic_id=${encodeURIComponent(clinicId)}`,
    token,
  );

  const [name, setName] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function resetForm() {
    setName('');
    setDeviceType('');
    setEditingId(null);
  }

  async function save(
    deviceId: string | null,
    body: Record<string, unknown>,
  ) {
    if (busy) return;

    setBusy(true);
    setMessage('');

    const path = deviceId
      ? `/api/devices/${encodeURIComponent(deviceId)}?clinic_id=${
          encodeURIComponent(clinicId)
        }`
      : '/api/devices';

    try {
      const response = await fetch(path, {
        method: deviceId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setMessage(response.status === 403
          ? ar
            ? 'معندكش صلاحية إدارة الأجهزة.'
            : 'You cannot manage devices.'
          : response.status === 400
            ? ar
              ? 'راجع اسم الجهاز ونوعه.'
              : 'Check the device name and type.'
            : response.status === 404
              ? ar
                ? 'الجهاز غير متاح للتعديل.'
                : 'This device is unavailable for editing.'
              : ar
                ? 'تعذر تأكيد الحفظ. حدّث القائمة للتحقق.'
                : 'Could not confirm the save. Refresh the list to verify.');
        return;
      }

      resetForm();
      query.retry();
      setMessage(ar ? 'تم الحفظ.' : 'Saved.');
    } catch {
      setMessage(ar
        ? 'تعذر تأكيد الحفظ. حدّث القائمة للتحقق.'
        : 'Could not confirm the save. Refresh the list to verify.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const deviceName = name.trim();
    const normalizedType = deviceType.trim().toLowerCase();

    if (busy || !deviceName || (!editingId && !normalizedType)) {
      return;
    }

    void save(
      editingId,
      editingId
        ? { device_name: deviceName }
        : {
            clinic_id: clinicId,
            device_name: deviceName,
            device_type: normalizedType,
            is_active: true,
          },
    );
  }

  return (
    <div className="space-y-5">
      <form className="glass grid gap-4 p-6" onSubmit={submit}>
        <h2 className="text-lg font-semibold">
          {editingId
            ? ar ? 'تعديل الجهاز' : 'Edit device'
            : ar ? 'إضافة جهاز' : 'Add device'}
        </h2>

        <fieldset disabled={busy} className="grid gap-4">
          <label className="grid gap-2">
            <span>{ar ? 'اسم الجهاز' : 'Device name'}</span>
            <input
              className="field"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Laser 1"
              required
              maxLength={200}
              dir="auto"
            />
          </label>

          <label className="grid gap-2">
            <span>{ar ? 'نوع الجهاز' : 'Device type'}</span>
            <input
              className="field"
              value={deviceType}
              onChange={event => setDeviceType(event.target.value)}
              placeholder="laser / onda"
              required
              maxLength={100}
              disabled={editingId !== null}
              dir="ltr"
            />
          </label>

          <p className="text-sm text-muted">
            {editingId
              ? ar
                ? 'نوع الجهاز ثابت؛ تقدر تعدّل الاسم والحالة.'
                : 'The device type is fixed. You can edit its name and status.'
              : ar
                ? 'استخدم نفس نوع الجهاز المحدد في إعداد الخدمة، مثل laser أو onda.'
                : 'Use the same device type configured for the service, such as laser or onda.'}
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-50"
            >
              {busy
                ? ar ? 'جاري الحفظ…' : 'Saving…'
                : ar ? 'حفظ الجهاز' : 'Save device'}
            </button>

            {editingId && (
              <button
                type="button"
                className="control"
                onClick={resetForm}
              >
                {ar ? 'إلغاء التعديل' : 'Cancel edit'}
              </button>
            )}
          </div>
        </fieldset>
      </form>

      {message && (
        <p className="glass p-4" role="status">{message}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {ar ? 'أجهزة العيادة' : 'Clinic devices'}
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
          {ar ? 'لسه مفيش أجهزة مضافة.' : 'No devices added yet.'}
        </p>
      ) : (
        <div className="grid gap-3">
          {query.data.data.map(device => (
            <article
              key={device.id}
              className="glass flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div>
                <h3 className="font-semibold" dir="auto">
                  {device.device_name}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  <span dir="ltr">{device.device_type}</span>
                  {' · '}
                  {device.is_active
                    ? ar ? 'نشط' : 'Active'
                    : ar ? 'غير نشط' : 'Inactive'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="control"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(device.id);
                    setName(device.device_name);
                    setDeviceType(device.device_type);
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
                    void save(device.id, {
                      is_active: !device.is_active,
                    });
                  }}
                >
                  {device.is_active
                    ? ar ? 'تعطيل' : 'Deactivate'
                    : ar ? 'تفعيل' : 'Activate'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DevicesPage() {
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
          {ar ? 'إدارة الأجهزة' : 'Manage devices'}
        </h1>
      </header>

      <DevicesManager
        key={`${clinic.id}:${token}`}
        clinicId={clinic.id}
        token={token}
        ar={ar}
      />
    </div>
  );
}