import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useGet } from '../hooks/useGet';
import type { Clinic, WorkspaceContext } from '../features/leads/types';
import Brand from '../components/Brand';
import Preferences from '../components/Preferences';
import QueryState from '../components/QueryState';
import ChoiceSelect from '../components/ChoiceSelect';

export default function AppLayout({
  session,
  isAdmin,
}: {
  session: Session;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const token = session.access_token;

  const me = useGet<{
    user: { id: string; email: string | null };
  }>('/api/auth/me', token);

  const clinics = useGet<{ data: Clinic[] }>(
    me.data ? '/api/clinics' : null,
    token,
  );

  const [selectedId, setSelectedId] = useState('');
  const clinic =
    clinics.data?.data.find(item => item.id === selectedId) ??
    clinics.data?.data[0];

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    setBusy(true);
    setError(false);

    try {
      const result = await supabase.auth.signOut();
      setError(Boolean(result.error));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-backdrop min-h-dvh p-3 sm:p-6 xl:p-9">
      <div className="workspace-frame relative z-10 mx-auto min-h-[calc(100dvh-72px)] max-w-[1600px] rounded-3xl p-4 sm:p-7">
        <header className="flex flex-wrap items-center gap-5 border-b border-line pb-5">
          <Brand />

          <nav
            className="order-3 flex w-full gap-1 rounded-2xl p-1 sm:order-none sm:w-auto sm:ms-6"
            aria-label={t('common.overview')}
          >
            {['overview', 'leads', 'chats'].map(page => (
              <NavLink
                key={page}
                to={`/${page}`}
                className={({ isActive }) =>
                  `rounded-xl px-5 py-3 text-sm transition ${
                    isActive
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-muted hover:bg-surface'
                  }`
                }
              >
                {t(`common.${page}`)}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink
                to="/admin/setup"
                className="rounded-xl px-5 py-3 text-sm text-muted hover:bg-surface"
              >
                {t('common.admin')}
              </NavLink>
            )}
          </nav>

          <div className="ms-auto flex items-center gap-2">
            <Preferences />
            <button
              type="button"
              className="control"
              disabled={busy}
              onClick={() => void signOut()}
              aria-label={t('common.signOut')}
              title={t('common.signOut')}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {error && (
          <p className="mt-4 text-danger" role="alert">
            {t('common.signOutError')}
          </p>
        )}

        <main className="py-6 sm:py-9">
          {me.error ? (
            <QueryState error retry={me.retry} />
          ) : !me.data ? (
            <QueryState />
          ) : clinics.error ? (
            <QueryState error retry={clinics.retry} />
          ) : !clinics.data ? (
            <QueryState />
          ) : !clinic ? (
            <p className="glass p-6">{t('common.noClinics')}</p>
          ) : (
            <>
              <div className="clinic-bar">
                <ChoiceSelect
                  label={t('common.clinic')}
                  value={clinic.id}
                  onChange={setSelectedId}
                  options={clinics.data.data.map(item => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />

                <p
                  className="min-w-0 truncate text-sm text-muted"
                  dir="ltr"
                >
                  {me.data.user.email}
                </p>
              </div>

            <Outlet
            key={clinic.id}
            context={{
                token,
                clinic,
                userId: session.user.id,
                isAdmin,
            } satisfies WorkspaceContext}
            />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
