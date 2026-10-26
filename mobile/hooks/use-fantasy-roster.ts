import AsyncStorage from '@react-native-async-storage/async-storage';

export interface FantasyPlayer {
  id?: string | number;
  name: string;
  position?: string | number | null;
  lineupSlotId?: number | null;
  team?: string;
  image?: string | null;
  injuryStatus?: string | null;
  points?: number;             // week-to-date fantasy points (matchup period)
  pointsToday?: number;        // current scoring-period (today) fantasy points
  isPlaying?: boolean;         // true while the player's real team is in a live game
}

export interface FantasyMatchup {
  myTeam: { name: string; score: number; logo?: string | null };
  opponent: { name: string; score: number; logo?: string | null };
  period?: number | null;
}

export interface FantasyRosterStore {
  leagueName: string;
  sport: string;
  provider: 'yahoo' | 'espn';
  players: FantasyPlayer[];
  matchup?: FantasyMatchup | null;
  savedAt: number;
}

const STORAGE_KEY = '@fantasy_roster';

// In-memory cache so game screen can read without async
let memoryStore: FantasyRosterStore | null = null;
const listeners: Array<() => void> = [];

export async function saveFantasyRoster(store: FantasyRosterStore) {
  memoryStore = store;
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
  listeners.forEach(fn => fn());
}

export async function loadFantasyRoster(): Promise<FantasyRosterStore | null> {
  if (memoryStore) return memoryStore;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) { memoryStore = JSON.parse(raw); }
  } catch {}
  return memoryStore;
}

export function getFantasyRosterSync(): FantasyRosterStore | null {
  return memoryStore;
}

export function subscribeToRoster(fn: () => void) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Fantasy points calculators per sport
// ---------------------------------------------------------------------------

export type FantasyProvider = 'espn' | 'yahoo';

export function calcFantasyPoints(
  sport: string,
  stats: Record<string, string>,
  provider: FantasyProvider = 'espn',
): number {
  // Parse a stat that may be "2-7" (made-attempted) → takes the first number
  const n = (key: string) => {
    const raw = stats[key] ?? '0';
    const val = String(raw).split('-')[0].split('/')[0].trim();
    return isNaN(Number(val)) ? 0 : Number(val);
  };

  // Parse "made-attempted" pair (e.g., FG="5-12" → { made: 5, att: 12 })
  const ma = (key: string) => {
    const raw = String(stats[key] ?? '0-0');
    const parts = raw.split('-').map(s => parseInt(s, 10));
    return { made: parts[0] || 0, att: parts[1] || 0 };
  };

  // Round to 1 decimal place for clean display
  const r1 = (v: number) => Math.round(v * 10) / 10;

  // ────────────────────────────────────────────────────────────────────
  // NBA
  // ────────────────────────────────────────────────────────────────────
  if (sport === 'nba') {
    if (provider === 'yahoo') {
      // Yahoo H2H Points basketball default
      // PTS:1, REB:1, AST:2, STL/BLK:3, TO:-1
      return r1(
        n('PTS') * 1 +
        n('REB') * 1 +
        n('AST') * 2 +
        n('STL') * 3 +
        n('BLK') * 3 +
        n('TO')  * -1
      );
    }
    // ESPN default: each shot type valued separately + misses penalty
    // 3PM × 5, 2PM × 3, FTM × 1, MISSES × -1, REB × 1, AST × 2, STL/BLK × 4, TO × -2
    const fg  = ma('FG');                 // total field goals made-attempted
    const fg3 = ma('3PT');                // three-pointers made-attempted
    const ft  = ma('FT');                 // free throws made-attempted
    const fg2Made = Math.max(0, fg.made - fg3.made);
    const misses  = Math.max(0, fg.att - fg.made) + Math.max(0, ft.att - ft.made);
    return r1(
      fg3.made * 5 +
      fg2Made  * 3 +
      ft.made  * 1 +
      misses   * -1 +
      n('REB') * 1 +
      n('AST') * 2 +
      n('STL') * 4 +
      n('BLK') * 4 +
      n('TO')  * -2
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // NFL
  // ────────────────────────────────────────────────────────────────────
  if (sport === 'nfl') {
    const passYds = n('PYDS') || n('YDS');
    const passTD  = n('PTD')  || n('TD');
    const passInt = n('INT');
    const rushYds = n('RYDS') || 0;
    const rushTD  = n('RTD')  || 0;
    const rec     = n('REC');
    const recYds  = n('REYDS') || 0;
    const recTD   = n('RETD') || 0;
    const fum     = n('FUM') || n('FUML');
    const twoPt   = n('2PT') || n('2PC');

    if (provider === 'yahoo') {
      // Yahoo default: 0.5 PPR, INT -1
      return r1(
        (passYds / 25) +
        passTD * 4 +
        passInt * -1 +
        (rushYds / 10) +
        rushTD * 6 +
        rec * 0.5 +
        (recYds / 10) +
        recTD * 6 +
        twoPt * 2 +
        fum * -2
      );
    }
    // ESPN full-PPR default, INT -2
    return r1(
      (passYds / 25) +
      passTD * 4 +
      passInt * -2 +
      (rushYds / 10) +
      rushTD * 6 +
      rec * 1 +
      (recYds / 10) +
      recTD * 6 +
      twoPt * 2 +
      fum * -2
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // MLB
  // ────────────────────────────────────────────────────────────────────
  if (sport === 'mlb') {
    const isPitcher = stats['IP'] !== undefined && stats['IP'] !== '' && stats['IP'] !== '0' && stats['IP'] !== '0.0';

    if (isPitcher) {
      // Parse innings pitched "6.2" → 6 + 2/3 = 6.667 IP (also = 20 outs)
      const ipRaw = String(stats['IP'] ?? '0');
      const [whole, dec] = ipRaw.split('.');
      const innings = (Number(whole) || 0) + (Number(dec) || 0) / 3;
      const outs    = innings * 3;
      const k    = n('K') || n('SO');
      const w    = n('W');
      const l    = n('L');
      const sv   = n('SV');
      const er   = n('ER');
      const hA   = n('H');
      const bbA  = n('BB');
      const hbpA = n('HBP');

      if (provider === 'yahoo') {
        // Yahoo: 1/out, K:3, W/SV:8, ER:-3, H/BB/HBP allowed:-1.3
        return r1(
          outs * 1 +
          k    * 3 +
          w    * 8 +
          sv   * 8 +
          er   * -3 +
          hA   * -1.3 +
          bbA  * -1.3 +
          hbpA * -1.3
        );
      }
      // ESPN H2H Points standard: IP×3, K×1, W:5, L:-3, SV:5, ER:-1, H/BB/HBP allowed:-1
      return r1(
        innings * 3 +
        k    * 1 +
        w    * 5 +
        l    * -3 +
        sv   * 5 +
        er   * -1 +
        hA   * -1 +
        bbA  * -1 +
        hbpA * -1
      );
    }

    // Batter — TB approach (singles/2B/3B/HR weighted)
    const h   = n('H'); 
    const hr  = n('HR');
    const d2b = n('2B');
    const t3b = n('3B');
    const singles = Math.max(0, h - hr - d2b - t3b);

    if (provider === 'yahoo') {
      // Yahoo: 1B/BB/HBP=2.6, 2B=5.2, 3B=7.8, HR=10.4, R/RBI=1.9, SB=4.2
      return r1(
        singles * 2.6 +
        d2b     * 5.2 +
        t3b     * 7.8 +
        hr      * 10.4 +
        n('R')   * 1.9 +
        n('RBI') * 1.9 +
        n('BB')  * 2.6 +
        n('HBP') * 2.6 +
        n('SB')  * 4.2
      );
    }
    // ESPN H2H Points standard: 1B=1, 2B=2, 3B=3, HR=4, R=1, RBI=1, BB=1, HBP=1, SB=2, CS=-1, K=-1
    const tb = singles * 1 + d2b * 2 + t3b * 3 + hr * 4;
    return r1(
      tb +
      n('R')   * 1 +
      n('RBI') * 1 +
      n('BB')  * 1 +
      n('HBP') * 1 +
      n('SB')  * 2 +
      n('CS')  * -1 +
      n('K')   * -1
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // NHL
  // ────────────────────────────────────────────────────────────────────
  if (sport === 'nhl') {
    const isGoalie = stats['SV'] !== undefined || stats['GA'] !== undefined;

    if (provider === 'yahoo') {
      if (isGoalie) {
        return r1(
          n('W')   * 5 +
          n('SV')  * 0.6 +
          n('GA')  * -3
        );
      }
      // Yahoo skater: G:6, A:4, +/-:2, SOG:0.9, BLK:1
      return r1(
        n('G')   * 6 +
        n('A')   * 4 +
        n('+/-') * 2 +
        n('SOG') * 0.9 +
        n('BLK') * 1
      );
    }
    // ESPN skater (close to default)
    return r1(
      n('G')   * 3 +
      n('A')   * 2 +
      n('SOG') * 0.5 +
      n('+/-') * 1 +
      n('BLK') * 1
    );
  }

  return 0;
}
