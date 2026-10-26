import { useEffect, useRef, useState } from 'react';

/**
 * useLiveClock — given the most recent game-clock string from the server
 * (e.g. "5:23" for NBA/NFL/NHL), returns a string that ticks down once a
 * second so the displayed clock feels live between server polls.
 *
 * • Resets the baseline every time the server sends a new clock value
 * • Pauses ticking during timeouts / between quarters (via `isRunning`)
 * • Returns the raw string for non-ticking formats (baseball innings, etc.)
 * • Never ticks past 0:00 — clamps if elapsed exceeds remaining
 *
 * Usage:
 *   const liveClock = useLiveClock(summary.status.clock, isLive, isRunning);
 *   <Text>{liveClock}</Text>
 */
export function useLiveClock(
  rawClock: string | null | undefined,
  isLive: boolean = true,
  isRunning: boolean = true,
): string {
  // Baseline: last clock we received + when we received it
  const baselineRef = useRef<{ secs: number; at: number } | null>(null);
  // Track previous clock value to auto-detect stoppages — if the server
  // sends the same clock value twice in a row, the real game clock is
  // STOPPED (timeout, free throw, foul, etc.) and we should not tick.
  const lastRawRef = useRef<string | null | undefined>(null);
  const lastRawAtRef = useRef<number>(0);
  const stoppedRef = useRef(false);
  // We only tick AFTER we've seen the clock change between polls. Until
  // then, freeze at the server value — prevents fake ticking during the
  // first ~2s when we don't yet know if the clock is running or stopped.
  const confirmedRunningRef = useRef(false);
  const [, setTick] = useState(0);

  // Parse "MM:SS" or "M:SS" → total seconds. Returns null for non-clock formats.
  const parse = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const m = /^(\d{1,2}):(\d{2})(?:\.(\d))?$/.exec(s.trim());
    if (!m) return null;
    const mins  = Number(m[1]) || 0;
    const secs  = Number(m[2]) || 0;
    const tenth = Number(m[3]) || 0;
    return mins * 60 + secs + tenth / 10;
  };

  // Whenever the server sends a new clock value, update our baseline
  useEffect(() => {
    const parsed = parse(rawClock);
    if (parsed == null) {
      baselineRef.current = null;
      stoppedRef.current = false;
      confirmedRunningRef.current = false;
      lastRawRef.current = rawClock;
      lastRawAtRef.current = Date.now();
      return;
    }
    const now = Date.now();
    if (rawClock === lastRawRef.current && lastRawRef.current != null) {
      // Server returned the SAME clock value as last poll → real clock is
      // stopped (timeout, free throw, foul, end of period). Freeze display.
      stoppedRef.current = true;
      confirmedRunningRef.current = false;
    } else if (lastRawRef.current != null) {
      // We now have two different values — clock IS running. Allow ticking.
      stoppedRef.current = false;
      confirmedRunningRef.current = true;
    } else {
      // First poll — we don't yet know whether clock is running. Freeze
      // at the server value until the next poll confirms running.
      stoppedRef.current = false;
      confirmedRunningRef.current = false;
    }
    // Always reset baseline to the latest server value so the display
    // never drifts below the real game clock when ticking resumes
    baselineRef.current = { secs: parsed, at: now };
    lastRawRef.current = rawClock;
    lastRawAtRef.current = now;
  }, [rawClock]);

  // Tick every second so the displayed value updates
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  // If we couldn't parse it, return the raw value (handles "Top 3rd" etc.)
  if (!baselineRef.current) return rawClock || '';

  if (!isLive) {
    // Not live → just show the parsed baseline once, no countdown
    const m = Math.floor(baselineRef.current.secs / 60);
    const s = Math.floor(baselineRef.current.secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Only tick when we've CONFIRMED the clock is running (by seeing the
  // server value change between polls). Detection:
  //   1. Caller passes isRunning=false (status text says timeout/halftime)
  //   2. Server sent the same value twice in a row → auto-stopped
  //   3. We haven't yet seen the clock change → uncertain, don't tick
  const trulyRunning = isRunning && !stoppedRef.current && confirmedRunningRef.current;
  const elapsed = trulyRunning ? (Date.now() - baselineRef.current.at) / 1000 : 0;
  const current = Math.max(0, baselineRef.current.secs - elapsed);

  // Show tenths under 1 minute (broadcast convention)
  if (current < 60) {
    return current.toFixed(1);
  }
  const m = Math.floor(current / 60);
  const s = Math.floor(current % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
