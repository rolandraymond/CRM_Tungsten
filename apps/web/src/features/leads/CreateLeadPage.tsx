import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Link,
  useNavigate,
  useOutletContext,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGet } from '../../hooks/useGet';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import QueryState from '../../components/QueryState';
import type { WorkspaceContext } from './types';
import { createLeadCopy } from './createLead.copy';
import ChoiceSelect, {
  ChoiceImage,
} from '../../components/ChoiceSelect';

import { leadFormCopy } from './leadForm.copy';

type Source = keyof typeof createLeadCopy.en.sources;
const liveCatalogTables = ['clinic_ads'] as const;

type Payload = {
  request_id: string;
  clinic_id: string;
  full_name: string;
  phone: string;
  requested_service_id: string;
  source: Source;
  attribution_status: 'exact_ad' | 'unknown' | 'not_applicable';
  ad_id: string | null;
  meta_creative_id: null;
  notes: string | null;
  booking?: { starts_at: string; reason: string } | null;
  allow_inactive_ad: false;
};

type Options = {
  data: {
    services: {
      id: string;
      name: string;
    }[];
    ads: {
      id: string;
      ad_name: string;
      caption: string | null;
      thumbnail_url?: string | null;
      creative_variants?: unknown[];
    }[];
    limited: boolean;
  };
};

function readPending(key: string): Payload | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(key) || 'null',
    ) as Payload | null;
  } catch {
    return null;
  }
}

function normalizePhone(value: string) {
  let phone = value
    .trim()
    .replace(/[٠-٩]/g, digit =>
      String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)),
    )
    .replace(/[۰-۹]/g, digit =>
      String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)),
    )
    .replace(/[\s()-]/g, '');

  if (/^01[0125]\d{8}$/.test(phone)) {
    phone = `+20${phone.slice(1)}`;
  } else if (phone.startsWith('00')) {
    phone = `+${phone.slice(2)}`;
  }

  return phone;
}

function localDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function CreateLeadPage() {
  const { token, clinic, userId, isAdmin } =
    useOutletContext<WorkspaceContext>();

  const { i18n, t } = useTranslation();
  const language = (
    i18n.resolvedLanguage ?? i18n.language
  ).startsWith('ar')
    ? 'ar'
    : 'en';

  const c = createLeadCopy[language];
  const ui = leadFormCopy[language];

  const navigate = useNavigate();

  const storageKey = `crm-pending-lead:${userId}:${clinic.id}`;

  const [pending, setPending] = useState<Payload | null>(
    () => readPending(storageKey),
  );

  const [name, setName] = useState(pending?.full_name ?? '');
  const [phone, setPhone] = useState(pending?.phone ?? '');
  const [service, setService] = useState(
    pending?.requested_service_id ?? '',
  );
  const [source, setSource] = useState<Source>(
    pending?.source ?? 'paid_facebook',
  );
  const [ad, setAd] = useState(pending?.ad_id ?? '');
  const [notes, setNotes] = useState(pending?.notes ?? '');
  const [bookingMode, setBookingMode] = useState(
    pending?.booking ? 'booking' : 'inquiry',
  );
  const [startsAt, setStartsAt] = useState(
    pending?.booking ? localDateTime(pending.booking.starts_at) : '',
  );
  const [bookingReason, setBookingReason] = useState(
    pending?.booking?.reason ?? '',
  );
  const canBook = Boolean(isAdmin) || clinic.role === 'platform_admin' ||
    ['clinic_manager', 'clinic_customer_service'].includes(clinic.role);
  const ar = language === 'ar';

  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const [error, setError] = useState<keyof typeof c | null>(null);

  const query = useGet<Options>(
    `/api/lead-options?clinic_id=${encodeURIComponent(clinic.id)}`,
    token,
  );
  useClinicChanges(clinic.id, liveCatalogTables, query.retry);

  const options = query.data?.data;
  const selectedAd = options?.ads.find(item => item.id === ad);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (sending.current) return;

    const normalized = normalizePhone(phone);
    const bookingTime = new Date(startsAt);
    if (!pending && bookingMode === 'booking' && (
      !canBook || !Number.isFinite(bookingTime.getTime()) ||
      bookingTime.getTime() <= Date.now() || !bookingReason.trim()
    )) {
      setError('invalid');
      return;
    }

    if (
      !pending &&
      (
        !name.trim() ||
        !/^\+[1-9][0-9]{7,14}$/.test(normalized) ||
        !options?.services.some(item => item.id === service) ||
        Boolean(ad && !selectedAd) ||
        Boolean(query.error)
      )
    ) {
      setError('invalid');
      return;
    }

    

    const payload: Payload = pending ?? {
      request_id: crypto.randomUUID(),
      clinic_id: clinic.id,
      full_name: name.trim(),
      phone: normalized,
      requested_service_id: service,
      source,

      attribution_status: ad
        ? 'exact_ad'
        : ['paid_instagram', 'paid_facebook'].includes(source)
          ? 'unknown'
          : 'not_applicable',

      ad_id: ad || null,
      meta_creative_id: null,
      notes: notes.trim() || null,
      booking: bookingMode === 'booking' ? {
        starts_at: bookingTime.toISOString(),
        reason: bookingReason.trim(),
      } : null,
      allow_inactive_ad: false,
    };

    try {
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      setError('storage');
      return;
    }

    setPending(payload);
    setError(null);
    setBusy(true);
    sending.current = true;

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if ([400, 403, 409].includes(response.status)) {
          sessionStorage.removeItem(storageKey);
          setPending(null);

          setError(
            response.status === 403
              ? 'forbidden'
              : response.status === 409
                ? 'conflict'
                : 'rejected',
          );
        } else {
          setError(
            response.status === 401 ? 'login' : 'uncertain',
          );
        }

        return;
      }

      const result = await response.json();

      if (
        typeof result.data?.lead_id !== 'string' ||
        typeof result.data?.replayed !== 'boolean'
      ) {
        setError('uncertain');
        return;
      }

      sessionStorage.removeItem(storageKey);
      setPending(null);

      navigate('/leads', { replace: true });
    } catch {
      setError('uncertain');
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }

  if (clinic.role === 'doctor') {
    return <p className="glass p-6" role="alert">{t('common.forbidden')}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link className="control mb-5" to="/leads">
        {c.back}
      </Link>

      <h1 className="mb-4 text-3xl font-semibold">
        {c.title}
      </h1>

      <div className="lead-clinic">
        <span>{ui.clinic}</span>
        <strong dir="auto">{clinic.name}</strong>
      </div>

      {(!options || query.error) && !pending ? (
        <QueryState
          error={query.error}
          retry={query.retry}
        />
      ) : (
        <form
          className="glass lead-form"
          onSubmit={submit}
        >
          <fieldset
            disabled={busy || Boolean(pending)}
            className="lead-form-fields"
          >
            <div className="lead-form-row">
              <label>
                <span className="form-label">{c.name}</span>

                <input
                  className="field"
                  required
                  maxLength={200}
                  value={name}
                  onChange={event => setName(event.target.value)}
                  dir="auto"
                  autoComplete="name"
                />
              </label>

              <label>
                <span className="form-label">{c.phone}</span>

                <input
                  className="field"
                  required
                  type="tel"
                  dir="ltr"
                  autoComplete="tel"
                  value={phone}
                  onChange={event => setPhone(event.target.value)}
                />

                <span className="text-xs text-muted">
                  {c.phoneHint}
                </span>
              </label>
            </div>

            <div className="lead-form-row">
              <ChoiceSelect
                label={c.service}
                value={service}
                placeholder={c.choose}
                disabled={busy || Boolean(pending)}
                onChange={setService}
                options={(options?.services ?? []).map(item => ({
                  value: item.id,
                  label: item.name,
                }))}
              />

              <ChoiceSelect
                label={c.source}
                value={source}
                disabled={busy || Boolean(pending)}
                onChange={value => {
                  setSource(value as Source);
                  setAd('');
                }}
                options={Object.entries(c.sources).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </div>

            {canBook && (
              <ChoiceSelect
                label={ar ? 'نوع الطلب' : 'Request type'}
                value={bookingMode}
                disabled={busy || Boolean(pending)}
                onChange={setBookingMode}
                options={[
                  { value: 'inquiry', label: ar ? 'سايب رقمه للمتابعة' : 'Inquiry / follow-up' },
                  { value: 'booking', label: ar ? 'حجز مباشر' : 'Book now' },
                ]}
              />
            )}

            {bookingMode === 'booking' && (
              <div className="lead-form-row">
                <label>
                  <span className="form-label">{ar ? 'ميعاد الحجز' : 'Appointment time'}</span>
                  <input className="field" type="datetime-local" required
                    value={startsAt} onChange={event => setStartsAt(event.target.value)} />
                  <span className="text-xs text-muted">
                    {ar ? 'بتوقيت جهازك: ' : 'Your device timezone: '}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </span>
                </label>
                <label>
                  <span className="form-label">{ar ? 'تفاصيل تأكيد الحجز' : 'Booking confirmation details'}</span>
                  <input className="field" required maxLength={2000} dir="auto"
                    value={bookingReason} onChange={event => setBookingReason(event.target.value)} />
                </label>
              </div>
            )}

            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">
                  {ui.ads}: {options?.ads.length ?? 0}
                </p>

                <button
                  type="button"
                  className="control"
                  onClick={() => query.retry()}
                >
                  {ui.refresh}
                </button>
              </div>

              <ChoiceSelect
                label={c.ad}
                value={ad}
                disabled={busy || Boolean(pending)}
                onChange={setAd}
                options={[
                  {
                    value: '',
                    label: c.unknown,
                  },
                  ...(options?.ads ?? []).map(item => ({
                    value: item.id,
                    label: item.ad_name,
                    description: item.caption || ui.noCaption,
                    image: item.thumbnail_url ?? null,
                    searchText: (item.creative_variants ?? [])
                      .filter(value => typeof value === 'string')
                      .join(' '),
                  })),
                ]}
              />

              {!options?.ads.length && (
                <p className="lead-notice" role="status">
                  {ui.noAds}
                </p>
              )}

              {ad && !selectedAd && !pending && (
                <p className="lead-notice" role="alert">
                  {ui.stale}
                </p>
              )}
            </div>

            {selectedAd && (
              <div className="lead-ad-preview">
                <ChoiceImage src={selectedAd.thumbnail_url} />

                <div className="min-w-0 flex-1">
                  <p
                    className="break-words font-semibold"
                    dir="auto"
                  >
                    {selectedAd.ad_name}
                  </p>

                  <p
                    dir="auto"
                    className="mt-2 whitespace-pre-wrap break-words text-sm text-muted"
                  >
                    {selectedAd.caption || ui.noCaption}
                  </p>

                  {(selectedAd.creative_variants ?? []).some(
                    value =>
                      typeof value === 'string' &&
                      value !== selectedAd.caption,
                  ) && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer">
                        {ui.variants}
                      </summary>

                      {(selectedAd.creative_variants ?? [])
                        .filter(
                          (value): value is string =>
                            typeof value === 'string' &&
                            value !== selectedAd.caption,
                        )
                        .map((value, index) => (
                          <p
                            key={index}
                            dir="auto"
                            className="mt-3 whitespace-pre-wrap break-words text-muted"
                          >
                            {value}
                          </p>
                        ))}
                    </details>
                  )}
                </div>
              </div>
            )}

            <label>
              <span className="form-label">{c.notes}</span>

              <textarea
                className="field"
                dir="auto"
                maxLength={5000}
                value={notes}
                onChange={event => setNotes(event.target.value)}
              />
            </label>
          </fieldset>

          {options?.limited && (
            <p className="lead-notice">{c.limited}</p>
          )}

          {options && !options.services.length && !pending && (
            <p role="alert" className="lead-notice">
              {c.noServices}
            </p>
          )}

          {pending && !busy && (
            <p role="status" className="lead-notice">
              {c.uncertain}
            </p>
          )}

          {error && error !== 'sources' && (
            <p role="alert" className="text-sm text-danger">
              {c[error]}
            </p>
          )}

          <button
            className="control lead-submit"
            type="submit"
            disabled={
              busy ||
              (
                !pending &&
                (
                  !options?.services.length ||
                  Boolean(query.error)
                )
              )
            }
          >
            {busy ? c.saving : pending ? c.retry : c.save}
          </button>
        </form>
      )}
    </div>
  );
}
