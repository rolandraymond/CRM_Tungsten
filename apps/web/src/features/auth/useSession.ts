import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

export function useSession() {
  const [state, setState] = useState<{
    ready: boolean;
    session: Session | null;
    error: boolean;
  }>({
    ready: false,
    session: null,
    error: false,
  });

  useEffect(() => {
    let active = true;
    let receivedEvent = false;

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      receivedEvent = true;

      if (active) {
        setState({ ready: true, session, error: false });
      }
    });

    void supabase.auth.getSession()
      .then(({ data: result, error }) => {
        if (active && !receivedEvent) {
          setState({
            ready: true,
            session: result.session,
            error: Boolean(error),
          });
        }
      })
      .catch(() => {
        if (active && !receivedEvent) {
          setState({
            ready: true,
            session: null,
            error: true,
          });
        }
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}