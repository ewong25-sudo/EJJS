import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BetType = 'moneyline' | 'spread' | 'over' | 'under' | 'prop';
export type LegStatus = 'pending' | 'winning' | 'losing' | 'won' | 'lost' | 'push';
export type ParlayStatus = 'active' | 'won' | 'lost' | 'push';

export interface BetLeg {
  id: string;
  gameId: string;
  sport: string;
  gameLabel: string;
  type: BetType;
  teamAbbr?: string;
  line?: number;
  odds: number;
  description: string;
  status: LegStatus;
  playerName?: string;
  statKey?: string;
  statLine?: number;
  propDirection?: 'over' | 'under';
  athleteId?: string;
  currentStatValue?: number;
  teamLogoUrl?: string;
}

export interface Parlay {
  id: string;
  name: string;
  legs: BetLeg[];
  stake: number;
  combinedOdds: number;
  potentialPayout: number;
  status: ParlayStatus;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = '@parlays';

let memoryParlays: Parlay[] = [];
const listeners: Array<() => void> = [];

export async function saveBets(parlays: Parlay[]): Promise<void> {
  memoryParlays = parlays;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(parlays));
  } catch {}
  listeners.forEach(fn => fn());
}

export async function loadBets(): Promise<Parlay[]> {
  if (memoryParlays.length > 0) return memoryParlays;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const loaded: Parlay[] = JSON.parse(raw);
      // Strip out incomplete "draft" legs (no description / odds) that may
      // have been saved by older code — keeps existing parlays clean
      memoryParlays = loaded.map(p => ({
        ...p,
        legs: (p.legs ?? []).filter(l => l.description && l.odds && l.gameId),
      }));
      // Persist the cleaned version so it stays clean on next load
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryParlays)); } catch {}
    }
  } catch {}
  return memoryParlays;
}

export function getBetsSync(): Parlay[] {
  return memoryParlays;
}

export function subscribeToBets(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Game data shape (from ESPN summary endpoint)
// ---------------------------------------------------------------------------

export interface GameData {
  away: { team: { abbreviation: string }; score: string };
  home: { team: { abbreviation: string }; score: string };
  status: { state: string; description: string };
  playerTeams?: Array<{
    athletes: Array<{
      name: string;
      stats: Record<string, string>;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Leg status calculation
// ---------------------------------------------------------------------------

export function calcLegStatus(leg: BetLeg, game: GameData): LegStatus {
  const state = game.status?.state ?? 'pre';
  // Pre-game: always pending
  if (state === 'pre') return 'pending';

  const isFinal = state === 'post';
  const awayScore = Number(game.away?.score ?? 0);
  const homeScore = Number(game.home?.score ?? 0);
  const awayAbbr = game.away?.team?.abbreviation ?? '';
  const homeAbbr = game.home?.team?.abbreviation ?? '';

  if (leg.type === 'moneyline') {
    const teamAbbr = leg.teamAbbr ?? '';
    const awayWinning = awayScore > homeScore;
    const homeWinning = homeScore > awayScore;
    const isTie = awayScore === homeScore && isFinal;

    if (isTie) return isFinal ? 'push' : 'pending';

    const myTeamWinning =
      teamAbbr === awayAbbr ? awayWinning :
      teamAbbr === homeAbbr ? homeWinning :
      false;

    if (isFinal) return myTeamWinning ? 'won' : 'lost';
    return myTeamWinning ? 'winning' : 'losing';
  }

  if (leg.type === 'spread') {
    const teamAbbr = leg.teamAbbr ?? '';
    const line = leg.line ?? 0;
    // Positive line = underdog, negative line = favored
    // teamAbbr team needs to cover the spread
    // If line < 0 (they're favored), they need to win by more than |line|
    // If line > 0 (underdog), they can lose by less than line or win outright
    let teamScore: number;
    let oppScore: number;

    if (teamAbbr === awayAbbr) {
      teamScore = awayScore;
      oppScore = homeScore;
    } else if (teamAbbr === homeAbbr) {
      teamScore = homeScore;
      oppScore = awayScore;
    } else {
      return 'pending';
    }

    const margin = teamScore - oppScore; // positive = team winning
    const covered = margin + line > 0; // team score + spread > opponent score
    const push = margin + line === 0;

    if (push) return 'push';
    if (isFinal) return covered ? 'won' : 'lost';
    return covered ? 'winning' : 'losing';
  }

  if (leg.type === 'over') {
    const total = awayScore + homeScore;
    const line = leg.line ?? 0;
    if (total === line) return 'push';
    const winning = total > line;
    if (isFinal) return winning ? 'won' : 'lost';
    return winning ? 'winning' : 'losing';
  }

  if (leg.type === 'under') {
    const total = awayScore + homeScore;
    const line = leg.line ?? 0;
    if (total === line) return 'push';
    const winning = total < line;
    if (isFinal) return winning ? 'won' : 'lost';
    return winning ? 'winning' : 'losing';
  }

  if (leg.type === 'prop') {
    const playerName = (leg.playerName ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const statKey = leg.statKey ?? '';
    const statLine = leg.statLine ?? 0;

    const STAT_KEY_MAP: Record<string, string> = {
      'Points': 'PTS', 'Rebounds': 'REB', 'Assists': 'AST', 'Steals': 'STL', 'Blocks': 'BLK',
      '3-Pointers': '3PM', 'Pass Yds': 'YDS', 'Rush Yds': 'YDS', 'Rec Yds': 'YDS',
      'Receptions': 'REC', 'Pass TDs': 'TD', 'Strikeouts': 'K', 'Hits': 'H',
      'Total Bases': 'TB', 'RBIs': 'RBI', 'Runs': 'R', 'Home Runs': 'HR',
      'Shots': 'SOG', 'Goals': 'G', 'Saves': 'SV',
    };
    const mappedKey = STAT_KEY_MAP[statKey] ?? statKey;

    // Find player across all playerTeams
    for (const team of game.playerTeams ?? []) {
      for (const athlete of team.athletes) {
        const nameNorm = athlete.name.toLowerCase().replace(/[^a-z]/g, '');
        if (nameNorm === playerName || nameNorm.includes(playerName) || playerName.includes(nameNorm)) {
          const statVal = Number(athlete.stats[mappedKey] ?? 0);
          const dir = leg.propDirection ?? 'over';
          const winning = dir === 'over' ? statVal > statLine : statVal < statLine;
          const push = statVal === statLine;
          if (push) return 'push';
          if (isFinal) return winning ? 'won' : 'lost';
          return winning ? 'winning' : 'losing';
        }
      }
    }

    return 'pending';
  }

  return 'pending';
}

// ---------------------------------------------------------------------------
// Parlay status calculation
// ---------------------------------------------------------------------------

export function calcParlayStatus(parlay: Parlay): ParlayStatus {
  const legs = parlay.legs;
  if (legs.length === 0) return 'active';

  const hasLost = legs.some(l => l.status === 'lost');
  if (hasLost) return 'lost';

  const hasPush = legs.some(l => l.status === 'push');
  const allWonOrPush = legs.every(l => l.status === 'won' || l.status === 'push');

  if (allWonOrPush && hasPush) return 'push';
  if (legs.every(l => l.status === 'won')) return 'won';

  // Still active (pending/winning/losing legs remain)
  return 'active';
}

// ---------------------------------------------------------------------------
// American odds formatting helper
// ---------------------------------------------------------------------------

export function fmtOdds(odds: number): string {
  if (!odds && odds !== 0) return '--';
  return odds > 0 ? `+${odds}` : String(odds);
}
