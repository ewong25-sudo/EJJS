import { useEffect, useState } from 'react';

/**
 * useTick — re-renders the calling component every `intervalMs` milliseconds.
 * Returns an integer counter that increments on each tick.
 *
 * Use for "live updating" displays: fantasy points, time-since-update,
 * countdown clocks, etc. Combine with periodic data fetching for the
 * underlying values to stay fresh.
 */
export function useTick(intervalMs: number = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
