export type AuthUser = {
  id: string; email: string | null; role: string; created_at: string;
  user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown>;
};
export type AuthSession = {
  access_token: string; token_type: 'bearer'; expires_at: number; expires_in: number; user: AuthUser;
};
type AuthError = { code: string; message: string; status?: number };
type Listener = (event: 'SIGNED_IN' | 'SIGNED_OUT', session: AuthSession | null) => void;
const storageKey = 'tungsten.crm.native.session.v1';
const listeners = new Set<Listener>();
let memory: AuthSession | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let checking: Promise<{ data: { session: AuthSession | null }; error: AuthError | null }> | undefined;

function readSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const session: AuthSession | null = raw ? JSON.parse(raw) : memory;
    if (!session || typeof session.access_token !== 'string' || !session.user?.id ||
        !Number.isFinite(session.expires_at) || session.expires_at <= Date.now() / 1000) return null;
    return session;
  } catch { return memory; }
}

function persist(session: AuthSession | null, notify = true) {
  memory = session;
  try {
    if (session) window.localStorage.setItem(storageKey, JSON.stringify(session));
    else window.localStorage.removeItem(storageKey);
  } catch { /* Session remains usable in memory when storage is unavailable. */ }
  if (expiryTimer) clearTimeout(expiryTimer);
  if (session) expiryTimer = setTimeout(() => persist(null), Math.max(0, session.expires_at * 1000 - Date.now()));
  if (notify) for (const listener of listeners) listener(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
}

async function getSession() {
  if (checking) return checking;
  checking = (async () => {
    const stored = readSession();
    if (!stored) { persist(null, false); return { data: { session: null }, error: null }; }
    try {
      const response = await fetch('/api/auth/session', { headers: { Authorization: `Bearer ${stored.access_token}` }, cache: 'no-store' });
      if (response.status === 401) { persist(null); return { data: { session: null }, error: null }; }
      if (!response.ok) throw new Error('Authentication service unavailable');
      const { session } = await response.json() as { session: AuthSession };
      persist(session, false);
      return { data: { session }, error: null };
    } catch {
      return { data: { session: null }, error: { code: 'AUTH_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' } };
    }
  })();
  try { return await checking; } finally { checking = undefined; }
}

export function clearInvalidSession() { persist(null); }

export const authClient = {
  auth: {
    getSession,
    onAuthStateChange(listener: Listener) {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => { listeners.delete(listener); } } } };
    },
    async signInWithPassword(input: { email: string; password: string }) {
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        const payload = await response.json() as { session?: AuthSession; error?: AuthError };
        if (!response.ok || !payload.session) return { data: { session: null }, error: payload.error ?? { code: 'AUTH_FAILED', message: 'Unable to sign in' } };
        persist(payload.session);
        return { data: { session: payload.session }, error: null };
      } catch { return { data: { session: null }, error: { code: 'AUTH_UNAVAILABLE', message: 'Unable to reach the server' } }; }
    },
    async signOut() {
      const session = readSession();
      try {
        if (session) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      } finally { persist(null); }
      return { error: null };
    },
  },
};

window.addEventListener('storage', event => {
  if (event.key === storageKey) {
    void getSession().then(result => {
      if (!result.error) for (const listener of listeners) listener(result.data.session ? 'SIGNED_IN' : 'SIGNED_OUT', result.data.session);
    });
  }
});
window.addEventListener('focus', () => { if (readSession()) void getSession(); });
