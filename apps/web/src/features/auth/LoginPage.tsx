import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import Brand from '../../components/Brand';
import Preferences from '../../components/Preferences';

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(false);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      setError(Boolean(authError));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-backdrop min-h-dvh p-4 sm:p-8">
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <Brand />
        <Preferences />
      </header>

      <main className="relative z-10 mx-auto grid min-h-[80dvh] max-w-5xl items-center gap-10 py-12 lg:grid-cols-2">
        <div>
          <p className="eyebrow">{t('auth.eyebrow')}</p>
          <h1 className="mt-4 text-5xl font-normal leading-tight sm:text-6xl">
            {t('auth.title')}
          </h1>
          <p className="mt-5 max-w-sm text-lg leading-relaxed text-muted">
            {t('auth.subtitle')}
          </p>
        </div>

        <form className="glass grid gap-3 p-6 sm:p-10" onSubmit={submit}>
          <label htmlFor="email">{t('auth.email')}</label>
          <input
            id="email"
            type="email"
            dir="ltr"
            autoComplete="username"
            className="field"
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
          />

          <label className="mt-3" htmlFor="password">
            {t('auth.password')}
          </label>
          <input
            id="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            className="field"
            required
            value={password}
            onChange={event => setPassword(event.target.value)}
          />

          {error && (
            <p role="alert" className="text-sm text-danger">
              {t('auth.error')}
            </p>
          )}

          <button
            type="submit"
            className="control mt-5 min-h-12 justify-center bg-lavender! text-[#242424]!"
            disabled={busy}
          >
            {t(busy ? 'auth.busy' : 'auth.submit')}
          </button>
        </form>
      </main>
    </div>
  );
}