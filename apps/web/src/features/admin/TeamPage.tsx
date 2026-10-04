import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import Preferences from '../../components/Preferences';
import { teamCopy } from './team.copy';
import { UserRound } from 'lucide-react';
import ChoiceSelect from '../../components/ChoiceSelect';

type Role = keyof typeof teamCopy.en.roles;

type Membership = {
  clinic_id: string;
  user_id: string;
  role: Role;
  is_active: boolean;
};

type Directory = {
  data: {
    users: {
      id: string;
      full_name: string;
      email: string | null;
    }[];
    clinics: {
      id: string;
      name: string;
    }[];
    memberships: Membership[];
  };
};

type Notice =
  | 'created'
  | 'saved'
  | 'failed'
  | 'exists'
  | 'config'
  | 'invalid'
  | 'forbidden';

function MembershipEditor({
  clinic,
  membership,
  busy,
  copy: c,
  onSave,
}: {
  clinic: { id: string; name: string };
  membership?: Membership;
  busy: boolean;
  copy: typeof teamCopy.en;
  onSave: (role: Role, active: boolean) => void;
}) {
  const [role, setRole] = useState<Role>(
    membership?.role ?? 'moderator',
  );

  const [active, setActive] = useState(
    membership?.is_active ?? false,
  );

  return (
    <fieldset
      disabled={busy}
      className="glass grid min-w-0 gap-3 p-4"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <strong dir="auto">{clinic.name}</strong>
        <span className="text-sm text-muted">
          {!membership
            ? c.unassigned
            : membership.is_active
              ? c.enabled
              : c.disabled}
        </span>
      </div>

      <ChoiceSelect
        label={clinic.name}
        value={role}
        disabled={busy}
        icon={<UserRound size={18} />}
        onChange={value => setRole(value as Role)}
        options={Object.entries(c.roles).map(([value, label]) => ({
          value,
          label,
        }))}
      />

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={active}
          onChange={event => setActive(event.target.checked)}
        />
        {c.active}
      </label>

      <button
        type="button"
        className="control justify-center"
        onClick={() => onSave(role, active)}
      >
        {c.save}
      </button>
    </fieldset>
  );
}

export default function TeamPage({ token }: { token: string }) {
  const { i18n } = useTranslation();

  const c = teamCopy[
    i18n.resolvedLanguage === 'ar' ? 'ar' : 'en'
  ];

  const query = useGet<Directory>('/api/admin/team', token);
  const data = query.data?.data;

  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const lock = useRef(false);

  const selected = data?.users.find(
    user => user.id === selectedId,
  );

  async function save(
    path: 'users' | 'membership',
    body: object,
  ) {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/team/${path}`, {
        method: path === 'users' ? 'POST' : 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        setNotice(
          response.status === 403
            ? 'forbidden'
            : response.status === 409
              ? 'exists'
              : result.error?.code ===
                  'ACCOUNT_CREATION_NOT_CONFIGURED'
                ? 'config'
                : response.status === 400
                  ? 'invalid'
                  : 'failed',
        );
        return;
      }

      if (path === 'users') {
        if (typeof result.data?.id !== 'string') {
          throw new Error('Invalid response');
        }

        setSelectedId(result.data.id);
        setPassword('');
        setEmail('');
        setName('');
        setNotice('created');
      } else {
        setNotice('saved');
      }

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
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/admin/setup" className="control">
            {c.back}
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
          <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            <form
              className="glass p-5"
              onSubmit={event => {
                event.preventDefault();

                void save('users', {
                  full_name: name.trim(),
                  email: email.trim(),
                  password,
                });
              }}
            >
              <h2 className="mb-5 text-xl">{c.create}</h2>

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
                    dir="auto"
                    value={name}
                    onChange={event => setName(event.target.value)}
                  />
                </label>

                <label className="grid gap-2">
                  {c.email}
                  <input
                    className="field"
                    required
                    type="email"
                    dir="ltr"
                    autoComplete="off"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                  />
                </label>

                <label className="grid gap-2">
                  {c.password}
                  <input
                    className="field"
                    required
                    type="password"
                    minLength={12}
                    maxLength={128}
                    dir="ltr"
                    autoComplete="new-password"
                    value={password}
                    onChange={event =>
                      setPassword(event.target.value)
                    }
                  />
                  <small className="text-muted">
                    {c.passwordHint}
                  </small>
                </label>

                <button className="control justify-center bg-lavender! text-[#242424]!">
                  {c.createButton}
                </button>
              </fieldset>
            </form>

            <section className="min-w-0">
              <div className="mb-4">
                <ChoiceSelect
                  label={c.select}
                  value={selected?.id ?? ''}
                  placeholder={c.choose}
                  disabled={busy}
                  icon={<UserRound size={18} />}
                  onChange={setSelectedId}
                  options={[
                    { value: '', label: c.choose },
                    ...data.users.map(user => ({
                      value: user.id,
                      label: user.full_name,
                      description: user.email ?? undefined,
                    })),
                  ]}
                />
              </div>

              <p className="mb-5 text-sm text-muted">
                {c.scope}
              </p>

              {!data.clinics.length && (
                <p className="glass p-5">{c.noClinics}</p>
              )}

              {selected && (
                <div className="grid gap-4">
                  {data.clinics.map(clinic => {
                    const membership = data.memberships.find(
                      row =>
                        row.user_id === selected.id &&
                        row.clinic_id === clinic.id,
                    );

                    return (
                      <MembershipEditor
                        key={`${selected.id}:${clinic.id}:${membership?.role}:${membership?.is_active}`}
                        clinic={clinic}
                        membership={membership}
                        busy={busy}
                        copy={c}
                        onSave={(role, active) =>
                          void save('membership', {
                            clinic_id: clinic.id,
                            user_id: selected.id,
                            role,
                            is_active: active,
                          })
                        }
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}