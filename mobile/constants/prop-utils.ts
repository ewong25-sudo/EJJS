// Shared helpers for sportsbook-style prop line formatting.

// Ensure betting lines display as decimals (FanDuel/Fliff/DK style).
// ESPN sometimes returns whole numbers — force a `.5` line in those cases
// because real sportsbooks never offer whole-number player prop lines.
export function formatPropLine(line: string | number | undefined | null): string {
  if (line == null) return '0.5';
  const n = Number(line);
  if (!isFinite(n)) return String(line);
  if (Number.isInteger(n)) return (n + 0.5).toFixed(1);
  // Already decimal — normalize "1" → "1.0" never happens; "1.5" stays
  return n % 1 === 0 ? n.toFixed(1) : String(n);
}

// Convert a raw numeric line to its sportsbook display number.
// Same value formatPropLine returns but as a number (useful for computations).
export function sportsbookLine(line: string | number | undefined | null): number {
  if (line == null) return 0.5;
  const n = Number(line);
  if (!isFinite(n)) return 0.5;
  return Number.isInteger(n) ? n + 0.5 : n;
}
