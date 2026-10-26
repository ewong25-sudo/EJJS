import { SportKey } from '@/types/sports';

export interface SportConfig {
  label: string;
  color: string;          // primary brand color
  secondaryColor: string;
  gradientColors: readonly [string, string, ...string[]];
  accentColor: string;
  tabIcon: string;        // SF Symbol name
  statsColumns: string[]; // column headers for standings
}

export const SPORT_CONFIG: Record<SportKey, SportConfig> = {
  nba: {
    label: 'NBA',
    color: '#C9082A',
    secondaryColor: '#1D428A',
    gradientColors: ['#C9082A', '#8B0000', '#0a0a0a'],
    accentColor: '#FF6B6B',
    tabIcon: 'sportscourt.fill',
    statsColumns: ['W', 'L', 'PCT', 'GB', 'STK'],
  },
  nfl: {
    // Readable royal blue for text/accents; deep navy stays in the gradient.
    label: 'NFL',
    color: '#4A7FC4',
    secondaryColor: '#D50A0A',
    gradientColors: ['#001F4D', '#013369', '#0d0d0d'],
    accentColor: '#4A7FC4',
    tabIcon: 'football.fill',
    statsColumns: ['W', 'L', 'T', 'PCT'],
  },
  mlb: {
    // Readable blue for text/accents; deep navy stays in the gradient.
    label: 'MLB',
    color: '#3E86D6',
    secondaryColor: '#D50A0A',
    gradientColors: ['#001A44', '#002D72', '#0a0a0a'],
    accentColor: '#3E86D6',
    tabIcon: 'baseball.fill',
    statsColumns: ['W', 'L', 'PCT', 'GB', 'STK'],
  },
  nhl: {
    // Brand navy is near-black and unreadable as text on a dark theme, so the
    // primary `color` (used for text/accents) is a readable ice blue. The dark
    // navy lives on in the gradient header where it has white text over it.
    label: 'NHL',
    color: '#4F9DDE',
    secondaryColor: '#C8102E',
    gradientColors: ['#050514', '#1a1a2e', '#0d0d0d'],
    accentColor: '#4F9DDE',
    tabIcon: 'hockey.puck.fill',
    statsColumns: ['GP', 'W', 'L', 'OTL', 'PTS'],
  },
};
