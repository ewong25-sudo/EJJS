export interface TeamInfo {
  team: string;
  score: number;
  logo: string;
}

export interface Game {
  id: string;
  period: number;
  clock: string;
  status: string;
  home: TeamInfo;
  away: TeamInfo;
}

export interface PlayerStat {
  name: string;
  nameI: string;
  position: string;
  minutes: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threesMade: number;
  threesAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  plusMinus: number;
  starter: boolean;
}

export interface TeamBoxScore {
  team: string;
  logo: string;
  score: number;
  players: PlayerStat[];
}

export interface BoxScore {
  gameId: string;
  status: string;
  period: number;
  clock: string;
  home: TeamBoxScore;
  away: TeamBoxScore;
}

export interface StandingTeam {
  teamId: number;
  teamCity: string;
  teamName: string;
  teamTricode: string;
  conference: string;
  wins: number;
  losses: number;
  winPct: number;
  gamesBehind: number;
  streak: number;
  streakType: 'W' | 'L';
  last10Wins: number;
  last10Losses: number;
  clinchIndicator?: string;
}
