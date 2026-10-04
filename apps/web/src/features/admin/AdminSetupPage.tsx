import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import Preferences from '../../components/Preferences';
import { adminCopy } from './admin.copy';
import ChoiceSelect from '../../components/ChoiceSelect';

type Setup = {
  data: {
    clinics: {
      id: string;
      name: string;
    }[];

    services: {
      id: string;
      service_code: string;
      service_name: string;
      finance_service_id: number | null;
    }[];

    links: {
      clinic_id: string;
      finance_client_id: number;
    }[];

    assignments: {
      clinic_id: string;
      service_id: string;
      is_active: boolean;
    }[];

    finance: null | {
      clients: {
        id: number;
        name: string;
        client_code: string | null;
      }[];

      services: {
        id: number;
        service_code: string;
        service_name: string;
      }[];
    };
  };
};

export default function AdminSetupPage({
  token,
}: {
  token: string;
}) {
  const { i18n } = useTranslation();

  const c = adminCopy[
    i18n.resolvedLanguage === 'ar' ? 'ar' : 'en'
  ];

  const query = useGet<Setup>('/api/admin/setup', token);
  const data = query.data?.data;

  const [clientId, setClientId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [financeServices, setFinanceServices] =
    useState<number[]>([]);

  const [clinicId, setClinicId] = useState('');
  
  const [name, setName] = useState('');

  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const [notice, setNotice] = useState<
    'success' | 'failed' | 'conflict' | 'forbidden' | null
  >(null);

  const links = data?.links.filter(
    item => item.finance_client_id === Number(clientId),
  ) ?? [];

  const clinic =
    data?.clinics.find(item => item.id === clinicId) ??
    data?.clinics[0];

  async function save(path: string, body: object) {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setNotice(
          response.status === 403
            ? 'forbidden'
            : response.status === 409
              ? 'conflict'
              : 'failed',
        );
        return;
      }

      const result = await response.json();

      if (result.data?.clinic_id) {
        setClinicId(result.data.clinic_id);
      }

if (path === 'services') {
  setName('');
}

      setNotice('success');
      query.retry();
    } catch {
      setNotice('failed');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="page-backdrop min-h-dvh p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Link className="control" to="/overview">
            {c.back}
          </Link>
          <Link className="control" to="/admin/team">
        {c.team}
        </Link>
        <Link className="control" to="/admin/ads">
          {c.ads}
        </Link>
          <Preferences />
        </header>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold">{c.title}</h1>

          <button
            className="control"
            disabled={busy || query.loading}
            onClick={query.retry}
          >
            {c.refresh}
          </button>
        </div>

        {notice && (
          <p className="glass mb-5 p-4" role="status">
            {c[notice]}
          </p>
        )}

        {!data ? (
          <QueryState error={query.error} retry={query.retry} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="glass min-w-0 p-5">
              <h2 className="mb-5 text-xl">{c.finance}</h2>

              {!data.finance ? (
                <p role="status">{c.offline}</p>
              ) : (
                <form
                  onSubmit={event => {
                    event.preventDefault();

                    void save('finance/activate', {
                      finance_client_id: Number(clientId),
                      clinic_id:
                        links[0]?.clinic_id ?? (targetId || null),
                      service_ids: financeServices,
                    });
                  }}
                >
                  <fieldset
                    disabled={busy}
                    className="grid min-w-0 gap-4"
                  >
                  <ChoiceSelect
                    label={c.client}
                    value={clientId}
                    placeholder={c.choose}
                    disabled={busy}
                    onChange={value => {
                      setClientId(value);
                      setTargetId('');
                      setFinanceServices([]);
                    }}
                    options={[
                      { value: '', label: c.choose },
                      ...data.finance.clients.map(item => ({
                        value: String(item.id),
                        label: item.name,
                      })),
                    ]}
                  />

                    {links.length ? (
                      <p>
                        {links.length > 1 ? c.multiple : c.linked}
                      </p>
                    ) : (
                    <ChoiceSelect
                      label={c.target}
                      value={targetId}
                      disabled={busy}
                      onChange={setTargetId}
                      options={[
                        { value: '', label: c.newClinic },
                        ...data.clinics
                          .filter(item =>
                            !data.links.some(link => link.clinic_id === item.id)
                          )
                          .map(item => ({
                            value: item.id,
                            label: item.name,
                          })),
                      ]}
                    />
                    )}

                    <p>{c.financeServices}</p>

                    {data.finance.services.map(item => (
                      <label
                        key={item.id}
                        className="flex min-h-11 items-center gap-3"
                      >
                        <input
                          type="checkbox"
                          checked={financeServices.includes(item.id)}
                          onChange={event =>
                            setFinanceServices(current =>
                              event.target.checked
                                ? [...current, item.id]
                                : current.filter(id => id !== item.id),
                            )
                          }
                        />

                        <span dir="auto">{item.service_name}</span>
                      </label>
                    ))}

                    <button
                      className="control justify-center bg-lavender! text-[#242424]!"
                      disabled={!clientId || links.length > 1}
                    >
                      {c.activate}
                    </button>
                  </fieldset>
                </form>
              )}
            </section>

            <section className="glass min-w-0 p-5">
              <h2 className="mb-5 text-xl">{c.manage}</h2>

              {!clinic ? (
                <p>{c.noClinics}</p>
              ) : (
                <>
              <ChoiceSelect
                label={c.target}
                value={clinic.id}
                disabled={busy}
                onChange={setClinicId}
                options={data.clinics.map(item => ({
                  value: item.id,
                  label: item.name,
                }))}
              />

                  <div className="my-5 grid gap-2">
                    {!data.services.length && <p>{c.empty}</p>}

                    {data.services.map(item => {
                      const enabled = data.assignments.some(
                        row =>
                          row.clinic_id === clinic.id &&
                          row.service_id === item.id &&
                          row.is_active,
                      );

                      return (
                        <label
                          key={item.id}
                          className="flex min-h-11 items-center gap-3 border-b border-line py-2"
                        >
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={enabled}
                            onChange={event =>
                              void save('services/assign', {
                                clinic_id: clinic.id,
                                service_id: item.id,
                                enabled: event.target.checked,
                              })
                            }
                          />

                          <span
                            className="min-w-0 flex-1 break-words"
                            dir="auto"
                          >
                            {item.service_name}
                          </span>

                          <small className="text-muted">
                            {item.finance_service_id
                              ? c.imported
                              : c.local}
                          </small>
                        </label>
                      );
                    })}
                  </div>

            <form
            onSubmit={event => {
              event.preventDefault();

              const serviceName = name.trim();
              if (!serviceName) return;

              void save('services', {
                clinic_id: clinic.id,
                name: serviceName,
              });
            }}
          >
            <fieldset
              disabled={busy}
              className="grid min-w-0 gap-4"
            >
              <label className="grid gap-2">
                {c.name}

                <input
                  className="field"
                  required
                  maxLength={200}
                  value={name}
                  onChange={event => setName(event.target.value)}
                  dir="auto"
                />
              </label>

              <p className="text-sm text-muted">{c.help}</p>

              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="control justify-center bg-lavender! text-[#242424]!"
              >
                {c.create}
              </button>
            </fieldset>
          </form>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}