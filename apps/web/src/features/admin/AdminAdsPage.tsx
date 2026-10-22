import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ChoiceSelect from '../../components/ChoiceSelect';

type Clinic = {
  id: string;
  name: string;
};

type Setup = {
  data: {
    clinics: Clinic[];
    links: {
      clinic_id: string;
      finance_client_id: number;
    }[];
  };
};

type SyncResult = {
  saved: number;
  skipped: number;
};

export default function AdminAdsPage({
  token,
}: {
  token: string;
}) {
  const { i18n } = useTranslation();

  const ar = (
    i18n.resolvedLanguage ?? i18n.language
  ).startsWith('ar');

  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [clinicId, setClinicId] = useState('');
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const loading = loadedToken !== token;
  const visibleFailed = loadedToken === token && failed;

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/admin/setup', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error();
        }

        const body: Setup = await response.json();

        const linked = new Set(
          body.data.links.map(link => link.clinic_id),
        );

        const available = body.data.clinics.filter(
          clinic => linked.has(clinic.id),
        );

        if (!controller.signal.aborted) {
          setClinics(available);
          setClinicId(available[0]?.id ?? '');
          setFailed(false);
          setResult(null);
          setLoadedToken(token);
        }
      } catch {
        if (!controller.signal.aborted) {
          setClinics([]);
          setClinicId('');
          setResult(null);
          setFailed(true);
          setLoadedToken(token);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [token]);

  async function sync() {
    setBusy(true);
    setFailed(false);
    setResult(null);

    try {
      const response = await fetch('/api/admin/ads/sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clinic_id: clinicId,
        }),
      });

      if (!response.ok) {
        throw new Error();
      }

      const body = await response.json();
      setResult(body.data);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="mx-auto max-w-2xl p-6"
      dir={ar ? 'rtl' : 'ltr'}
    >
      <Link
        to="/admin/setup"
        className="text-sm underline"
      >
        {ar ? 'رجوع للإدارة' : 'Back to administration'}
      </Link>

      <h1 className="my-6 text-3xl">
        {ar ? 'مزامنة الإعلانات' : 'Ad sync'}
      </h1>

      <p className="mb-6 text-muted">
        {ar
          ? 'حدّث الإعلانات في Finance أولًا، وبعدها انقل آخر بياناتها للـCRM من هنا.'
          : 'Sync ads in Finance first, then import their latest details into CRM here.'}
      </p>

      {loading ? (
        <p>{ar ? 'جاري التحميل…' : 'Loading…'}</p>
      ) : (
        <div className="glass grid gap-4 p-5">
          {clinics.length ? (
            <>
          <ChoiceSelect
            label={ar ? 'العيادة' : 'Clinic'}
            value={clinicId}
            disabled={busy}
            onChange={value => {
              setClinicId(value);
              setResult(null);
              setFailed(false);
            }}
            options={clinics.map(clinic => ({
              value: clinic.id,
              label: clinic.name,
            }))}
          />

              <button
                type="button"
                className="control"
                disabled={busy || !clinicId}
                onClick={() => void sync()}
              >
                {busy
                  ? ar
                    ? 'جاري المزامنة…'
                    : 'Syncing…'
                  : ar
                    ? 'مزامنة من Finance'
                    : 'Sync from Finance'}
              </button>
            </>
          ) : (
            <p>
              {ar
                ? 'اربط عيادة بـFinance من صفحة الإدارة الأول.'
                : 'Link a clinic to Finance from Administration first.'}
            </p>
          )}

          {result && (
            <p role="status">
              {ar
                ? `تم حفظ أو تحديث ${result.saved} إعلان. تم تخطي ${result.skipped} إعلان لم تتم مزامنته من Meta بعد.`
                : `Saved or updated ${result.saved} ads. Skipped ${result.skipped} ads not yet synced from Meta.`}
            </p>
          )}
        </div>
      )}

      {visibleFailed && (
        <p role="alert" className="mt-4">
          {ar
            ? 'تعذر إتمام الطلب. راجع تشغيل Finance Bridge وصلاحية الأدمن ورسالة API في Network، ثم أعد المحاولة.'
            : 'Request failed. Check Finance Bridge, admin access and the API response in Network, then retry.'}
        </p>
      )}
    </main>
  );
}
