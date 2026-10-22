import { useState, type FormEvent } from 'react';

import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';

type Offering = {
  service_id: string;
  duration_minutes: number;

  is_active: boolean;
};

type Catalog = {
  data: {
    services: { id: string; name: string }[];
    limited: boolean;
  };
};

type Props = {
  clinicId: string;
  doctorId: string;
  doctorName: string;
  token: string;
  ar: boolean;
  onClose: () => void;
};

export default function DoctorServicesEditor({
  clinicId,
  doctorId,
  doctorName,
  token,
  ar,
  onClose,
}: Props) {
  const path = `/api/doctors/${encodeURIComponent(doctorId)}/services`
    + `?clinic_id=${encodeURIComponent(clinicId)}`;

  const offerings = useGet<{ data: Offering[] }>(path, token);

  const catalog = useGet<Catalog>(
    `/api/lead-options?clinic_id=${encodeURIComponent(clinicId)}`,
    token,
  );

  const [serviceId, setServiceId] = useState('');
  const [duration, setDuration] = useState('30');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function selectService(id: string) {
    const existing = offerings.data?.data.find(
      item => item.service_id === id,
    );

    setServiceId(id);
    setDuration(String(existing?.duration_minutes ?? 30));
    setActive(existing?.is_active ?? true);
    setMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const minutes = Number(duration);

    if (
      !serviceId ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 1440
    ) {
      setMessage(ar
        ? 'اختار خدمة ومدة صحيحة بالدقائق.'
        : 'Select a service and a valid duration in minutes.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const response = await fetch(path, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          service_id: serviceId,
          duration_minutes: minutes,
          is_active: active,
        }),
      });

      if (!response.ok) {
        setMessage(response.status === 403
          ? ar
            ? 'معندكش صلاحية تعديل خدمات الدكتور.'
            : 'You cannot edit this doctor’s services.'
          : response.status === 400
            ? ar
              ? 'راجع المدة. تفعيل الخدمة يتطلب إنها تكون نشطة في العيادة.'
              : 'Check the duration. Enabling a service requires it to be active in the clinic.'
            : ar
              ? 'تعذر تأكيد الحفظ. حدّث القائمة للتحقق.'
              : 'Could not confirm the save. Refresh the list to verify.');
        return;
      }

      offerings.retry();
      setMessage(ar ? 'تم حفظ الخدمة.' : 'Service saved.');
    } catch {
      setMessage(ar
        ? 'تعذر تأكيد الحفظ. حدّث القائمة للتحقق.'
        : 'Could not confirm the save. Refresh the list to verify.');
    } finally {
      setBusy(false);
    }
  }

  if (
    offerings.error ||
    catalog.error ||
    !offerings.data ||
    !catalog.data
  ) {
    return (
      <QueryState
        error={offerings.error || catalog.error}
        retry={() => {
          offerings.retry();
          catalog.retry();
        }}
      />
    );
  }

  const services = catalog.data.data.services;
  const assigned = offerings.data.data;

  // Keep existing assignments editable even if the catalog
  // service was subsequently deactivated.
  const choices = [
    ...services,
    ...assigned
      .filter(item => !services.some(
        service => service.id === item.service_id,
      ))
      .map(item => ({
        id: item.service_id,
        name: ar
          ? `خدمة غير متاحة حاليًا (${item.service_id.slice(0, 8)})`
          : `Unavailable service (${item.service_id.slice(0, 8)})`,
      })),
  ];

  function serviceName(id: string) {
    return choices.find(item => item.id === id)?.name ?? id;
  }

  return (
    <section className="glass space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {ar ? 'الخدمات والمدد' : 'Services and durations'}
          </h2>
          <p className="mt-1 text-muted" dir="auto">
            {doctorName}
          </p>
        </div>

        <button
          type="button"
          className="control"
          disabled={busy}
          onClick={onClose}
        >
          {ar ? 'إغلاق' : 'Close'}
        </button>
      </header>

      <form onSubmit={submit}>
        <fieldset disabled={busy} className="grid gap-4">
          <label className="grid gap-2">
            <span>{ar ? 'الخدمة' : 'Service'}</span>
            <select
              className="field"
              value={serviceId}
              required
              onChange={event => selectService(event.target.value)}
            >
              <option value="">
                {ar ? 'اختار الخدمة' : 'Select a service'}
              </option>
              {choices.map(service => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span>
              {ar ? 'المدة عند الدكتور بالدقائق' : 'Duration for this doctor, in minutes'}
            </span>
            <input
              className="field"
              type="number"
              min={1}
              max={1440}
              step={1}
              required
              value={duration}
              onChange={event => setDuration(event.target.value)}
            />
          </label>



          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={active}
              onChange={event => setActive(event.target.checked)}
            />
            <span>
              {ar ? 'الخدمة نشطة عند الدكتور' : 'Service active for this doctor'}
            </span>
          </label>

          <button
            type="submit"
            disabled={busy || !serviceId}
            className="rounded-full bg-black px-6 py-3 text-white disabled:opacity-50"
          >
            {busy
              ? ar ? 'جاري الحفظ…' : 'Saving…'
              : ar ? 'حفظ الخدمة' : 'Save service'}
          </button>
        </fieldset>
      </form>

      {message && <p role="status">{message}</p>}

      {choices.length === 0 && (
        <p className="text-sm text-muted">
          {ar
            ? 'مفيش خدمات نشطة للعيادة. أضف خدمات للعيادة أولًا.'
            : 'No active clinic services. Add clinic services first.'}
        </p>
      )}

      {catalog.data.data.limited && (
        <p className="text-sm text-muted">
          {ar
            ? 'قائمة الخيارات قد تكون محدودة؛ لو الخدمة مش ظاهرة راجع كتالوج العيادة.'
            : 'Options may be limited. Check the clinic catalog if a service is missing.'}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">
          {ar ? 'الخدمات المسجّلة' : 'Assigned services'}
        </h3>
        <button
          type="button"
          className="control"
          disabled={busy}
          onClick={offerings.retry}
        >
          {ar ? 'تحديث القائمة' : 'Refresh list'}
        </button>
      </div>

      {assigned.length === 0 ? (
        <p>{ar ? 'لسه مفيش خدمات للدكتور.' : 'No services assigned yet.'}</p>
      ) : (
        <div className="grid gap-3">
          {assigned.map(item => (
            <article
              key={item.service_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4"
            >
              <div>
                <h4 className="font-semibold" dir="auto">
                  {serviceName(item.service_id)}
                </h4>
                <p className="mt-1 text-sm text-muted">
                  {item.duration_minutes} {ar ? 'دقيقة' : 'minutes'}
                  {' · '}
                  {item.is_active
                    ? ar ? 'نشطة' : 'Active'
                    : ar ? 'غير نشطة' : 'Inactive'}
                  {' · '}

                </p>
              </div>

              <button
                type="button"
                className="control"
                disabled={busy}
                onClick={() => selectService(item.service_id)}
              >
                {ar ? 'تعديل' : 'Edit'}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}