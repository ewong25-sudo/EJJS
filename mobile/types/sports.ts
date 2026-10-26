export type SportKey = 'nba' | 'nfl' | 'mlb' | 'nhl';

export interface SportTeam {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  logo: string;
  logoDark?: string;
  color: string; // hex WITHOUT #
}

export interface SportGame {
  id: string;
  shortName: string;
  date: string;
  status: {
    clock: string;
    period: number;
    state: 'pre' | 'in' | 'post';
    detail: string;
  };
  home: { team: SportTeam; score: string; record?: string };
  away: { team: SportTeam; score: string; record?: string };
  note?: string;        // e.g. "East Semifinals - Game 6"
  seriesSummary?: string; // e.g. "CLE leads series 3-2"
}

export interface NewsArticle {
  id: string;
  headline: string;
  description: string;
  published: string;
  image: string | null;
  url: string;
  sport: SportKey;
  source?: string;   // "ESPN" | "CBS Sports" | "Yahoo Sports"
}

export interface StandingEntry {
  rank: number;
  team: SportTeam;
  wins: number;
  losses: number;
  pct: string;
  gb: string;
  points?: number;
  streak?: string;
  // Extended columns
  home?: string;
  away?: string;
  last10?: string;
  pointsFor?: string;
  pointsAgainst?: string;
  diff?: string;
}

export interface StandingGroup {
  name: string;
  conference?: string;   // parent league/conference (e.g. "American League")
  entries: StandingEntry[];
}
