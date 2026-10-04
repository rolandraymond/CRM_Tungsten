import { useCallback, useEffect, useState } from 'react';

export function useGet<T>(path: string | null, token: string) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([path, token]);

  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!path) return;

    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(path!, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json() as T;

        if (!controller.signal.aborted) {
          setResult({ key, data });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult(previous =>
            previous?.key === key && previous.data !== undefined
              ? previous
              : { key, error: true },
          );
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [path, token, key, attempt]);

  const current = result?.key === key ? result : null;
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  return {
    data: current?.data,
    error: current?.error ?? false,
    loading: Boolean(path) && !current,
    retry,
  };
}