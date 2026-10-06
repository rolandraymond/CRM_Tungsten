import { useEffect, useId } from 'react';
import { supabase } from '../lib/supabase';

type Table = 'leads' | 'appointments' | 'clinic_ads' | 'chat_channels' | 'chat_conversations'   | 'chat_referrals'| 'chat_messages';

// The event only invalidates the screen. The authenticated API remains the
// source of truth, including after a reconnect or an inactive browser tab.
export function useClinicChanges(
  clinicId: string,
  tables: readonly Table[],
  onChange: () => void,
) {
  const subscriberId = useId();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 500);
    };

    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    let channel = supabase.channel(
      `clinic-dashboard:${clinicId}:${tables.join('-')}:${subscriberId}`,
    );

    for (const table of tables) {
      for (const event of ['INSERT', 'UPDATE'] as const) {
        channel = channel.on(
          'postgres_changes',
          {
            event,
            schema: 'public',
            table,
            filter: `clinic_id=eq.${clinicId}`,
          },
          refresh,
        );
      }
    }

    let subscribedBefore = false;
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        // The page fetches on mount; refresh only after a reconnect.
        if (subscribedBefore) refresh();
        subscribedBefore = true;
      }
    });

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [clinicId, tables, onChange, subscriberId]);
}
