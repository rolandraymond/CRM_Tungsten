import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { WorkspaceContext } from '../leads/types';

type Doctor = { id: string; full_name: string; is_active: boolean };
type Device = {
  id: string;
  device_name: string;
  device_type: string;
  is_active: boolean;
};
type Service = {
  service_id: string;
  service_name: string;
  is_active: boolean;
  requires_device: boolean | null;
};
type ServiceDevice = { service_id: string; device_id: string; is_active: boolean };
type Offering = {
  doctor_id: string;
  service_id: string;
  duration_minutes: number;
  is_active: boolean;
};
type DoctorDevice = ServiceDevice & { doctor_id: string };
type Period = {
  id: string;
  doctor_id: string | null;
  device_id: string | null;
  iso_weekday: number;
  starts_at: string;
  ends_at: string;
  end_day_offset: number;
  is_active: boolean;
};
type Block = {
  id: string;
  doctor_id: string | null;
  device_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string;
};
type Setup = {
  doctors: Doctor[];
  devices: Device[];
  services: Service[];
  service_devices: ServiceDevice[];
  doctor_services: Offering[];
  doctor_devices: DoctorDevice[];
  periods: Period[];
  blocks: Block[];
};
type Save = (
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
) => Promise<boolean>;
type Shared = { ar: boolean; busy: boolean; save: Save };
const button = 'rounded-full bg-black px-5 py-2.5 text-white disabled:opacity-40';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span>{label}</span>
      {children}
    </label>
  );
}
function toggle(values: string[], id: string) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}
function DevicesChoice({
  devices,
  ids,
  onChange,
  ar,
}: {
  devices: Device[];
  ids: string[];
  onChange: (ids: string[]) => void;
  ar: boolean;
}) {
  return (
    <div className="grid gap-2">
      {devices.length === 0 && (
        <p className="text-sm text-muted">
          {ar
            ? 'مفيش أجهزة متاحة. أضف جهازًا من تبويب الأجهزة.'
            : 'No devices available. Add a device in Devices.'}
        </p>
      )}
      {devices.map((device) => (
        <label
          key={device.id}
          className="flex items-center gap-3 rounded-xl border border-line p-3"
        >
          <input
            type="checkbox"
            checked={ids.includes(device.id)}
            disabled={!device.is_active && !ids.includes(device.id)}
            onChange={() => onChange(toggle(ids, device.id))}
          />
          <span dir="auto">{device.device_name}</span>
          {!device.is_active && (
            <span className="text-sm text-muted">{ar ? 'غير نشط' : 'Inactive'}</span>
          )}
        </label>
      ))}
    </div>
  );
}
function ResourceCard({
  resource,
  kind,
  ar,
  busy,
  save,
}: Shared & {
  resource: Doctor | Device;
  kind: 'doctors' | 'devices';
}) {
  const original = 'full_name' in resource ? resource.full_name : resource.device_name;
  const [name, setName] = useState(original);
  return (
    <form
      className="glass grid gap-3 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save(
          `/${kind}/${resource.id}`,
          'PATCH',
          kind === 'doctors' ? { full_name: name.trim() } : { device_name: name.trim() },
        );
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <Field label={ar ? 'الاسم' : 'Name'}>
          <input
            className="field"
            required
            maxLength={200}
            dir="auto"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            {resource.is_active ? (ar ? 'نشط' : 'Active') : ar ? 'غير نشط' : 'Inactive'}
          </span>
          <button
            className="control"
            type="submit"
            disabled={!name.trim() || name.trim() === original}
          >
            {ar ? 'حفظ الاسم' : 'Save name'}
          </button>
          <button
            className="control"
            type="button"
            onClick={() => {
              void save(`/${kind}/${resource.id}`, 'PATCH', {
                is_active: !resource.is_active,
              });
            }}
          >
            {resource.is_active
              ? ar
                ? 'تعطيل'
                : 'Deactivate'
              : ar
                ? 'تفعيل'
                : 'Activate'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function ResourceList({
  kind,
  data,
  ...shared
}: Shared & { kind: 'doctors' | 'devices'; data: Setup }) {
  const [name, setName] = useState('');
  const list = kind === 'doctors' ? data.doctors : data.devices;
  return (
    <div className="space-y-4">
      <form
        className="glass grid gap-4 p-6"
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            await shared.save(
              `/${kind}`,
              'POST',
              kind === 'doctors'
                ? { full_name: name.trim() }
                : { device_name: name.trim() },
            )
          )
            setName('');
        }}
      >
        <h2 className="text-lg font-semibold">
          {kind === 'doctors'
            ? shared.ar
              ? 'إضافة دكتور'
              : 'Add doctor'
            : shared.ar
              ? 'إضافة جهاز فعلي'
              : 'Add a physical device'}
        </h2>
        <fieldset disabled={shared.busy} className="grid gap-4">
          <Field label={shared.ar ? 'الاسم' : 'Name'}>
            <input
              className="field"
              required
              maxLength={200}
              value={name}
              dir="auto"
              placeholder={kind === 'devices' ? 'Laser 1' : ''}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <button className={button} disabled={!name.trim()}>
            {shared.ar ? 'إضافة' : 'Add'}
          </button>
        </fieldset>
      </form>
      {list.length === 0 && (
        <p className="glass p-5">
          {shared.ar ? 'لسه مفيش بيانات مسجّلة.' : 'Nothing added yet.'}
        </p>
      )}
      {list.map((resource) => (
        <ResourceCard
          key={`${resource.id}:${JSON.stringify(resource)}`}
          resource={resource}
          kind={kind}
          {...shared}
        />
      ))}
    </div>
  );
}
function ServiceForm({
  service,
  data,
  ...shared
}: Shared & { service: Service; data: Setup }) {
  const [mode, setMode] = useState(
    service.requires_device === null ? '' : service.requires_device ? 'device' : 'none',
  );
  const [ids, setIds] = useState(
    data.service_devices
      .filter((row) => row.service_id === service.service_id && row.is_active)
      .map((row) => row.device_id),
  );
  return (
    <form
      className="glass space-y-4 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void shared.save(`/services/${service.service_id}`, 'PUT', {
          requires_device: mode === 'device',
          device_ids: mode === 'device' ? ids : [],
        });
      }}
    >
      <header>
        <h2 className="text-lg font-semibold" dir="auto">
          {service.service_name}
        </h2>
        {!service.is_active && (
          <p className="text-sm text-muted">
            {shared.ar ? 'الخدمة غير نشطة' : 'Service inactive'}
          </p>
        )}
      </header>
      <fieldset disabled={shared.busy} className="grid gap-4">
        <Field
          label={
            shared.ar ? 'الجهاز المطلوب للخدمة' : 'Devices required for this service'
          }
        >
          <select
            className="field"
            required
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="">{shared.ar ? 'اختار الإعداد' : 'Select requirement'}</option>
            <option value="none">
              {shared.ar ? 'الخدمة بدون جهاز' : 'No device required'}
            </option>
            <option value="device">
              {shared.ar
                ? 'تحتاج جهازًا من الأجهزة التالية'
                : 'Requires one of these devices'}
            </option>
          </select>
        </Field>
        {mode === 'device' && (
          <DevicesChoice
            devices={data.devices}
            ids={ids}
            onChange={setIds}
            ar={shared.ar}
          />
        )}
        <button
          className={button}
          disabled={!mode || (mode === 'device' && ids.length === 0)}
        >
          {shared.ar ? 'حفظ الخدمة وأجهزتها' : 'Save service and devices'}
        </button>
      </fieldset>
      <p className="text-sm text-muted">
        {shared.ar
          ? 'اختار الأجهزة البديلة المناسبة للخدمة. كل جلسة تستخدم جهازًا واحدًا منها.'
          : 'Select suitable alternative devices. Each appointment uses one device.'}
      </p>
    </form>
  );
}
function OfferingForm({
  doctorId,
  service,
  offering,
  data,
  ...shared
}: Shared & {
  doctorId: string;
  service: Service;
  offering?: Offering;
  data: Setup;
}) {
  const [duration, setDuration] = useState(String(offering?.duration_minutes ?? 30));
  const [active, setActive] = useState(offering?.is_active ?? true);
  const permitted = data.service_devices
    .filter((row) => row.service_id === service.service_id && row.is_active)
    .map((row) => row.device_id);
  const existing = data.doctor_devices
    .filter(
      (row) =>
        row.doctor_id === doctorId &&
        row.service_id === service.service_id &&
        row.is_active,
    )
    .map((row) => row.device_id);
  const [ids, setIds] = useState(existing.filter((id) => permitted.includes(id)));
  const devices = data.devices.filter((device) => permitted.includes(device.id));
  const unconfigured = service.requires_device === null;
  return (
    <form
      className="glass space-y-4 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void shared.save(`/doctors/${doctorId}/services/${service.service_id}`, 'PUT', {
          duration_minutes: Number(duration),
          is_active: active,
          device_ids: service.requires_device === true ? ids : [],
        });
      }}
    >
      <h3 className="text-lg font-semibold" dir="auto">
        {service.service_name}
      </h3>
      <fieldset disabled={shared.busy} className="grid gap-4">
        <Field
          label={
            shared.ar
              ? 'مدة الإجراء عند الدكتور بالدقائق'
              : 'Duration for this doctor, in minutes'
          }
        >
          <input
            className="field"
            type="number"
            min={1}
            max={1440}
            step={1}
            required
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          {shared.ar ? 'الدكتور يقدم الخدمة' : 'Doctor offers this service'}
        </label>
        {service.requires_device === true && (
          <div className="space-y-3">
            <p>
              {shared.ar
                ? 'الأجهزة المسموحة للدكتور في الخدمة دي'
                : 'Devices this doctor may use for this service'}
            </p>
            <DevicesChoice devices={devices} ids={ids} onChange={setIds} ar={shared.ar} />
          </div>
        )}
        {unconfigured && (
          <p className="text-sm text-muted">
            {shared.ar
              ? 'اضبط احتياج الخدمة للجهاز في تبويب الخدمات قبل استخدامها في الحجز.'
              : 'Configure the service’s device requirement in Services before booking it.'}
          </p>
        )}
        {!service.is_active && (
          <p className="text-sm text-muted">
            {shared.ar ? 'الخدمة غير نشطة في العيادة.' : 'Service inactive in clinic.'}
          </p>
        )}
        <button
          className={button}
          disabled={
            !duration ||
            (active &&
              (!service.is_active ||
                (service.requires_device === true && ids.length === 0)))
          }
        >
          {shared.ar
            ? 'حفظ مدة الخدمة وأجهزة الدكتور'
            : 'Save duration and doctor devices'}
        </button>
      </fieldset>
    </form>
  );
}
function DoctorSettings({ data, ...shared }: Shared & { data: Setup }) {
  const [doctorId, setDoctorId] = useState(data.doctors[0]?.id ?? '');
  const [serviceId, setServiceId] = useState('');
  const doctor = data.doctors.find((row) => row.id === doctorId);
  const service = data.services.find((row) => row.service_id === serviceId);
  const offering = data.doctor_services.find(
    (row) => row.doctor_id === doctorId && row.service_id === serviceId,
  );
  const links = data.doctor_devices.filter(
    (row) => row.doctor_id === doctorId && row.service_id === serviceId,
  );
  return (
    <div className="space-y-5">
      <ResourceList kind="doctors" data={data} {...shared} />
      <section className="glass grid gap-4 p-6">
        <h2 className="text-xl font-semibold">
          {shared.ar
            ? 'خدمات الدكتور ومددها وأجهزتها'
            : 'Doctor services, durations and devices'}
        </h2>
        <Field label={shared.ar ? 'الدكتور' : 'Doctor'}>
          <select
            className="field"
            value={doctorId}
            disabled={shared.busy}
            onChange={(event) => {
              setDoctorId(event.target.value);
              setServiceId('');
            }}
          >
            <option value="">{shared.ar ? 'اختار الدكتور' : 'Select doctor'}</option>
            {data.doctors.map((row) => (
              <option key={row.id} value={row.id}>
                {row.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={shared.ar ? 'الخدمة' : 'Service'}>
          <select
            className="field"
            value={serviceId}
            disabled={shared.busy || !doctor}
            onChange={(event) => setServiceId(event.target.value)}
          >
            <option value="">{shared.ar ? 'اختار الخدمة' : 'Select service'}</option>
            {data.services.map((row) => (
              <option key={row.service_id} value={row.service_id}>
                {row.service_name}
              </option>
            ))}
          </select>
        </Field>
      </section>
      {doctor && service && (
        <OfferingForm
          key={`${doctorId}:${serviceId}:${JSON.stringify(offering)}:${JSON.stringify(links)}:${JSON.stringify(data.service_devices)}:${JSON.stringify(data.devices)}:${service.requires_device}:${service.is_active}`}
          doctorId={doctorId}
          service={service}
          offering={offering}
          data={data}
          {...shared}
        />
      )}
      {doctor && (
        <section className="glass space-y-3 p-6">
          <h3 className="font-semibold" dir="auto">
            {shared.ar ? 'الخدمات المسجّلة للدكتور: ' : 'Assigned services: '}
            {doctor.full_name}
          </h3>
          {data.doctor_services
            .filter((row) => row.doctor_id === doctorId)
            .map((row) => {
              const deviceNames = data.doctor_devices
                .filter(
                  (link) =>
                    link.doctor_id === doctorId &&
                    link.service_id === row.service_id &&
                    link.is_active,
                )
                .map(
                  (link) =>
                    data.devices.find((d) => d.id === link.device_id)?.device_name,
                )
                .filter(Boolean);
              return (
                <button
                  key={row.service_id}
                  type="button"
                  disabled={shared.busy}
                  className="control block w-full text-start"
                  onClick={() => setServiceId(row.service_id)}
                >
                  {data.services.find((s) => s.service_id === row.service_id)
                    ?.service_name ?? row.service_id}
                  {' · '}
                  {row.duration_minutes} {shared.ar ? 'دقيقة' : 'min'}
                  {' · '}
                  {row.is_active
                    ? shared.ar
                      ? 'نشطة'
                      : 'Active'
                    : shared.ar
                      ? 'غير نشطة'
                      : 'Inactive'}
                  {deviceNames.length > 0 && <> · {deviceNames.join(', ')}</>}
                </button>
              );
            })}
        </section>
      )}
    </div>
  );
}
function WeeklyDayRow({
  weekday,
  label,
  nextLabel,
  periods,
  doctorId,
  ...shared
}: Shared & {
  weekday: number;
  label: string;
  nextLabel: string;
  periods: Period[];
  doctorId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('19:00');
  const overnight = end < start;
  const active = periods.filter((period) => period.is_active);
  return (
    <section className="border-b border-line py-5 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-24">
          <h3 className="font-semibold">{label}</h3>
          <p className="mt-1 text-sm text-muted">
            {active.length === 0
              ? shared.ar
                ? 'إجازة'
                : 'Day off'
              : shared.ar
                ? `${active.length} فترة عمل`
                : `${active.length} working period(s)`}
          </p>
        </div>
        <div className="flex-1 space-y-2 sm:px-4">
          {periods.map((period) => (
            <div
              key={period.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3"
            >
              <div>
                <span className="font-medium" dir="ltr">
                  {period.starts_at.slice(0, 5)} – {period.ends_at.slice(0, 5)}
                </span>
                {period.end_day_offset === 1 && (
                  <p className="mt-1 text-sm text-muted">
                    {shared.ar ? `النهاية يوم ${nextLabel}` : `Ends on ${nextLabel}`}
                  </p>
                )}
                {!period.is_active && (
                  <p className="text-sm text-muted">
                    {shared.ar ? 'غير نشطة' : 'Inactive'}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="control"
                disabled={shared.busy}
                onClick={() => {
                  if (
                    window.confirm(
                      shared.ar
                        ? `حذف فترة العمل دي من ${label}؟`
                        : `Delete this working period on ${label}?`,
                    )
                  ) {
                    void shared.save(`/periods/${period.id}`, 'DELETE');
                  }
                }}
              >
                {shared.ar ? 'حذف' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="control"
          disabled={shared.busy}
          onClick={() => setAdding(!adding)}
        >
          {adding
            ? shared.ar
              ? 'إلغاء'
              : 'Cancel'
            : shared.ar
              ? '+ إضافة فترة'
              : '+ Add period'}
        </button>
      </div>
      {adding && (
        <form
          className="mt-4 rounded-2xl border border-line bg-white p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (start === end) return;
            if (
              await shared.save('/periods', 'POST', {
                kind: 'doctor',
                resource_id: doctorId,
                iso_weekday: weekday,
                starts_at: start,
                ends_at: end,
                end_day_offset: overnight ? 1 : 0,
              })
            )
              setAdding(false);
          }}
        >
          <fieldset disabled={shared.busy} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={shared.ar ? `بداية العمل — ${label}` : `Start — ${label}`}>
                <input
                  className="field"
                  type="time"
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </Field>
              <Field
                label={
                  shared.ar
                    ? `نهاية العمل — ${overnight ? nextLabel : label}`
                    : `End — ${overnight ? nextLabel : label}`
                }
              >
                <input
                  className="field"
                  type="time"
                  required
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </Field>
            </div>
            {overnight && (
              <p className="text-sm text-muted">
                {shared.ar
                  ? `الفترة بتبدأ ${label} وتنتهي ${nextLabel} الساعة ${end}.`
                  : `This period starts on ${label} and ends on ${nextLabel} at ${end}.`}
              </p>
            )}
            {start === end && (
              <p role="alert">
                {shared.ar
                  ? 'وقت البداية والنهاية لازم يختلفوا.'
                  : 'Start and end times must differ.'}
              </p>
            )}
            <button className={button} disabled={start === end}>
              {shared.ar ? 'حفظ الفترة' : 'Save period'}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
function Schedules({ data, ...shared }: Shared & { data: Setup }) {
  const [doctorId, setDoctorId] = useState('');
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [reason, setReason] = useState('');
  const [addingBlock, setAddingBlock] = useState(false);
  const days = shared.ar
    ? ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد']
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const doctors = data.doctors;
  const matches = (row: { doctor_id: string | null }) =>
    doctorId !== '' && row.doctor_id === doctorId;
  const selected = doctors.find((doctor) => doctor.id === doctorId);
  const periods = data.periods.filter(matches);
  const blocks = data.blocks
    .filter(matches)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const format = (value: string) =>
    new Intl.DateTimeFormat(shared.ar ? 'ar-EG' : 'en-GB', {
      timeZone: 'Africa/Cairo',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  function clearBlock() {
    setBlockStart('');
    setBlockEnd('');
    setReason('');
    setAddingBlock(false);
  }
  return (
    <div className="space-y-5">
      <section className="glass grid gap-5 p-6">
        <header>
          <h2 className="text-xl font-semibold">
            {shared.ar ? 'مواعيد الدكاترة' : 'Doctor schedules'}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {shared.ar
              ? 'اختار الدكتور لعرض مواعيد عمله وإجازاته خلال الأسبوع.'
              : 'Select a doctor to view their weekly schedule and leave.'}
          </p>
        </header>
        <Field label={shared.ar ? 'اختار الدكتور' : 'Select doctor'}>
          <select
            className="field"
            disabled={shared.busy}
            value={doctorId}
            onChange={(event) => {
              setDoctorId(event.target.value);
              clearBlock();
            }}
          >
            <option value="">{shared.ar ? 'اختار الاسم' : 'Select a name'}</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.full_name}
              </option>
            ))}
          </select>
        </Field>
      </section>
      {selected && (
        <>
          <section className="glass p-6">
            <header className="mb-3">
              <h2 className="text-xl font-semibold" dir="auto">
                {shared.ar ? 'جدول الأسبوع — ' : 'Weekly schedule — '}
                {selected.full_name}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {shared.ar
                  ? 'كل الأوقات بتوقيت القاهرة. للبريك، سجّل فترة قبله وفترة بعده. لو وقت النهاية قبل البداية، الفترة بتنتهي تاني يوم تلقائيًا.'
                  : 'All times use Cairo timezone. Add periods before and after breaks. An end time earlier than the start automatically means the following day.'}
              </p>
            </header>
            {days.map((label, index) => (
              <WeeklyDayRow
                key={`${doctorId}:${index}`}
                weekday={index + 1}
                label={label}
                nextLabel={days[(index + 1) % 7]}
                periods={periods
                  .filter((period) => period.iso_weekday === index + 1)
                  .sort((a, b) => a.starts_at.localeCompare(b.starts_at))}
                doctorId={doctorId}
                {...shared}
              />
            ))}
          </section>
          <section className="glass space-y-4 p-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {shared.ar
                  ? 'إجازات الدكتور والاستثناءات'
                  : 'Doctor leave and exceptions'}
              </h2>
              <button
                type="button"
                className="control"
                disabled={shared.busy}
                onClick={() => setAddingBlock(!addingBlock)}
              >
                {addingBlock
                  ? shared.ar
                    ? 'إلغاء'
                    : 'Cancel'
                  : shared.ar
                    ? '+ إضافة استثناء'
                    : '+ Add exception'}
              </button>
            </header>
            {blocks.length === 0 && (
              <p className="text-sm text-muted">
                {shared.ar ? 'مفيش استثناءات مسجّلة.' : 'No exceptions recorded.'}
              </p>
            )}
            {blocks.map((block) => (
              <div
                key={block.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"
              >
                <div>
                  <p className="font-medium" dir="auto">
                    {block.reason}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {format(block.starts_at)} → {format(block.ends_at)}
                  </p>
                </div>
                <button
                  type="button"
                  className="control"
                  disabled={shared.busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        shared.ar ? 'حذف الاستثناء ده؟' : 'Delete this exception?',
                      )
                    )
                      void shared.save(`/blocks/${block.id}`, 'DELETE');
                  }}
                >
                  {shared.ar ? 'حذف' : 'Delete'}
                </button>
              </div>
            ))}
            {addingBlock && (
              <form
                className="rounded-2xl border border-line bg-white p-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    await shared.save('/blocks', 'POST', {
                      kind: 'doctor',
                      resource_id: doctorId,
                      starts_local: blockStart,
                      ends_local: blockEnd,
                      reason: reason.trim(),
                    })
                  )
                    clearBlock();
                }}
              >
                <fieldset disabled={shared.busy} className="grid gap-4">
                  <Field
                    label={shared.ar ? 'البداية بتوقيت القاهرة' : 'Start in Cairo time'}
                  >
                    <input
                      className="field"
                      type="datetime-local"
                      required
                      value={blockStart}
                      onChange={(event) => setBlockStart(event.target.value)}
                    />
                  </Field>
                  <Field
                    label={shared.ar ? 'النهاية بتوقيت القاهرة' : 'End in Cairo time'}
                  >
                    <input
                      className="field"
                      type="datetime-local"
                      required
                      value={blockEnd}
                      onChange={(event) => setBlockEnd(event.target.value)}
                    />
                  </Field>
                  <Field label={shared.ar ? 'السبب' : 'Reason'}>
                    <input
                      className="field"
                      required
                      maxLength={1000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                  <button className={button}>
                    {shared.ar ? 'حفظ الاستثناء' : 'Save exception'}
                  </button>
                </fieldset>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function SetupWorkspace({
  clinicId,
  clinicName,
  token,
  ar,
}: {
  clinicId: string;
  clinicName: string;
  token: string;
  ar: boolean;
}) {
  const [tab, setTab] = useState<'devices' | 'services' | 'doctors' | 'schedules'>(
    'devices',
  );
  const [data, setData] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const url = `/api/booking-setup?clinic_id=${encodeURIComponent(clinicId)}`;
  const load = useCallback(
    async (signal?: AbortSignal): Promise<Setup> => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { data: Setup };
      return result.data;
    },
    [url, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .then(result => {
        if (!controller.signal.aborted) {
          setData(result);
          setStale(false);
          setError('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStale(true);
          setError(ar ? 'تعذر تحميل الإعدادات.' : 'Could not load settings.');
        }
      });
    return () => controller.abort();
  }, [load, ar]);
  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await load();
      setData(result);
      setStale(false);
      setError('');
    } catch {
      setStale(true);
      setError(ar ? 'تعذر تحميل الإعدادات.' : 'Could not load settings.');
    } finally {
      setBusy(false);
    }
  }
  const save: Save = async (path, method, body) => {
    if (busy || stale) return false;
    setBusy(true);
    setMessage('');
    setError('');
    let committed = false;
    try {
      const response = await fetch(
        `/api/booking-setup${path}?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: { code?: string };
        };
        const code = result.error?.code ?? String(response.status);
        setError(
          response.status === 403
            ? ar
              ? 'الحفظ متاح لمدير العيادة والأدمن فقط.'
              : 'Only clinic managers and admins can save.'
            : ar
              ? `تعذر الحفظ؛ راجع البيانات والأجهزة المختارة. (${code})`
              : `Could not save. Check the data and selected devices. (${code})`,
        );
        return false;
      }
      committed = true;
      const result = await load();
      setData(result);
      setStale(false);
      setError('');
      setMessage(ar ? 'تم الحفظ.' : 'Saved.');
      return true;
    } catch {
      setStale(true);
      setError(
        committed
          ? ar
            ? 'تم الحفظ، لكن تعذر تحديث العرض. اضغط تحديث.'
            : 'Saved, but the display could not refresh. Select Refresh.'
          : ar
            ? 'تعذر تأكيد الحفظ. اضغط تحديث للتحقق قبل المحاولة مرة تانية.'
            : 'Could not confirm the save. Refresh to verify before retrying.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const shared = { ar, busy: busy || stale, save };
  const tabs = [
    ['devices', ar ? '١. الأجهزة' : '1. Devices'],
    ['services', ar ? '٢. الخدمات' : '2. Services'],
    ['doctors', ar ? '٣. الدكاترة' : '3. Doctors'],
    ['schedules', ar ? '٤. مواعيد الدكاترة' : '4. Doctor schedules'],
  ] as const;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow" dir="auto">
            {clinicName}
          </p>
          <h1 className="mt-3 text-3xl font-semibold">
            {ar ? 'إعداد الحجز للعيادة' : 'Clinic booking setup'}
          </h1>
        </div>
        <button
          className="control"
          type="button"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          {ar ? 'تحديث' : 'Refresh'}
        </button>
      </header>
      <nav
        className="glass flex flex-wrap gap-2 p-3"
        aria-label={ar ? 'أقسام إعداد الحجز' : 'Booking setup sections'}
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            aria-pressed={tab === id}
            className={tab === id ? button : 'control'}
            onClick={() => {
              setTab(id);
              setMessage('');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="glass p-4" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="glass p-4" role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p role="status">{ar ? 'جاري تحميل الإعدادات…' : 'Loading settings…'}</p>
      ) : (
        <>
          {tab === 'devices' && <ResourceList kind="devices" data={data} {...shared} />}
          {tab === 'services' && (
            <div className="space-y-4">
              {data.services.length === 0 && (
                <p className="glass p-5">
                  {ar
                    ? 'مفيش خدمات مرتبطة بالعيادة. اربط الخدمات من إعداد الأدمن أولًا.'
                    : 'No clinic services. Assign services in admin setup first.'}
                </p>
              )}
              {data.services.map((service) => (
                <ServiceForm
                  key={`${service.service_id}:${JSON.stringify(service)}:${JSON.stringify(data.service_devices)}:${JSON.stringify(data.devices)}`}
                  service={service}
                  data={data}
                  {...shared}
                />
              ))}
            </div>
          )}
          {tab === 'doctors' && <DoctorSettings data={data} {...shared} />}
          {tab === 'schedules' && <Schedules data={data} {...shared} />}
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Link className="control" to="/booking/calendar">
          {ar ? 'تقويم الحجوزات' : 'Booking calendar'}
        </Link>
        <Link className="control" to="/booking/legacy-settings">
          {ar ? 'إعدادات التقويم الحالي' : 'Current calendar settings'}
        </Link>
      </div>
    </div>
  );
}
export default function BookingSetupPage() {
  const { clinic, token, isAdmin } = useOutletContext<WorkspaceContext>();
  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');
  const canManage =
    Boolean(isAdmin) ||
    clinic.role === 'platform_admin' ||
    clinic.role === 'clinic_manager';
  if (!canManage)
    return (
      <p className="glass p-6" role="alert">
        {ar
          ? 'إعداد الحجز متاح لمدير العيادة فقط.'
          : 'Booking setup is available to clinic managers only.'}
      </p>
    );
  return (
    <SetupWorkspace
      key={`${clinic.id}:${token}`}
      clinicId={clinic.id}
      clinicName={clinic.name}
      token={token}
      ar={ar}
    />
  );
}
