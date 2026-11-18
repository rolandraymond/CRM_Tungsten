import { useEffect } from 'react';

type Table = 'leads' | 'appointments' | 'clinic_ads' | 'chat_channels' | 'chat_conversations'   | 'chat_referrals'| 'chat_messages';

// Poll visible screens; authenticated APIs remain the source of truth.
export function useClinicChanges(clinicId: string, tables: readonly Table[], onChange: () => void) {
  const tableKey = tables.join(',');
  useEffect(() => {
    if (!clinicId || !tableKey) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(onChange, 500);
    };
    const interval = setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      if (debounce) clearTimeout(debounce);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [clinicId, tableKey, onChange]);
}
