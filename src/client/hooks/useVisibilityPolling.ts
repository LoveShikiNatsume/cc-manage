import { useEffect, useRef, useCallback } from 'react';

export function useVisibilityPolling(
  fetchFn: () => Promise<void>,
  intervalMs: number = 60_000,
  enabled: boolean = true,
) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    if (isMountedRef.current) fetchFn();
    timerRef.current = setInterval(() => {
      if (isMountedRef.current) fetchFn();
    }, intervalMs);
  }, [fetchFn, intervalMs, stopPolling]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      stopPolling();
      return;
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMountedRef.current = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, startPolling, stopPolling]);
}
