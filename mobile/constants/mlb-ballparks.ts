export type MlbBallparkBackdropKind =
  | 'city'
  | 'dome'
  | 'fountains'
  | 'warehouse'
  | 'waterfront'
  | 'mountains'
  | 'retro'
  | 'generic';

export type MlbBallparkProfile = {
  teamAbbr: string;
  venue: string;
  backdropKind: MlbBallparkBackdropKind;
  seatBowl: 'symmetric' | 'asymmetric' | 'dome' | 'warehouse' | 'waterfront';
  accent: string;
  outfieldFeature?: string;
  modelStatus: 'detailed' | 'profiled';
};

export const MLB_BALLPARKS: Record<string, MlbBallparkProfile> = {
  ARI: { teamAbbr: 'ARI', venue: 'Chase Field', backdropKind: 'dome', seatBowl: 'dome', accent: '#A71930', outfieldFeature: 'chase-roof', modelStatus: 'profiled' },
  ATH: { teamAbbr: 'ATH', venue: 'Sutter Health Park', backdropKind: 'city', seatBowl: 'symmetric', accent: '#003831', outfieldFeature: 'sutter-batter-eye', modelStatus: 'profiled' },
  OAK: { teamAbbr: 'OAK', venue: 'Sutter Health Park', backdropKind: 'city', seatBowl: 'symmetric', accent: '#003831', outfieldFeature: 'sutter-batter-eye', modelStatus: 'profiled' },
  ATL: { teamAbbr: 'ATL', venue: 'Truist Park', backdropKind: 'city', seatBowl: 'asymmetric', accent: '#CE1141', outfieldFeature: 'truist-scoreboard', modelStatus: 'profiled' },
  BAL: { teamAbbr: 'BAL', venue: 'Oriole Park at Camden Yards', backdropKind: 'warehouse', seatBowl: 'warehouse', accent: '#DF4601', outfieldFeature: 'warehouse', modelStatus: 'profiled' },
  BOS: { teamAbbr: 'BOS', venue: 'Fenway Park', backdropKind: 'retro', seatBowl: 'asymmetric', accent: '#BD3039', outfieldFeature: 'green-monster', modelStatus: 'profiled' },
  CHC: { teamAbbr: 'CHC', venue: 'Wrigley Field', backdropKind: 'retro', seatBowl: 'asymmetric', accent: '#0E3386', outfieldFeature: 'wrigley-ivy', modelStatus: 'profiled' },
  CIN: { teamAbbr: 'CIN', venue: 'Great American Ball Park', backdropKind: 'waterfront', seatBowl: 'asymmetric', accent: '#C6011F', outfieldFeature: 'riverboat-smokestacks', modelStatus: 'profiled' },
  CLE: { teamAbbr: 'CLE', venue: 'Progressive Field', backdropKind: 'city', seatBowl: 'symmetric', accent: '#E31937', outfieldFeature: 'progressive-sign', modelStatus: 'profiled' },
  COL: { teamAbbr: 'COL', venue: 'Coors Field', backdropKind: 'mountains', seatBowl: 'symmetric', accent: '#33006F', modelStatus: 'profiled' },
  CWS: { teamAbbr: 'CWS', venue: 'Rate Field', backdropKind: 'city', seatBowl: 'symmetric', accent: '#C4CED4', outfieldFeature: 'exploding-scoreboard', modelStatus: 'profiled' },
  DET: { teamAbbr: 'DET', venue: 'Comerica Park', backdropKind: 'city', seatBowl: 'asymmetric', accent: '#FA4616', outfieldFeature: 'comerica-towers', modelStatus: 'profiled' },
  HOU: { teamAbbr: 'HOU', venue: 'Daikin Park', backdropKind: 'city', seatBowl: 'warehouse', accent: '#EB6E1F', outfieldFeature: 'train-track', modelStatus: 'profiled' },
  KC: { teamAbbr: 'KC', venue: 'Kauffman Stadium', backdropKind: 'fountains', seatBowl: 'symmetric', accent: '#004687', outfieldFeature: 'fountains', modelStatus: 'detailed' },
  LAA: { teamAbbr: 'LAA', venue: 'Angel Stadium', backdropKind: 'mountains', seatBowl: 'symmetric', accent: '#BA0021', outfieldFeature: 'rockpile', modelStatus: 'profiled' },
  LAD: { teamAbbr: 'LAD', venue: 'Dodger Stadium', backdropKind: 'mountains', seatBowl: 'symmetric', accent: '#005A9C', outfieldFeature: 'dodger-pavilions', modelStatus: 'profiled' },
  MIA: { teamAbbr: 'MIA', venue: 'loanDepot park', backdropKind: 'dome', seatBowl: 'dome', accent: '#00A3E0', outfieldFeature: 'miami-towers', modelStatus: 'profiled' },
  MIL: { teamAbbr: 'MIL', venue: 'American Family Field', backdropKind: 'dome', seatBowl: 'dome', accent: '#FFC52F', outfieldFeature: 'brewers-roof-arches', modelStatus: 'profiled' },
  MIN: { teamAbbr: 'MIN', venue: 'Target Field', backdropKind: 'city', seatBowl: 'symmetric', accent: '#D31145', outfieldFeature: 'target-skyline', modelStatus: 'profiled' },
  NYM: { teamAbbr: 'NYM', venue: 'Citi Field', backdropKind: 'city', seatBowl: 'asymmetric', accent: '#FF5910', outfieldFeature: 'citi-apple', modelStatus: 'profiled' },
  NYY: { teamAbbr: 'NYY', venue: 'Yankee Stadium', backdropKind: 'city', seatBowl: 'symmetric', accent: '#C4CED4', outfieldFeature: 'yankee-frieze', modelStatus: 'profiled' },
  PHI: { teamAbbr: 'PHI', venue: 'Citizens Bank Park', backdropKind: 'city', seatBowl: 'asymmetric', accent: '#E81828', outfieldFeature: 'liberty-bell', modelStatus: 'profiled' },
  PIT: { teamAbbr: 'PIT', venue: 'PNC Park', backdropKind: 'waterfront', seatBowl: 'asymmetric', accent: '#FDB827', outfieldFeature: 'bridges', modelStatus: 'profiled' },
  SD: { teamAbbr: 'SD', venue: 'Petco Park', backdropKind: 'warehouse', seatBowl: 'asymmetric', accent: '#FFC425', outfieldFeature: 'western-metal', modelStatus: 'profiled' },
  SEA: { teamAbbr: 'SEA', venue: 'T-Mobile Park', backdropKind: 'city', seatBowl: 'asymmetric', accent: '#00A3E0', outfieldFeature: 'seattle-roof-trusses', modelStatus: 'profiled' },
  SF: { teamAbbr: 'SF', venue: 'Oracle Park', backdropKind: 'waterfront', seatBowl: 'waterfront', accent: '#FD5A1E', outfieldFeature: 'mcovey-cove', modelStatus: 'profiled' },
  STL: { teamAbbr: 'STL', venue: 'Busch Stadium', backdropKind: 'city', seatBowl: 'symmetric', accent: '#C41E3A', outfieldFeature: 'gateway-arch', modelStatus: 'profiled' },
  TB: { teamAbbr: 'TB', venue: 'Tropicana Field', backdropKind: 'dome', seatBowl: 'dome', accent: '#8FBCE6', outfieldFeature: 'trop-dome', modelStatus: 'detailed' },
  TEX: { teamAbbr: 'TEX', venue: 'Globe Life Field', backdropKind: 'dome', seatBowl: 'dome', accent: '#C0111F', outfieldFeature: 'globe-life-roof', modelStatus: 'profiled' },
  TOR: { teamAbbr: 'TOR', venue: 'Rogers Centre', backdropKind: 'city', seatBowl: 'dome', accent: '#134A8E', outfieldFeature: 'cn-tower', modelStatus: 'profiled' },
  WSH: { teamAbbr: 'WSH', venue: 'Nationals Park', backdropKind: 'city', seatBowl: 'symmetric', accent: '#AB0003', outfieldFeature: 'capitol-view', modelStatus: 'profiled' },
  DEFAULT: { teamAbbr: 'MLB', venue: 'Ballpark', backdropKind: 'generic', seatBowl: 'symmetric', accent: '#6f7f8f', modelStatus: 'profiled' },
};

export function getMlbBallparkProfile(teamAbbr?: string): MlbBallparkProfile {
  const key = (teamAbbr || '').toUpperCase();
  return MLB_BALLPARKS[key] || MLB_BALLPARKS.DEFAULT;
}
