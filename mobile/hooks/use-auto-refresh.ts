import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

/**
 * useAutoRefresh — fire `callback` whenever something happens that means
 * displayed data is probably stale:
 *
 *   1. screen receives focus (user opened the tab or returned to it)
 *   2. app returns from background to foreground
 *   3. local day rolls over (midnight)
 *   4. on a recurring interval while the screen is mounted (default 60s)
 *
 * Drop-in for any screen that shows live numbers — fantasy roster, scoreboards,
 * matchup view. No manual refresh needed; the data simply stays current.
 */
export function useAutoRefresh(
  callback: () => void,
  options: { intervalMs?: number; enabled?: boolean } = {}
): void {
  const { intervalMs = 60_000, enabled = true } = options;

  // Keep the latest callback in a ref so we don't burn down our event handlers
  // every time the parent re-renders
  const cbRef = useRef(callback);
  cbRef.current = callback;

  // 1) Re-fire on every screen focus (user came back to this tab)
  useFocusEffect(
    useCallback(() => {
      if (enabled) cbRef.current();
    }, [enabled])
  );

  // 2) Recurring interval + midnight rollover detector
  useEffect(() => {
    if (!enabled) return;
    let lastDay = new Date().toDateString();
    const tick = () => {
      const today = new Date().toDateString();
      if (today !== lastDay) {
        lastDay = today;
        // Day changed — definitely stale, immediate refresh
        cbRef.current();
        return;
      }
      cbRef.current();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);

  // 3) Refresh when app comes back from background
  useEffect(() => {
    if (!enabled) return;
    let last: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if ((last === 'background' || last === 'inactive') && next === 'active') {
        cbRef.current();
      }
      last = next;
    });
    return () => sub.remove();
  }, [enabled]);
}
