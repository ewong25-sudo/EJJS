import axios from 'axios';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

// Animated SVG primitives — used by per-sport play visualizations
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect   = Animated.createAnimatedComponent(Rect);
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { BoxScoreTable, BSAthlete } from '@/components/box-score-table';
import { F } from '@/constants/fonts';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FavoritePlayer, useFavorites } from '@/hooks/use-favorites';
import { FantasyPlayer, FantasyRosterStore, calcFantasyPoints, loadFantasyRoster, subscribeToRoster, getFantasyRosterSync } from '@/hooks/use-fantasy-roster';
import { useTick } from '@/hooks/use-tick';
import { useLiveClock } from '@/hooks/use-live-clock';
import { GameChat } from '@/components/game-chat';
import { SportKey } from '@/types/sports';

import { API } from '@/constants/api';
import { BetLeg, Parlay, calcLegStatus, fmtOdds, loadBets, subscribeToBets } from '@/hooks/use-bets';
import { PropProgressRing } from '@/components/ui/PropProgressRing';
import { getMlbBallparkProfile } from '@/constants/mlb-ballparks';

// Lighten a brand color when it's too dark to read as TEXT on a dark
// background (e.g. NFL navy #013369, MLB navy #002D72). Returns the original
// color in light mode or when it's already bright enough.
function readableOnDark(hex: string | undefined, dark: boolean, fallback: string): string {
  if (!hex) return fallback;
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (dark && lum < 0.5) {
    const f = 0.6; // blend toward white
    r = Math.round(r + (255 - r) * f);
    g = Math.round(g + (255 - g) * f);
    b = Math.round(b + (255 - b) * f);
  }
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

interface LeaderAthlete {
  id: string;
  displayName: string;
  headshot: string;
  position: string;
}

interface LeaderCategory {
  name: string;
  displayName: string;
  athlete: LeaderAthlete;
  displayValue: string;
}

interface TeamLeaders {
  teamId: string;
  teamAbbr: string;
  categories: LeaderCategory[];
}

interface Probable {
  homeAway: string;
  pitcher: { id: string; displayName: string; headshot: string; throwingArm: string; stats?: Record<string, string> };
}

interface GameOdds {
  provider: string;
  spread: string;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
  awayMoneyLine: number | null;
  homeMoneyLine: number | null;
}

interface PlayerProp {
  athleteId: string;
  typeName: string;
  line: string;
  overOdds: string;
  underOdds?: string;
  athlete: { name: string; headshot: string };
}

interface Linescore {
  value: string;
  hits: number | null;
  errors: number | null;
}

interface GameSummary {
  sport: string;
  eventId: string;
  status: { state?: string; completed?: boolean; description: string; clock: string; period: number };
  home: { team: { id: string; displayName: string; abbreviation: string; logo: string; logoDark?: string; color: string }; score: string; linescores?: Linescore[]; record?: string };
  away: { team: { id: string; displayName: string; abbreviation: string; logo: string; logoDark?: string; color: string }; score: string; linescores?: Linescore[]; record?: string };
  playerTeams: Array<{
    teamId: string;
    labels: string[];
    athletes: Array<{
      id: string;
      name: string;
      position: string;
      battingOrder?: number | null;
      hotZones?: Array<{
        zoneId: number;
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
        atBats: number;
        hits: number;
        battingAvg: number;
        battingAvgScore: number;
      }>;
      headshot: string;
      starter: boolean;
      stats: Record<string, string>;
    }>;
  }>;
  pitcherTeams?: Array<{
    teamId: string;
    labels: string[];
    athletes: Array<{ id: string; name: string; position: string; headshot: string; starter: boolean; stats: Record<string, string> }>;
  }>;
  rosterPlayers?: Array<{ id: string; name: string; position: string; teamId: string }>;
  teamStats: Array<{ teamId: string; stats: Array<{ label: string; value: string }> }>;
  teamSeasonStats?: Array<{ homeAway: string; teamId: string; abbreviation: string; record: string; stats: Array<{ name: string; label: string; displayValue: string }> }>;
  series: { summary: string; completed: boolean } | null;
  notes: string[];
  leaders: TeamLeaders[];
  probables: Probable[];
  gameOdds: GameOdds | null;
  playerProps: PlayerProp[];
}

interface Runner { id: string; name: string; headshot: string }
type BasePoint = { x: number; y: number };
interface OnDeckBatter { id: string; name: string; headshot: string }

interface Play {
  id: string;
  text: string;
  typeText: string;
  typeAbbr: string;
  period: string;
  clock: string;
  awayScore: number;
  homeScore: number;
  scoringPlay: boolean;
  scoreValue: number;
  teamId: string;
  coordinate: { x: number; y: number } | null;
  participants: Array<{ id?: string; name: string; headshot: string; type: string }>;
  // MLB pitch data
  pitchCoordinate: { x: number; y: number } | null;
  pitchType: { text: string; abbr: string } | null;
  pitchVelocity: number | null;
  atBatId: string | null;
  atBatPitchNumber: number | null;
  bats: string | null;
  // MLB situational data
  onFirst: Runner | null;
  onSecond: Runner | null;
  onThird: Runner | null;
  outcomeAbbr: string | null;
  outs: number | null;
  trajectory: string | null;
  resultCount: { balls: number; strikes: number } | null;
  pitchCount: number | null;
  onDeck: OnDeckBatter | null;
}

interface PlaysData {
  sport: string;
  eventId: string;
  plays: Play[];
  status: { state: string; description: string; clock: string; period: number };
}

const KEY_STATS: Record<string, string[]> = {
  // NBA: PTS first (so it's the sort key + bolded "headline" stat), then
  // shooting splits (MIN, FG, 3PT) — matches ESPN/NBA-app box-score layout.
  // Total = 9 columns; the table renders inside a horizontal ScrollView so
  // the extras are reachable on phone-width screens.
  nba: ['PTS', 'MIN', 'FG', '3PT', 'REB', 'AST', 'STL', 'BLK', '+/-'],
  nfl: ['YDS', 'TD', 'INT', 'REC', 'CAR'],
  // Covers both batters (AB/H/R/RBI/HR/BB/K/HBP/SB) and pitchers (IP/K/ER/W/SV).
  // The fantasy card filters to only keys present in the player's actual stats,
  // so batters see batting cols and pitchers see pitching cols automatically.
  mlb: ['AB', 'H', 'R', 'RBI', 'HR', 'BB', 'K', 'HBP', 'SB', 'IP', 'ER', 'W', 'SV'],
  nhl: ['G', 'A', '+/-', 'SOG', 'TOI'],
};

// ---------------------------------------------------------------------------
// Custom navigation bar header — logos, score, live indicator
// ---------------------------------------------------------------------------

function GameNavHeader({
  away, home, status, sport,
}: {
  away: GameSummary['away'];
  home: GameSummary['home'];
  status: GameSummary['status'];
  sport: string;
}) {
  const desc = status.description?.toLowerCase() ?? '';
  // Prefer ESPN's authoritative state; fall back to text only if state absent.
  // A scheduled game (state 'pre') must NEVER show LIVE even though its
  // description is a date/time that doesn't contain "scheduled".
  const isLive = status.state
    ? status.state === 'in'
    : (!desc.includes('final') && !desc.includes('scheduled') && desc.length > 0
        && !/\b\d{1,2}:\d{2}\s*(am|pm)\b/i.test(desc)
        && !/\b(ed?t|es?t|cd?t|cs?t|md?t|ms?t|pd?t|ps?t)\b/i.test(desc));
  const isFinal = status.state ? status.state === 'post' : desc.includes('final');
  const hasScore = isLive || isFinal;

  // Ticking clock — updates every second between server polls.
  // Pauses for timeouts / halftime / between quarters.
  const isRunning = isLive && !/timeout|halftime|intermission|end of|end period|delay/i.test(desc);
  const liveClock = useLiveClock(status.clock, isLive, isRunning);

  // What to show under the LIVE pill — sport-aware
  // MLB has no clock; show inning ("Top 3rd"). Other sports show clock if non-zero.
  const liveSubText = (() => {
    if (sport === 'mlb') return status.description || '';   // "Top 3rd", "End 5th", etc.
    if (!liveClock || liveClock === '0:00') return status.description || '';
    return `Q${status.period || 1}  ${liveClock}`;
  })();
  const awayLogo = away.team.logoDark ?? away.team.logo;
  const homeLogo = home.team.logoDark ?? home.team.logo;
  const headerLogoStyle = {
    width: 36,
    height: 36,
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {/* Away */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Image source={{ uri: awayLogo }} style={headerLogoStyle} contentFit="contain" />
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 13, letterSpacing: 0.5 }}>{away.team.abbreviation}</Text>
          {hasScore && <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20, lineHeight: 22 }}>{away.score}</Text>}
        </View>
      </View>

      {/* Center */}
      <View style={{ alignItems: 'center', minWidth: 64 }}>
        {isLive ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' }} />
              <Text style={{ color: '#FF3B30', fontSize: 9, fontFamily: F.black, letterSpacing: 1.5 }}>LIVE</Text>
            </View>
            {liveSubText ? (
              <Text
                style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, fontFamily: F.bold }}
                numberOfLines={1}
              >
                {liveSubText}
              </Text>
            ) : null}
          </>
        ) : isFinal ? (
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontFamily: F.black, letterSpacing: 1.5 }}>FINAL</Text>
        ) : (
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontFamily: F.black }}>@</Text>
        )}
      </View>

      {/* Home */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={{ alignItems: 'flex-start' }}>
          <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 13, letterSpacing: 0.5 }}>{home.team.abbreviation}</Text>
          {hasScore && <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 20, lineHeight: 22 }}>{home.score}</Text>}
        </View>
        <Image source={{ uri: homeLogo }} style={headerLogoStyle} contentFit="contain" />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Line score (runs/quarters by period) — like ESPN
// ---------------------------------------------------------------------------

function LineScoreTable({
  sport, away, home, cardBg, border, text, sub,
}: {
  sport: string;
  away: GameSummary['away'];
  home: GameSummary['home'];
  cardBg: string;
  border: string;
  text: string;
  sub: string;
}) {
  const awayLs = away.linescores ?? [];
  const homeLs = home.linescores ?? [];
  const periodCount = Math.max(awayLs.length, homeLs.length);
  if (periodCount === 0) return null;

  const showRHE = sport === 'mlb';
  const periodLabels = Array.from({ length: periodCount }, (_, i) => String(i + 1));

  const totalHits = (ls: Linescore[]) => ls.reduce((s, p) => s + (p.hits ?? 0), 0);
  const totalErrors = (ls: Linescore[]) => ls.reduce((s, p) => s + (p.errors ?? 0), 0);

  // ROW_H must match exactly between fixed team col and scrollable stats col
  const ROW_H = 40;
  const HEADER_H = 28;

  // Fixed team-column cell
  const TeamCell = ({ label, logo }: { label?: string; logo?: string }) => (
    <View style={[lineScoreStyles.teamRow, { height: ROW_H }]}>
      {logo ? <Image source={{ uri: logo }} style={lineScoreStyles.logo} contentFit="contain" /> : <View style={lineScoreStyles.logo} />}
      <Text style={[lineScoreStyles.teamAbbr, { color: text }]}>{label}</Text>
    </View>
  );

  return (
    <Animated.View entering={FadeInDown.duration(400)} style={[lineScoreStyles.card, { backgroundColor: cardBg, borderColor: border }]}>
      <View style={{ flexDirection: 'row' }}>
        {/* FIXED TEAM COLUMN — does not scroll */}
        <View style={[lineScoreStyles.fixedCol, { borderRightColor: 'rgba(255,255,255,0.08)' }]}>
          <View style={[lineScoreStyles.teamRow, { height: HEADER_H }]}>
            <Text style={[lineScoreStyles.headerText, { color: sub }]}></Text>
          </View>
          <TeamCell label={away.team.abbreviation} logo={away.team.logo} />
          <TeamCell label={home.team.abbreviation} logo={home.team.logo} />
        </View>

        {/* SCROLLABLE STATS COLUMN */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View>
            {/* Header row */}
            <View style={[lineScoreStyles.statsRow, { height: HEADER_H }]}>
              {periodLabels.map((p, i) => (
                <View key={i} style={lineScoreStyles.periodCol}>
                  <Text style={[lineScoreStyles.headerText, { color: sub }]}>{p}</Text>
                </View>
              ))}
              <View style={[lineScoreStyles.totalCol, lineScoreStyles.totalDivider]}>
                <Text style={[lineScoreStyles.headerText, { color: text }]}>{showRHE ? 'R' : 'T'}</Text>
              </View>
              {showRHE && (
                <>
                  <View style={lineScoreStyles.totalCol}>
                    <Text style={[lineScoreStyles.headerText, { color: sub }]}>H</Text>
                  </View>
                  <View style={lineScoreStyles.totalCol}>
                    <Text style={[lineScoreStyles.headerText, { color: sub }]}>E</Text>
                  </View>
                </>
              )}
            </View>

            {/* Away stats row */}
            <View style={[lineScoreStyles.statsRow, { height: ROW_H }]}>
              {periodLabels.map((_, i) => (
                <View key={i} style={lineScoreStyles.periodCol}>
                  <Text style={[lineScoreStyles.periodVal, { color: text }]}>{awayLs[i]?.value ?? '-'}</Text>
                </View>
              ))}
              <View style={[lineScoreStyles.totalCol, lineScoreStyles.totalDivider]}>
                <Text style={[lineScoreStyles.totalVal, { color: text }]}>{away.score}</Text>
              </View>
              {showRHE && (
                <>
                  <View style={lineScoreStyles.totalCol}>
                    <Text style={[lineScoreStyles.totalVal, { color: sub }]}>{totalHits(awayLs)}</Text>
                  </View>
                  <View style={lineScoreStyles.totalCol}>
                    <Text style={[lineScoreStyles.totalVal, { color: sub }]}>{totalErrors(awayLs)}</Text>
                  </View>
                </>
              )}
            </View>

            {/* Home stats row */}
            <View style={[lineScoreStyles.statsRow, { height: ROW_H }]}>
              {periodLabels.map((_, i) => (
                <View key={i} style={lineScoreStyles.periodCol}>
                  <Text style={[lineScoreStyles.periodVal, { color: text }]}>{homeLs[i]?.value ?? '-'}</Text>
                </View>
              ))}
              <View style={[lineScoreStyles.totalCol, lineScoreStyles.totalDivider]}>
                <Text style={[lineScoreStyles.totalVal, { color: text }]}>{home.score}</Text>
              </View>
              {showRHE && (
                <>
                  <View style={lineScoreStyles.totalCol}>
                    <Text style={[lineScoreStyles.totalVal, { color: sub }]}>{totalHits(homeLs)}</Text>
                  </View>
                  <View style={lineScoreStyles.totalCol}>
                    <Text style={[lineScoreStyles.totalVal, { color: sub }]}>{totalErrors(homeLs)}</Text>
                  </View>
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    </Animated.View>
  );
}

const lineScoreStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 0,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  fixedCol: {
    paddingLeft: 12,
    paddingRight: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 86,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  logo: { width: 22, height: 22 },
  teamAbbr: { fontSize: 13, fontFamily: F.black, letterSpacing: 0.5 },
  periodCol: { width: 34, alignItems: 'center' },
  periodVal: { fontSize: 14, fontFamily: F.regular },
  headerText: { fontSize: 11, fontFamily: F.black, letterSpacing: 1 },
  totalCol: {
    width: 38,
    alignItems: 'center',
  },
  totalDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(255,255,255,0.1)',
    marginLeft: 4,
    paddingLeft: 4,
    width: 42,
  },
  totalVal: { fontSize: 15, fontFamily: F.black },
});

function MlbZoneSummary({
  plays, summary,
}: {
  plays: Play[];
  summary: GameSummary;
  cardBg: string;
  border: string;
  text: string;
  sub: string;
}) {
  const isWeb = Platform.OS === 'web';
  const compact = !isWeb;
  const panelBg = '#1c1c1e';
  const panelText = '#f5f5f7';
  const panelSub = '#a1a1a6';
  const panelBorder = '#3a3a3c';
  const statePlay = plays[0] ?? null;
  const balls = Math.max(0, Math.min(4, statePlay?.resultCount?.balls ?? 0));
  const strikes = Math.max(0, Math.min(3, statePlay?.resultCount?.strikes ?? 0));
  const outs = Math.max(0, Math.min(3, statePlay?.outs ?? 0));

  const activeAtBatId = plays.find(p => p.atBatId)?.atBatId ?? null;
  const activeAtBat = activeAtBatId
    ? plays.filter(p => p.atBatId === activeAtBatId && p.pitchCoordinate)
        .sort((a, b) => (a.atBatPitchNumber ?? 0) - (b.atBatPitchNumber ?? 0))
    : [];
  const batterParticipant = plays
    .filter(p => !activeAtBatId || p.atBatId === activeAtBatId)
    .flatMap(p => p.participants ?? [])
    .find(p => p.type === 'batter' && p.id);
  const activeBatter = summary.playerTeams
    .flatMap(team => team.athletes)
    .find(a => a.id === batterParticipant?.id);
  const contextPlay = plays.find(p =>
    (!activeAtBatId || p.atBatId === activeAtBatId)
    && p.participants?.some(part => part.type === 'pitcher')
    && p.participants?.some(part => part.type === 'batter'),
  ) ?? statePlay;
  const pitcherParticipant = contextPlay?.participants?.find(part => part.type === 'pitcher');
  const pitcher = (summary.pitcherTeams ?? [])
    .flatMap(team => team.athletes)
    .find(a => a.id === pitcherParticipant?.id);
  const fallbackPitcher = pitcher
    ?? (summary.pitcherTeams ?? [])
      .flatMap(team => team.athletes)
      .find(a => a.stats.PC || a.stats.IP || a.starter)
    ?? null;
  const fallbackProbable = !fallbackPitcher ? summary.probables?.[0]?.pitcher : null;
  const pitcherTeam = (summary.pitcherTeams ?? []).find(team => team.athletes.some(a => a.id === fallbackPitcher?.id));
  const battingTeamForMatchup = pitcherTeam?.teamId === summary.home.team.id ? summary.away : summary.home;
  // playerTeams entry for the pitcher's team (used to exclude ALL of that team's batters, not just pitchers)
  const pitcherPlayerTeam = summary.playerTeams.find(t => t.teamId === pitcherTeam?.teamId);
  const fallbackBatterPool = summary.playerTeams
    .filter(team => !pitcherTeam?.teamId || team.teamId !== pitcherTeam.teamId)
    .filter(team => !battingTeamForMatchup?.team.id || team.teamId === battingTeamForMatchup.team.id)
    .flatMap(team => team.athletes);
  const fallbackBatter = activeBatter
    && (!pitcherTeam?.teamId || summary.playerTeams.find(team => team.teamId === pitcherTeam.teamId)?.athletes.every(a => a.id !== activeBatter.id))
    ? activeBatter
    : fallbackBatterPool
      .filter(a => a.battingOrder || a.starter)
      .sort((a, b) => (a.battingOrder ?? 99) - (b.battingOrder ?? 99))[0]
    ?? summary.playerTeams
      .flatMap(team => team.athletes)
      .filter(a => !pitcherPlayerTeam?.athletes.some(p => p.id === a.id))
      .filter(a => a.battingOrder || a.starter)
      .sort((a, b) => (a.battingOrder ?? 99) - (b.battingOrder ?? 99))[0]
    ?? null;
  const playerById = new Map(
    [...summary.playerTeams, ...(summary.pitcherTeams ?? [])]
      .flatMap(team => team.athletes)
      .map(player => [player.id, player] as const),
  );
  const resolvedRunner = (runner: Runner | null | undefined) => {
    if (!runner) return null;
    const player = playerById.get(runner.id);
    return {
      ...runner,
      name: runner.name || player?.name || '',
      headshot: runner.headshot || player?.headshot || '',
    };
  };
  const onFirst = resolvedRunner(statePlay?.onFirst);
  const onSecond = resolvedRunner(statePlay?.onSecond);
  const onThird = resolvedRunner(statePlay?.onThird);
  // Never let batterTeam resolve to the same team as the pitcher — a batter can't face their own pitcher.
  const batterTeam = summary.playerTeams.find(team =>
    team.teamId !== pitcherTeam?.teamId && team.athletes.some(a => a.id === fallbackBatter?.id),
  ) ?? summary.playerTeams.find(team => team.teamId !== pitcherTeam?.teamId) ?? null;
  const teamForId = (teamId?: string) =>
    teamId === summary.home.team.id ? summary.home.team : teamId === summary.away.team.id ? summary.away.team : null;
  const matchupLogo = (teamId?: string) => {
    const team = teamForId(teamId);
    return team?.logoDark ?? team?.logo;
  };
  const pitcherLogo = matchupLogo(pitcherTeam?.teamId);
  const batterLogo = matchupLogo(batterTeam?.teamId);
  const pitcherName = fallbackPitcher?.name ?? pitcherParticipant?.name ?? fallbackProbable?.displayName ?? '';
  const pitcherHeadshot = fallbackPitcher?.headshot ?? pitcherParticipant?.headshot ?? fallbackProbable?.headshot ?? '';
  const batterName = fallbackBatter?.name ?? batterParticipant?.name ?? '';
  const batterHeadshot = fallbackBatter?.headshot ?? batterParticipant?.headshot ?? '';
  const pitchCount = (typeof statePlay?.pitchCount === 'number' ? statePlay?.pitchCount : undefined) ?? Number(fallbackPitcher?.stats.PC ?? NaN);
  const onDeck = statePlay?.onDeck;
  const zoneLeft = 172;
  const zoneTop = 82;
  const zoneWidth = 144;
  const zoneHeight = 156;
  const zoneCellWidth = zoneWidth / 3;
  const zoneCellHeight = zoneHeight / 3;
  const values = Array.from({ length: 9 }, (_, index) =>
    fallbackBatter?.hotZones?.find(zone => zone.zoneId === index + 1)?.battingAvg ?? null,
  );
  const Count = ({ label, count, max, color }: { label: string; count: number; max: number; color: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: compact ? 4 : 7, minWidth: compact ? 90 : 130 }}>
      <Text style={{ color: panelText, fontSize: compact ? 12 : 18, fontFamily: F.black }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: max }, (_, i) => (
          <View key={i} style={{
            width: compact ? 9 : 13, height: compact ? 9 : 13, borderRadius: 7,
            borderWidth: 1.5,
            borderColor: i < count ? color : panelBorder,
            backgroundColor: i < count ? color : 'transparent',
          }} />
        ))}
      </View>
    </View>
  );
  const portraitSize = compact ? 58 : 64;
  const Portrait = ({ url, name }: { url?: string; name?: string }) => (
    <View style={{
      width: portraitSize,
      height: portraitSize,
      borderRadius: portraitSize / 2,
      borderWidth: 1.5,
      borderColor: '#dfe1e5',
      overflow: 'hidden',
      backgroundColor: '#f1f3f4',
    }}>
      {url
        ? <Image source={{ uri: url }} style={{ width: portraitSize, height: portraitSize }} contentFit="cover" cachePolicy="memory-disk" />
        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: panelSub, fontSize: 18, fontFamily: F.black }}>
              {name?.split(' ').map(word => word[0]).slice(0, 2).join('') || '?'}
            </Text>
          </View>}
    </View>
  );

  return (
    <Animated.View entering={FadeInDown.duration(400)} style={{
      marginHorizontal: 16,
      marginTop: 12,
      borderWidth: 1,
      borderColor: panelBorder,
      borderRadius: 16,
      backgroundColor: panelBg,
      overflow: 'hidden',
      minHeight: compact ? 430 : 380,
    }}>
      {(pitcherName || batterName) && (
        <View style={{
          paddingHorizontal: isWeb ? 14 : 18,
          paddingTop: isWeb ? 12 : 16,
          paddingBottom: isWeb ? 10 : 14,
          borderBottomWidth: 1,
          borderBottomColor: panelBorder,
          alignItems: 'center',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: compact ? 7 : 14 }}>
            <View style={{ width: compact ? 158 : 250, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: compact ? 7 : 12 }}>
              <View style={{ alignItems: 'flex-end', flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  {pitcherLogo ? <Image source={{ uri: pitcherLogo }} style={{ width: compact ? 28 : 22, height: compact ? 28 : 22 }} contentFit="contain" /> : null}
                  <Text style={{ color: panelText, fontSize: compact ? 12 : 16, fontFamily: F.black }}>PITCHER</Text>
                </View>
                <Text numberOfLines={1} style={{ color: '#0969da', fontSize: compact ? 12 : 15, fontFamily: F.regular }}>
                  {compactPlayerName(pitcherName)}
                </Text>
                <Text numberOfLines={1} style={{ color: panelSub, fontSize: compact ? 8 : 11, fontFamily: F.regular, marginTop: compact ? 4 : 6 }}>
                  {[fallbackPitcher?.stats.IP && `${fallbackPitcher.stats.IP} IP`, fallbackPitcher?.stats.H && `${fallbackPitcher.stats.H} H`, fallbackPitcher?.stats.ER && `${fallbackPitcher.stats.ER} ER`, fallbackPitcher?.stats.K && `${fallbackPitcher.stats.K} K`, fallbackPitcher?.stats.BB && `${fallbackPitcher.stats.BB} BB`]
                    .filter(Boolean).join(', ')}
                </Text>
              </View>
              <Portrait url={pitcherHeadshot} name={pitcherName} />
            </View>
            <Text style={{ color: '#a1a1a6', fontSize: 16, fontFamily: F.regular }}>VS</Text>
            <View style={{ width: compact ? 158 : 250, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: compact ? 7 : 12 }}>
              <Portrait url={batterHeadshot} name={batterName} />
              <View style={{ alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={{ color: panelText, fontSize: compact ? 12 : 16, fontFamily: F.black }}>BATTER</Text>
                  {batterLogo ? <Image source={{ uri: batterLogo }} style={{ width: compact ? 28 : 22, height: compact ? 28 : 22 }} contentFit="contain" /> : null}
                </View>
                <Text numberOfLines={1} style={{ color: '#0969da', fontSize: compact ? 12 : 15, fontFamily: F.regular }}>
                  {compactPlayerName(batterName)}
                </Text>
                <Text style={{ color: panelText, fontSize: compact ? 9 : 11, fontFamily: F.bold, marginTop: compact ? 4 : 6 }}>
                  {fallbackBatter?.stats.H ?? '0'}-{fallbackBatter?.stats.AB ?? '0'}
                </Text>
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: isWeb ? 12 : 18, marginTop: isWeb ? 8 : 14 }}>
            {Number.isFinite(pitchCount) ? (
              <Text style={{ color: panelText, fontSize: compact ? 11 : 12, fontFamily: F.regular }}>PITCH COUNT: {pitchCount}</Text>
            ) : null}
            {Number.isFinite(pitchCount) && onDeck ? <View style={{ width: 1, height: 22, backgroundColor: panelBorder }} /> : null}
            {onDeck ? (
              <Text style={{ color: panelText, fontSize: compact ? 11 : 12, fontFamily: F.regular }}>
                ON DECK: <Text style={{ color: '#0969da' }}>{compactPlayerName(onDeck.name)}</Text>
              </Text>
            ) : null}
          </View>
        </View>
      )}

      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingTop: isWeb ? 12 : 18,
        paddingBottom: isWeb ? 2 : 6,
      }}>
        <Count label="BALLS" count={balls} max={4} color="#34C759" />
        <Count label="STRIKES" count={strikes} max={3} color="#FFD60A" />
        <Count label="OUTS" count={outs} max={3} color="#E00016" />
      </View>

      <View style={{ minHeight: compact ? 262 : 230, position: 'relative', alignItems: 'center', paddingBottom: compact ? 20 : 22 }}>
        <View style={{ height: compact ? 198 : 170, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{
            width: 470,
            height: 270,
            position: 'relative',
            transform: compact ? [{ scale: 0.62 }] : [{ scale: 0.62 }],
          }}>
            <Image
              source={require('../../assets/images/mlb-batter-silhouette.png')}
              style={{
                position: 'absolute',
                left: 18,
                top: 2,
                width: 168,
                height: 266,
                opacity: 0.76,
                transform: [{ scaleX: -1 }],
              }}
              contentFit="contain"
            />
            <View style={{
              position: 'absolute',
              left: zoneLeft,
              top: zoneTop,
              width: zoneWidth,
              height: zoneHeight,
              flexDirection: 'row',
              flexWrap: 'wrap',
            }}>
            {values.map((value, i) => {
              const bg = value == null ? '#1877E8' : value >= .300 ? '#E85A35' : value >= .220 ? '#78ACE3' : '#0878EE';
              return (
                <View key={i} style={{
                  width: zoneCellWidth,
                  height: zoneCellHeight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: bg,
                  borderWidth: 1,
                  borderColor: panelBg,
                }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontFamily: F.black }}>
                    {value == null ? '--' : value.toFixed(3).replace(/^0/, '')}
                  </Text>
                </View>
              );
            })}
            </View>

            {/* The nine statistical cells are the strike zone. */}
            <View style={{
              position: 'absolute',
              left: zoneLeft,
              top: zoneTop,
              width: zoneWidth,
              height: zoneHeight,
              borderWidth: 4,
              borderColor: panelText,
            }} />

            {activeAtBat.map((pitch, index) => {
              const x = Math.max(-14, Math.min(zoneWidth + 14, ((pitch.pitchCoordinate!.x - 77) / 80) * zoneWidth));
              const y = Math.max(-14, Math.min(zoneHeight + 14, ((pitch.pitchCoordinate!.y - 131) / 73) * zoneHeight));
              const markerColor = isBallPitch(pitch) ? '#00A651' : '#E21B2D';
              return (
                <View key={pitch.id} style={{
                  position: 'absolute',
                  left: zoneLeft + x - 14,
                  top: zoneTop + y - 14,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: markerColor,
                  borderWidth: 2,
                  borderColor: panelBg,
                }}>
                  <Text style={{ color: '#fff', fontSize: 12, fontFamily: F.black }}>
                    {pitch.atBatPitchNumber ?? index + 1}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={{
          width: '100%',
          paddingLeft: compact ? 38 : 18,
          paddingRight: compact ? 22 : 18,
          marginTop: compact ? 0 : -6,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: compact ? 12 : 24,
        }}>
          <View style={compact ? { transform: [{ scale: 0.84 }], width: 68, height: 68 } : { transform: [{ scale: 0.62 }], width: 52, height: 52 }}>
            <BaseDiamond
              onFirst={onFirst}
              onSecond={onSecond}
              onThird={onThird}
              outs={statePlay?.outs ?? 0}
              dark={true}
            />
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: compact ? 8 : 16 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: panelSub, fontSize: compact ? 10 : 12, fontFamily: F.regular }}>
              1B: {onFirst ? (onFirst.name || 'Occupied') : 'Base empty'}
            </Text>
            <Text numberOfLines={1} style={{ flex: 1, color: panelSub, fontSize: compact ? 10 : 12, fontFamily: F.regular }}>
              2B: {onSecond ? (onSecond.name || 'Occupied') : 'Base empty'}
            </Text>
            <Text numberOfLines={1} style={{ flex: 1, color: panelSub, fontSize: compact ? 10 : 12, fontFamily: F.regular }}>
              3B: {onThird ? (onThird.name || 'Occupied') : 'Base empty'}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

function MlbParkFeature({
  abbr,
  feature,
  accent,
  dark,
  near,
  far,
}: {
  abbr: string;
  feature?: string;
  accent: string;
  dark: boolean;
  near: string;
  far: string;
}) {
  const wallDark = dark ? '#12161d' : '#253140';
  const steel = dark ? '#7e8994' : '#56616d';
  const brick = dark ? '#6b3b2a' : '#9b5a43';
  const signBlue = '#123f8c';
  const wall = <Path d="M112 162 Q450 78 788 162" fill="none" stroke={wallDark} strokeWidth={30} opacity={0.92} />;

  const CurvedBoard = ({ x, y, w, h, fill, label }: { x: number; y: number; w: number; h: number; fill: string; label?: string }) => (
    <G>
      <Path d={`M${x} ${y + h * 0.28} Q${x + w / 2} ${y} ${x + w} ${y + h * 0.28} L${x + w} ${y + h} Q${x + w / 2} ${y + h - 12} ${x} ${y + h} Z`} fill={fill} stroke={accent} strokeWidth={2.5} />
      {label ? <SvgText x={x + w / 2} y={y + h * 0.64} fill="#fff" fontSize={12} fontWeight="900" textAnchor="middle">{label}</SvgText> : null}
    </G>
  );

  const CityBlocks = ({ start = 300, count = 7 }: { start?: number; count?: number }) => (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const x = start + i * 34;
        const baseY = 150 - Math.sin((i / Math.max(1, count - 1)) * Math.PI) * 38;
        const h = 42 + (i % 3) * 14;
        return <Rect key={`city-${i}`} x={x} y={baseY - h} width={22} height={h} rx={2} fill={i % 2 ? near : far} opacity={0.92} />;
      })}
    </>
  );

  switch (feature) {
    case 'green-monster':
      return <G>{wall}<Path d="M124 142 Q220 118 328 116 L328 174 Q222 168 124 188 Z" fill="#0b5a33" stroke="#073a21" strokeWidth={2} /><Path d="M152 150 Q224 132 296 128 L296 162 Q224 160 152 172 Z" fill="#13351e" stroke="#d3a84b" strokeWidth={1.5} />{Array.from({ length: 8 }).map((_, i) => <Rect key={i} x={164 + i * 14} y={143 - Math.sin((i / 7) * Math.PI) * 10} width={9} height={14} fill="#111" stroke="#d3a84b" strokeWidth={0.8} />)}<Rect x={334} y={98} width={5} height={70} fill="#ffd400" /><Rect x={210} y={100} width={48} height={22} rx={3} fill="#fff" /><Path d="M220 112 L234 105 L248 112 L234 119 Z" fill="#e1342c" /></G>;
    case 'wrigley-ivy':
      return <G>{wall}<Path d="M150 160 Q470 100 790 160" fill="none" stroke="#164d29" strokeWidth={20} /><Path d="M150 152 Q470 92 790 152" fill="none" stroke="#2f7a3c" strokeWidth={11} /><Path d="M404 78 L470 58 L536 78 Z" fill="#1f6b3a" stroke="#0c3d20" strokeWidth={2} /><Path d="M404 78 L536 78 L536 136 Q470 124 404 136 Z" fill="#1f6b3a" stroke="#0c3d20" strokeWidth={2} />{Array.from({ length: 14 }).map((_, i) => <Rect key={i} x={414 + (i % 7) * 17} y={92 + Math.floor(i / 7) * 24} width={12} height={12} fill="#0c2e18" stroke="#c9a44a" strokeWidth={0.7} />)}<Circle cx={470} cy={72} r={8} fill="#fff" stroke="#0c3d20" strokeWidth={1.5} /></G>;
    case 'mcovey-cove':
      return (
        <G>
          <Path d="M132 151 Q470 84 808 151" fill="none" stroke="#d7b47b" strokeWidth={5} opacity={0.92} />
          <Path d="M536 108 Q684 74 842 108 L842 168 Q684 136 536 158 Z" fill="#2f87ad" stroke="#9fd0e1" strokeWidth={2} />
          {[0, 1, 2, 3].map(i => (
            <Path key={`sf-wave-${i}`} d={`M${596 + i * 62} ${124 - (i % 2) * 5} q17 -8 34 0`} fill="none" stroke="#b8dceb" strokeWidth={2} opacity={0.9} />
          ))}
          {[0, 1].map(i => (
            <Path key={`sf-boat-${i}`} d={`M${672 + i * 88} ${104 - i * 6} l32 0 l-6 7 l-22 0 Z`} fill="#eef2f4" opacity={0.92} />
          ))}
          {[332, 608].map((x, i) => (
            <G key={`sf-light-${i}`}>
              <Rect x={x} y={52} width={32} height={82} fill="none" stroke="#27333e" strokeWidth={4} />
              <Rect x={x - 9} y={18} width={50} height={36} fill="#26323d" stroke="#9aa9b3" strokeWidth={2} />
              {Array.from({ length: 5 }).map((_, r) => (
                <Line key={`r-${r}`} x1={x - 5} y1={25 + r * 6} x2={x + 37} y2={25 + r * 6} stroke="#d7e4ec" strokeWidth={1} opacity={0.72} />
              ))}
              {Array.from({ length: 4 }).map((_, c) => (
                <Line key={`c-${c}`} x1={x + c * 12} y1={20} x2={x + c * 12} y2={52} stroke="#10161c" strokeWidth={1} opacity={0.6} />
              ))}
              <Path d={`M${x} 84 L${x + 32} 134 M${x + 32} 84 L${x} 134`} stroke="#27333e" strokeWidth={3} />
            </G>
          ))}
          <G>
            <Path d="M368 58 Q470 36 572 58 L572 162 Q470 146 368 162 Z" fill="#263542" stroke="#a5b2bb" strokeWidth={3} />
            <Path d="M392 58 Q470 44 548 58" fill="none" stroke="#d3dbe1" strokeWidth={2} opacity={0.9} />
            {[-56, -28, 0, 28, 56].map((dx, i) => (
              <G key={`sf-flag-${i}`}>
                <Line x1={470 + dx} y1={57 - Math.abs(dx) * 0.1} x2={470 + dx} y2={40 - Math.abs(dx) * 0.08} stroke="#a5b2bb" strokeWidth={1.4} />
                <Path d={`M${470 + dx} ${40 - Math.abs(dx) * 0.08} q8 3 15 0 l0 7 q-8 3 -15 0 Z`} fill={i % 2 ? '#f2f0e8' : '#fd5a1e'} stroke="#8a969f" strokeWidth={0.7} />
              </G>
            ))}
            <Path d="M410 52 Q470 42 530 52 L530 67 Q470 60 410 67 Z" fill="#263542" opacity={0.96} />
            <SvgText x={470} y={62} fill="#f2d2a2" fontSize={10} fontWeight="900" textAnchor="middle">ORACLE PARK</SvgText>
            <Circle cx={470} cy={84} r={12} fill="#f0eee4" stroke="#30363b" strokeWidth={2} />
            <Circle cx={470} cy={84} r={7} fill="none" stroke="#c9c4b8" strokeWidth={1} />
            <Line x1={470} y1={84} x2={470} y2={78} stroke="#30363b" strokeWidth={1.5} />
            <Line x1={470} y1={84} x2={475} y2={84} stroke="#30363b" strokeWidth={1.5} />
            <Rect x={386} y={104} width={168} height={52} fill="#10161b" stroke="#59656d" strokeWidth={2} />
            <Rect x={396} y={113} width={30} height={14} fill="#ef3d2d" />
            <Rect x={432} y={113} width={30} height={14} fill="#f8f6ec" />
            <Rect x={468} y={113} width={40} height={14} fill="#10202b" />
            <Rect x={516} y={113} width={30} height={14} fill="#54a6ca" />
            <Rect x={400} y={134} width={140} height={16} fill="#05090d" stroke="#26323d" strokeWidth={1} />
            {Array.from({ length: 9 }).map((_, i) => (
              <Line key={`sf-score-row-${i}`} x1={407 + i * 15} y1={136} x2={407 + i * 15} y2={148} stroke="#44505a" strokeWidth={0.8} />
            ))}
            <SvgText x={411} y={124} fill="#fff" fontSize={8} fontWeight="900" textAnchor="middle">AD</SvgText>
            <SvgText x={447} y={124} fill="#c13a28" fontSize={7} fontWeight="900" textAnchor="middle">SAFE</SvgText>
            <SvgText x={488} y={124} fill="#fff" fontSize={7} fontWeight="900" textAnchor="middle">GIANTS</SvgText>
          </G>
          <Path d="M144 140 Q276 118 412 132" fill="none" stroke="#f7f7f1" strokeWidth={3} opacity={0.7} />
          <Path d="M142 154 Q276 128 414 140 L404 172 Q268 156 138 182 Z" fill="#141920" opacity={0.96} />
          <Path d="M142 168 Q276 142 414 154" fill="none" stroke="#2b3139" strokeWidth={8} opacity={0.9} />
          {Array.from({ length: 46 }).map((_, i) => (
            <Circle key={`sf-crowd-l-${i}`} cx={156 + (i % 23) * 11} cy={144 + Math.floor(i / 23) * 8 - Math.sin((i / 22) * Math.PI) * 12} r={1.8} fill={i % 3 ? '#f2f0e8' : '#fd5a1e'} opacity={0.9} />
          ))}
          <G>
            <G transform="rotate(-22 226 130)">
              <Path d="M220 96 C232 98 236 106 231 116 C241 124 240 146 230 156 C224 162 214 158 216 145 C207 134 209 119 219 113 C216 105 217 99 220 96 Z" fill="#e7392d" stroke="#7a1611" strokeWidth={1.8} />
              <Path d="M217 127 C225 123 234 125 240 132 C234 139 222 141 212 136 C211 132 213 129 217 127 Z" fill="#f7f1e4" opacity={0.96} />
              <SvgText x={226} y={135} fill="#e7392d" fontSize={7} fontWeight="900" textAnchor="middle">Coke</SvgText>
            </G>
            <Path d="M246 132 q26 -28 56 0 q-28 29 -62 18 Z" fill="#d27a38" stroke="#6d3f22" strokeWidth={2} />
            <Path d="M262 132 q14 -10 28 0" fill="none" stroke="#6d3f22" strokeWidth={2} />
          </G>
          <Path d="M556 143 Q692 146 808 184" fill="none" stroke="#75422d" strokeWidth={40} strokeLinecap="butt" />
          <Path d="M556 111 Q692 120 808 162" fill="none" stroke="#9b6245" strokeWidth={2} opacity={0.85} />
          <Path d="M556 160 Q692 162 808 202" fill="none" stroke="#4b2418" strokeWidth={2} opacity={0.78} />
          {Array.from({ length: 9 }).map((_, i) => (
            <Path key={`sf-arch-${i}`} d={`M${570 + i * 26} ${169 + i * 3.5} L${570 + i * 26} ${148 + i * 3.1} Q${583 + i * 26} ${137 + i * 3.2} ${596 + i * 26} ${148 + i * 3.1} L${596 + i * 26} ${169 + i * 3.5} Z`} fill="#25150f" stroke="#8b5a3c" strokeWidth={1} />
          ))}
          {Array.from({ length: 54 }).map((_, i) => (
            <Circle key={`sf-crowd-r-${i}`} cx={572 + (i % 27) * 7} cy={113 + Math.floor(i / 27) * 8 - Math.sin((i / 26) * Math.PI) * 8} r={1.4} fill={i % 4 ? '#f2f0e8' : '#fd5a1e'} opacity={0.88} />
          ))}
          <SvgText x={718} y={157} fill="#f2f0e8" fontSize={10} fontWeight="900" textAnchor="middle" transform="rotate(8 718 157)">LEVI'S LANDING</SvgText>
          <G>
            <Path d="M368 58 Q470 36 572 58 L572 162 Q470 146 368 162 Z" fill="#263542" stroke="#a5b2bb" strokeWidth={3} />
            <Path d="M392 58 Q470 44 548 58" fill="none" stroke="#d3dbe1" strokeWidth={2} opacity={0.9} />
            <Path d="M410 52 Q470 42 530 52 L530 67 Q470 60 410 67 Z" fill="#263542" opacity={0.96} />
            <SvgText x={470} y={62} fill="#f2d2a2" fontSize={10} fontWeight="900" textAnchor="middle">ORACLE PARK</SvgText>
            <Circle cx={470} cy={84} r={12} fill="#f0eee4" stroke="#30363b" strokeWidth={2} />
            <Circle cx={470} cy={84} r={7} fill="none" stroke="#c9c4b8" strokeWidth={1} />
            <Line x1={470} y1={84} x2={470} y2={78} stroke="#30363b" strokeWidth={1.5} />
            <Line x1={470} y1={84} x2={475} y2={84} stroke="#30363b" strokeWidth={1.5} />
            <Rect x={386} y={104} width={168} height={52} fill="#10161b" stroke="#59656d" strokeWidth={2} />
            <Rect x={396} y={113} width={30} height={14} fill="#ef3d2d" />
            <Rect x={432} y={113} width={30} height={14} fill="#f8f6ec" />
            <Rect x={468} y={113} width={40} height={14} fill="#10202b" />
            <Rect x={516} y={113} width={30} height={14} fill="#54a6ca" />
            <Rect x={400} y={134} width={140} height={16} fill="#05090d" stroke="#26323d" strokeWidth={1} />
            {Array.from({ length: 9 }).map((_, i) => (
              <Line key={`sf-score-row-top-${i}`} x1={407 + i * 15} y1={136} x2={407 + i * 15} y2={148} stroke="#44505a" strokeWidth={0.8} />
            ))}
            <SvgText x={411} y={124} fill="#fff" fontSize={8} fontWeight="900" textAnchor="middle">AD</SvgText>
            <SvgText x={447} y={124} fill="#c13a28" fontSize={7} fontWeight="900" textAnchor="middle">SAFE</SvgText>
            <SvgText x={488} y={124} fill="#fff" fontSize={7} fontWeight="900" textAnchor="middle">GIANTS</SvgText>
          </G>
          <Rect x={132} y={106} width={6} height={76} fill="#ffde42" />
          <Rect x={802} y={102} width={6} height={80} fill="#ffde42" />
        </G>
      );
    case 'bridges':
      return <G><Path d="M138 156 Q470 92 802 156 L802 188 Q470 132 138 188 Z" fill="#16486e" opacity={0.88} />{[0, 1, 2].map(i => { const x = 188 + i * 205; return <G key={i}><Path d={`M${x} 144 Q${x + 88} ${88 + i * 6} ${x + 176} 144`} fill="none" stroke="#fdb827" strokeWidth={6} /><Path d={`M${x + 18} 144 L${x + 88} ${96 + i * 5} L${x + 158} 144`} fill="none" stroke="#fdb827" strokeWidth={2.5} /><Line x1={x} y1={144} x2={x} y2={164} stroke="#fdb827" strokeWidth={4} /><Line x1={x + 176} y1={144} x2={x + 176} y2={164} stroke="#fdb827" strokeWidth={4} /></G>; })}</G>;
    case 'fountains':
      return <G>{wall}<CurvedBoard x={382} y={96} w={176} h={64} fill="#194d8c" label="ROYALS" /><Path d="M418 96 L450 72 L490 96" fill="none" stroke="#f3c14a" strokeWidth={6} />{[0, 1, 2, 3, 4].map(i => <Path key={i} d={`M${198 + i * 118} 160 Q${246 + i * 98} ${104 - (i % 2) * 9} ${294 + i * 78} 160`} fill="none" stroke="#7bd7ff" strokeWidth={5} opacity={0.95} />)}</G>;
    case 'warehouse':
      return <G><Path d="M138 116 Q470 84 802 116 L802 162 Q470 128 138 162 Z" fill={brick} stroke="#3a2018" strokeWidth={2} />{Array.from({ length: 24 }).map((_, i) => <Rect key={i} x={154 + i * 26} y={122 - Math.sin((i / 23) * Math.PI) * 24} width={12} height={16} fill="#2a1a14" opacity={0.86} />)}</G>;
    case 'chase-roof':
    case 'trop-dome':
    case 'globe-life-roof':
    case 'brewers-roof-arches':
      return <G><Path d="M98 158 Q470 44 842 158 L842 194 Q470 124 98 194 Z" fill="#2d343d" stroke={steel} strokeWidth={3} />{[0, 1, 2, 3, 4].map(i => <Path key={i} d={`M${150 + i * 76} 152 Q470 ${58 + i * 8} ${790 - i * 76} 152`} fill="none" stroke={i === 2 ? accent : '#66727e'} strokeWidth={i === 2 ? 5 : 3} opacity={0.92} />)}{feature === 'globe-life-roof' ? <Path d="M314 146 Q470 92 626 146" fill="none" stroke="#c0111f" strokeWidth={6} /> : null}{feature === 'brewers-roof-arches' ? <Path d="M344 148 Q470 82 596 148" fill="none" stroke="#ffc52f" strokeWidth={5} /> : null}</G>;
    case 'truist-scoreboard':
    case 'progressive-sign':
    case 'exploding-scoreboard':
    case 'citi-apple':
    case 'liberty-bell':
    case 'target-skyline':
      return <G>{wall}{feature === 'target-skyline' ? <CityBlocks start={294} count={8} /> : null}<CurvedBoard x={feature === 'citi-apple' ? 584 : 360} y={feature === 'citi-apple' ? 112 : 108} w={feature === 'citi-apple' ? 150 : 220} h={feature === 'citi-apple' ? 58 : 66} fill={feature === 'exploding-scoreboard' ? '#111' : signBlue} label={feature === 'progressive-sign' ? 'PROGRESSIVE' : feature === 'truist-scoreboard' ? 'TRUIST' : feature === 'target-skyline' ? 'TARGET' : feature === 'citi-apple' ? 'CITI' : undefined} />{feature === 'exploding-scoreboard' ? Array.from({ length: 7 }).map((_, i) => <Path key={i} d={`M${404 + i * 24} 118 l9 -24 l9 24`} fill="none" stroke={i % 2 ? '#fff' : '#c4ced4'} strokeWidth={3} />) : null}{feature === 'citi-apple' ? <Path d="M648 146 q20 -24 40 0 q-10 26 -20 26 q-10 0 -20 -26" fill="#d71920" stroke="#7a0f12" strokeWidth={1.5} /> : null}{feature === 'liberty-bell' ? <Path d="M448 122 q22 -26 44 0 l10 42 q-32 16 -64 0 Z" fill="#e81828" stroke="#fff" strokeWidth={2} /> : null}</G>;
    case 'riverboat-smokestacks':
      return <G><Path d="M138 160 Q470 102 802 160 L802 188 Q470 134 138 188 Z" fill="#16486e" opacity={0.9} />{[230, 686].map((x, i) => <G key={i}><Rect x={x} y={96 + i * 6} width={18} height={64} fill="#cfd7df" /><Path d={`M${x - 8} ${102 + i * 6} L${x + 26} ${102 + i * 6}`} stroke="#c6011f" strokeWidth={6} /><Path d={`M${x - 10} ${88 + i * 6} q18 -14 36 0`} fill="none" stroke="#e4edf6" strokeWidth={4} opacity={0.85} /></G>)}<Path d="M344 152 Q470 124 596 152" fill="none" stroke={accent} strokeWidth={7} /></G>;
    case 'rockpile':
      return <G>{wall}<Path d="M144 164 Q262 118 382 146 L382 176 Q262 152 144 190 Z" fill="#8a7a65" stroke="#4f4539" strokeWidth={2} />{[188, 226, 272, 322].map((x, i) => <Circle key={i} cx={x} cy={144 - i * 5} r={22 - i * 2} fill="#b6a084" stroke="#7c6c58" strokeWidth={1.5} />)}</G>;
    case 'dodger-pavilions':
      return <G><Path d="M138 160 Q470 96 802 160" fill="none" stroke="#164f95" strokeWidth={24} />{[232, 708].map((x, i) => <CurvedBoard key={i} x={x - 58} y={118} w={116} h={54} fill="#0c3f86" label={i ? 'LA' : 'Dodgers'} />)}{[164, 202, 738, 776].map(x => <Path key={x} d={`M${x} 160 L${x} 106 M${x} 112 l-16 -10 M${x} 112 l16 -10 M${x} 112 l-20 5 M${x} 112 l20 5`} stroke="#2f7a3c" strokeWidth={4} />)}</G>;
    default:
      return <G>{wall}{feature === 'cn-tower' ? <><Path d="M466 156 L476 156 L473 48 L469 48 Z" fill={steel} /><Path d="M456 96 L486 96 L480 78 L462 78 Z" fill={steel} /><Rect x={469} y={26} width={4} height={22} fill={steel} /></> : null}{feature === 'gateway-arch' ? <Path d="M340 158 Q470 44 600 158" fill="none" stroke="#aab3bd" strokeWidth={8} /> : null}{feature === 'seattle-roof-trusses' ? Array.from({ length: 4 }).map((_, i) => <Path key={i} d={`M${154 + i * 160} 158 Q${250 + i * 86} ${80 + i * 4} ${382 + i * 84} 150`} fill="none" stroke="#607380" strokeWidth={6} />) : null}{feature === 'yankee-frieze' ? <><Path d="M150 140 Q470 82 790 140" fill="none" stroke="#c4ced4" strokeWidth={8} />{Array.from({ length: 18 }).map((_, i) => <Path key={i} d={`M ${178 + i * 34} ${141 - Math.sin((i / 17) * Math.PI) * 54} l 8 12 l 8 -12`} fill="none" stroke="#fff" strokeWidth={2} />)}</> : null}{feature === 'western-metal' ? <Path d="M142 112 L232 122 L232 170 Q186 158 142 178 Z" fill={brick} stroke="#3a2018" strokeWidth={2} /> : null}{feature === 'train-track' ? <><Path d="M150 150 Q470 92 790 150" fill="none" stroke={steel} strokeWidth={7} /><Path d="M206 130 Q246 120 286 130 L286 152 Q246 142 206 152 Z" fill="#222" /><Circle cx={226} cy={148} r={6} fill="#111" /><Circle cx={264} cy={142} r={6} fill="#111" /></> : null}{feature === 'sutter-batter-eye' ? <><Path d="M150 158 Q470 98 790 158" fill="none" stroke="#123f2f" strokeWidth={22} />{[238, 306, 634, 702].map(x => <Line key={x} x1={x} y1={158} x2={x} y2={104} stroke="#f7c948" strokeWidth={5} />)}</> : null}{feature === 'miami-towers' || feature === 'comerica-towers' || feature === 'capitol-view' ? <CityBlocks start={feature === 'capitol-view' ? 610 : 310} count={feature === 'capitol-view' ? 4 : 7} /> : null}{feature === 'capitol-view' ? <><Path d="M438 146 Q470 116 502 146 L516 158 Q470 144 424 158 Z" fill="#e6edf4" /><Rect x={452} y={146} width={36} height={22} fill="#dce5ee" /></> : null}{!feature ? <CityBlocks /> : null}</G>;
  }
}

function MlbBallparkBackdrop({
  teamAbbr, dark, baseOnly = false, featuresOnly = false, featureLift = 0,
}: {
  teamAbbr?: string;
  dark: boolean;
  baseOnly?: boolean;
  featuresOnly?: boolean;
  featureLift?: number;
}) {
  const abbr = (teamAbbr || '').toUpperCase();
  const profile = getMlbBallparkProfile(abbr);
  const sky = dark ? '#17191d' : '#d8e5f1';
  const far = dark ? '#242831' : '#a7b7c7';
  const near = dark ? '#30343d' : '#8d9daf';
  const seatA = dark ? '#27272d' : '#5f6470';
  const seatB = dark ? '#34343b' : '#747a86';
  const accent = profile.accent;
  const hasFeature = Boolean(profile.outfieldFeature);
  const seed = abbr.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const buildings = Array.from({ length: 22 }, (_, i) => {
    const x = 72 + i * 36;
    const arc = Math.abs(i - 10.5);
    const h = 22 + ((seed + i * 17) % 46) + Math.max(0, 22 - arc * 3);
    const y = 150 - h + arc * 2;
    const w = 15 + ((seed + i * 11) % 18);
    return [x, y, w, h] as [number, number, number, number];
  });

  if (featuresOnly) {
    return (
      <G transform={`translate(0 ${featureLift})`}>
        <MlbParkFeature
          abbr={abbr}
          feature={profile.outfieldFeature}
          accent={accent}
          dark={dark}
          near={near}
          far={far}
        />
      </G>
    );
  }

  if (abbr === 'SF') {
    return <G />;
  }

  return (
    <G>
      {!featuresOnly ? (
        <>
      {profile.backdropKind === 'dome' ? (
        <>
          <Path d="M88 170 Q450 35 812 170 L812 228 Q450 142 88 228 Z" fill={sky} opacity={dark ? 0.44 : 0.72} />
          {[0, 1, 2, 3].map(i => (
            <Path
              key={`dome-rib-${i}`}
              d={`M ${142 + i * 72} ${158 + i * 2} Q 450 ${70 + i * 11} ${758 - i * 72} ${158 + i * 2}`}
              fill="none"
              stroke={i === 0 ? accent : near}
              strokeWidth={i === 0 ? 4 : 2}
              opacity={i === 0 ? 0.8 : 0.5}
            />
          ))}
        </>
      ) : (
        <>
          <Path d="M110 166 Q450 70 790 166 L790 220 Q450 150 110 220 Z" fill={sky} opacity={dark ? 0.38 : 0.65} />
          {!hasFeature && buildings.map(([x, y, w, h], index) => (
            <Rect key={`${abbr}-b-${index}`} x={x} y={y} width={w} height={h} rx={2} fill={index % 2 ? far : near} opacity={0.82} />
          ))}
        </>
      )}
      {profile.backdropKind === 'fountains' && !hasFeature ? (
        <>
          {[0, 1, 2, 3, 4].map(i => (
            <Path
              key={`kc-fountain-${i}`}
              d={`M ${238 + i * 92} 204 Q ${268 + i * 92} ${140 - (i % 2) * 12} ${298 + i * 92} 204`}
              fill="none"
              stroke="#7bd7ff"
              strokeWidth={5}
              opacity={0.78}
            />
          ))}
          <Path d="M190 210 Q450 170 710 210" fill="none" stroke={accent} strokeWidth={5} opacity={0.82} />
        </>
      ) : null}
      {/* Generic waterfront shimmer — subtle blue, ONLY for parks without a
          specific water landmark (SF/PIT draw their own), so no stray accent
          line shows over the cove/bridges. */}
      {profile.backdropKind === 'waterfront' && !profile.outfieldFeature ? (
        <Path d="M250 128 Q450 112 650 128" fill="none" stroke="#3f7fb0" strokeWidth={6} opacity={0.6} />
      ) : null}

      {/* Stadium bowl rows sit behind the custom park features. */}
      {abbr !== 'SF' ? [0, 1, 2, 3].map(i => (
        <Path
          key={`seat-${i}`}
          d={`M ${132 + i * 12} ${176 + i * 18} Q 450 ${88 + i * 22} ${808 - i * 12} ${176 + i * 18}`}
          fill="none"
          stroke={i % 2 ? seatA : seatB}
          strokeWidth={15 - i * 1.8}
          opacity={hasFeature ? 0.42 : 0.95}
        />
      )) : null}
        </>
      ) : null}

      {!baseOnly ? (
      <G transform={`translate(0 ${featureLift})`}>
      {hasFeature && abbr !== 'SF' ? (
        <Path
          d="M112 162 Q450 76 788 162"
          fill="none"
          stroke={dark ? '#101216' : '#273240'}
          strokeWidth={30}
          opacity={0.72}
        />
      ) : null}
      {profile.outfieldFeature === 'fountains' ? (
        <>
          {[0, 1, 2, 3, 4].map(i => (
            <Path
              key={`kc-fountain-raised-${i}`}
              d={`M ${238 + i * 92} 204 Q ${268 + i * 92} ${140 - (i % 2) * 12} ${298 + i * 92} 204`}
              fill="none"
              stroke="#7bd7ff"
              strokeWidth={5}
              opacity={0.9}
            />
          ))}
          <Path d="M190 210 Q450 170 710 210" fill="none" stroke={accent} strokeWidth={5} opacity={0.9} />
        </>
      ) : null}

      {/* ─── Distinctive per-park landmarks (stylized but recognizable) ─── */}
      {/* Rocky Mountains — COL / LAD / LAA */}
      {profile.backdropKind === 'mountains' ? (
        <>
          <Path d="M110 158 L210 92 L300 126 L400 78 L500 122 L600 88 L700 130 L790 104 L790 158 Q450 94 110 158 Z"
            fill={dark ? '#2b3340' : '#9fb0c0'} opacity={0.92} />
          <Path d="M400 78 L432 106 L368 106 Z M600 88 L628 112 L572 112 Z M210 92 L240 114 L180 114 Z"
            fill={dark ? '#3c4555' : '#d6e0ea'} opacity={0.85} />
        </>
      ) : null}
      {/* Gateway Arch — STL */}
      {profile.outfieldFeature === 'gateway-arch' ? (
        <Path d="M348 158 Q470 58 592 158" fill="none" stroke={dark ? '#aab3bd' : '#7c8794'} strokeWidth={7} opacity={0.9} />
      ) : null}
      {/* CN Tower — TOR */}
      {profile.outfieldFeature === 'cn-tower' ? (
        <>
          <Path d="M466 156 L474 156 L472 62 L468 62 Z" fill={dark ? '#5a6470' : '#8c97a3'} />
          <Path d="M458 104 L482 104 L477 86 L463 86 Z" fill={dark ? '#5a6470' : '#8c97a3'} />
          <Rect x={468} y={44} width={4} height={20} fill={dark ? '#5a6470' : '#8c97a3'} />
        </>
      ) : null}
      {/* Roberto Clemente / yellow river bridges — PIT */}
      {profile.outfieldFeature === 'bridges' ? (
        <>
          <Path d="M150 160 Q470 98 790 160 L790 184 Q470 128 150 184 Z" fill="#16486e" opacity={0.75} />
          {[0, 1, 2].map(i => (
            <G key={`pnc-br-${i}`}>
              <Path d={`M ${196 + i * 202} ${150 - (i === 1 ? 32 : 12)} Q ${286 + i * 202} ${116 - (i === 1 ? 24 : 8)} ${376 + i * 202} ${150 - (i === 1 ? 32 : 12)}`} fill="none" stroke="#FDB827" strokeWidth={4} opacity={0.95} />
              <Line x1={196 + i * 202} y1={150 - (i === 1 ? 32 : 12)} x2={196 + i * 202} y2={166 - (i === 1 ? 18 : 6)} stroke="#FDB827" strokeWidth={3} />
              <Line x1={376 + i * 202} y1={150 - (i === 1 ? 32 : 12)} x2={376 + i * 202} y2={166 - (i === 1 ? 18 : 6)} stroke="#FDB827" strokeWidth={3} />
            </G>
          ))}
        </>
      ) : null}
      {/* B&O Warehouse — BAL */}
      {profile.outfieldFeature === 'warehouse' ? (
        <>
          <Path d="M150 116 Q470 86 790 116 L790 158 Q470 124 150 158 Z" fill={dark ? '#5a3326' : '#9c5a44'} opacity={0.94} />
          {Array.from({ length: 26 }).map((_, i) => (
            <Rect key={`bo-w${i}`} x={162 + i * 24} y={122 - Math.sin((i / 25) * Math.PI) * 22} width={10} height={14} fill={dark ? '#2a1a14' : '#6e3a2a'} opacity={0.9} />
          ))}
        </>
      ) : null}
      {/* Western Metal Supply building — SD */}
      {profile.outfieldFeature === 'western-metal' ? (
        <Path d="M150 112 L226 120 L226 166 Q188 158 150 174 Z" fill={dark ? '#6a3b2a' : '#a8654a'} opacity={0.94} stroke="#3a2018" strokeWidth={1} />
      ) : null}
      {/* Houston train track + locomotive ledge — HOU */}
      {profile.outfieldFeature === 'train-track' ? (
        <>
          <Path d="M150 150 Q470 92 790 150" fill="none" stroke={dark ? '#3a3f48' : '#7d8893'} strokeWidth={6} opacity={0.85} />
          <Path d="M210 132 Q246 124 282 132 L282 150 Q246 142 210 150 Z" fill={dark ? '#1f1f1f' : '#3a3a3a'} />
          <Circle cx={228} cy={147} r={5} fill="#222" /><Circle cx={262} cy={142} r={5} fill="#222" />
        </>
      ) : null}
      {profile.outfieldFeature === 'chase-roof' ? (
        <>
          <Path d="M130 154 Q470 68 810 154" fill="none" stroke="#2d3138" strokeWidth={18} opacity={0.92} />
          {[0, 1, 2, 3].map(i => (
            <Path key={`ari-roof-${i}`} d={`M ${180 + i * 130} ${146 - Math.sin((i / 3) * Math.PI) * 52} L ${230 + i * 130} ${118 - Math.sin((i / 3) * Math.PI) * 44}`} stroke="#7f8a94" strokeWidth={4} opacity={0.9} />
          ))}
          <Path d="M350 142 Q470 112 590 142" fill="none" stroke={accent} strokeWidth={5} opacity={0.88} />
        </>
      ) : null}
      {profile.outfieldFeature === 'truist-scoreboard' ? (
        <>
          <Path d="M150 158 Q470 96 790 158" fill="none" stroke="#1f2733" strokeWidth={20} opacity={0.92} />
          <Path d="M376 118 Q470 98 564 118 L564 154 Q470 142 376 154 Z" fill="#202634" stroke={accent} strokeWidth={3} />
          <Path d="M400 130 Q470 118 540 130" fill="none" stroke="#f3c14a" strokeWidth={4} />
          <Path d="M166 152 Q245 122 324 144" fill="none" stroke="#697789" strokeWidth={5} opacity={0.75} />
          <Path d="M616 144 Q690 120 770 152" fill="none" stroke="#697789" strokeWidth={5} opacity={0.75} />
        </>
      ) : null}
      {profile.outfieldFeature === 'riverboat-smokestacks' ? (
        <>
          <Path d="M150 162 Q470 104 790 162 L790 184 Q470 132 150 184 Z" fill="#16486e" opacity={0.74} />
          {[250, 684].map((x, i) => (
            <G key={`cin-stack-${i}`}>
              <Rect x={x} y={104 + i * 8} width={14} height={56} fill="#bfc9d2" />
              <Path d={`M ${x - 8} ${104 + i * 8} L ${x + 22} ${104 + i * 8}`} stroke="#c6011f" strokeWidth={5} />
              <Path d={`M ${x - 10} ${98 + i * 8} q 15 -12 30 0`} fill="none" stroke="#e4edf6" strokeWidth={3} opacity={0.8} />
            </G>
          ))}
          <Path d="M340 150 Q470 122 600 150" fill="none" stroke={accent} strokeWidth={6} opacity={0.85} />
        </>
      ) : null}
      {profile.outfieldFeature === 'progressive-sign' ? (
        <>
          <Path d="M150 158 Q470 96 790 158" fill="none" stroke="#2c3540" strokeWidth={22} opacity={0.88} />
          <Path d="M374 126 Q470 106 566 126 L566 154 Q470 142 374 154 Z" fill="#123f8c" />
          <Path d="M392 137 Q470 124 548 137" fill="none" stroke="#ffffff" strokeWidth={4} opacity={0.92} />
          {[206, 650].map(x => <Path key={`cle-tower-${x}`} d={`M${x} 154 L${x + 24} 148 L${x + 20} 96 L${x + 4} 100 Z`} fill="#586677" opacity={0.9} />)}
        </>
      ) : null}
      {profile.outfieldFeature === 'exploding-scoreboard' ? (
        <>
          <Path d="M150 158 Q470 98 790 158" fill="none" stroke="#111820" strokeWidth={20} opacity={0.94} />
          <Path d="M386 122 Q470 104 554 122 L554 154 Q470 142 386 154 Z" fill="#151515" stroke="#c4ced4" strokeWidth={2} />
          {[0, 1, 2, 3, 4].map(i => (
            <Path key={`cws-pin-${i}`} d={`M ${416 + i * 28} ${120 - Math.sin((i / 4) * Math.PI) * 18} l 7 -18 l 7 18`} fill="none" stroke={i % 2 ? '#ffffff' : '#c4ced4'} strokeWidth={3} />
          ))}
        </>
      ) : null}
      {profile.outfieldFeature === 'comerica-towers' ? (
        <>
          <Path d="M150 160 Q470 96 790 160" fill="none" stroke="#28303a" strokeWidth={20} opacity={0.9} />
          {[250, 312, 594, 656].map((x, i) => (
            <Path key={`det-tower-${i}`} d={`M${x} ${150 - (i % 2) * 10} L${x + 34} ${144 - (i % 2) * 10} L${x + 30} ${92 - i * 3} L${x + 8} ${96 - i * 3} Z`} fill="#526172" opacity={0.9} />
          ))}
          <Path d="M420 148 Q470 136 520 148" fill="none" stroke={accent} strokeWidth={5} />
        </>
      ) : null}
      {profile.outfieldFeature === 'rockpile' ? (
        <>
          <Path d="M156 164 Q260 130 360 146 L360 170 Q260 154 156 184 Z" fill="#9d8b73" />
          {[190, 226, 270, 314].map((x, i) => <Circle key={`laa-rock-${i}`} cx={x} cy={148 - i * 5} r={18 - i * 2} fill="#b6a084" opacity={0.9} />)}
          <Path d="M360 148 Q470 128 580 148" fill="none" stroke={accent} strokeWidth={5} opacity={0.82} />
        </>
      ) : null}
      {profile.outfieldFeature === 'dodger-pavilions' ? (
        <>
          <Path d="M150 158 Q470 98 790 158" fill="none" stroke="#164f95" strokeWidth={18} opacity={0.9} />
          {[238, 692].map((x, i) => (
            <G key={`lad-board-${i}`}>
              <Path d={`M${x - 42} 138 Q${x} 124 ${x + 42} 138 L${x + 42} 166 Q${x} 154 ${x - 42} 166 Z`} fill="#0c3f86" stroke="#ffffff" strokeWidth={1.5} />
              <Path d={`M${x - 20} 148 Q${x} 142 ${x + 20} 148`} stroke="#ffffff" strokeWidth={3} />
            </G>
          ))}
          {[168, 202, 738, 772].map(x => <Path key={`lad-palm-${x}`} d={`M${x} 158 L${x} 114 M${x} 118 l-14 -10 M${x} 118 l14 -10 M${x} 118 l-18 4 M${x} 118 l18 4`} stroke="#2f6b3a" strokeWidth={4} />)}
        </>
      ) : null}
      {profile.outfieldFeature === 'miami-towers' ? (
        <>
          <Path d="M150 160 Q470 96 790 160" fill="none" stroke="#214b66" strokeWidth={18} opacity={0.88} />
          {[330, 374, 422, 482, 532, 586].map((x, i) => (
            <Path key={`mia-tower-${i}`} d={`M${x} ${150 - Math.sin((i / 5) * Math.PI) * 34} L${x + 26} ${146 - Math.sin((i / 5) * Math.PI) * 34} L${x + 22} ${86 + (i % 2) * 16} L${x + 4} ${90 + (i % 2) * 16} Z`} fill={i % 2 ? '#7d98ad' : '#9fb8c9'} opacity={0.9} />
          ))}
          <Path d="M230 154 Q270 126 310 154" fill="none" stroke="#ff6b00" strokeWidth={5} />
        </>
      ) : null}
      {profile.outfieldFeature === 'brewers-roof-arches' ? (
        <>
          <Path d="M150 158 Q470 84 790 158" fill="none" stroke="#33414c" strokeWidth={18} opacity={0.9} />
          {[0, 1, 2].map(i => (
            <Path key={`mil-arch-${i}`} d={`M ${240 + i * 110} 154 Q ${330 + i * 55} ${70 + i * 8} ${610 - i * 40} 154`} fill="none" stroke={i === 0 ? '#9caab4' : '#5f6d78'} strokeWidth={5 - i} opacity={0.9} />
          ))}
          <Path d="M410 146 Q470 134 530 146" fill="none" stroke={accent} strokeWidth={5} />
        </>
      ) : null}
      {profile.outfieldFeature === 'target-skyline' ? (
        <>
          <Path d="M150 160 Q470 96 790 160" fill="none" stroke="#27313b" strokeWidth={18} opacity={0.9} />
          {[300, 340, 386, 444, 512, 570, 628].map((x, i) => (
            <Path key={`min-b-${i}`} d={`M${x} ${152 - Math.sin((i / 6) * Math.PI) * 34} L${x + 24} ${148 - Math.sin((i / 6) * Math.PI) * 34} L${x + 20} ${92 + (i % 3) * 12} L${x + 4} ${96 + (i % 3) * 12} Z`} fill={i % 2 ? near : far} opacity={0.95} />
          ))}
          <Circle cx={462} cy={126} r={14} fill="none" stroke={accent} strokeWidth={4} />
        </>
      ) : null}
      {profile.outfieldFeature === 'sutter-batter-eye' ? (
        <>
          <Path d="M150 158 Q470 98 790 158" fill="none" stroke="#123f2f" strokeWidth={20} opacity={0.92} />
          {[238, 306, 634, 702].map(x => <Path key={`ath-pole-${x}`} d={`M${x} 158 L${x} 104`} stroke="#f7c948" strokeWidth={4} />)}
          <Path d="M390 146 Q470 132 550 146" fill="none" stroke={accent} strokeWidth={6} />
        </>
      ) : null}
      {profile.outfieldFeature === 'citi-apple' ? (
        <>
          <Path d="M150 160 Q470 96 790 160" fill="none" stroke="#24313f" strokeWidth={18} opacity={0.92} />
          <Path d="M586 130 Q650 112 718 130 L718 158 Q650 146 586 158 Z" fill="#0a4381" stroke="#ff5910" strokeWidth={2} />
          <Path d="M642 146 q18 -22 36 0 q-8 22 -18 22 q-10 0 -18 -22" fill="#d71920" />
          <Rect x={658} y={128} width={5} height={14} fill="#2f7a3c" />
          <Path d="M260 152 Q330 126 400 148" fill="none" stroke="#718096" strokeWidth={5} opacity={0.8} />
        </>
      ) : null}
      {profile.outfieldFeature === 'yankee-frieze' ? (
        <>
          <Path d="M150 158 Q470 96 790 158" fill="none" stroke="#1f2935" strokeWidth={20} opacity={0.92} />
          <Path d="M154 142 Q470 88 786 142" fill="none" stroke="#c4ced4" strokeWidth={7} opacity={0.92} />
          {Array.from({ length: 18 }).map((_, i) => (
            <Path key={`nyy-fr-${i}`} d={`M ${178 + i * 34} ${143 - Math.sin((i / 17) * Math.PI) * 54} l 8 12 l 8 -12`} fill="none" stroke="#f3f5f7" strokeWidth={2} />
          ))}
          {[350, 400, 454, 510, 566].map((x, i) => <Rect key={`nyy-sky-${i}`} x={x} y={92 + (i % 2) * 12} width={20} height={48 - (i % 2) * 10} fill={near} opacity={0.8} />)}
        </>
      ) : null}
      {profile.outfieldFeature === 'liberty-bell' ? (
        <>
          <Path d="M150 158 Q470 98 790 158" fill="none" stroke="#26313d" strokeWidth={18} opacity={0.92} />
          <Path d="M392 142 Q470 118 548 142" fill="none" stroke={accent} strokeWidth={7} />
          <Path d="M448 126 q22 -24 44 0 l8 34 q-30 14 -60 0 Z" fill="#e81828" stroke="#ffffff" strokeWidth={2} />
          <Line x1={470} y1={130} x2={458} y2={158} stroke="#ffffff" strokeWidth={2} />
          {[240, 690].map(x => <Path key={`phi-board-${x}`} d={`M${x - 50} 140 Q${x} 124 ${x + 50} 140 L${x + 50} 160 Q${x} 150 ${x - 50} 160 Z`} fill="#123b73" />)}
        </>
      ) : null}
      {profile.outfieldFeature === 'seattle-roof-trusses' ? (
        <>
          <Path d="M150 160 Q470 94 790 160" fill="none" stroke="#283744" strokeWidth={18} opacity={0.92} />
          {[0, 1, 2, 3].map(i => (
            <Path key={`sea-truss-${i}`} d={`M ${166 + i * 160} ${156 - Math.sin((i / 3) * Math.PI) * 34} Q ${246 + i * 90} ${84 + i * 4} ${374 + i * 88} ${148 - Math.sin((i / 3) * Math.PI) * 22}`} fill="none" stroke="#607380" strokeWidth={5} opacity={0.88} />
          ))}
          <Path d="M640 142 Q700 122 760 142" fill="none" stroke={accent} strokeWidth={5} />
        </>
      ) : null}
      {profile.outfieldFeature === 'trop-dome' ? (
        <>
          <Path d="M104 158 Q470 54 836 158 L836 196 Q470 126 104 196 Z" fill="#2e343d" opacity={0.9} />
          {[0, 1, 2, 3, 4].map(i => (
            <Path key={`tb-rib-${i}`} d={`M ${150 + i * 80} 154 Q 470 ${70 + i * 6} ${790 - i * 80} 154`} fill="none" stroke={i === 2 ? accent : '#596675'} strokeWidth={3} opacity={0.8} />
          ))}
          <Path d="M392 144 Q470 128 548 144" fill="none" stroke="#8fbce6" strokeWidth={5} />
        </>
      ) : null}
      {profile.outfieldFeature === 'globe-life-roof' ? (
        <>
          <Path d="M150 158 Q470 82 790 158" fill="none" stroke="#394650" strokeWidth={20} opacity={0.93} />
          <Path d="M300 148 Q470 72 640 148" fill="none" stroke="#9aa8b2" strokeWidth={6} />
          <Path d="M318 158 Q470 98 622 158" fill="none" stroke="#c0111f" strokeWidth={5} />
          {[352, 410, 470, 530, 588].map(x => <Line key={`tex-roof-${x}`} x1={x} y1={152 - Math.sin(((x - 300) / 340) * Math.PI) * 56} x2={x + 18} y2={112} stroke="#6a7680" strokeWidth={3} />)}
        </>
      ) : null}
      {profile.outfieldFeature === 'capitol-view' ? (
        <>
          <Path d="M150 160 Q470 98 790 160" fill="none" stroke="#26313d" strokeWidth={18} opacity={0.92} />
          <Path d="M442 148 Q470 120 498 148 L512 156 Q470 144 428 156 Z" fill="#e6edf4" />
          <Rect x={452} y={148} width={36} height={20} fill="#dce5ee" />
          <Path d="M470 112 L470 96" stroke="#e6edf4" strokeWidth={3} />
          {[620, 670, 716].map((x, i) => <Rect key={`wsh-b-${i}`} x={x} y={118 + i * 8} width={28} height={42 - i * 4} fill={near} opacity={0.8} />)}
        </>
      ) : null}

      {/* Signature landmarks are anchored to the same outfield-wall curve. */}
      {/* FENWAY PARK (BOS): Green Monster, manual scoreboard, Pesky pole,
          Citgo sign, light tower. */}
      {abbr === 'BOS' ? (
        <>
          <Path d="M150 148 Q226 124 316 118 L316 170 Q232 164 150 182 Z" fill="#0B5A33" />
          <Path d="M150 148 Q226 124 316 118" fill="none" stroke="#0c8048" strokeWidth={7} />
          <Path d="M184 142 Q230 130 278 126 L278 154 Q230 154 184 162 Z" fill="#13351e" stroke="#0a8a3f" strokeWidth={1} />
          {[0,1,2,3,4,5,6,7].map(i => (
            <Rect key={`fw-s${i}`} x={190 + i * 10} y={143 - Math.sin((i / 7) * Math.PI) * 10} width={7} height={12} fill="#1b1b1b" stroke="#c9a44a" strokeWidth={0.7} />
          ))}
          <Rect x={318} y={102} width={4} height={56} fill="#FFD400" />
          <Rect x={205} y={104} width={42} height={20} rx={2} fill="#ffffff" />
          <Path d="M214 114 L226 108 L238 114 L226 120 Z" fill="#e1342c" />
          <Rect x={336} y={92} width={5} height={38} fill="#6b727a" />
          <Rect x={326} y={86} width={24} height={10} rx={1} fill="#dfe6ed" />
        </>
      ) : null}

      {/* WRIGLEY FIELD (CHC): hand-operated center-field scoreboard + clock. */}
      {abbr === 'CHC' ? (
        <>
          <Path d="M404 82 L470 64 L536 82 Z" fill="#1f6b3a" stroke="#0c3d20" strokeWidth={2} />
          <Path d="M404 82 L536 82 L536 136 Q470 124 404 136 Z" fill="#1f6b3a" stroke="#0c3d20" strokeWidth={2} />
          {[0,1,2,3,4,5,6].map(i => (
            <Rect key={`wr-a${i}`} x={412 + i * 17} y={94} width={12} height={12} fill="#0c2e18" stroke="#c9a44a" strokeWidth={0.6} />
          ))}
          {[0,1,2,3,4,5,6].map(i => (
            <Rect key={`wr-b${i}`} x={412 + i * 17} y={116} width={12} height={12} fill="#0c2e18" stroke="#c9a44a" strokeWidth={0.6} />
          ))}
          <Circle cx={470} cy={74} r={7} fill="#fff" stroke="#0c3d20" strokeWidth={1.4} />
          {/* brick + ivy outfield wall follows the warning-track curve. */}
          <Path d="M150 158 Q470 102 790 158" fill="none" stroke="#184f28" strokeWidth={18} />
          <Path d="M150 151 Q470 95 790 151" fill="none" stroke="#2f7a3c" strokeWidth={10} />
          {Array.from({ length: 40 }).map((_, i) => (
            <Circle
              key={`ivy-${i}`}
              cx={158 + i * 16}
              cy={154 - Math.sin((i / 39) * Math.PI) * 55 + (i % 2) * 3}
              r={4}
              fill="#3f8a4a"
            />
          ))}
        </>
      ) : null}

      </G>
      ) : null}
    </G>
  );
}

function MlbBroadcastFieldSvg({
  teamAbbr,
  dark,
}: {
  teamAbbr?: string;
  dark: boolean;
}) {
  const HP_X = 470, HP_Y = 460;
  const B1_X = 586, B1_Y = 344;
  const B2_X = 470, B2_Y = 266;
  const B3_X = 354, B3_Y = 344;
  const FIELD_OFFSET_Y = 38;
  const IN_CX = 470, IN_CY = 330, IN_R = 112;

  return (
    <Svg width="100%" height="100%" viewBox="0 0 940 580" preserveAspectRatio="xMidYMid meet">
      <Rect x={0} y={0} width={940} height={580} fill={dark ? '#1c1c1e' : '#fff'} />
      <Defs>
        <ClipPath id={`mlbFeatureClip-${teamAbbr || 'default'}`}>
          <Path d="M132 0 L808 0 L808 198 Q470 118 132 198 Z" />
        </ClipPath>
      </Defs>
      <MlbBallparkBackdrop teamAbbr={teamAbbr} dark={dark} baseOnly />
      <G clipPath={`url(#mlbFeatureClip-${teamAbbr || 'default'})`}>
        <MlbBallparkBackdrop teamAbbr={teamAbbr} dark={dark} featuresOnly featureLift={0} />
      </G>
      <G transform={`translate(470 330) scale(1.06) translate(-470 -330) translate(0 ${FIELD_OFFSET_Y})`}>
        <Path
          d={`M ${HP_X},${HP_Y}
              L 145,135
              Q 470,92 795,135
              L ${HP_X},${HP_Y} Z`}
          fill="#2b6b2b"
        />
        <Path d={`M 145,135 Q 470,92 795,135`} fill="none" stroke="#a98555" strokeWidth={14} opacity={1} />
        <Path
          d={`M ${HP_X},${HP_Y}
              L ${B1_X},${B1_Y}
              L 594,318
              C 560,274 520,252 470,246
              C 420,252 380,274 346,318
              L ${B3_X},${B3_Y}
              L ${HP_X},${HP_Y} Z`}
          fill="#a98555"
          opacity={0.98}
        />
        <Path
          d={`M ${IN_CX},${IN_CY + 114}
              C ${IN_CX + 30},${IN_CY + 82} ${IN_CX + 72},${IN_CY + 48} ${IN_CX + 92},${IN_CY + 22}
              C ${IN_CX + 78},${IN_CY - 4} ${IN_CX + 46},${IN_CY - 28} ${IN_CX + 16},${IN_CY - 40}
              C ${IN_CX + 8},${IN_CY - 32} ${IN_CX - 8},${IN_CY - 32} ${IN_CX - 16},${IN_CY - 40}
              C ${IN_CX - 46},${IN_CY - 28} ${IN_CX - 78},${IN_CY - 4} ${IN_CX - 92},${IN_CY + 22}
              C ${IN_CX - 72},${IN_CY + 48} ${IN_CX - 30},${IN_CY + 82} ${IN_CX},${IN_CY + 114}
              Z`}
          fill="#2b6b2b"
        />
        <Path d={`M ${HP_X},${HP_Y} L 145,135`} fill="none" stroke="#a98555" strokeWidth={16} opacity={0.98} />
        <Path d={`M ${HP_X},${HP_Y} L 795,135`} fill="none" stroke="#a98555" strokeWidth={16} opacity={0.98} />
        <Path d={`M ${HP_X},${HP_Y} L 145,135`} fill="none" stroke="#fff" strokeWidth={2} opacity={0.82} />
        <Path d={`M ${HP_X},${HP_Y} L 795,135`} fill="none" stroke="#fff" strokeWidth={2} opacity={0.82} />
        <Circle cx={HP_X} cy={364} r={20} fill="#b8945f" stroke="#fff" strokeWidth={1.5} opacity={0.9} />
        <Rect x={HP_X - 8} y={362} width={16} height={4} fill="#fff" />
        {[
          [HP_X, HP_Y, 7],
          [B1_X, B1_Y, 9],
          [B2_X, B2_Y, 9],
          [B3_X, B3_Y, 9],
        ].map(([x, y, s], i) => (
          <Rect
            key={i}
            x={x - s / 2} y={y - s / 2}
            width={s} height={s}
            fill="#fff"
            transform={`rotate(45, ${x}, ${y})`}
          />
        ))}
      </G>
      {String(teamAbbr || '').toUpperCase() === 'SF' ? (
        <G>
          <Line x1={145} y1={82} x2={145} y2={181} stroke="#ffde42" strokeWidth={8} strokeLinecap="square" />
          <Line x1={795} y1={82} x2={795} y2={181} stroke="#ffde42" strokeWidth={8} strokeLinecap="square" />
        </G>
      ) : null}
    </Svg>
  );
}

function MlbFinalFieldSummary({ summary, dark }: { summary: GameSummary; dark: boolean }) {
  const panelBg = dark ? '#1c1c1e' : '#fff';
  const panelText = dark ? '#f5f5f7' : '#202124';
  const panelSub = dark ? '#a1a1a6' : '#5f6368';
  const panelBorder = dark ? '#3a3a3c' : '#d1d1d6';
  const awayScore = Number(summary.away.score || 0);
  const homeScore = Number(summary.home.score || 0);
  const winner = homeScore > awayScore ? summary.home : summary.away;
  const loser = homeScore > awayScore ? summary.away : summary.home;
  const winnerLogo = dark ? (winner.team.logoDark ?? winner.team.logo) : winner.team.logo;

  return (
    <Animated.View entering={FadeInDown.duration(400)} style={{
      marginHorizontal: 16,
      marginTop: 12,
      borderWidth: 1,
      borderColor: panelBorder,
      borderRadius: 16,
      backgroundColor: panelBg,
      overflow: 'hidden',
      minHeight: Platform.OS === 'web' ? 235 : 270,
      alignItems: 'center',
    }}>
      <View style={{ alignItems: 'center', paddingTop: 12, gap: 3 }}>
        {winnerLogo ? <Image source={{ uri: winnerLogo }} style={{ width: 34, height: 34 }} contentFit="contain" /> : null}
        <Text style={{ color: panelText, fontSize: 20, fontFamily: F.black }}>
          {winner.team.abbreviation} WINS
        </Text>
        <Text style={{ color: panelSub, fontSize: 14, fontFamily: F.bold }}>
          {winner.score} - {loser.score}
        </Text>
      </View>
      <View style={{ width: '100%', height: Platform.OS === 'web' ? 150 : 180, marginTop: 2 }}>
        <Svg width="100%" height="100%" viewBox="0 0 900 430" preserveAspectRatio="xMidYMid meet">
          <Path d="M450 405 L120 185 Q450 25 780 185 Z" fill="#2f8b24" stroke="#d8b47d" strokeWidth={14} />
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Path key={i} d={`M ${150 + i * 30} ${190 - i * 10} Q 450 ${55 + i * 7} ${750 - i * 30} ${190 - i * 10}`}
              fill="none" stroke="#24751c" strokeWidth={12} opacity={0.45} />
          ))}
          <Path d="M450 392 L590 295 L450 198 L310 295 Z" fill="#d8b47d" />
          <Path d="M450 360 L550 295 L450 230 L350 295 Z" fill="#39962d" />
          <Path d="M450 392 L590 295 L450 198 L310 295 Z" fill="none" stroke="#fff" strokeWidth={3} strokeLinejoin="round" />
          <Circle cx={450} cy={310} r={13} fill="#c79d64" stroke="#fff" strokeWidth={2} />
        </Svg>
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Player prop classifier — splits MLB props into pitcher vs batter
// ---------------------------------------------------------------------------

function classifyMlbProp(typeName: string): 'pitcher' | 'batter' {
  const t = (typeName || '').toLowerCase();
  // Pitcher prop keywords
  if (
    t.includes('strikeout') ||         // "Total Strikeouts" + "Strikeouts Thrown Milestones"
    t.includes('hits allowed') ||
    t.includes('earned run') ||
    t.includes('walks allowed') ||
    t.includes('thrown') ||
    t.includes('pitcher')
  ) return 'pitcher';
  return 'batter';
}

// Shared sportsbook-style line formatter (lives in constants/prop-utils.ts)
import { formatPropLine as _formatPropLine } from '@/constants/prop-utils';
const formatPropLine = _formatPropLine;

// Did the athlete actually play in the game (any non-empty stat)
function didPlay(stats: Record<string, string>): boolean {
  for (const v of Object.values(stats)) {
    if (v && v !== '--' && v !== '0' && v !== '0:00' && v !== '0-0' && v !== '.000') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Play classifier — detects the type of play for visual treatment
// ---------------------------------------------------------------------------

type PlayKind =
  | 'made3'         // made three-pointer
  | 'dunk'          // dunk (made)
  | 'made2'         // made 2-pointer (non-dunk)
  | 'madeFT'        // made free throw
  | 'missed3'       // missed three-pointer
  | 'missed'        // missed shot (non-3)
  | 'block'         // shot blocked
  | 'steal'         // steal
  | 'turnover'      // turnover (no steal info)
  | 'rebound'       // rebound
  | 'foul'          // foul
  | 'timeout'       // timeout
  | 'sub'           // substitution
  | 'other';

function classifyPlay(play: Play): PlayKind {
  const text = (play.text || '').toLowerCase();
  const type = (play.typeText || '').toLowerCase();

  if (type.includes('free throw') && play.scoringPlay) return 'madeFT';
  if (type.includes('dunk') && play.scoringPlay) return 'dunk';
  if (play.scoringPlay && play.scoreValue === 3) return 'made3';
  if (play.scoringPlay && play.scoreValue === 2) return 'made2';
  if (text.includes('block')) return 'block';
  if (text.includes('turnover') || text.includes('bad pass')) return 'turnover';
  if (text.includes('steal')) return 'steal';
  if (type.includes('rebound')) return 'rebound';
  if (type.includes('foul')) return 'foul';
  if (type.includes('timeout')) return 'timeout';
  if (type.includes('substitution')) return 'sub';
  if (type.includes('three') && !play.scoringPlay) return 'missed3';
  if ((type.includes('shot') || type.includes('layup') || type.includes('jump')) && !play.scoringPlay) return 'missed';
  return 'other';
}

// Whether the coordinate is meaningful (ESPN uses -214748340 as sentinel for "no coord")
function hasCoord(c: Play['coordinate']): boolean {
  if (!c) return false;
  return Math.abs(c.x) < 1000 && Math.abs(c.y) < 1000;
}

// ---------------------------------------------------------------------------
// Possession banner — sits above the court
// ---------------------------------------------------------------------------

function PossessionBanner({
  team, color, dark,
}: {
  team: GameSummary['home']['team'] | null;
  color: string;
  dark: boolean;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 900 })),
      -1,
      false,
    );
  }, []);
  const dotStyle = useAnimatedStyle(() => ({ opacity: 0.4 + pulse.value * 0.6 }));

  if (!team) return null;
  return (
    <View style={[possStyles.banner, { backgroundColor: dark ? '#1c1c1e' : '#fff', borderColor: color }]}>
      <Animated.View style={[possStyles.dot, { backgroundColor: color }, dotStyle]} />
      {team.logo ? (
        <Image source={{ uri: team.logo }} style={possStyles.logo} contentFit="contain" />
      ) : null}
      <Text style={[possStyles.label, { color }]}>POSSESSION</Text>
      <Text style={[possStyles.team, { color: dark ? '#fff' : '#000' }]}>{team.abbreviation}</Text>
    </View>
  );
}

const possStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  logo: { width: 22, height: 22 },
  label: { fontSize: 12, fontFamily: F.black, letterSpacing: 2, flex: 1 },
  team: { fontSize: 14, fontFamily: F.black, letterSpacing: 0.5 },
});

// ---------------------------------------------------------------------------
// Play highlight banner — slides in for big plays
// ---------------------------------------------------------------------------

function PlayHighlight({
  play, kind, teamColor, possessionAfterArrow,
}: {
  play: Play | null;
  kind: PlayKind;
  teamColor: string;
  possessionAfterArrow?: 'left' | 'right' | null;   // for turnovers
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-40);
  const scale = useSharedValue(0.6);
  const arrowSlide = useSharedValue(0);

  // Re-animate every time the play id changes
  useEffect(() => {
    if (!play) return;
    opacity.value = 0;
    translateY.value = -40;
    scale.value = 0.6;
    arrowSlide.value = 0;

    // Stay visible longer + smoother fade
    opacity.value = withSequence(
      withTiming(1, { duration: 220 }),
      withTiming(1, { duration: 2000 }),
      withTiming(0, { duration: 450 }),
    );
    // Eye-popping entrance — punchy spring drop with overshoot
    translateY.value = withSpring(0, { damping: 7, stiffness: 180, overshootClamping: false });
    scale.value = withSequence(
      withSpring(1.15, { damping: 6, stiffness: 200 }),
      withSpring(1,    { damping: 9, stiffness: 160 }),
    );
    // Arrow slide-in for turnovers
    if (kind === 'turnover' && possessionAfterArrow) {
      arrowSlide.value = withDelay(160,
        withSpring(1, { damping: 8, stiffness: 200 }),
      );
    }
  }, [play?.id]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));
  const arrowStyle = useAnimatedStyle(() => ({
    opacity: arrowSlide.value,
    transform: [{
      translateX: arrowSlide.value * (possessionAfterArrow === 'right' ? 20 : -20),
    }],
  }));

  // Pick label + color per kind (no emojis — clean broadcast aesthetic)
  const highlight = (() => {
    switch (kind) {
      case 'made3':    return { label: '3-POINTER!',  color: teamColor };
      case 'dunk':     return { label: 'DUNK!',       color: teamColor };
      case 'made2':    return { label: '+2',          color: teamColor };
      case 'madeFT':   return { label: 'FREE THROW',  color: teamColor };
      case 'block':    return { label: 'BLOCK!',      color: '#9b59b6' };
      case 'steal':    return { label: 'STEAL!',      color: '#34c759' };
      case 'turnover': return { label: 'TURNOVER',    color: '#ff453a' };
      case 'foul':     return { label: 'FOUL',        color: '#ff9f0a' };
      case 'missed3':  return { label: 'MISSED 3',    color: '#8e8e93' };
      case 'missed':   return { label: 'MISSED',      color: '#8e8e93' };
      default:         return null;
    }
  })();

  if (!play || !highlight) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        playHighlightStyles.banner,
        { borderColor: highlight.color, backgroundColor: `${highlight.color}E6` },
        animStyle,
      ]}
    >
      {/* Left arrow appears when possession goes left after turnover */}
      {kind === 'turnover' && possessionAfterArrow === 'left' && (
        <Animated.Text style={[playHighlightStyles.arrow, arrowStyle]}>←</Animated.Text>
      )}
      <Text style={playHighlightStyles.label}>{highlight.label}</Text>
      {/* Right arrow appears when possession goes right after turnover */}
      {kind === 'turnover' && possessionAfterArrow === 'right' && (
        <Animated.Text style={[playHighlightStyles.arrow, arrowStyle]}>→</Animated.Text>
      )}
    </Animated.View>
  );
}

const playHighlightStyles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    left: '50%',
    marginLeft: -90,
    width: 180,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 2,
    zIndex: 50,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  emoji: { fontSize: 18 },
  label: { color: '#fff', fontSize: 14, fontFamily: F.black, letterSpacing: 1.5 },
  arrow: { color: '#fff', fontSize: 22, fontFamily: F.black, lineHeight: 22 },
});

// ---------------------------------------------------------------------------
// Court play overlay — animated marker on the court at shot location
// ---------------------------------------------------------------------------

function CourtPlayOverlay({
  play, kind, teamColor, offenseLeft,
}: {
  play: Play | null;
  kind: PlayKind;
  teamColor: string;
  offenseLeft: boolean;     // is the offensive basket on the left side?
}) {
  const pop = useSharedValue(0);
  const ripple = useSharedValue(0);

  useEffect(() => {
    if (!play || !hasCoord(play.coordinate)) return;
    pop.value = 0;
    ripple.value = 0;
    pop.value = withSpring(1, { damping: 8, stiffness: 160 });
    ripple.value = withSequence(
      withTiming(1, { duration: 800 }),
      withTiming(0, { duration: 100 }),
    );
  }, [play?.id]);

  if (!play || !hasCoord(play.coordinate)) return null;
  // Don't render for non-shot plays
  if (!['made3', 'made2', 'madeFT', 'dunk', 'missed', 'missed3', 'block'].includes(kind)) return null;

  const { x = 0, y = 0 } = play.coordinate ?? {};
  // ESPN coords: x = distance from baseline (0-50), y = -25..25 (center=0)
  // Map to court (which is 100% width, 160px tall — left or right half)
  // Use percentage positioning over the court container
  const xPct = Math.min(50, Math.max(0, x)) / 50;         // 0..1 distance from baseline
  const yPct = (Math.max(-25, Math.min(25, y)) + 25) / 50; // 0..1 court width
  const leftPct = offenseLeft ? xPct * 45 + 2 : 98 - xPct * 45;
  const topPct = yPct * 100;

  const isMade = ['made3', 'made2', 'dunk', 'madeFT'].includes(kind);
  const isMiss = ['missed', 'missed3'].includes(kind);
  const markerColor = isMade ? teamColor : isMiss ? '#ff453a' : '#9b59b6';

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
    opacity: pop.value,
  }));
  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.5 + ripple.value * 2.2 }],
    opacity: 0.6 * (1 - ripple.value),
  }));

  return (
    <View pointerEvents="none" style={courtOverlayStyles.layer}>
      {/* Outer ripple */}
      <Animated.View
        style={[
          courtOverlayStyles.ripple,
          { left: `${leftPct}%` as any, top: `${topPct}%` as any, borderColor: markerColor },
          rippleStyle,
        ]}
      />
      {/* Marker */}
      <Animated.View
        style={[
          courtOverlayStyles.marker,
          { left: `${leftPct}%` as any, top: `${topPct}%` as any, backgroundColor: markerColor },
          dotStyle,
        ]}
      >
        {isMade ? (
          <Text style={courtOverlayStyles.markerText}>
            {kind === 'made3' ? '3' : kind === 'madeFT' ? '1' : '2'}
          </Text>
        ) : (
          <Text style={courtOverlayStyles.markerText}>✕</Text>
        )}
      </Animated.View>
    </View>
  );
}

const courtOverlayStyles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  marker: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    marginLeft: -13,
    marginTop: -13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  markerText: { color: '#fff', fontSize: 12, fontFamily: F.black },
  ripple: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    marginLeft: -25,
    marginTop: -25,
    borderWidth: 2,
  },
});

// ---------------------------------------------------------------------------
// Baseball play overlay — ball arcs, strikeout K, walk runner, etc.
// Sits on top of the diamond and re-animates whenever the latest play changes.
// ---------------------------------------------------------------------------

type MlbPlayKind = 'strikeout' | 'walk' | 'single' | 'double' | 'triple' | 'homer' | 'groundout' | 'flyout' | 'out' | 'steal' | 'error' | 'hbp' | 'bunt' | null;

function classifyMlbPlay(text: string): MlbPlayKind {
  const t = (text || '').toLowerCase();
  if (/struck out|strikeout/.test(t)) return 'strikeout';
  if (/hit by pitch/.test(t))         return 'hbp';
  if (/\berror\b|reached on/.test(t)) return 'error';
  if (/\bbunt/.test(t))               return 'bunt';
  if (/walks?\b|walked/.test(t))      return 'walk';
  if (/home run|homered/.test(t))     return 'homer';
  if (/tripled|triples\b/.test(t))    return 'triple';
  if (/doubled|doubles\b/.test(t))    return 'double';
  if (/singled|singles\b/.test(t))    return 'single';
  if (/stole|stolen base/.test(t))    return 'steal';
  if (/popped|pop fly|flied|fly out|lined out/.test(t)) return 'flyout';
  if (/grounded|ground out|grounds into/.test(t)) return 'groundout';
  if (/out at|forced|sacrifice/.test(t)) return 'out';
  return null;
}

function resolveMlbHitPoint(play: Play, fallback: BasePoint): BasePoint {
  const point = play.coordinate;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return fallback;

  // ESPN hit charts are generally either percentages or a roughly 0-250
  // coordinate plane. Project both forms into this field's fair-territory fan.
  const scale = Math.max(Math.abs(point.x), Math.abs(point.y)) <= 100 ? 100 : 250;
  return {
    x: Math.max(165, Math.min(775, 165 + (point.x / scale) * 610)),
    y: Math.max(125, Math.min(410, 125 + (point.y / scale) * 285)),
  };
}

function BaseballPlayAnimation({ play }: { play: Play | null }) {
  const FIELD_OFFSET_Y = 38;
  // Diamond coords (must match the SVG geometry above)
  const HP = { x: 470, y: 460 };
  const B1 = { x: 600, y: 330 };
  const B2 = { x: 470, y: 200 };
  const B3 = { x: 340, y: 330 };

  const ballScale = useSharedValue(0);
  const ballX = useSharedValue(HP.x);
  const ballY = useSharedValue(HP.y);
  const flashOpacity = useSharedValue(0);
  const labelScale = useSharedValue(0);

  const kind = classifyMlbPlay(play?.text || '');

  useEffect(() => {
    if (!play || !kind) return;
    // Reset
    ballScale.value = 0;
    flashOpacity.value = 0;
    labelScale.value = 0;
    ballX.value = HP.x;
    ballY.value = HP.y;

    // Strikeout: red K flashes at home plate
    if (kind === 'strikeout') {
      labelScale.value = withSequence(
        withSpring(1.2, { damping: 6, stiffness: 120 }),
        withTiming(1, { duration: 200 }),
        withDelay(1500, withTiming(0, { duration: 400 })),
      );
      flashOpacity.value = withSequence(
        withTiming(0.4, { duration: 120 }),
        withTiming(0, { duration: 400 }),
      );
      return;
    }
    // Walk: ball moves home → 1B slowly
    if (kind === 'walk') {
      ballScale.value = withSpring(1, { damping: 8 });
      ballX.value = withTiming(B1.x, { duration: 900 });
      ballY.value = withTiming(B1.y, { duration: 900 });
      labelScale.value = withSequence(
        withSpring(1, { damping: 7 }),
        withDelay(1500, withTiming(0, { duration: 400 })),
      );
      return;
    }
    // Balls in play travel to the real ESPN hit-chart coordinate when present.
    const targets: Record<string, { x: number; y: number }> = {
      single:  { x: 600, y: 350 },
      double:  { x: 720, y: 280 },
      triple:  { x: 470, y: 220 },
      homer:   { x: 470, y: 180 },
      groundout: { x: 560, y: 350 },
      flyout:  { x: 650, y: 205 },
      out:     { x: 470, y: 320 },
      steal:   { x: B2.x, y: B2.y },
      error:   { x: 555, y: 335 },
      hbp:     { x: B1.x, y: B1.y },
      bunt:    { x: 515, y: 405 },
    };
    const fallback = targets[kind] || { x: 470, y: 350 };
    const target = ['single', 'double', 'triple', 'homer', 'groundout', 'flyout', 'out', 'error', 'bunt'].includes(kind)
      ? resolveMlbHitPoint(play, fallback)
      : fallback;
    const travelDuration = kind === 'groundout' || kind === 'bunt' ? 900 : 1300;
    ballScale.value = withSequence(
      withSpring(1, { damping: 8 }),
      withDelay(2300, withTiming(0, { duration: 350 })),
    );
    ballX.value = withTiming(target.x, { duration: travelDuration });
    ballY.value = kind === 'groundout'
      ? withTiming(target.y, { duration: travelDuration })
      : withSequence(
          withTiming((HP.y + target.y) / 2 - (kind === 'flyout' || kind === 'homer' ? 125 : 60), { duration: travelDuration * 0.55 }),
          withTiming(target.y, { duration: travelDuration * 0.45 }),
        );
    flashOpacity.value = kind === 'homer'
      ? withSequence(
          withTiming(0.6, { duration: 250 }),
          withTiming(0, { duration: 500 }),
        )
      : 0;
    labelScale.value = withSequence(
      withDelay(travelDuration * 0.7, withSpring(1, { damping: 7 })),
      withDelay(1800, withTiming(0, { duration: 400 })),
    );
  }, [play?.id, kind, play?.coordinate?.x, play?.coordinate?.y]);

  // SVG attribute animation (cx/cy/r/opacity) requires useAnimatedProps
  const ballProps = useAnimatedProps(() => ({
    cx: ballX.value,
    cy: ballY.value,
    r: 8 * ballScale.value,
    opacity: ballScale.value,
  } as any));
  const flashProps = useAnimatedProps(() => ({ opacity: flashOpacity.value } as any));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelScale.value,
    transform: [{ scale: labelScale.value }],
  }));

  if (!play || !kind) return null;

  const labelText = (() => {
    switch (kind) {
      case 'strikeout': return 'STRIKEOUT';
      case 'walk':      return 'WALK';
      case 'single':    return 'SINGLE';
      case 'double':    return 'DOUBLE';
      case 'triple':    return 'TRIPLE';
      case 'homer':     return 'HOME RUN';
      case 'groundout': return 'GROUND OUT';
      case 'flyout':    return /pop/i.test(play.text) ? 'POP OUT' : 'FLY OUT';
      case 'out':       return 'OUT';
      case 'steal':     return 'STOLEN BASE';
      case 'error':     return 'REACHED ON ERROR';
      case 'hbp':       return 'HIT BY PITCH';
      case 'bunt':      return 'BUNT';
      default: return '';
    }
  })();
  const labelColor = kind === 'homer'  ? '#FFD700'
                   : kind === 'strikeout' || kind === 'out' || kind === 'groundout' || kind === 'flyout' ? '#FF3B30'
                   : kind === 'walk'   ? '#0a84ff'
                   : '#34c759';
  const fallbackTarget = kind ? ({
    single: { x: 600, y: 350 }, double: { x: 720, y: 280 }, triple: { x: 470, y: 220 },
    homer: { x: 470, y: 180 }, groundout: { x: 560, y: 350 }, flyout: { x: 650, y: 205 },
    out: { x: 470, y: 320 }, error: { x: 555, y: 335 }, bunt: { x: 515, y: 405 },
  } as Record<string, BasePoint>)[kind] : null;
  const hitTarget = play && fallbackTarget ? resolveMlbHitPoint(play, fallbackTarget) : null;
  const showHitPath = !!hitTarget && ['single', 'double', 'triple', 'homer', 'groundout', 'flyout', 'out', 'error', 'bunt'].includes(kind);
  const controlY = hitTarget ? (HP.y + hitTarget.y) / 2 - (kind === 'flyout' || kind === 'homer' ? 125 : 60) : HP.y;

  return (
    <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 6 }}>
      <Svg width="100%" height="100%" viewBox="0 0 940 580" preserveAspectRatio="xMidYMid meet">
        <G transform={`translate(0 ${FIELD_OFFSET_Y})`}>
        {/* Celebration flash (HR / K) */}
        <AnimatedRect
          x={60} y={0} width={820} height={580}
          fill={labelColor} animatedProps={flashProps}
        />
        {showHitPath && hitTarget ? (
          <>
            <Path
              d={`M ${HP.x} ${HP.y} Q ${(HP.x + hitTarget.x) / 2} ${controlY} ${hitTarget.x} ${hitTarget.y}`}
              fill="none"
              stroke="#fff"
              strokeWidth={3}
              strokeDasharray="8,7"
              opacity={0.62}
            />
            <Circle cx={hitTarget.x} cy={hitTarget.y} r={15} fill="none" stroke={labelColor} strokeWidth={4} />
          </>
        ) : null}
        {/* Animated ball */}
        <AnimatedCircle
          fill="#fff" stroke="#000" strokeWidth={1.5}
          animatedProps={ballProps}
        />
        </G>
      </Svg>
      {/* Broadcast result banner */}
      <Animated.View style={[{
        position: 'absolute',
        top: 8,
        left: 18,
        right: 18,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        backgroundColor: labelColor,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      }, labelStyle]}>
        <Text style={{ color: '#fff', fontFamily: F.black, fontSize: 15, letterSpacing: 1 }}>
          {labelText}
        </Text>
      </Animated.View>
    </View>
  );
}

type NflPlayKind = 'touchdown' | 'pass' | 'run' | 'penalty' | 'sack' | 'turnover' | 'fieldGoal' | 'play' | null;
type NhlPlayKind = 'goal' | 'shot' | 'save' | 'penalty' | 'hit' | 'faceoff' | 'stoppage' | null;

function classifyNflPlay(play: Play | null): NflPlayKind {
  const t = `${play?.typeText ?? ''} ${play?.text ?? ''}`.toLowerCase();
  if (/touchdown/.test(t)) return 'touchdown';
  if (/intercept|fumble|turnover/.test(t)) return 'turnover';
  if (/penalty|no play/.test(t)) return 'penalty';
  if (/field goal/.test(t)) return 'fieldGoal';
  if (/\bsack/.test(t)) return 'sack';
  if (/pass|complete|incomplete/.test(t)) return 'pass';
  if (/rush|left end|right end|up the middle|kneel/.test(t)) return 'run';
  return play ? 'play' : null;
}

function classifyNhlPlay(play: Play | null): NhlPlayKind {
  const t = `${play?.typeText ?? ''} ${play?.text ?? ''}`.toLowerCase();
  if (/\bgoal\b/.test(t)) return 'goal';
  if (/penalty|minor|major|misconduct/.test(t)) return 'penalty';
  if (/save|saved/.test(t)) return 'save';
  if (/shot|missed|blocked/.test(t)) return 'shot';
  if (/\bhit\b/.test(t)) return 'hit';
  if (/faceoff|face-off/.test(t)) return 'faceoff';
  return play ? 'stoppage' : null;
}

function extractYards(text: string): number | null {
  const m = text.match(/(-?\d+)\s+yards?/i);
  return m ? Number(m[1]) : null;
}

function SportPlayAnimation({ sport, play }: { sport: 'nfl' | 'nhl'; play: Play | null }) {
  const progress = useSharedValue(0);
  const badge = useSharedValue(0);
  const nflKind = sport === 'nfl' ? classifyNflPlay(play) : null;
  const nhlKind = sport === 'nhl' ? classifyNhlPlay(play) : null;
  const kind = nflKind ?? nhlKind;

  useEffect(() => {
    if (!play || !kind) return;
    progress.value = 0;
    badge.value = 0;
    progress.value = withTiming(1, {
      duration: kind === 'pass' || kind === 'shot' || kind === 'goal' ? 850 : 650,
    });
    badge.value = withSequence(
      withDelay(250, withSpring(1, { damping: 8 })),
      withDelay(1450, withTiming(0, { duration: 300 })),
    );
  }, [play?.id, kind]);

  const coord = play?.coordinate;
  const rawX = coord?.x ?? 50;
  const rawY = coord?.y ?? 50;
  const endX = rawX > 100 ? Math.max(8, Math.min(92, rawX / 10)) : Math.max(8, Math.min(92, rawX));
  const endY = rawY > 100 ? Math.max(15, Math.min(85, rawY / 10)) : Math.max(15, Math.min(85, rawY));
  const startX = sport === 'nfl' ? Math.max(8, endX - 18) : 50;
  const startY = sport === 'nfl' ? endY : 50;
  const markerStyle = useAnimatedStyle(() => ({
    left: `${startX + (endX - startX) * progress.value}%` as any,
    top: `${startY + (endY - startY) * progress.value}%` as any,
    transform: [
      { translateX: -8 },
      { translateY: -8 },
      { scale: 0.8 + progress.value * 0.35 },
    ],
    opacity: progress.value < 0.02 ? 0 : 1,
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badge.value,
    transform: [{ scale: badge.value }],
  }));

  if (!play || !kind) return null;
  const yards = sport === 'nfl' ? extractYards(play.text) : null;
  const penalized = play.participants?.find(p => /penal|committed/i.test(p.type)) ?? play.participants?.[0];
  const label = sport === 'nfl'
    ? kind === 'touchdown' ? 'TOUCHDOWN'
      : kind === 'fieldGoal' ? 'FIELD GOAL'
      : kind === 'turnover' ? 'TURNOVER'
      : kind === 'penalty' ? `PENALTY${yards != null ? ` ${yards > 0 ? '+' : ''}${yards} YDS` : ''}`
      : kind === 'sack' ? `SACK${yards != null ? ` ${yards} YDS` : ''}`
      : kind === 'pass' ? `PASS${yards != null ? ` ${yards} YDS` : ''}`
      : kind === 'run' ? `RUN${yards != null ? ` ${yards} YDS` : ''}`
      : 'PLAY UPDATE'
    : kind === 'goal' ? 'GOAL'
      : kind === 'penalty' ? 'PENALTY'
      : kind === 'save' ? 'SAVE'
      : kind === 'hit' ? 'HIT'
      : kind === 'faceoff' ? 'FACEOFF'
      : kind === 'shot' ? 'SHOT'
      : 'STOPPAGE';
  const color = kind === 'touchdown' || kind === 'goal' || kind === 'fieldGoal' ? '#34C759'
    : kind === 'penalty' ? '#FFD60A'
    : kind === 'turnover' || kind === 'sack' ? '#FF3B30'
    : '#0A84FF';

  return (
    <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 12 }}>
      <Animated.View style={[{
        position: 'absolute',
        width: sport === 'nfl' ? 18 : 14,
        height: sport === 'nfl' ? 11 : 14,
        borderRadius: sport === 'nfl' ? 6 : 7,
        backgroundColor: sport === 'nfl' ? '#7A3E16' : '#111',
        borderWidth: 2,
        borderColor: '#fff',
      }, markerStyle]} />
      <Animated.View style={[{
        position: 'absolute',
        alignSelf: 'center',
        top: '16%',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: color,
        maxWidth: '88%',
      }, badgeStyle]}>
        <Text style={{ color: kind === 'penalty' ? '#111' : '#fff', fontSize: 17, fontFamily: F.black, textAlign: 'center' }}>
          {label}
        </Text>
        {kind === 'penalty' && penalized?.name ? (
          <Text style={{ color: '#111', fontSize: 10, fontFamily: F.bold, textAlign: 'center', marginTop: 2 }}>
            {penalized.name}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

function BaseballFieldRunners({
  play, dark,
}: {
  play: Play | null;
  dark: boolean;
}) {
  const onFirst = play?.onFirst ?? null;
  const onSecond = play?.onSecond ?? null;
  const onThird = play?.onThird ?? null;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scoringRunners, setScoringRunners] = useState<Array<{ runner: Runner; from: number }>>([]);
  const initializedRef = useRef(false);
  const SVG_W = 940;
  const SVG_H = 580;
  const FIELD_OFFSET_Y = 38;
  const mapPoint = (x: number, y: number): BasePoint => ({
    x: (size.width - SVG_W * Math.min(size.width / SVG_W, size.height / SVG_H)) / 2
      + x * Math.min(size.width / SVG_W, size.height / SVG_H),
    y: (size.height - SVG_H * Math.min(size.width / SVG_W, size.height / SVG_H)) / 2
      + y * Math.min(size.width / SVG_W, size.height / SVG_H),
  });
  const bases = {
    home:   mapPoint(470, 460 + FIELD_OFFSET_Y),
    first:  mapPoint(600, 330 + FIELD_OFFSET_Y),
    second: mapPoint(470, 200 + FIELD_OFFSET_Y),
    third:  mapPoint(340, 330 + FIELD_OFFSET_Y),
  };
  const basePoints = [bases.home, bases.first, bases.second, bases.third, bases.home];
  const previousByRunner = useRef<Record<string, { runner: Runner; base: number }>>({});
  const currentByRunner: Record<string, { runner: Runner; base: number }> = {};
  if (onFirst?.id) currentByRunner[onFirst.id] = { runner: onFirst, base: 1 };
  if (onSecond?.id) currentByRunner[onSecond.id] = { runner: onSecond, base: 2 };
  if (onThird?.id) currentByRunner[onThird.id] = { runner: onThird, base: 3 };

  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      previousByRunner.current = currentByRunner;
      setScoringRunners([]);
      return;
    }
    const disappeared = Object.entries(previousByRunner.current)
      .filter(([id]) => !currentByRunner[id])
      .map(([, value]) => value)
      .sort((a, b) => b.base - a.base);
    const scoringCandidates = disappeared.map(({ runner, base }) => ({ runner, from: base }));
    if (play && classifyMlbPlay(play.text) === 'homer') {
      const batter = play.participants?.find(part => part.type === 'batter');
      if (batter?.id && !scoringCandidates.some(item => item.runner.id === batter.id)) {
        scoringCandidates.push({
          runner: { id: batter.id, name: batter.name, headshot: batter.headshot },
          from: 0,
        });
      }
    }
    if (play?.scoringPlay && play.scoreValue > 0 && scoringCandidates.length) {
      setScoringRunners(
        scoringCandidates.slice(0, play.scoreValue),
      );
      const timer = setTimeout(() => setScoringRunners([]), 1900);
      previousByRunner.current = currentByRunner;
      return () => clearTimeout(timer);
    }
    setScoringRunners([]);
    previousByRunner.current = currentByRunner;
  }, [play?.id, onFirst?.id, onSecond?.id, onThird?.id, size.width, size.height]);

  const routeToBase = (runnerId: string, targetBase: number) => {
    const from = previousByRunner.current[runnerId]?.base ?? 0;
    if (targetBase <= from) return [basePoints[targetBase]];
    return basePoints.slice(from + 1, targetBase + 1);
  };
  const isInitialSnapshot = size.width > 0 && !initializedRef.current;

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.width || height !== size.height) setSize({ width, height });
      }}
      style={{ ...StyleSheet.absoluteFillObject, zIndex: 7 }}
    >
      {size.width > 0 && size.height > 0
        ? [
            { runner: onFirst, pos: bases.first },
            { runner: onSecond, pos: bases.second },
            { runner: onThird, pos: bases.third },
          ].map(({ runner, pos }, idx) => runner ? (
            <RunnerBase
              key={runner.id || idx}
              runner={runner}
              pos={pos}
              previousPos={isInitialSnapshot ? pos : basePoints[previousByRunner.current[runner.id]?.base ?? 0]}
              pathPoints={isInitialSnapshot ? [pos] : routeToBase(runner.id, idx + 1)}
              radius={17}
              dark={dark}
              animationDelay={isInitialSnapshot ? 0 : 60}
              animationDuration={isInitialSnapshot ? 0 : 520}
            />
          ) : null)
        : null}
      {size.width > 0 && scoringRunners.map(({ runner, from }) => (
        <RunnerBase
          key={`score-${play?.id}-${runner.id}`}
          runner={runner}
          pos={bases.home}
          previousPos={basePoints[from]}
          pathPoints={basePoints.slice(from + 1, 5)}
          radius={17}
          dark={dark}
          animationDelay={60}
          animationDuration={480}
        />
      ))}
    </View>
  );
}

function isMlbInningBreak(description: string): boolean {
  return /\b(middle|mid\.?|end)\b.*\b\d+(st|nd|rd|th)?\b|between innings|side retired|end of inning|third out/i.test(description);
}

function compactPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function BetweenInningsMlbView({
  summary, plays, dark, transitionDescription,
}: {
  summary: GameSummary;
  plays: Play[];
  dark: boolean;
  transitionDescription?: string;
}) {
  const description = transitionDescription || summary.status.description || '';
  const isFinal = /final/i.test(summary.status.description || description);
  if (isFinal) {
    const awayScore = Number(summary.away.score || 0);
    const homeScore = Number(summary.home.score || 0);
    const winner = homeScore > awayScore ? summary.home : summary.away;
    const loser = homeScore > awayScore ? summary.away : summary.home;
    return (
      <View style={{ backgroundColor: dark ? '#1c1c1e' : '#fff', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: dark ? '#303033' : '#dadce0', paddingVertical: 26, paddingHorizontal: 16, alignItems: 'center', gap: 10 }}>
        {winner.team.logo ? <Image source={{ uri: dark ? (winner.team.logoDark ?? winner.team.logo) : winner.team.logo }} style={{ width: 46, height: 46 }} contentFit="contain" /> : null}
        <Text style={{ color: dark ? '#fff' : '#202124', fontSize: 24, fontFamily: F.black }}>
          {winner.team.abbreviation} WINS
        </Text>
        <Text style={{ color: dark ? '#a1a1a6' : '#5f6368', fontSize: 16, fontFamily: F.bold }}>
          {winner.score} - {loser.score}
        </Text>
      </View>
    );
  }
  const isMiddle = /\b(middle|mid\.?)\b/i.test(description);
  const battingTeam = isMiddle ? summary.home : summary.away;
  const defenseTeam = isMiddle ? summary.away : summary.home;
  const battingData = summary.playerTeams.find(t => t.teamId === battingTeam.team.id);
  const defenseData = summary.playerTeams.find(t => t.teamId === defenseTeam.team.id);
  const pitcherData = summary.pitcherTeams?.find(t => t.teamId === defenseTeam.team.id);
  const lineup = [...(battingData?.athletes ?? [])]
    .filter(a => a.starter || a.battingOrder)
    .sort((a, b) => (a.battingOrder ?? 99) - (b.battingOrder ?? 99));
  const lastBatterId = plays
    .flatMap(p => p.participants ?? [])
    .find(p => p.type === 'batter' && p.id)?.id;
  const lastIndex = lineup.findIndex(a => a.id === lastBatterId);
  const dueUp = lineup.length
    ? [1, 2, 3].map(offset => lineup[(lastIndex + offset) % lineup.length])
    : [];
  const defenseAthletes = [...(defenseData?.athletes ?? [])];
  const defenders = defenseAthletes.filter(a => a.starter);
  const currentPitcher = [...(pitcherData?.athletes ?? [])].reverse().find(a =>
    a.stats.IP && a.stats.IP !== '--' && a.stats.IP !== '0.0',
  ) ?? pitcherData?.athletes?.[0];
  const byPosition = (position: string) => {
    if (position === 'P') return currentPitcher;
    const pool = defenders.length ? defenders : defenseAthletes;
    const aliases: Record<string, string[]> = {
      C: ['C', 'CA'],
      '1B': ['1B', '1'],
      '2B': ['2B', '2'],
      '3B': ['3B', '3'],
      SS: ['SS', '6'],
      LF: ['LF', '7'],
      CF: ['CF', '8'],
      RF: ['RF', '9'],
    };
    return pool.find(a => (aliases[position] ?? [position]).includes(a.position.toUpperCase()));
  };
  const positions = [
    { key: 'CF', left: '50%', top: '24%' },
    { key: 'LF', left: '32%', top: '39%' },
    { key: 'RF', left: '68%', top: '39%' },
    { key: 'SS', left: '44%', top: '55%' },
    { key: '2B', left: '56%', top: '55%' },
    { key: '3B', left: '40%', top: '66%' },
    { key: '1B', left: '60%', top: '66%' },
    { key: 'P', left: '50%', top: '67%' },
    { key: 'C', left: '50%', top: '88%' },
  ] as const;
  const fg = dark ? '#fff' : '#202124';
  const muted = dark ? '#a1a1a6' : '#5f6368';
  const panel = dark ? '#1c1c1e' : '#fff';
  const divider = dark ? '#303033' : '#dadce0';

  return (
    <View style={{ backgroundColor: panel, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: divider }}>
      <View style={{ paddingTop: 14, paddingHorizontal: 12, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          {battingTeam.team.logo ? (
            <Image source={{ uri: battingTeam.team.logo }} style={{ width: 24, height: 24 }} contentFit="contain" />
          ) : null}
          <Text style={{ color: fg, fontSize: 19, fontFamily: F.black }}>
            {battingTeam.team.abbreviation} DUE UP
          </Text>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {dueUp.map((player, index) => {
            const lineupIndex = lineup.findIndex(a => a.id === player.id);
            return (
              <View key={player.id} style={{
                flex: 1,
                alignItems: 'center',
                borderLeftWidth: index ? 1 : 0,
                borderLeftColor: divider,
                paddingHorizontal: 4,
              }}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#0A66C2', fontSize: 14, fontFamily: F.bold }}>
                  {compactPlayerName(player.name)} ({lineupIndex + 1})
                </Text>
                <Text style={{ color: fg, fontSize: 13, fontFamily: F.black, marginTop: 3 }}>
                  {player.stats.H ?? '0'}-{player.stats.AB ?? '0'}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: divider, paddingTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {defenseTeam.team.logo ? (
            <Image source={{ uri: defenseTeam.team.logo }} style={{ width: 24, height: 24 }} contentFit="contain" />
          ) : null}
          <Text style={{ color: fg, fontSize: 19, fontFamily: F.black }}>
            {defenseTeam.team.abbreviation} DEFENSE
          </Text>
        </View>
        <View style={{ height: 255, marginTop: 4, position: 'relative' }}>
          <MlbBroadcastFieldSvg teamAbbr={summary.home.team.abbreviation} dark={dark} />
          {positions.map(pos => {
            const player = byPosition(pos.key);
            if (!player) return null;
            return (
              <Text key={pos.key} numberOfLines={1} style={{
                position: 'absolute',
                left: pos.left as any,
                top: pos.top as any,
                transform: [{ translateX: -55 }],
                width: 110,
                color: '#fff',
                fontSize: 11,
                fontFamily: F.bold,
                textAlign: 'center',
                textShadowColor: '#000',
                textShadowRadius: 3,
              }}>
                {compactPlayerName(player.name)}
              </Text>
            );
          })}
          {!defenders.length ? (
            <Text style={{ position: 'absolute', alignSelf: 'center', top: '50%', color: muted, fontFamily: F.bold }}>
              Defensive alignment unavailable
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Court / Field / Rink / Diamond — animated, with stadium seating around.
// Each sport renders an SVG playing surface + a perimeter "crowd" + a
// centered, breathing team logo. When `isLive` is true a subtle spotlight
// sweep and pulsing accent kick in.
// ---------------------------------------------------------------------------

// ─────────────────────────────────────────────────────────────────────
// Stadium seating — sport-specific, drawn to match real stadium layouts
// from a top-down broadcast view.
// ─────────────────────────────────────────────────────────────────────

// Seat row colors — back rows darker, front rows brighter (toward field)
const SEAT_TIERS = ['#4a4a52', '#5d5d68', '#74747f', '#8a8a97', '#a0a0ae', '#b8b8c6'];
const HIGHLIGHT_SEAT = '#d8d8e4';

// Draw a row of small seat marks along a path defined by interpolating
// between two points. Returns SVG rect elements.
function seatRow(
  fromX: number, fromY: number, toX: number, toY: number,
  color: string, step: number, rowIdx: number, keyPrefix: string,
  seatW = 3.2, seatH = 2.2,
): any[] {
  const elements: any[] = [];
  const dx = toX - fromX, dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  const count = Math.max(1, Math.floor(dist / step));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = fromX + dx * t - seatW / 2;
    const y = fromY + dy * t - seatH / 2;
    const fill = (i + rowIdx * 7) % 5 === 0 ? HIGHLIGHT_SEAT : color;
    elements.push(
      <Rect key={`${keyPrefix}-${i}`} x={x} y={y} width={seatW} height={seatH}
        fill={fill} rx={0.4} />
    );
  }
  return elements;
}

// Draw a curved row of seats along an arc segment
function seatArc(
  cx: number, cy: number, r: number,
  startAngle: number, endAngle: number,
  color: string, step: number, rowIdx: number, keyPrefix: string,
): any[] {
  const elements: any[] = [];
  const arcLen = Math.abs(endAngle - startAngle) * r;
  const count = Math.max(1, Math.floor(arcLen / step));
  const seatW = 3.2, seatH = 2.2;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const ang = startAngle + (endAngle - startAngle) * t;
    const x = cx + r * Math.cos(ang) - seatW / 2;
    const y = cy + r * Math.sin(ang) - seatH / 2;
    const fill = (i + rowIdx * 7) % 5 === 0 ? HIGHLIGHT_SEAT : color;
    elements.push(
      <Rect key={`${keyPrefix}-${i}`} x={x} y={y} width={seatW} height={seatH}
        fill={fill} rx={0.4} />
    );
  }
  return elements;
}

// MLB — horseshoe stadium bowl. Reads like a real ballpark aerial:
//   • Solid concrete bowl wrapping behind home plate + up the foul lines
//   • 3 visible deck tiers (lower bowl / club / upper deck) shown as bands
//   • Open outfield (just dark — wall + bleachers area is beyond)
//   • Inner "front row" highlight closest to the field
function renderBaseballSeating(viewW: number, viewH: number) {
  const elements: any[] = [];

  // Dark sky/ground around the whole viewport
  elements.push(<Rect key="bg" x={0} y={0} width={viewW} height={viewH} fill="#0a0a0c" />);

  const HP   = { x: 470, y: 460 };
  const FP_L = { x: 145, y: 135 };
  const FP_R = { x: 795, y: 135 };

  // Outward-perpendicular unit vectors (pointing away from the field)
  const dxL = FP_L.x - HP.x, dyL = FP_L.y - HP.y;
  const lenL = Math.hypot(dxL, dyL);
  const oxL = dyL / lenL,  oyL = -dxL / lenL;            // (-0.707, +0.707) for left

  const dxR = FP_R.x - HP.x, dyR = FP_R.y - HP.y;
  const lenR = Math.hypot(dxR, dyR);
  const oxR = -dyR / lenR, oyR =  dxR / lenR;            // (+0.707, +0.707) for right

  // Build a filled stadium bowl as 3 nested layers (decks)
  // Each "deck" is drawn as a wedge that wraps from FP_L around HP to FP_R.
  // Inner deck = closest to field (brightest), outer = farthest (darkest)
  const decks = [
    { offIn: 0,   offOut: 28, color: '#3a3a45' },     // lower bowl
    { offIn: 30,  offOut: 55, color: '#2a2a35' },     // club level
    { offIn: 57,  offOut: 85, color: '#1c1c25' },     // upper deck
  ];
  for (const d of decks) {
    // Corners of this deck — inner edge near field, outer edge farther out
    const Li = { x: FP_L.x + oxL * d.offIn,  y: FP_L.y + oyL * d.offIn };
    const Lo = { x: FP_L.x + oxL * d.offOut, y: FP_L.y + oyL * d.offOut };
    const Ri = { x: FP_R.x + oxR * d.offIn,  y: FP_R.y + oyR * d.offIn };
    const Ro = { x: FP_R.x + oxR * d.offOut, y: FP_R.y + oyR * d.offOut };

    // Behind-HP arc centers/radii — semicircle wrapping HP
    const hpIn  = Math.hypot(HP.x + oxL * d.offIn  - HP.x, HP.y + oyL * d.offIn  - (HP.y - 8));
    const hpOut = Math.hypot(HP.x + oxL * d.offOut - HP.x, HP.y + oyL * d.offOut - (HP.y - 8));

    // Use 2 line segments + 2 arcs (large-arc / sweep flags chosen to wrap below HP)
    elements.push(
      <Path
        key={`deck-${d.offIn}`}
        d={`M ${Li.x},${Li.y}
            L ${HP.x + oxL * d.offIn},${HP.y + oyL * d.offIn}
            A ${hpIn},${hpIn} 0 0,0 ${HP.x + oxR * d.offIn},${HP.y + oyR * d.offIn}
            L ${Ri.x},${Ri.y}
            L ${Ro.x},${Ro.y}
            L ${HP.x + oxR * d.offOut},${HP.y + oyR * d.offOut}
            A ${hpOut},${hpOut} 0 0,1 ${HP.x + oxL * d.offOut},${HP.y + oyL * d.offOut}
            L ${Lo.x},${Lo.y}
            Z`}
        fill={d.color}
      />
    );
  }

  // (No bright front-row rail — it was reading as a hard white line across
  // the seats. The deck tiers + fan dots already define the bowl shape.)

  // Visible seat texture — small "fan" dots scattered in the lower deck
  // (brightest tier). Suggests packed seats without looking like noise.
  const fanColor = '#cdcdd8';
  for (let r = 0; r < 4; r++) {                            // 4 sub-rows in lower deck
    const off = 6 + r * 6;
    const stepLeft = 6;
    // Along left foul line
    const dxLen = HP.x - FP_L.x, dyLen = HP.y - FP_L.y;
    const segLen = Math.hypot(dxLen, dyLen);
    const fanCount = Math.floor(segLen / stepLeft);
    for (let i = 0; i < fanCount; i++) {
      const t = i / fanCount;
      const baseX = FP_L.x + dxLen * t;
      const baseY = FP_L.y + dyLen * t;
      const x = baseX + oxL * off;
      const y = baseY + oyL * off;
      const bright = (i + r) % 4 === 0 ? '#ffffff' : fanColor;
      elements.push(<Rect key={`fL-${r}-${i}`} x={x - 1} y={y - 0.8} width={2} height={1.6} fill={bright} opacity={0.8} />);
    }
    // Along right foul line (mirror)
    const dxLen2 = FP_R.x - HP.x, dyLen2 = FP_R.y - HP.y;
    for (let i = 0; i < fanCount; i++) {
      const t = i / fanCount;
      const baseX = HP.x + dxLen2 * t;
      const baseY = HP.y + dyLen2 * t;
      const x = baseX + oxR * off;
      const y = baseY + oyR * off;
      const bright = (i + r) % 4 === 0 ? '#ffffff' : fanColor;
      elements.push(<Rect key={`fR-${r}-${i}`} x={x - 1} y={y - 0.8} width={2} height={1.6} fill={bright} opacity={0.8} />);
    }
    // Behind home plate arc
    const radius = Math.hypot(HP.x + oxL * off - HP.x, HP.y + oyL * off - (HP.y - 8));
    const angStart = Math.atan2(HP.y + oyL * off - (HP.y - 8), HP.x + oxL * off - HP.x);
    const angEnd   = Math.atan2(HP.y + oyR * off - (HP.y - 8), HP.x + oxR * off - HP.x);
    const arcLen = Math.abs(angEnd - angStart) * radius;
    const arcCount = Math.floor(arcLen / 6);
    for (let i = 0; i < arcCount; i++) {
      const t = i / arcCount;
      const ang = angStart + (angEnd - angStart) * t;
      const x = HP.x + radius * Math.cos(ang);
      const y = (HP.y - 8) + radius * Math.sin(ang);
      const bright = (i + r) % 4 === 0 ? '#ffffff' : fanColor;
      elements.push(<Rect key={`fHP-${r}-${i}`} x={x - 1} y={y - 0.8} width={2} height={1.6} fill={bright} opacity={0.8} />);
    }
  }

  return elements;
}

// Basketball arena — rectangular bowl with seating on all 4 sides curving
// into the corners. Court has more seats on the long sides (sidelines).
function renderBasketballSeating(viewW: number, viewH: number) {
  const elements: any[] = [];
  elements.push(<Rect key="bg" x={0} y={0} width={viewW} height={viewH} fill="#0a0a0c" />);

  // The basketball court is inset; seats wrap around it
  // Court area roughly: (60, 60) to (viewW-60, viewH-60)
  // Seats fill the area between viewport edge and court
  const courtPad = 60;
  const rowCount = SEAT_TIERS.length;
  for (let r = 0; r < rowCount; r++) {
    const inset = 4 + r * 8;
    const color = SEAT_TIERS[rowCount - 1 - r];
    // Top + bottom rows (full width)
    elements.push(...seatRow(
      inset + 30, inset, viewW - inset - 30, inset,
      color, 6, r, `T-${r}`,
    ));
    elements.push(...seatRow(
      inset + 30, viewH - inset, viewW - inset - 30, viewH - inset,
      color, 6, r, `B-${r}`,
    ));
    // Side rows
    elements.push(...seatRow(
      inset, inset + 30, inset, viewH - inset - 30,
      color, 6, r, `L-${r}`,
    ));
    elements.push(...seatRow(
      viewW - inset, inset + 30, viewW - inset, viewH - inset - 30,
      color, 6, r, `R-${r}`,
    ));
    // Rounded corners — small arcs in each corner
    [
      { cx: inset + 30, cy: inset + 30, sa: Math.PI, ea: Math.PI * 1.5 },           // TL
      { cx: viewW - inset - 30, cy: inset + 30, sa: -Math.PI/2, ea: 0 },            // TR
      { cx: viewW - inset - 30, cy: viewH - inset - 30, sa: 0, ea: Math.PI/2 },     // BR
      { cx: inset + 30, cy: viewH - inset - 30, sa: Math.PI/2, ea: Math.PI },       // BL
    ].forEach((c, ci) =>
      elements.push(...seatArc(c.cx, c.cy, 30, c.sa, c.ea, color, 6, r, `C-${ci}-${r}`))
    );
    void courtPad;
  }
  return elements;
}

// NFL — large oval bowl, sideline seating wraps around the end zones
function renderFootballSeating(viewW: number, viewH: number) {
  // Same shape as basketball but with deeper sidelines (more rows on long sides)
  return renderBasketballSeating(viewW, viewH);
}

// NHL — rectangular bowl with rounded corners, like basketball
function renderHockeySeating(viewW: number, viewH: number) {
  return renderBasketballSeating(viewW, viewH);
}

// Dispatcher — picks the right sport-specific seating
function renderStadiumSeating(sport: string, viewW: number, viewH: number) {
  if (sport === 'mlb') return renderBaseballSeating(viewW, viewH);
  if (sport === 'nfl') return renderFootballSeating(viewW, viewH);
  if (sport === 'nhl') return renderHockeySeating(viewW, viewH);
  return renderBasketballSeating(viewW, viewH);
}

// Rain — continuous diagonal streaks covering the full container.
// Each streak gets its own animated translate that loops independently,
// using a unique duration + delay so the rain never appears stagnant.
function RainStreak({ index, containerH }: { index: number; containerH: number }) {
  const left = ((index * 17) % 100);              // spread horizontally
  const len  = 14 + (index % 6) * 4;              // varied lengths
  const dur  = 700 + (index % 5) * 150;           // each falls at its own speed
  const delay = (index * 53) % 800;               // staggered start
  const opacity = 0.4 + (index % 3) * 0.15;

  const y = useSharedValue(-20);
  useEffect(() => {
    y.value = withDelay(delay,
      withRepeat(withTiming(containerH + 30, { duration: dur }), -1, false)
    );
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { rotate: '18deg' }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: 'absolute',
        left: `${left}%`,
        top: 0,
        width: 1.5,
        height: len,
        backgroundColor: `rgba(190, 215, 255, ${opacity})`,
        borderRadius: 1,
      }, style]}
    />
  );
}

function RainOverlay({ height }: { height: number }) {
  const indices = Array.from({ length: 80 }, (_, i) => i);
  return (
    <View pointerEvents="none" style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 4, overflow: 'hidden',
    }}>
      {/* Atmospheric darken veil — sells the storm */}
      <View style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(30, 45, 70, 0.3)',
      }} />
      {indices.map(i => <RainStreak key={i} index={i} containerH={height} />)}
    </View>
  );
}

function CourtView({
  sport, homeLogo, homeColor, awayColor, homeTeamAbbr, isLive, isDelayed, latestPlay, runnerStatePlay,
}: {
  sport: string;
  homeLogo?: string;
  homeColor?: string;
  awayColor?: string;
  homeTeamAbbr?: string;
  isLive?: boolean;
  isDelayed?: boolean;          // rain/weather delay — overlay rain
  latestPlay?: Play | null;     // most recent play for ESPN-style animations
  runnerStatePlay?: Play | null;// most recent reliable MLB base-state snapshot
}) {
  const darkSurface = useColorScheme() === 'dark';
  // Ambient breathing animation for the centered logo
  const breathe = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(
      withSequence(withTiming(1, { duration: 2200 }), withTiming(0, { duration: 2200 })),
      -1, false,
    );
  }, []);

  // Live-game spotlight sweep
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (!isLive) { sweep.value = 0; return; }
    sweep.value = withRepeat(withTiming(1, { duration: 3600 }), -1, false);
  }, [isLive]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.98 + breathe.value * 0.04 }],
    opacity: 0.85 + breathe.value * 0.15,
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    left: `${-30 + sweep.value * 130}%` as any,
    opacity: isLive ? 0.18 : 0,
  }));

  // Live-glow ring around the logo
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!isLive) { pulse.value = 0; return; }
    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })),
      -1, false,
    );
  }, [isLive]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: isLive ? 0.4 + pulse.value * 0.5 : 0,
    transform: [{ scale: 1 + pulse.value * 0.15 }],
  }));

  // ───────────── NBA — basketball court ─────────────
  if (sport === 'nba') {
    const tint   = homeColor ? `#${homeColor}` : '#8B6914';
    const tint25 = `${tint}40`;
    const LBX = 52.5, RBX = 887.5, CY = 250;

    return (
      <View style={[courtStyles.container, courtStyles.containerTall]}>
        {/* Outer crowd / arena */}
        <View style={[courtStyles.arena, { backgroundColor: '#0a0a0a' }]}>
          <Svg width="100%" height="100%" viewBox="0 0 940 620" preserveAspectRatio="xMidYMid meet">
            {/* Stadium floor + seating dots */}
            <Rect x={0} y={0} width={940} height={620} fill="#0a0a0a" />
            {renderStadiumSeating('nba', 940, 620)}

            {/* Inset court (offset by 60 on all sides) */}
            <G transform="translate(60, 60)">
              <Rect x={0} y={0} width={820} height={500} fill="#C8A96E" rx={4} />

              {/* Paint zones */}
              <Rect x={0} y={170} width={170} height={160} fill={tint25} stroke={tint} strokeWidth={3} />
              <Rect x={650} y={170} width={170} height={160} fill={tint25} stroke={tint} strokeWidth={3} />

              {/* FT arcs */}
              <Path d="M 170,190 A 60,60 0 0,1 170,310" fill="none" stroke={tint} strokeWidth={2.5} />
              <Path d="M 170,190 A 60,60 0 0,0 170,310" fill="none" stroke={tint} strokeWidth={2} strokeDasharray="10,8" />
              <Path d="M 650,190 A 60,60 0 0,0 650,310" fill="none" stroke={tint} strokeWidth={2.5} />
              <Path d="M 650,190 A 60,60 0 0,1 650,310" fill="none" stroke={tint} strokeWidth={2} strokeDasharray="10,8" />

              {/* Backboards + rims */}
              <Line x1={20} y1={220} x2={20} y2={280} stroke={tint} strokeWidth={5} strokeLinecap="round" />
              <Line x1={800} y1={220} x2={800} y2={280} stroke={tint} strokeWidth={5} strokeLinecap="round" />
              <Circle cx={32} cy={CY} r={12} fill="none" stroke="#FF7A00" strokeWidth={3} />
              <Circle cx={788} cy={CY} r={12} fill="none" stroke="#FF7A00" strokeWidth={3} />

              {/* Restricted-area arcs */}
              <Path d={`M 32 ${CY - 40} A 40,40 0 0,1 32 ${CY + 40}`} fill="none" stroke={tint} strokeWidth={2} />
              <Path d={`M 788 ${CY - 40} A 40,40 0 0,0 788 ${CY + 40}`} fill="none" stroke={tint} strokeWidth={2} />

              {/* 3pt lines */}
              <Line x1={0}  y1={30}  x2={123} y2={30}  stroke={tint} strokeWidth={2.5} />
              <Line x1={0}  y1={470} x2={123} y2={470} stroke={tint} strokeWidth={2.5} />
              <Line x1={697} y1={30}  x2={820} y2={30}  stroke={tint} strokeWidth={2.5} />
              <Line x1={697} y1={470} x2={820} y2={470} stroke={tint} strokeWidth={2.5} />
              <Path d="M 123,30 A 238,238 0 0,1 123,470" fill="none" stroke={tint} strokeWidth={2.5} />
              <Path d="M 697,30 A 238,238 0 0,0 697,470" fill="none" stroke={tint} strokeWidth={2.5} />

              {/* Center line + single center circle (no inner jump circle to clash with logo) */}
              <Line x1={410} y1={0} x2={410} y2={500} stroke={tint} strokeWidth={2.5} />
              <Circle cx={410} cy={250} r={60} fill="none" stroke={tint} strokeWidth={2.5} />

              <Rect x={1} y={1} width={818} height={498} fill="none" stroke={tint} strokeWidth={3} />
            </G>
          </Svg>

          {/* Centered logo */}
          <View style={courtStyles.logoOverlay} pointerEvents="none">
            {homeLogo
              ? <Animated.View style={logoStyle}>
                  <Image source={{ uri: homeLogo }} style={courtStyles.centerLogoBig} contentFit="contain" />
                </Animated.View>
              : <Text style={courtStyles.courtLabel}>NBA</Text>}
          </View>

          {isDelayed && <RainOverlay height={210} />}
        </View>
      </View>
    );
  }

  // ───────────── NFL — football field ─────────────
  if (sport === 'nfl') {
    const tint = homeColor ? `#${homeColor}` : '#013369';
    return (
      <View style={[courtStyles.container, courtStyles.containerTall]}>
        <View style={[courtStyles.arena, { backgroundColor: '#0c1810' }]}>
          <Svg width="100%" height="100%" viewBox="0 0 940 620" preserveAspectRatio="xMidYMid meet">
            <Rect x={0} y={0} width={940} height={620} fill="#0c1810" />
            {renderStadiumSeating('nfl', 940, 620)}

            <G transform="translate(60, 60)">
              {/* Field grass stripes (alternating darker/lighter) */}
              {[0,1,2,3,4,5,6,7,8,9].map(i => (
                <Rect key={i} x={i * 82} y={0} width={82} height={500}
                  fill={i % 2 === 0 ? '#2b6b2b' : '#338033'} />
              ))}
              {/* End zones */}
              <Rect x={0} y={0} width={82} height={500} fill={tint} opacity={0.85} />
              <Rect x={738} y={0} width={82} height={500} fill={tint} opacity={0.85} />

              {/* Yard lines */}
              {[82, 164, 246, 328, 410, 492, 574, 656, 738].map((x) => (
                <Line key={x} x1={x} y1={0} x2={x} y2={500} stroke="#fff" strokeWidth={2} opacity={0.75} />
              ))}
              {/* Yard numbers */}
              {[[164,"10"],[246,"20"],[328,"30"],[410,"50"],[492,"30"],[574,"20"],[656,"10"]].map(([x,n]) => (
                <SvgText key={String(x)} x={Number(x)} y={260} fill="#fff" fontSize={32} fontWeight="900"
                  textAnchor="middle" opacity={0.55}>{n as string}</SvgText>
              ))}

              {/* Hash marks */}
              {[120, 200, 280, 360, 450, 540, 620, 700].map(x => (
                <G key={x}>
                  <Line x1={x} y1={180} x2={x} y2={195} stroke="#fff" strokeWidth={1.5} opacity={0.6} />
                  <Line x1={x} y1={305} x2={x} y2={320} stroke="#fff" strokeWidth={1.5} opacity={0.6} />
                </G>
              ))}

              {/* Field border */}
              <Rect x={1} y={1} width={818} height={498} fill="none" stroke="#fff" strokeWidth={2} opacity={0.8} />
            </G>
          </Svg>

          <View style={courtStyles.logoOverlay} pointerEvents="none">
            {homeLogo
              ? <Animated.View style={logoStyle}>
                  <Image source={{ uri: homeLogo }} style={courtStyles.centerLogoBig} contentFit="contain" />
                </Animated.View>
              : <Text style={courtStyles.courtLabel}>NFL</Text>}
          </View>

          {latestPlay && <SportPlayAnimation sport="nfl" play={latestPlay} />}
          {isDelayed && <RainOverlay height={210} />}
        </View>
      </View>
    );
  }

  // ───────────── MLB — baseball stadium (TV broadcast angle) ─────────────
  if (sport === 'mlb') {
    const tint = homeColor ? `#${homeColor}` : '#002D72';
    const FIELD_OFFSET_Y = 38;
    // Geometry — home plate sits higher up to leave room for the stadium bowl
    // behind it. Field shrinks slightly so the seats are clearly visible.
    const HP_X = 470, HP_Y = 460;          // home plate
    const B1_X = 594, B1_Y = 344;          // first base
    const B2_X = 470, B2_Y = 266;          // second base
    const B3_X = 346, B3_Y = 344;          // third base
    const IN_CX = 470, IN_CY = 330, IN_R = 112;
    return (
      <View style={[courtStyles.container, courtStyles.containerTall]}>
        <View style={[courtStyles.arena, { backgroundColor: '#0a0a0a' }]}>
          <Svg width="100%" height="100%" viewBox="0 0 940 580" preserveAspectRatio="xMidYMid meet">
            <Rect x={0} y={0} width={940} height={580} fill="#0a0a0a" />

            {/* Replicated ballpark backdrop — stadium bowl + signature landmarks
                (Green Monster, Wrigley scoreboard, McCovey Cove…). Clipped to
                the region between the foul poles and the outfield wall arc so it
                hugs the wall and never overflows into the corners. The clip's
                bottom edge follows the warning-track arc (in screen coords, the
                field group is offset by +38). */}
            <Defs>
              <ClipPath id="cvBallparkClip">
                <Path d={`M 150,216 L 150,16 L 790,16 L 790,216 Q 470,136 150,216 Z`} />
              </ClipPath>
            </Defs>
            <MlbBallparkBackdrop teamAbbr={homeTeamAbbr} dark={darkSurface} baseOnly />
            <G clipPath="url(#cvBallparkClip)">
              <MlbBallparkBackdrop teamAbbr={homeTeamAbbr} dark={darkSurface} featuresOnly featureLift={0} />
            </G>

            <G transform={`translate(0 ${FIELD_OFFSET_Y})`}>
            {/* Field (fan-shaped) — outfield arc + foul territory */}
            {/* Outfield grass (large fan from home plate) */}
            <Path
              d={`M ${HP_X},${HP_Y}
                  L 150,160
                  Q 470,96 790,160
                  L ${HP_X},${HP_Y} Z`}
              fill="#2b6b2b"
            />
            {/* (No green outside the foul lines — that area is stadium seats) */}

            {/* Warning track — tan arc along the outfield wall */}
            <Path
              d={`M 150,160 Q 470,96 790,160`}
              fill="none" stroke="#a98555" strokeWidth={14} opacity={1}
            />

            {/* No painted foul lines — the field edge (where green meets the
               stadium bowl / warning track) already shows the boundary */}

            {/* Infield dirt with a same-color grass cutout, matching the
               broadcast field reference without creating a separate green box. */}
            <Path
              d={`M ${HP_X},${HP_Y}
                  L ${B1_X},${B1_Y}
                  L 594,318
                  C 560,274 520,252 470,246
                  C 420,252 380,274 346,318
                  L ${B3_X},${B3_Y}
                  L ${HP_X},${HP_Y} Z`}
              fill="#a98555"
              opacity={0.98}
            />

            {/* Infield grass — same green as the outfield, leaving only a dirt path band. */}
            <Path
              d={`M ${IN_CX},${IN_CY + 114}
                  C ${IN_CX + 30},${IN_CY + 82} ${IN_CX + 72},${IN_CY + 48} ${IN_CX + 92},${IN_CY + 22}
                  C ${IN_CX + 78},${IN_CY - 4} ${IN_CX + 46},${IN_CY - 28} ${IN_CX + 16},${IN_CY - 40}
                  C ${IN_CX + 8},${IN_CY - 32} ${IN_CX - 8},${IN_CY - 32} ${IN_CX - 16},${IN_CY - 40}
                  C ${IN_CX - 46},${IN_CY - 28} ${IN_CX - 78},${IN_CY - 4} ${IN_CX - 92},${IN_CY + 22}
                  C ${IN_CX - 72},${IN_CY + 48} ${IN_CX - 30},${IN_CY + 82} ${IN_CX},${IN_CY + 114}
                  Z`}
              fill="#2b6b2b"
            />

            <Path d={`M ${HP_X},${HP_Y} L 150,160`} fill="none" stroke="#a98555" strokeWidth={16} opacity={0.98} />
            <Path d={`M ${HP_X},${HP_Y} L 790,160`} fill="none" stroke="#a98555" strokeWidth={16} opacity={0.98} />
            <Path d={`M ${HP_X},${HP_Y} L 150,160`} fill="none" stroke="#fff" strokeWidth={2} opacity={0.82} />
            <Path d={`M ${HP_X},${HP_Y} L 790,160`} fill="none" stroke="#fff" strokeWidth={2} opacity={0.82} />

            {/* Pitcher's mound */}
            <Circle cx={HP_X} cy={364} r={20} fill="#b8945f" stroke="#fff" strokeWidth={1.5} opacity={0.9} />
            <Rect x={HP_X - 8} y={362} width={16} height={4} fill="#fff" />

            {/* Bases (white squares rotated 45deg) */}
            {[
              [HP_X, HP_Y, 7],
              [B1_X, B1_Y, 9],
              [B2_X, B2_Y, 9],
              [B3_X, B3_Y, 9],
            ].map(([x, y, s], i) => (
              <Rect
                key={i}
                x={x - s / 2} y={y - s / 2}
                width={s} height={s}
                fill="#fff"
                transform={`rotate(45, ${x}, ${y})`}
              />
            ))}

            {/* Catcher's box behind home plate */}
            <Path d={`M ${HP_X - 18},${HP_Y + 6} L ${HP_X - 18},${HP_Y + 20} L ${HP_X + 18},${HP_Y + 20} L ${HP_X + 18},${HP_Y + 6}`}
              fill="none" stroke="#fff" strokeWidth={1.2} opacity={0.6} />

            </G>
            {String(homeTeamAbbr || '').toUpperCase() === 'SF' ? (
              <G>
                <Line x1={150} y1={96} x2={150} y2={198} stroke="#ffde42" strokeWidth={8} strokeLinecap="square" />
                <Line x1={790} y1={96} x2={790} y2={198} stroke="#ffde42" strokeWidth={8} strokeLinecap="square" />
              </G>
            ) : null}
          </Svg>

          {/* Home logo in center field. Rendered as a normal overlay image
              (not an SVG <image>, which is unreliable on web) positioned high
              in the outfield so it sits beyond second base. */}
          {homeLogo ? (
            <View style={courtStyles.logoOverlayMlb} pointerEvents="none">
              <Image source={{ uri: homeLogo }} style={courtStyles.centerLogoMed} contentFit="contain" />
            </View>
          ) : null}

          <BaseballFieldRunners
            play={runnerStatePlay ?? latestPlay ?? null}
            dark={darkSurface}
          />

          {/* ESPN-style ball-flight / strikeout / walk / HR animation */}
          {latestPlay && <BaseballPlayAnimation play={latestPlay} />}

          {isDelayed && <RainOverlay height={210} />}
        </View>
      </View>
    );
  }

  // ───────────── NHL — ice rink ─────────────
  if (sport === 'nhl') {
    const tint = homeColor ? `#${homeColor}` : '#003087';
    return (
      <View style={[courtStyles.container, courtStyles.containerTall]}>
        <View style={[courtStyles.arena, { backgroundColor: '#0a0a0a' }]}>
          <Svg width="100%" height="100%" viewBox="0 0 940 620" preserveAspectRatio="xMidYMid meet">
            <Rect x={0} y={0} width={940} height={620} fill="#0a0a0a" />
            {renderStadiumSeating('nhl', 940, 620)}

            <G transform="translate(60, 60)">
              {/* Ice — rounded corners */}
              <Rect x={0} y={0} width={820} height={500} fill="#e8f4fd" rx={70} />

              {/* Center red line */}
              <Line x1={410} y1={0} x2={410} y2={500} stroke="#CC0000" strokeWidth={6} />
              {/* Blue lines */}
              <Line x1={282} y1={0} x2={282} y2={500} stroke="#003087" strokeWidth={6} />
              <Line x1={538} y1={0} x2={538} y2={500} stroke="#003087" strokeWidth={6} />
              {/* Goal lines */}
              <Line x1={60}  y1={20} x2={60}  y2={480} stroke="#CC0000" strokeWidth={2} />
              <Line x1={760} y1={20} x2={760} y2={480} stroke="#CC0000" strokeWidth={2} />

              {/* Center face-off dot + circle */}
              <Circle cx={410} cy={250} r={60} fill="none" stroke="#003087" strokeWidth={2} />
              <Circle cx={410} cy={250} r={4}  fill="#003087" />

              {/* End-zone face-off circles + dots */}
              {[
                [150, 150], [150, 350], [670, 150], [670, 350],
              ].map(([x, y]) => (
                <G key={`${x}-${y}`}>
                  <Circle cx={x} cy={y} r={45} fill="none" stroke="#CC0000" strokeWidth={2} />
                  <Circle cx={x} cy={y} r={3} fill="#CC0000" />
                </G>
              ))}
              {/* Neutral-zone face-off dots */}
              {[[340, 150], [340, 350], [480, 150], [480, 350]].map(([x, y]) => (
                <Circle key={`${x}-${y}`} cx={x} cy={y} r={3} fill="#CC0000" />
              ))}

              {/* Goal creases */}
              <Path d="M 60,225 A 25,25 0 0,1 60,275 Z" fill="#9ec5f2" stroke="#CC0000" strokeWidth={1.5} />
              <Path d="M 760,225 A 25,25 0 0,0 760,275 Z" fill="#9ec5f2" stroke="#CC0000" strokeWidth={1.5} />

              {/* Rink border */}
              <Rect x={1} y={1} width={818} height={498} fill="none" stroke="#444" strokeWidth={3} rx={70} />
            </G>
          </Svg>

          <View style={courtStyles.logoOverlay} pointerEvents="none">
            {homeLogo
              ? <Animated.View style={logoStyle}>
                  <Image source={{ uri: homeLogo }} style={courtStyles.centerLogoBig} contentFit="contain" />
                </Animated.View>
              : <Text style={[courtStyles.courtLabel, { color: '#003087' }]}>NHL</Text>}
          </View>

          {latestPlay && <SportPlayAnimation sport="nhl" play={latestPlay} />}
          {isDelayed && <RainOverlay height={210} />}
        </View>
      </View>
    );
  }

  return <View style={[courtStyles.container, { backgroundColor: '#333' }]} />;
}

const courtStyles = StyleSheet.create({
  container: {
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  containerTall: { height: 210 },          // taller to fit stadium + court
  arena: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  logoOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  logoOverlayTop: {
    position: 'absolute',
    top: 16, left: 0, right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  // MLB logo sits in the stadium "sky" above the outfield (not over the field)
  logoOverlayMlb: {
    // Center field grass — clear of both the scoreboard/wall band and second base.
    position: 'absolute',
    top: '34.5%',
    left: '50%',
    width: 24,
    height: 24,
    marginLeft: -12,
    zIndex: 5,
  },
  centerLogoBig: { width: 76, height: 76 },
  centerLogoMed: { width: 24, height: 24 },
  courtLabel: { fontSize: 28, fontFamily: 'System', fontWeight: '900', color: 'rgba(255,255,255,0.15)', letterSpacing: 4, position: 'absolute' },

  // Live-game spotlight that sweeps across the surface
  spotlight: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    width: '35%',
    backgroundColor: '#fff',
    transform: [{ skewX: '-18deg' }],
    zIndex: 2,
  },
  // Pulsing glow ring under the centered logo
  glowRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    top: '50%',
    left: '50%',
    marginTop: -65,
    marginLeft: -65,
    zIndex: 3,
  },
  glowRingTop: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    top: 16 + 30 - 45,
    left: '50%',
    marginLeft: -45,
    zIndex: 3,
  },
});

// ---------------------------------------------------------------------------
// Animated score display for plays tab
// ---------------------------------------------------------------------------

function ScoreFlash({ value, color, text }: { value: number; color: string; text: string }) {
  const scale = useSharedValue(1);
  const prevVal = useRef(value);

  useEffect(() => {
    if (value !== prevVal.current) {
      prevVal.current = value;
      scale.value = withSequence(withTiming(1.3, { duration: 150 }), withSpring(1, { damping: 8 }));
    }
  }, [value]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.Text style={[animStyle, { fontSize: 36, fontFamily: F.black, color: text }]}>
      {value}
    </Animated.Text>
  );
}

// ---------------------------------------------------------------------------
// Strike zone visualization (MLB only)
// Play-by-play pitch canvas. The Box Score hot-zone panel uses the active
// batter's separate ESPN bounds directly.
// ---------------------------------------------------------------------------

const SZ = { // Strike Zone constants in ESPN coordinate units
  xMin: 95, xMax: 170,
  yMin: 145, yMax: 220,
  // Visible canvas is wider to show balls outside
  canXMin: 40, canXMax: 220,
  canYMin: 100, canYMax: 265,
  // Approximate mound in ESPN coords (catcher's box bottom = high y)
  moundX: 130, moundY: 290,
};

function toSvg(px: number, py: number, w: number, h: number) {
  const x = ((px - SZ.canXMin) / (SZ.canXMax - SZ.canXMin)) * w;
  const y = ((py - SZ.canYMin) / (SZ.canYMax - SZ.canYMin)) * h;
  return { x, y };
}

function pitchColor(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('ball in play') || t.includes('hit') || t.includes('single') ||
      t.includes('double') || t.includes('triple') || t.includes('homer')) return '#34C759';
  if (t.includes('foul'))   return '#FF9F0A';
  if (t.includes('strike')) return '#FF3B30';
  if (t.includes('ball'))   return '#636366';
  return '#8e8e93';
}

function isBallPitch(pitch: Play): boolean {
  const t = pitch.text.toLowerCase();
  return /\bball\s*[1-4]?\b|intentional ball|pitchout/.test(t)
    && !/ball in play|foul ball/.test(t);
}

function pitchMarkerColor(pitch: Play): string {
  return isBallPitch(pitch) ? '#00A651' : '#E21B2D';
}

// ---------------------------------------------------------------------------
// Stable pitcher/batter avatar — hoisted out of the render IIFE so React keeps
// the same component identity across polls. Without this, every 500ms poll
// remounts the Image (since the parent IIFE rebuilds the function each call),
// causing visible flicker as the URL re-resolves.
// ---------------------------------------------------------------------------
const AT_BAT_AVATAR_SIZE = 42;
const AtBatAvatar = React.memo(function AtBatAvatar({
  url, name, ringColor, dark, accent,
}: {
  url?: string; name?: string; ringColor?: string;
  dark: boolean; accent: string;
}) {
  return (
    <View style={{
      width: AT_BAT_AVATAR_SIZE, height: AT_BAT_AVATAR_SIZE,
      borderRadius: AT_BAT_AVATAR_SIZE / 2,
      borderWidth: 2, borderColor: ringColor ?? 'transparent',
      overflow: 'hidden', flexShrink: 0,
      backgroundColor: dark ? '#2c2c2e' : '#e5e5ea',
    }}>
      {url
        ? <Image
            source={{ uri: url }}
            style={{ width: AT_BAT_AVATAR_SIZE, height: AT_BAT_AVATAR_SIZE }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={url}
            transition={0}
          />
        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {name
              ? <Text style={{ color: accent, fontSize: 12, fontFamily: F.black }}>
                  {name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}
                </Text>
              : <IconSymbol name="baseball.fill" size={18} color={accent} />}
          </View>
      }
    </View>
  );
});

// ---------------------------------------------------------------------------
// Bigger strike zone with arc trajectory per pitch
// ---------------------------------------------------------------------------
function StrikeZone({ pitches, dark }: { pitches: Play[]; dark: boolean }) {
  const W = 160, H = 160;
  const zoneX1 = ((SZ.xMin - SZ.canXMin) / (SZ.canXMax - SZ.canXMin)) * W;
  const zoneX2 = ((SZ.xMax - SZ.canXMin) / (SZ.canXMax - SZ.canXMin)) * W;
  const zoneY1 = ((SZ.yMin - SZ.canYMin) / (SZ.canYMax - SZ.canYMin)) * H;
  const zoneY2 = ((SZ.yMax - SZ.canYMin) / (SZ.canYMax - SZ.canYMin)) * H;
  const zoneW = zoneX2 - zoneX1;
  const zoneH = zoneY2 - zoneY1;
  const third  = zoneW / 3;
  const third2 = zoneH / 3;
  const borderColor = dark ? '#3a3a3c' : '#c7c7cc';
  const gridColor   = dark ? '#2c2c2e' : '#e5e5ea';
  const mound = toSvg(SZ.moundX, SZ.moundY, W, H);

  return (
    <Svg width={W} height={H}>
      {pitches.map((pitch) => {
        if (!pitch.pitchCoordinate) return null;
        const { x, y } = toSvg(pitch.pitchCoordinate.x, pitch.pitchCoordinate.y, W, H);
        const cpx = (mound.x + x) / 2;
        const cpy = Math.min(mound.y, y) - 30;
        return (
          <Path
            key={`arc-${pitch.id}`}
            d={`M ${mound.x} ${mound.y} Q ${cpx} ${cpy} ${x} ${y}`}
            stroke={pitchColor(pitch.text)}
            strokeWidth={1.2}
            strokeOpacity={0.35}
            fill="none"
            strokeDasharray="3,3"
          />
        );
      })}

      {/* Strike zone box */}
      <Rect x={zoneX1} y={zoneY1} width={zoneW} height={zoneH}
        fill={dark ? '#1c1c1e' : '#f2f2f7'} stroke={borderColor} strokeWidth={1.5} />

      {/* 3×3 grid lines inside zone */}
      <Line x1={zoneX1 + third}  y1={zoneY1} x2={zoneX1 + third}  y2={zoneY2} stroke={gridColor} strokeWidth={0.7} />
      <Line x1={zoneX1 + third * 2} y1={zoneY1} x2={zoneX1 + third * 2} y2={zoneY2} stroke={gridColor} strokeWidth={0.7} />
      <Line x1={zoneX1} y1={zoneY1 + third2}  x2={zoneX2} y2={zoneY1 + third2}  stroke={gridColor} strokeWidth={0.7} />
      <Line x1={zoneX1} y1={zoneY1 + third2 * 2} x2={zoneX2} y2={zoneY1 + third2 * 2} stroke={gridColor} strokeWidth={0.7} />

      {/* Pitch dots with number labels */}
      {pitches.map((pitch, idx) => {
        if (!pitch.pitchCoordinate) return null;
        const { x, y } = toSvg(pitch.pitchCoordinate.x, pitch.pitchCoordinate.y, W, H);
        const color = pitchColor(pitch.text);
        const num = pitch.atBatPitchNumber ?? (idx + 1);
        return (
          <G key={pitch.id}>
            <AnimatedCircle cx={x} cy={y} r={11} fill={color} />
            <SvgText
              x={x} y={y + 4}
              textAnchor="middle"
              fontSize={9}
              fontWeight="bold"
              fill="#fff"
            >
              {num}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Base diamond — shows which bases are occupied with player headshots
// ---------------------------------------------------------------------------
function RunnerBase({
  runner, pos, previousPos, pathPoints, radius, dark, animationDelay = 150, animationDuration = 800,
}: {
  runner: Runner;
  pos: BasePoint;
  previousPos?: BasePoint;
  pathPoints?: BasePoint[];
  radius: number;
  dark: boolean;
  animationDelay?: number;
  animationDuration?: number;
}) {
  const x = useSharedValue((previousPos ?? pos).x);
  const y = useSharedValue((previousPos ?? pos).y);

  useEffect(() => {
    const route = pathPoints?.length ? pathPoints : [pos];
    x.value = withDelay(
      animationDelay,
      withSequence(...route.map(point => withTiming(point.x, { duration: animationDuration }))),
    );
    y.value = withDelay(
      animationDelay,
      withSequence(...route.map(point => withTiming(point.y, { duration: animationDuration }))),
    );
  }, [runner.id, pos.x, pos.y, animationDelay, animationDuration, pathPoints?.map(p => `${p.x}:${p.y}`).join('|')]);

  const style = useAnimatedStyle(() => ({
    left: x.value - radius,
    top: y.value - radius,
  }));

  return (
    <Animated.View style={[{
      position: 'absolute',
      width: radius * 2,
      height: radius * 2,
      borderRadius: radius,
      borderWidth: 2,
      borderColor: '#FF9F0A',
      overflow: 'hidden',
      backgroundColor: dark ? '#2c2c2e' : '#e5e5ea',
      zIndex: 2,
    }, style]}>
      {runner.headshot
        ? <Image source={{ uri: runner.headshot }} style={{ width: radius * 2, height: radius * 2 }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={runner.headshot} />
        : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 9, fontFamily: F.black, color: '#FF9F0A' }}>
              {runner.name.split(' ').pop()?.[0] ?? '?'}
            </Text>
          </View>
      }
    </Animated.View>
  );
}

function BaseDiamond({ onFirst, onSecond, onThird, outs, dark }: {
  onFirst: Runner | null; onSecond: Runner | null; onThird: Runner | null;
  outs: number | null; dark: boolean;
}) {
  const S = 76;  // overall SVG + overlay container
  const half = S / 2;
  const B = 11;  // empty base square size
  const R = 14;  // headshot circle radius
  const lineC = dark ? '#48484a' : '#c7c7cc';
  const emptyFill = dark ? '#3a3a3c' : '#d1d1d6';

  // Base centers within the S×S space
  const bases = {
    home:   { x: half, y: S - 7  },
    first:  { x: S - 7, y: half  },
    second: { x: half,  y: 7     },
    third:  { x: 7,     y: half  },
  };
  const previousByRunner = useRef<Record<string, BasePoint>>({});
  const currentByRunner: Record<string, BasePoint> = {};
  if (onFirst?.id) currentByRunner[onFirst.id] = bases.first;
  if (onSecond?.id) currentByRunner[onSecond.id] = bases.second;
  if (onThird?.id) currentByRunner[onThird.id] = bases.third;

  useEffect(() => {
    previousByRunner.current = currentByRunner;
  }, [onFirst?.id, onSecond?.id, onThird?.id]);

  function BaseOverlay({ runner, pos }: { runner: Runner | null; pos: { x: number; y: number } }) {
    if (!runner) {
      // Empty base: small rotated square
      return (
        <View style={{
          position: 'absolute',
          left: pos.x - B / 2, top: pos.y - B / 2,
          width: B, height: B,
          backgroundColor: emptyFill,
          transform: [{ rotate: '45deg' }],
        }} />
      );
    }
    return (
      <RunnerBase
        runner={runner}
        pos={pos}
        previousPos={previousByRunner.current[runner.id] ?? bases.home}
        radius={R}
        dark={dark}
        animationDelay={60}
        animationDuration={520}
      />
    );
  }

  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: S, height: S }}>
        {/* Base lines via SVG */}
        <Svg width={S} height={S} style={{ position: 'absolute' }}>
          <Line x1={bases.home.x} y1={bases.home.y} x2={bases.first.x}  y2={bases.first.y}  stroke={lineC} strokeWidth={1} />
          <Line x1={bases.first.x}  y1={bases.first.y}  x2={bases.second.x} y2={bases.second.y} stroke={lineC} strokeWidth={1} />
          <Line x1={bases.second.x} y1={bases.second.y} x2={bases.third.x}  y2={bases.third.y}  stroke={lineC} strokeWidth={1} />
          <Line x1={bases.third.x}  y1={bases.third.y}  x2={bases.home.x}   y2={bases.home.y}   stroke={lineC} strokeWidth={1} />
        </Svg>
        {/* Home plate always empty */}
        <View style={{
          position: 'absolute',
          left: bases.home.x - B / 2, top: bases.home.y - B / 2,
          width: B, height: B,
          backgroundColor: emptyFill,
          transform: [{ rotate: '45deg' }],
        }} />
        <BaseOverlay runner={onFirst}  pos={bases.first}  />
        <BaseOverlay runner={onSecond} pos={bases.second} />
        <BaseOverlay runner={onThird}  pos={bases.third}  />
      </View>
      {/* Outs indicator */}
      {outs != null && (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {[0, 1, 2].map(i => (
            <View key={i} style={{
              width: 7, height: 7, borderRadius: 3.5,
              backgroundColor: i < outs ? '#FF3B30' : (dark ? '#3a3a3c' : '#d1d1d6'),
            }} />
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Outcome badge — animated chip for K, BB, HBP, 1B, 2B, 3B, HR
// ---------------------------------------------------------------------------
type OutcomeKind =
  | 'K' | 'KL' | 'BB' | 'HBP'
  | '1B' | '2B' | '3B' | 'HR' | 'HR2' | 'HR3' | 'SLAM'
  // field outs / other results
  | 'GO' | 'FO' | 'PO' | 'LO' | 'FC' | 'DP' | 'TP' | 'SF' | 'SAC' | 'E' | 'OUT';

function outcomeFromAbbr(abbr: string | null, scoreValue?: number, onFirst?: Runner | null, onSecond?: Runner | null, onThird?: Runner | null): OutcomeKind | null {
  if (!abbr) return null;
  const a = abbr.toUpperCase();
  if (a === 'SS') return 'K';
  if (a === 'SL') return 'KL';
  if (a === 'B')  return 'BB';
  if (a === 'HBP') return 'HBP';
  if (a === '1B') return '1B';
  if (a === '2B') return '2B';
  if (a === '3B') return '3B';
  if (a === 'HR') {
    // Determine HR type by base runners at time of pitch + batter = runs scored
    const runners = [onFirst, onSecond, onThird].filter(Boolean).length;
    if (runners === 3) return 'SLAM';
    if (runners === 2) return 'HR3';
    if (runners === 1) return 'HR2';
    return 'HR';
  }
  return null;
}

// Derive the at-bat result from the play TEXT. ESPN reliably describes every
// outcome in words ("grounds out to short", "flies out to center", "strikes
// out swinging") even when it omits a tidy abbreviation — so this is the source
// of truth for field outs, which previously showed no badge at all.
function outcomeFromText(text: string | null | undefined): OutcomeKind | null {
  if (!text) return null;
  const t = text.toLowerCase();
  // Hits (check HR / triple / double before single so "double play" etc. don't misfire)
  if (/grand slam/.test(t)) return 'SLAM';
  if (/home run|homer|homers|homered/.test(t)) return 'HR';
  if (/\btriple(s|d)?\b/.test(t)) return '3B';
  if (/\bdoubl(e|es|ed)\b(?!.*play)/.test(t)) return '2B';
  if (/\bsingl(e|es|ed)\b/.test(t)) return '1B';
  // Strikeouts / walks / hbp
  if (/strikes out looking|called out on strikes|caught looking/.test(t)) return 'KL';
  if (/strikes out|struck out|strikeout/.test(t)) return 'K';
  if (/hit by (a )?pitch/.test(t)) return 'HBP';
  if (/\bwalk(s|ed)?\b|base on balls|intentionally walk/.test(t)) return 'BB';
  // Outs / other batted-ball results
  if (/triple play/.test(t)) return 'TP';
  if (/double play|grounded into a double play|gidp/.test(t)) return 'DP';
  if (/sacrifice fly|sac fly/.test(t)) return 'SF';
  if (/sacrifice bunt|sac bunt|sacrifices/.test(t)) return 'SAC';
  if (/fielder'?s choice/.test(t)) return 'FC';
  if (/reach(es|ed)? on (an? )?error|safe on (an? )?error/.test(t)) return 'E';
  if (/ground(s|ed)? out|grounds? into|ground out|grounder/.test(t)) return 'GO';
  if (/flies? out|fly out|flied? out|flyout|fly ball/.test(t)) return 'FO';
  if (/pops? out|pop out|popped out|popout|pop up|popup/.test(t)) return 'PO';
  if (/lines? out|line out|lined out|lineout|line drive/.test(t)) return 'LO';
  if (/forced out|force out|out at (first|second|third|home)|fielded by|thrown out|tagged out|put out/.test(t)) return 'OUT';
  return null;
}

const OUTCOME_CONFIGS: Record<OutcomeKind, { label: string; bg: string; fg: string }> = {
  'K':    { label: 'Strikeout',    bg: '#FF3B30', fg: '#fff' },
  'KL':   { label: 'Strikeout (L)', bg: '#FF3B30', fg: '#fff' },
  'BB':   { label: 'Walk',   bg: '#007AFF', fg: '#fff' },
  'HBP':  { label: 'Hit By Pitch', bg: '#FF9F0A', fg: '#fff' },
  '1B':   { label: 'Single',   bg: '#34C759', fg: '#fff' },
  '2B':   { label: 'Double',   bg: '#30D158', fg: '#fff' },
  '3B':   { label: 'Triple',   bg: '#32D74B', fg: '#fff' },
  'HR':   { label: 'Home Run',   bg: '#FFD60A', fg: '#000' },
  'HR2':  { label: '2-Run HR', bg: '#FFD60A', fg: '#000' },
  'HR3':  { label: '3-Run HR', bg: '#FF9F0A', fg: '#fff' },
  'SLAM': { label: 'Grand Slam', bg: '#FF2D55', fg: '#fff' },
  // Field outs — muted gray so they read as "out", distinct from hits (green) / K (red)
  'GO':   { label: 'Groundout', bg: '#6E6E73', fg: '#fff' },
  'FO':   { label: 'Flyout',    bg: '#6E6E73', fg: '#fff' },
  'PO':   { label: 'Popout',    bg: '#6E6E73', fg: '#fff' },
  'LO':   { label: 'Lineout',   bg: '#6E6E73', fg: '#fff' },
  'FC':   { label: "Fielder's Choice", bg: '#6E6E73', fg: '#fff' },
  'DP':   { label: 'Double Play', bg: '#48484A', fg: '#fff' },
  'TP':   { label: 'Triple Play', bg: '#48484A', fg: '#fff' },
  'SF':   { label: 'Sac Fly',   bg: '#5E5CE6', fg: '#fff' },
  'SAC':  { label: 'Sacrifice', bg: '#5E5CE6', fg: '#fff' },
  'E':    { label: 'Reached on Error', bg: '#FF9F0A', fg: '#fff' },
  'OUT':  { label: 'Out',       bg: '#6E6E73', fg: '#fff' },
};

function OutcomeBadge({ kind }: { kind: OutcomeKind }) {
  const cfg = OUTCOME_CONFIGS[kind];
  const isLarge = kind === 'HR' || kind === 'HR2' || kind === 'HR3' || kind === 'SLAM';

  // Static badge — no entrance pop, no rotation, no repeating pulse. The pulse
  // is distracting on a list that re-renders every poll, since each new at-bat
  // would re-trigger the animation. Keep it calm and readable.
  return (
    <View style={{
      backgroundColor: cfg.bg,
      borderRadius: 8,
      paddingHorizontal: isLarge ? 12 : 9,
      paddingVertical: isLarge ? 5 : 4,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    }}>
      <Text style={{
        color: cfg.fg,
        fontSize: isLarge ? 15 : 14,
        fontFamily: F.black,
        letterSpacing: 0.5,
      }}>{cfg.label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ESPN-style play card
// ---------------------------------------------------------------------------

function PulsingPlayRow({ play, sub, text, border, cardBg, isLatestScoring, isFirst, teamColor, awayAbbr, homeAbbr, headshotMap, awayTeamId, homeTeamId, awayLogo, homeLogo }: {
  play: Play; sub: string; text: string; border: string; cardBg: string;
  isLatestScoring: boolean; isFirst?: boolean; teamColor?: string;
  awayAbbr?: string; homeAbbr?: string; headshotMap?: Record<string, string>;
  awayTeamId?: string; homeTeamId?: string;
  awayLogo?: string; homeLogo?: string;
}) {
  const liveDotOpacity = useSharedValue(1);
  useEffect(() => {
    if (isFirst) {
      liveDotOpacity.value = withRepeat(
        withSequence(withTiming(0.15, { duration: 700 }), withTiming(1, { duration: 700 })),
        -1, false,
      );
    }
  }, [isFirst]);
  const liveDotStyle = useAnimatedStyle(() => ({ opacity: liveDotOpacity.value }));

  const accent = teamColor ?? sub;
  const isScoring = play.scoringPlay;

  // Resolve headshot — use ESPN URL from participant, else look up from box score map
  const resolveHeadshot = (p: { name: string; headshot: string } | undefined) => {
    if (!p) return undefined;
    if (p.headshot) return p.headshot;
    if (!headshotMap || !p.name) return undefined;
    const key = p.name.toLowerCase();
    return headshotMap[key] ?? headshotMap[p.name.split(' ').pop()?.toLowerCase() ?? ''];
  };
  const primary   = play.participants?.[0];
  const secondary = play.participants?.[1];
  const primaryHeadshot   = resolveHeadshot(primary);
  const secondaryHeadshot = resolveHeadshot(secondary);

  // Detect plays attributed to the team rather than an individual: team rebound,
  // timeout, end of period, technical foul on team, etc. These have no
  // participants but do have a teamId — show the team's logo instead of a generic
  // dash. Falls back to dash if we don't know which team it belongs to.
  const isTeamPlay = !primary && /team rebound|timeout|delay of game|technical foul|team turnover|coach's challenge|end of|start of|coaching challenge|official|review/i.test(play.text);
  const teamLogo = (() => {
    if (!isTeamPlay || !play.teamId) return undefined;
    if (play.teamId === awayTeamId) return awayLogo;
    if (play.teamId === homeTeamId) return homeLogo;
    return undefined;
  })();

  // For MLB runner plays like "Hayes at third base." or "Stewart at first base."
  // ESPN often returns NO participants array, so we mine the player's name out
  // of the text and look up their headshot in the box-score map. This covers
  // "X at Yth base", "X stole second", "X scored", "X advances to N", etc.
  const minedHeadshot = (() => {
    if (primaryHeadshot || teamLogo) return undefined;
    if (!headshotMap) return undefined;
    const t = play.text;
    // Common MLB patterns — capture the player name at the start of the text
    const patterns = [
      /^([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)*)\s+at\s+(?:first|second|third|home)\b/,
      /^([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)*)\s+stole\b/,
      /^([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)*)\s+scored\b/,
      /^([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)*)\s+advances?\b/,
      /^([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)*)\s+caught\s+stealing\b/,
      /^([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)*)\s+(?:was\s+)?picked off\b/i,
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) {
        const name = m[1];
        const key = name.toLowerCase();
        const hit = headshotMap[key] ?? headshotMap[name.split(' ').pop()?.toLowerCase() ?? ''];
        if (hit) return hit;
      }
    }
    return undefined;
  })();

  // Situation strip text: "25–33  ·  2nd Quarter  ·  7:29"
  const situationParts: string[] = [];
  if (play.awayScore != null) situationParts.push(`${play.awayScore}–${play.homeScore}`);
  if (play.period)            situationParts.push(play.period);
  if (play.clock && play.clock !== '0:00') situationParts.push(play.clock);
  const situation = situationParts.join('  ·  ');

  // Headline vs detail split
  const usesType = !!(play.typeText && play.typeText.length < 60 &&
    play.text.toLowerCase().startsWith(play.typeText.toLowerCase()));
  const headline = usesType ? play.typeText! : play.text;
  const detail   = usesType
    ? play.text.slice(play.typeText!.length).replace(/^[\s.,:-]+/, '').trim()
    : null;

  return (
    <Animated.View entering={FadeInDown.duration(240)} style={[
      playStyles.row,
      { backgroundColor: isScoring ? accent + '10' : cardBg, borderBottomColor: border },
      isScoring && { borderLeftWidth: 3, borderLeftColor: accent },
    ]}>

      {/* ── Thin situation line ── */}
      <View style={playStyles.situation}>
        {isFirst && <Animated.View style={[playStyles.liveDot, liveDotStyle]} />}
        <Text style={[playStyles.situationTxt, { color: sub }]} numberOfLines={1}>
          {situation}
        </Text>
        {isScoring && play.scoreValue > 0 && (
          <Text style={[playStyles.scoreDelta, { color: accent }]}>▲{play.scoreValue}</Text>
        )}
      </View>

      {/* ── Main body: big headshot + text stack ── */}
      <View style={playStyles.body}>

        {/* Headshot — 58px circle, scoring gets accent ring */}
        <View style={[
          playStyles.avatarWrap,
          { borderColor: isScoring ? accent : 'transparent' },
        ]}>
          {primaryHeadshot
            ? <Image source={{ uri: primaryHeadshot }} style={playStyles.avatar} contentFit="cover" cachePolicy="memory-disk" recyclingKey={primaryHeadshot} />
            : minedHeadshot
              ? <Image source={{ uri: minedHeadshot }} style={playStyles.avatar} contentFit="cover" cachePolicy="memory-disk" recyclingKey={minedHeadshot} />
              : teamLogo
                ? <Image source={{ uri: teamLogo }} style={playStyles.avatar} contentFit="contain" cachePolicy="memory-disk" recyclingKey={teamLogo} />
                : (
                  <View style={[playStyles.avatarFallback, { backgroundColor: accent + '22' }]}>
                    <Text style={[playStyles.avatarInitials, { color: accent }]}>
                      {primary?.name
                        ? primary.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')
                        : '—'}
                    </Text>
                  </View>
                )
          }
        </View>

        {/* Text stack */}
        <View style={playStyles.textCol}>
          {/* Bold headline */}
          <Text style={[playStyles.headline, { color: isScoring ? accent : text }]}>
            {headline}
          </Text>

          {/* Primary participant name (batter / scorer) */}
          {primary?.name ? (
            <Text style={[playStyles.subLine, { color: sub }]} numberOfLines={1}>
              {primary.name}
            </Text>
          ) : null}

          {/* Detail / rest of play text */}
          {detail ? (
            <Text style={[playStyles.subLine, { color: sub }]} numberOfLines={2}>{detail}</Text>
          ) : null}

          {/* Secondary participant (pitcher) */}
          {secondary?.name ? (
            <Text style={[playStyles.subLine, { color: sub }]} numberOfLines={1}>
              {secondary.name}
            </Text>
          ) : null}
        </View>

      </View>
    </Animated.View>
  );
}

const playStyles = StyleSheet.create({
  // Flat full-width row — separated only by a hairline, like ESPN
  row: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 0,          // overridden for scoring plays
  },
  situation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 10,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF3B30',
    flexShrink: 0,
  },
  situationTxt: {
    fontSize: 11,
    fontFamily: F.bold,
    flex: 1,
    letterSpacing: 0.1,
  },
  scoreDelta: {
    fontSize: 11,
    fontFamily: F.black,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  avatarWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatar: {
    width: 58,
    height: 58,
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 16,
    fontFamily: F.black,
  },
  textCol: {
    flex: 1,
    paddingTop: 2,
    gap: 3,
  },
  headline: {
    fontSize: 16,
    fontFamily: F.bold,
    lineHeight: 21,
  },
  subLine: {
    fontSize: 12,
    fontFamily: F.regular,
    lineHeight: 17,
  },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function GameDetailScreen() {
  const { id, sport = 'nba' } = useLocalSearchParams<{ id: string; sport: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const dark = useColorScheme() === 'dark';
  const { togglePlayer, isPlayerFav } = useFavorites();

  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'boxscore' | 'plays' | 'scoring' | 'chat'>('boxscore');
  // Tick every second so all derived number displays (fantasy pts, clocks, etc.)
  // refresh visually even between server polls
  useTick(1000);

  // Game clock that ticks down once per second (shared across every score
  // display on this page so the clock stays in sync everywhere)
  const gameDesc = summary?.status.description?.toLowerCase() ?? '';
  const isGameLive = !!gameDesc && !gameDesc.includes('final') && !gameDesc.includes('scheduled');
  // Clock should NOT tick during stoppages — timeouts, halftime, between
  // quarters, intermission, free throws. ESPN's description gives us the cue.
  const isClockRunning = isGameLive && !(
    /timeout|halftime|intermission|end of|end period|delay/i.test(gameDesc)
  );
  const liveClock = useLiveClock(summary?.status.clock, isGameLive, isClockRunning);

  // MLB only: which past innings has the user expanded? Most-recent inning is
  // always expanded; older innings collapse to a tappable header that toggles.
  const [expandedInnings, setExpandedInnings] = useState<Set<string>>(new Set());
  const toggleInning = (key: string) => {
    setExpandedInnings(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Fantasy roster
  const [fantasyStore, setFantasyStore] = useState<FantasyRosterStore | null>(null);

  // Bets for this game
  const [matchingParlays, setMatchingParlays] = useState<Array<{ parlay: Parlay; legs: BetLeg[] }>>([]);

  // Plays state
  const [playsData, setPlaysData] = useState<PlaysData | null>(null);
  const [playsLoading, setPlaysLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPlaysRef = useRef<Play[]>([]);
  const playsSignatureRef = useRef('');

  const bg = dark ? '#000' : '#f2f2f7';
  const cardBg = dark ? '#1c1c1e' : '#fff';
  const border = dark ? '#2c2c2e' : '#e5e5e5';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';
  const cfg = SPORT_CONFIG[sport as SportKey];
  // Readable version of the sport accent for use as TEXT on the dark theme.
  const readAccent = readableOnDark(cfg?.color, dark, sub);

  async function fetchSummary() {
    if (!id) return;
    try {
      const { data } = await axios.get<GameSummary>(`${API}/sports/${sport}/game/${id}`, {
        params: { _: Date.now() },
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      setSummary(data);
      // Start or stop live polling based on status
      const desc = data.status?.description?.toLowerCase() ?? '';
      const isLive = !desc.includes('final') && !desc.includes('scheduled') && desc.length > 0;
      if (isLive) {
        if (!summaryIntervalRef.current) {
          summaryIntervalRef.current = setInterval(fetchSummary, 750);
        }
      } else {
        if (summaryIntervalRef.current) {
          clearInterval(summaryIntervalRef.current);
          summaryIntervalRef.current = null;
        }
      }
    } catch {
      setError('Box score not available');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSummary();
    return () => {
      if (summaryIntervalRef.current) {
        clearInterval(summaryIntervalRef.current);
        summaryIntervalRef.current = null;
      }
    };
  }, [id, sport]);

  useEffect(() => {
    loadFantasyRoster().then(store => setFantasyStore(store));
    // Stay in sync when the fantasy tab refreshes the roster (every 45s)
    const unsub = subscribeToRoster(() => {
      setFantasyStore(getFantasyRosterSync());
    });
    return unsub;
  }, []);

  // Custom navigation bar — updates every time summary changes (live polls)
  useEffect(() => {
    if (!summary) return;
    const safeHex = (c: string, alpha = 'BB') => {
      const clean = (c ?? '').replace('#', '');
      return clean.length === 6 ? `#${clean}${alpha}` : '#1a1a1a';
    };
    navigation.setOptions({
      headerTitle: () => (
        <GameNavHeader away={summary.away} home={summary.home} status={summary.status} sport={sport} />
      ),
      headerBackground: () => (
        <LinearGradient
          colors={[safeHex(summary.away.team.color), '#111111', safeHex(summary.home.team.color)]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      ),
      headerTintColor: '#fff',
      headerBackTitle: '',
      headerBackButtonDisplayMode: 'minimal',
    });
  }, [summary]);

  // Stat key map shared with bets.tsx
  const STAT_KEY_MAP: Record<string, string> = {
    'Points': 'PTS', 'Rebounds': 'REB', 'Assists': 'AST', 'Steals': 'STL', 'Blocks': 'BLK',
    '3-Pointers': '3PM', 'Pass Yds': 'YDS', 'Rush Yds': 'YDS', 'Rec Yds': 'YDS',
    'Receptions': 'REC', 'Pass TDs': 'TD', 'Strikeouts': 'K', 'Hits': 'H',
    'Total Bases': 'TB', 'RBIs': 'RBI', 'Runs': 'R', 'Home Runs': 'HR',
    'Shots': 'SOG', 'Goals': 'G', 'Saves': 'SV',
  };

  // Load bets and find matching legs for this game
  function refreshBetsPanel(gameSummary?: GameSummary | null) {
    loadBets().then(parlays => {
      const matches = parlays
        .filter(p => p.status === 'active')
        .map(parlay => {
          const legs = parlay.legs.filter(l => l.gameId === id);
          return { parlay, legs };
        })
        .filter(m => m.legs.length > 0);

      // If we have game data, compute live statuses and currentStatValue
      if (gameSummary) {
        const gameData = {
          away: { team: { abbreviation: gameSummary.away.team.abbreviation }, score: gameSummary.away.score },
          home: { team: { abbreviation: gameSummary.home.team.abbreviation }, score: gameSummary.home.score },
          status: { state: gameSummary.status.description?.toLowerCase().includes('final') ? 'post' : gameSummary.status.description?.toLowerCase().includes('scheduled') ? 'pre' : 'in', description: gameSummary.status.description },
          playerTeams: gameSummary.playerTeams,
        };
        const enriched = matches.map(({ parlay, legs }) => ({
          parlay,
          legs: legs.map(leg => {
            const status = calcLegStatus(leg, gameData);
            let currentStatValue = leg.currentStatValue;
            if (leg.type === 'prop' && leg.playerName && leg.statKey) {
              const mappedKey = STAT_KEY_MAP[leg.statKey] ?? leg.statKey;
              const norm = leg.playerName.toLowerCase().replace(/[^a-z]/g, '');
              outer: for (const team of [...(gameSummary.playerTeams ?? []), ...(gameSummary.pitcherTeams ?? [])]) {
                for (const athlete of team.athletes) {
                  const n = athlete.name.toLowerCase().replace(/[^a-z]/g, '');
                  if (n.includes(norm) || norm.includes(n)) {
                    const v = Number(athlete.stats[mappedKey] ?? NaN);
                    if (!isNaN(v)) { currentStatValue = v; break outer; }
                  }
                }
              }
            }
            return { ...leg, status, currentStatValue };
          }),
        }));
        setMatchingParlays(enriched);
      } else {
        setMatchingParlays(matches);
      }
    });
  }

  useEffect(() => {
    refreshBetsPanel(summary);
    const unsub = subscribeToBets(() => refreshBetsPanel(summary));
    return unsub;
  }, [id, summary]);

  // Fetch plays
  async function fetchPlays(): Promise<PlaysData | null> {
    if (!id) return null;
    try {
      const { data } = await axios.get<PlaysData>(`${API}/sports/${sport}/game/${id}/plays`, {
        params: { _: Date.now() },
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      const latest = data.plays[0];
      const signature = [
        data.status.state,
        data.status.description,
        data.status.clock,
        data.status.period,
        data.plays.length,
        latest?.id,
        latest?.text,
        latest?.awayScore,
        latest?.homeScore,
        latest?.onFirst?.id,
        latest?.onSecond?.id,
        latest?.onThird?.id,
      ].join('|');
      if (signature !== playsSignatureRef.current) {
        playsSignatureRef.current = signature;
        setPlaysData(data);
        prevPlaysRef.current = data.plays;
      }
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    // MLB box score also needs the live feed for count/outs/hot-zone state.
    const needsLivePlays = activeTab === 'plays' || activeTab === 'scoring' || (activeTab === 'boxscore' && sport === 'mlb');
    if (!needsLivePlays) {
      if (intervalRef.current) { clearTimeout(intervalRef.current); intervalRef.current = null; }
      return;
    }
    let cancelled = false;
    let firstRequest = true;
    setPlaysLoading(true);
    const poll = async () => {
      const data = await fetchPlays();
      if (firstRequest) {
        firstRequest = false;
        setPlaysLoading(false);
      }
      if (cancelled) return;
      // The server now background-polls ESPN and serves from memory instantly,
      // so a tight 100ms client loop catches every refresh with minimal lag
      // without hammering the network. Relaxed when the game isn't live.
      const delay = data?.status?.state === 'in' || !data ? 100 : 1000;
      intervalRef.current = setTimeout(poll, delay);
    };
    poll();
    return () => {
      cancelled = true;
      if (intervalRef.current) { clearTimeout(intervalRef.current); intervalRef.current = null; }
    };
  }, [activeTab, id, sport]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearTimeout(intervalRef.current); };
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
        <ActivityIndicator style={{ marginTop: 60 }} size="large" color={cfg?.color ?? '#888'} />
      </SafeAreaView>
    );
  }

  if (error || !summary) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: sub }]}>{error || 'No data available'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const keyLabels = KEY_STATS[sport] ?? [];
  const availableLabels = summary.playerTeams[0]?.labels ?? [];
  const displayLabels = keyLabels.filter(l => availableLabels.includes(l));
  const finalLabels = displayLabels.length > 0 ? displayLabels : availableLabels.slice(0, 6);

  const isPre = summary.playerTeams.every(t => t.athletes.length === 0);
  const awayLeaders = summary.leaders?.find(l => l.teamAbbr === summary.away.team.abbreviation) ?? summary.leaders?.[0];
  const homeLeaders = summary.leaders?.find(l => l.teamAbbr === summary.home.team.abbreviation) ?? summary.leaders?.[1];
  const awayProbable = summary.probables?.find(p => p.homeAway === 'away');
  const homeProbable = summary.probables?.find(p => p.homeAway === 'home');
  const mlbInningText = sport === 'mlb' && !/final|scheduled|pre/i.test(summary.status.description ?? '')
    ? (/(top|bottom|middle|mid\.?|end)\b/i.test(summary.status.description ?? '')
        ? summary.status.description
        : summary.status.period > 0 ? `Inning ${summary.status.period}` : '')
    : '';

  // Find latest scoring play index for pulsing
  const latestScoringIdx = playsData?.plays.findIndex(p => p.scoringPlay) ?? -1;

  // Build name → headshot map from box score so play cards can show real
  // player photos even when ESPN omits them from the participants array.
  const playerHeadshotMap = (() => {
    const map: Record<string, string> = {};
    const allTeams = [...(summary.playerTeams ?? []), ...(summary.pitcherTeams ?? [])];
    for (const team of allTeams) {
      for (const athlete of team.athletes ?? []) {
        if (athlete.name && athlete.headshot) {
          map[athlete.name.toLowerCase()] = athlete.headshot;
          // Also index by last name only as a fallback
          const parts = athlete.name.split(' ');
          if (parts.length > 1) map[parts[parts.length - 1].toLowerCase()] = athlete.headshot;
        }
      }
    }
    return map;
  })();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      {/* SEGMENT SWITCHER — SCORING tab added for NFL / MLB / NHL (where a
          discrete list of scoring events is meaningful; NBA scores too often). */}
      <View style={[styles.segmentBar, { backgroundColor: cardBg, borderBottomColor: border }]}>
        {(['boxscore', ...(sport === 'nfl' || sport === 'mlb' || sport === 'nhl' ? ['scoring'] as const : []), 'plays', 'chat'] as Array<'boxscore' | 'plays' | 'scoring' | 'chat'>).map(tab => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.segmentTab, activeTab === tab && { borderBottomColor: cfg?.color ?? '#FF3B30', borderBottomWidth: 3 }]}
          >
            <Text style={[styles.segmentText, { color: activeTab === tab ? readAccent : sub }]} numberOfLines={1} adjustsFontSizeToFit>
              {tab === 'boxscore' ? 'BOX SCORE' : tab === 'plays' ? 'PLAY-BY-PLAY' : tab === 'scoring' ? 'SCORING' : 'CHAT'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Persistent mini score header — visible in CHAT so users always see the score + period */}
      {activeTab === 'chat' && (
        <View style={[styles.chatMiniScore, { backgroundColor: cardBg, borderBottomColor: border }]}>
          <View style={styles.chatMiniSide}>
            {summary.away.team.logo
              ? <Image source={{ uri: summary.away.team.logo }} style={styles.chatMiniLogo} contentFit="contain" />
              : null}
            <Text style={[styles.chatMiniAbbr, { color: text }]}>{summary.away.team.abbreviation}</Text>
            <Text style={[styles.chatMiniScoreText, { color: text }]}>{summary.away.score}</Text>
          </View>
          <View style={styles.chatMiniCenter}>
            <Text style={[styles.chatMiniStatus, { color: readAccent }]} numberOfLines={1}>
              {summary.status.description}
            </Text>
            {liveClock && liveClock !== '0:00' && sport !== 'mlb' ? (
              <Text style={[styles.chatMiniClock, { color: sub }]}>{liveClock}</Text>
            ) : null}
          </View>
          <View style={styles.chatMiniSide}>
            <Text style={[styles.chatMiniScoreText, { color: text }]}>{summary.home.score}</Text>
            <Text style={[styles.chatMiniAbbr, { color: text }]}>{summary.home.team.abbreviation}</Text>
            {summary.home.team.logo
              ? <Image source={{ uri: summary.home.team.logo }} style={styles.chatMiniLogo} contentFit="contain" />
              : null}
          </View>
        </View>
      )}

      {activeTab === 'boxscore' && (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* SCORE HEADER — shown first so the score is always the top thing
             you see when you open a game */}
          <Animated.View entering={FadeInDown.duration(400)} style={[styles.scoreCard, { backgroundColor: cardBg, borderColor: border }]}>
            <TeamHeader
              side={summary.away}
              sub={sub}
              text={text}
              dark={dark}
              // Tapping the away team logo/score/abbr opens the team profile
              onPress={() => router.push({ pathname: '/team/[id]', params: { id: summary.away.team.id, sport } } as any)}
            />
            <View style={styles.scoreCenter}>
              <Text style={[styles.vs, { color: sub }]}>@</Text>
              <Text style={[styles.statusText, { color: readAccent }]}>{summary.status.description}</Text>
              {mlbInningText && mlbInningText !== summary.status.description ? (
                <Text style={{ color: text, fontSize: 13, fontFamily: F.black, marginTop: 2 }}>
                  {mlbInningText.toUpperCase()}
                </Text>
              ) : null}
              {liveClock && liveClock !== '0:00' && sport !== 'mlb' ? <Text style={[styles.clock, { color: sub }]}>{liveClock}</Text> : null}
            </View>
            <TeamHeader
              side={summary.home}
              sub={sub}
              text={text}
              dark={dark}
              onPress={() => router.push({ pathname: '/team/[id]', params: { id: summary.home.team.id, sport } } as any)}
            />
          </Animated.View>

          {/* LINE SCORE TABLE — period-by-period scores (innings / quarters) */}
          {((summary.away.linescores?.length ?? 0) > 0 || (summary.home.linescores?.length ?? 0) > 0) && (
            <LineScoreTable
              sport={sport}
              away={summary.away}
              home={summary.home}
              cardBg={cardBg}
              border={border}
              text={text}
              sub={sub}
            />
          )}

          {sport === 'mlb' && (
            /final/i.test(summary.status.description ?? '') ? (
              <MlbFinalFieldSummary summary={summary} dark={dark} />
            ) : (
              <MlbZoneSummary
                plays={playsData?.plays ?? []}
                summary={summary}
                cardBg={cardBg}
                border={border}
                text={text}
                sub={sub}
              />
            )
          )}

          {/* MY BETS PANEL — shown AFTER the score so users can see how their
             bets are tracking with the live score above */}
          {matchingParlays.length > 0 && (
            <Animated.View entering={FadeInDown.duration(350)} style={[betPanelStyles.panel, { backgroundColor: '#1a1a2e', borderColor: '#2c2c3e' }]}>
              <Text style={betPanelStyles.panelHeader}>MY BETS</Text>
              {matchingParlays.map(({ parlay, legs }) => (
                <View key={parlay.id} style={betPanelStyles.parlayGroup}>
                  <Text style={betPanelStyles.parlayName}>{parlay.name}</Text>
                  {legs.map(leg => {
                    const sColor =
                      leg.status === 'winning' || leg.status === 'won' ? '#34C759' :
                      leg.status === 'losing' || leg.status === 'lost' ? '#FF3B30' :
                      leg.status === 'push' ? '#FF9F0A' : '#8e8e93';
                    return (
                      <View key={leg.id} style={betPanelStyles.legRow}>
                        <PropProgressRing leg={leg} />
                        <View style={{ flex: 1 }}>
                          <Text style={[betPanelStyles.legDesc, { color: sColor }]}>{leg.description}</Text>
                          {leg.type === 'prop' && leg.statLine != null && leg.currentStatValue != null && (
                            <Text style={{ color: '#8e8e93', fontSize: 10, fontFamily: 'System' }}>
                              {leg.currentStatValue} / {leg.statLine} {leg.statKey}
                            </Text>
                          )}
                        </View>
                        <Text style={[betPanelStyles.legOdds, { color: sColor }]}>{fmtOdds(leg.odds)}</Text>
                      </View>
                    );
                  })}
                </View>
              ))}
              {summary?.status.description?.toLowerCase().includes('final') && (
                <Text style={betPanelStyles.finalNote}>FINAL</Text>
              )}
            </Animated.View>
          )}

          {/* POSTSEASON BANNER */}
          {((summary.notes?.length ?? 0) > 0 || summary.series) && (
            <Animated.View entering={FadeInDown.duration(350)} style={[styles.postseasonBanner, { backgroundColor: cfg?.color ?? '#888' }]}>
              {(summary.notes?.length ?? 0) > 0 && (
                <Text style={styles.postseasonNote}>{summary.notes[0]}</Text>
              )}
              {summary.series?.summary ? (
                <Text style={styles.seriesText}>{summary.series.summary}</Text>
              ) : null}
            </Animated.View>
          )}

          {/* FANTASY PLAYERS IN THIS GAME */}
          {fantasyStore && fantasyStore.sport === sport && (() => {
            const homeAbbr = summary.home.team.abbreviation.toUpperCase();
            const awayAbbr = summary.away.team.abbreviation.toUpperCase();

            // Build teamId → teamInfo mapping using teamSeasonStats (most reliable)
            // so we never mis-assign home/away regardless of ESPN's array order
            const teamInfoById: Record<string, typeof summary.home.team> = {};
            for (const ts of (summary.teamSeasonStats ?? [])) {
              teamInfoById[ts.teamId] = ts.homeAway === 'home' ? summary.home.team : summary.away.team;
            }
            // Fallback: if teamSeasonStats absent, ESPN typically lists away then home
            if (Object.keys(teamInfoById).length === 0) {
              const [first, second] = summary.playerTeams;
              if (first) teamInfoById[first.teamId] = summary.away.team;
              if (second) teamInfoById[second.teamId] = summary.home.team;
            }

            // Include pitchers (MLB statistics[1] group) so fantasy pitchers
            // playing in this game are found and scored correctly.
            const allAthletes = [
              ...summary.playerTeams,
              ...(summary.pitcherTeams ?? []),
            ].flatMap(t =>
              t.athletes.map(a => ({ ...a, resolvedTeamInfo: teamInfoById[t.teamId] ?? summary.home.team }))
            );

            const hasBoxScore = allAthletes.length > 0;
            // Game state: pre-game means no fantasy points should be shown yet.
            // ESPN sometimes returns season stats in the box score even before
            // tipoff, which would otherwise produce huge bogus fantasy totals.
            const gameDesc = summary.status.description?.toLowerCase() ?? '';
            const gameIsPre = gameDesc.includes('scheduled') || gameDesc.includes('pre');
            const gameIsLiveOrFinal = !gameIsPre && hasBoxScore;

            type FantasyMatch = {
              fantasy: FantasyPlayer;
              athlete: (typeof allAthletes)[0] | null;
              teamInfo: typeof summary.home.team;
            };

            // Only show players from the SAME sport whose team is actually in this game
            const matches: FantasyMatch[] = [];
            for (const fp of fantasyStore.players) {
              const fpTeam = (fp.team ?? '').toUpperCase().trim();
              if (!fpTeam) continue; // player has no team (free agent) — skip
              const isHome = fpTeam === homeAbbr;
              const isAway = fpTeam === awayAbbr;
              if (!isHome && !isAway) continue; // not playing in this game

              const teamInfo = isHome ? summary.home.team : summary.away.team;

              // Find the athlete in the box score by name
              const nameNorm = fp.name.toLowerCase().replace(/[^a-z]/g, '');
              const found = allAthletes.find(a => {
                const n = a.name.toLowerCase().replace(/[^a-z]/g, '');
                return n === nameNorm || n.includes(nameNorm) || nameNorm.includes(n);
              }) ?? null;

              matches.push({ fantasy: fp, athlete: found, teamInfo });
            }

            if (matches.length === 0) return null;
            const providerColor = fantasyStore.provider === 'yahoo' ? '#6001D2' : '#D00';
            return (
              <Animated.View entering={FadeInDown.delay(20).duration(400)} style={styles.section}>
                <View style={styles.fantasyHeader}>
                  <View style={[styles.fantasyProviderDot, { backgroundColor: providerColor }]} />
                  <Text style={[styles.fantasySectionTitle, { color: text }]}>My Fantasy Players</Text>
                  <Text style={[styles.fantasyLeagueName, { color: sub }]}>{fantasyStore.leagueName}</Text>
                </View>
                <View style={[styles.fantasyCard, { backgroundColor: cardBg, borderColor: border }]}>
                  {matches.map(({ fantasy, athlete, teamInfo }, i) => {
                    const headshot = athlete?.headshot ?? fantasy.image ?? null;
                    const posLabel = athlete?.position ?? (fantasy.position != null ? String(fantasy.position) : null);
                    // During a live game, calculate from the newest box-score
                    // stats so this value changes with every summary refresh.
                    // The roster's pointsToday can be 30–45 seconds behind.
                    const pts = (gameIsLiveOrFinal && athlete)
                      ? calcFantasyPoints(sport, athlete.stats, fantasyStore.provider)
                      : 0;
                    const keyStats = KEY_STATS[sport] ?? [];
                    const statEntries = (gameIsLiveOrFinal && athlete)
                      ? keyStats.filter(k => athlete.stats[k] !== undefined && athlete.stats[k] !== '--').map(k => ({ k, v: athlete.stats[k] }))
                      : [];
                    const isBench = fantasy.lineupSlotId != null && fantasy.lineupSlotId >= 20;
                    return (
                      <View key={String(fantasy.id ?? i) + i} style={[styles.fantasyPlayerRow, { borderBottomColor: border }, i === matches.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={[styles.fantasyTeamAccent, { backgroundColor: `#${teamInfo.color}` }]} />
                        {headshot
                          ? <Image source={{ uri: headshot }} style={styles.fantasyHeadshot} contentFit="cover" />
                          : <View style={[styles.fantasyHeadshot, { backgroundColor: sub + '30' }]} />}
                        <View style={styles.fantasyPlayerInfo}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[styles.fantasyPlayerName, { color: text }]}>{fantasy.name}</Text>
                            {isBench && <Text style={{ fontSize: 9, fontFamily: F.bold, color: sub, backgroundColor: sub + '20', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>BE</Text>}
                          </View>
                          <Text style={[styles.fantasyPlayerPos, { color: sub }]}>
                            {posLabel ? `${posLabel}  ·  ` : ''}{teamInfo.abbreviation}
                          </Text>
                          {gameIsLiveOrFinal && statEntries.length > 0 && (
                            <View style={styles.fantasyStatRow}>
                              {statEntries.slice(0, 8).map(({ k, v }) => (
                                <View key={k} style={styles.fantasyStat}>
                                  <Text style={[styles.fantasyStatVal, { color: text }]}>{v}</Text>
                                  <Text style={[styles.fantasyStatKey, { color: sub }]}>{k}</Text>
                                </View>
                              ))}
                            </View>
                          )}
                          {(!gameIsLiveOrFinal || !athlete) && (
                            <Text style={{ color: sub, fontSize: 11, fontFamily: F.regular, marginTop: 2 }}>Upcoming</Text>
                          )}
                        </View>
                        <View style={styles.fantasyPtsBlock}>
                          <Text style={[styles.fantasyPts, { color: pts > 0 ? providerColor : sub }]}>{pts.toFixed(1)}</Text>
                          <Text style={[styles.fantasyPtsLabel, { color: sub }]}>FPTS</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </Animated.View>
            );
          })()}

          {/* BETTING LINES */}
          {summary.gameOdds && (
            <Animated.View entering={FadeInDown.delay(60).duration(400)} style={[styles.section, styles.oddsCard, { backgroundColor: cardBg, borderColor: border }]}>
              <View style={styles.oddsHeader}>
                <Text style={[styles.oddsTitle, { color: text }]}>Betting Lines</Text>
                <Text style={[styles.oddsProvider, { color: sub }]}>{summary.gameOdds.provider}</Text>
              </View>
              <View style={styles.oddsRow}>
                <OddsPill label="AWAY ML" value={fmtML(summary.gameOdds.awayMoneyLine)} color={summary.gameOdds.awayMoneyLine != null && summary.gameOdds.awayMoneyLine > 0 ? '#ff9f0a' : '#34c759'} sub={sub} />
                <OddsPill label="SPREAD" value={summary.gameOdds.spread} color={cfg?.color ?? sub} sub={sub} />
                <OddsPill label="O/U" value={summary.gameOdds.overUnder != null ? String(summary.gameOdds.overUnder) : '--'} color={sub} sub={sub} />
                <OddsPill label="HOME ML" value={fmtML(summary.gameOdds.homeMoneyLine)} color={summary.gameOdds.homeMoneyLine != null && summary.gameOdds.homeMoneyLine > 0 ? '#ff9f0a' : '#34c759'} sub={sub} />
              </View>
              {(summary.gameOdds.overOdds != null || summary.gameOdds.underOdds != null) && (
                <View style={styles.ouRow}>
                  <Text style={[styles.ouLabel, { color: sub }]}>Over {fmtML(summary.gameOdds.overOdds)}</Text>
                  <Text style={[styles.ouDivider, { color: border }]}> | </Text>
                  <Text style={[styles.ouLabel, { color: sub }]}>Under {fmtML(summary.gameOdds.underOdds)}</Text>
                </View>
              )}
            </Animated.View>
          )}

          {/* PLAYER PROPS — original compact grid (reverted; full betting UI lives in Bets tab) */}
          {(() => {
            const visibleProps = (summary.playerProps ?? [])
              .filter(prop => !prop.typeName.toLowerCase().includes('milestone'))
              .slice(0, 6);
            if (visibleProps.length === 0) return null;
            const normalizePropName = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
            const allBoxPlayers = [
              ...(summary.playerTeams ?? []).flatMap(team => team.athletes),
              ...(summary.pitcherTeams ?? []).flatMap(team => team.athletes),
            ];
            const findPropPlayer = (prop: PlayerProp) => {
              const propWords = (prop.athlete?.name ?? '').toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
              const propName = propWords.join('');
              const propLast = propWords[propWords.length - 1] || propName;
              const direct = allBoxPlayers.find(player =>
                player.id === prop.athleteId ||
                normalizePropName(player.name) === propName ||
                normalizePropName(player.name).endsWith(propName) ||
                propName.endsWith(normalizePropName(player.name)),
              );
              if (direct) return direct;
              const lastMatches = allBoxPlayers.filter(player =>
                player.name.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).pop() === propLast
              );
              return lastMatches.length === 1 ? lastMatches[0] : undefined;
            };
            return (
            <Animated.View entering={FadeInDown.delay(80).duration(400)} style={styles.section}>
              <SectionTitle label="Player Props" color={cfg?.color ?? '#888'} text={text} />
              <View style={styles.propsGrid}>
                {visibleProps.map(prop => {
                    const matchedPlayer = findPropPlayer(prop);
                    const athleteName = prop.athlete?.name || matchedPlayer?.name || '';
                    const headshot = prop.athlete?.headshot || matchedPlayer?.headshot || (prop.athleteId ? `https://a.espncdn.com/i/headshots/${sport}/players/full/${prop.athleteId}.png` : '');
                    return (
                      <View key={`${prop.athleteId}-${prop.typeName}-${prop.line}`} style={[styles.propCard, { backgroundColor: cardBg, borderColor: border }]}>
                        <View style={styles.propHeroBlock}>
                          {headshot
                            ? <Image source={{ uri: headshot }} style={styles.propHeroImg} contentFit="contain" contentPosition="center" />
                            : <View style={styles.propHeroImg} />}
                          <Text style={[styles.propName, { color: text, backgroundColor: cardBg + 'DD' }]} numberOfLines={1}>{athleteName.split(' ').pop() || 'Player'}</Text>
                        </View>
                        <View style={[styles.propAccent, { backgroundColor: cfg?.color ?? '#888' }]} />
                        <Text style={[styles.propType, { color: sub }]}>{abbreviatePropType(prop.typeName)}</Text>
                        <Text style={[styles.propLine, { color: text }]}>{formatPropLine(prop.line)}</Text>
                        <View style={styles.propOddsRow}>
                          <Text style={[styles.propOdds, { color: String(prop.overOdds ?? '').startsWith('+') ? '#ff9f0a' : '#34c759' }]}>O {prop.overOdds}</Text>
                          {prop.underOdds ? <Text style={[styles.propOdds, { color: String(prop.underOdds ?? '').startsWith('+') ? '#ff9f0a' : '#34c759' }]}>U {prop.underOdds}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
              </View>
            </Animated.View>
            );
          })()}

          {/* MLB PROBABLE PITCHERS */}
          {sport === 'mlb' && (awayProbable || homeProbable) && (
            <Animated.View entering={FadeInDown.delay(80).duration(400)} style={styles.section}>
              <SectionTitle label="Starting Pitchers" color={cfg?.color ?? '#888'} text={text} />
              <View style={[styles.pitchersCard, { backgroundColor: cardBg, borderColor: border }]}>
                <PitcherSide probable={awayProbable} label={summary.away.team.abbreviation} color={`#${summary.away.team.color}`} sub={sub} text={text} />
                <View style={[styles.pitcherDivider, { backgroundColor: border }]} />
                <PitcherSide probable={homeProbable} label={summary.home.team.abbreviation} color={`#${summary.home.team.color}`} sub={sub} text={text} />
              </View>
            </Animated.View>
          )}

          {/* PRE-GAME LEADERS */}
          {isPre && (awayLeaders || homeLeaders) && (
            <Animated.View entering={FadeInDown.delay(160).duration(400)} style={styles.section}>
              <SectionTitle label="Season Leaders" color={cfg?.color ?? '#888'} text={text} />
              <View style={styles.leadersRow}>
                {[
                  { leaders: awayLeaders, team: summary.away.team },
                  { leaders: homeLeaders, team: summary.home.team },
                ].map(({ leaders, team }) =>
                  leaders ? (
                    <View key={team.abbreviation} style={[styles.leadersCard, { backgroundColor: cardBg, borderColor: border }]}>
                      <View style={[styles.leadersTeamBar, { backgroundColor: `#${team.color}` }]} />
                      <View style={styles.leadersTeamRow}>
                        {team.logo ? <Image source={{ uri: dark && team.logoDark ? team.logoDark : team.logo }} style={styles.leadersTeamLogo} contentFit="contain" /> : null}
                        <Text style={[styles.leadersTeamAbbr, { color: text }]}>{team.abbreviation}</Text>
                      </View>
                      {leaders.categories.slice(0, 3).map((cat) => (
                        <View key={cat.name} style={styles.leaderRow}>
                          <View style={styles.leaderLeft}>
                            {cat.athlete.headshot
                              ? <Image source={{ uri: cat.athlete.headshot }} style={styles.leaderHeadshot} contentFit="cover" />
                              : <View style={[styles.leaderHeadshot, { backgroundColor: sub + '30' }]} />
                            }
                            <View style={styles.leaderInfo}>
                              <Text style={[styles.leaderName, { color: text }]} numberOfLines={1}>{cat.athlete.displayName}</Text>
                              <Text style={[styles.leaderCat, { color: sub }]}>{cat.displayName}</Text>
                            </View>
                          </View>
                          <Text style={[styles.leaderValue, { color: dark ? '#FFD700' : (cfg?.color ?? text) }]}>{cat.displayValue}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null
                )}
              </View>
            </Animated.View>
          )}

          {/* PLAYER STATS (live/final) — on web, render the two team tables
              side by side (50/50 in a row) so wide screens use horizontal
              space. On native we keep them stacked vertically. */}
          <View style={Platform.OS === 'web' ? styles.bsTeamsRowWeb : undefined}>
          {summary.playerTeams.map((teamData, ti) => {
            const teamInfo = ti === 0 ? summary.away.team : summary.home.team;
            // For MLB: filter out bench players who didn't play AND stagger
            // substitutes directly beneath the starter at their position
            // (matches ESPN's box-score layout). For other sports: simple sort.
            let sorted: typeof teamData.athletes;
            if (sport === 'mlb') {
              const played = teamData.athletes.filter(a => a.starter || didPlay(a.stats));
              const ordered: typeof teamData.athletes = [];
              const seen = new Set<string>();
              // Walk starters in their lineup order; after each, append any
              // sub at the same position who actually played
              for (const starter of played) {
                if (!starter.starter || seen.has(starter.name)) continue;
                seen.add(starter.name);
                ordered.push(starter);
                const pos = starter.position || '';
                for (const sub of played) {
                  if (sub.starter || seen.has(sub.name)) continue;
                  if ((sub.position || '') === pos) {
                    seen.add(sub.name);
                    ordered.push(sub);
                  }
                }
              }
              // Any remaining subs at positions without a listed starter
              for (const a of played) {
                if (!seen.has(a.name)) { seen.add(a.name); ordered.push(a); }
              }
              sorted = ordered;
            } else {
              sorted = [...teamData.athletes].sort((a, b) => {
                if (a.starter !== b.starter) return a.starter ? -1 : 1;
                const pts = finalLabels[0] ?? 'PTS';
                return Number(b.stats[pts] ?? 0) - Number(a.stats[pts] ?? 0);
              });
            }

            if (sorted.length === 0) return null;

            // ────────────────────────────────────────────────────────────
            // Sticky-PLAYER-column box-score table.
            //
            // The table is rendered as three vertical "tracks" sitting side
            // by side in a flexbox row:
            //
            //   [ fixed PLAYER track ] [ horizontally scrollable STATS track ] [ fixed ★ track ]
            //
            // Only the middle track scrolls horizontally — so the player's
            // headshot/name stays pinned on screen while the user swipes
            // through stat columns. Each row uses a shared fixed height so
            // the three tracks stay aligned. Star column rendered inside an
            // overlay column on the right edge.
            // ────────────────────────────────────────────────────────────
            return (
              <Animated.View
                key={teamData.teamId}
                entering={FadeInDown.delay(ti * 120).duration(400)}
                // On web add `bsTeamColWeb` so each team table takes 50% of the
                // row width (set up by the outer `bsTeamsRowWeb` flex container).
                style={[styles.section, Platform.OS === 'web' && styles.bsTeamColWeb]}
              >
                {/* Team header is now a pressable that opens the team profile.
                    Tapping anywhere on the logo or name jumps to /team/[id]. */}
                <Pressable
                  style={[styles.teamHeader, { borderLeftColor: `#${teamInfo.color}` }]}
                  onPress={() => teamInfo.id && router.push({ pathname: '/team/[id]', params: { id: teamInfo.id, sport } } as any)}
                >
                  {teamInfo.logo ? <Image source={{ uri: dark && teamInfo.logoDark ? teamInfo.logoDark : teamInfo.logo }} style={styles.teamLogo} contentFit="contain" /> : null}
                  <Text style={[styles.teamName, { color: text }]}>{teamInfo.displayName}</Text>
                </Pressable>

                {(() => {
                  // Batter columns. MLB uses the ESPN hitter set (H-AB, R, HR,
                  // RBI, BB, K, AVG, OBP, SLG); other sports keep finalLabels.
                  const batterLabels = sport === 'mlb'
                    ? ['H-AB', 'R', 'HR', 'RBI', 'BB', 'K', 'AVG', 'OBP', 'SLG']
                        .filter(l => sorted.some(a => a.stats[l] !== undefined && a.stats[l] !== '--'))
                    : finalLabels;
                  const pitcherTeam = summary.pitcherTeams?.[ti];
                  const pitcherLabels = ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC', 'ERA'];
                  const openPlayer = (id: string) => router.push({ pathname: '/player/[id]', params: { id, sport } } as any);
                  const toggleFav = (a: BSAthlete) => togglePlayer({
                    id: a.id, name: a.name, headshot: a.headshot, position: a.position,
                    teamAbbr: teamInfo.abbreviation, sport,
                  } as FavoritePlayer);
                  return (
                    <>
                      {sport === 'mlb' && (
                        <Text style={{ color: sub, fontSize: 11, fontFamily: F.black, letterSpacing: 0.8, marginBottom: 6, marginTop: 2 }}>HITTERS</Text>
                      )}
                      <BoxScoreTable
                        athletes={sorted as any} labels={batterLabels}
                        text={text} sub={sub} border={border} cardBg={cardBg}
                        onOpenPlayer={openPlayer} isFav={isPlayerFav} toggleFav={toggleFav}
                        staggerSubs={sport === 'mlb'}
                      />
                      {sport === 'mlb' && pitcherTeam && pitcherTeam.athletes.length > 0 && (
                        <>
                          <Text style={{ color: sub, fontSize: 11, fontFamily: F.black, letterSpacing: 0.8, marginBottom: 6, marginTop: 14 }}>PITCHERS</Text>
                          <BoxScoreTable
                            athletes={pitcherTeam.athletes as any} labels={pitcherLabels}
                            text={text} sub={sub} border={border} cardBg={cardBg}
                            onOpenPlayer={openPlayer} isFav={isPlayerFav} toggleFav={toggleFav}
                          />
                        </>
                      )}
                    </>
                  );
                })()}
              </Animated.View>
            );
          })}
          </View>

          {/* TEAM STATS — live/final boxscore stats, falling back to season averages pre-game */}
          {(() => {
            const hasLive = summary.teamStats.length > 0 && summary.teamStats[0].stats.length > 0;
            const away = summary.teamSeasonStats?.find(t => t.homeAway === 'away');
            const home = summary.teamSeasonStats?.find(t => t.homeAway === 'home');
            const hasseason = (away?.stats?.length ?? 0) > 0 || (home?.stats?.length ?? 0) > 0;
            if (!hasLive && !hasseason) return null;

            if (hasLive) {
              return (
                <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.section}>
                  <View style={[styles.teamHeader, { borderLeftColor: cfg?.color ?? '#888' }]}>
                    <Text style={[styles.teamName, { color: text }]}>Team Stats</Text>
                  </View>
                  {summary.teamStats[0].stats.slice(0, 10).map((stat, i) => {
                    const awayVal = summary.teamStats[0]?.stats[i]?.value ?? '--';
                    const homeVal = summary.teamStats[1]?.stats[i]?.value ?? '--';
                    return (
                      <View key={stat.label} style={[styles.teamStatRow, { backgroundColor: cardBg, borderColor: border }]}>
                        <Text style={[styles.teamStatVal, { color: text }]}>{awayVal}</Text>
                        <Text style={[styles.teamStatLabel, { color: sub }]}>{stat.label}</Text>
                        <Text style={[styles.teamStatVal, { color: text, textAlign: 'right' }]}>{homeVal}</Text>
                      </View>
                    );
                  })}
                </Animated.View>
              );
            }

            // Pre-game: show season averages
            const statLabels = away?.stats ?? home?.stats ?? [];
            return (
              <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.section}>
                <View style={[styles.teamHeader, { borderLeftColor: cfg?.color ?? '#888' }]}>
                  <Text style={[styles.teamName, { color: text }]}>Season Averages</Text>
                </View>
                <View style={[styles.teamStatRow, { backgroundColor: cardBg, borderColor: border }]}>
                  <Text style={[styles.teamStatVal, { color: sub, fontSize: 11 }]}>{summary.away.team.abbreviation}{away?.record ? ` (${away.record})` : ''}</Text>
                  <Text style={[styles.teamStatLabel, { color: sub }]}> </Text>
                  <Text style={[styles.teamStatVal, { color: sub, fontSize: 11, textAlign: 'right' }]}>{summary.home.team.abbreviation}{home?.record ? ` (${home.record})` : ''}</Text>
                </View>
                {statLabels.slice(0, 12).map((stat, i) => {
                  const awayVal = away?.stats[i]?.displayValue ?? '--';
                  const homeVal = home?.stats[i]?.displayValue ?? '--';
                  return (
                    <View key={stat.name + i} style={[styles.teamStatRow, { backgroundColor: cardBg, borderColor: border }]}>
                      <Text style={[styles.teamStatVal, { color: text }]}>{awayVal}</Text>
                      <Text style={[styles.teamStatLabel, { color: sub }]}>{stat.label}</Text>
                      <Text style={[styles.teamStatVal, { color: text, textAlign: 'right' }]}>{homeVal}</Text>
                    </View>
                  );
                })}
              </Animated.View>
            );
          })()}
        </ScrollView>
      )}

      {activeTab === 'plays' && (
        /* PLAYS TAB */
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Score display */}
          {playsData && (
            <View style={[styles.playsScoreCard, { backgroundColor: cardBg, borderColor: border }]}>
              <View style={styles.playsScoreTeam}>
                {(dark ? summary.away.team.logoDark : summary.away.team.logo)
                  ? <Image source={{ uri: dark ? (summary.away.team.logoDark ?? summary.away.team.logo) : summary.away.team.logo }} style={styles.playsScoreLogo} contentFit="contain" />
                  : null}
                <Text style={[styles.playsScoreAbbr, { color: sub }]}>{summary.away.team.abbreviation}</Text>
                <ScoreFlash value={playsData.plays[0]?.awayScore ?? 0} color={`#${summary.away.team.color}`} text={text} />
              </View>
              <View style={styles.playsScoreCenter}>
                <Text style={[styles.playsScoreStatus, { color: readAccent }]}>{playsData.status.description}</Text>
                {/* Center clock shows "Q3 6:05" / "P2 14:32" / "5th Inning" so
                   you instantly see WHICH period the time belongs to. */}
                {(() => {
                  const clk = liveClock || playsData.status.clock;
                  const per = playsData.status.period;
                  // Per-sport period label
                  const periodLabel = (() => {
                    if (!per) return '';
                    if (sport === 'nba') return `Q${per}`;
                    if (sport === 'nfl') return `Q${per}`;
                    if (sport === 'nhl') return `P${per}`;
                    if (sport === 'mlb') {
                      const ord = per === 1 ? '1st' : per === 2 ? '2nd' : per === 3 ? '3rd' : `${per}th`;
                      return `${ord} Inning`;
                    }
                    return `Q${per}`;
                  })();
                  // MLB has no clock — show inning only
                  if (sport === 'mlb') {
                    return per
                      ? <Text style={[styles.playsScoreClock, { color: sub }]}>{periodLabel}</Text>
                      : null;
                  }
                  // Other sports: combine period + clock, e.g., "Q3 6:05"
                  if (!clk || clk === '0:00') {
                    // Only period available (between quarters / end of game)
                    return per ? <Text style={[styles.playsScoreClock, { color: sub }]}>{periodLabel}</Text> : null;
                  }
                  return (
                    <Text style={[styles.playsScoreClock, { color: sub }]}>
                      {periodLabel}  {clk}
                    </Text>
                  );
                })()}
              </View>
              <View style={styles.playsScoreTeam}>
                {(dark ? summary.home.team.logoDark : summary.home.team.logo)
                  ? <Image source={{ uri: dark ? (summary.home.team.logoDark ?? summary.home.team.logo) : summary.home.team.logo }} style={styles.playsScoreLogo} contentFit="contain" />
                  : null}
                <Text style={[styles.playsScoreAbbr, { color: sub }]}>{summary.home.team.abbreviation}</Text>
                <ScoreFlash value={playsData.plays[0]?.homeScore ?? 0} color={`#${summary.home.team.color}`} text={text} />
              </View>
            </View>
          )}

          {/* ESPN-style play visuals (NBA): possession + animated court overlay */}
          {(() => {
            const latestPlay = playsData?.plays?.[0] ?? null;
            const latestFieldPlay = sport === 'mlb'
              ? (playsData?.plays ?? []).find(p => p.onFirst || p.onSecond || p.onThird || p.outs != null) ?? latestPlay
              : latestPlay;
            const statusDescription = playsData?.status?.description || summary.status.description || '';
            const recentBreakDescription = (playsData?.plays ?? [])
              .slice(0, 4)
              .map(p => p.text)
              .find(isMlbInningBreak);
            const inningBreakDescription = isMlbInningBreak(statusDescription)
              ? statusDescription
              : recentBreakDescription;
            if (sport === 'mlb' && (/final/i.test(summary.status.description || statusDescription) || inningBreakDescription)) {
              return (
                <View style={styles.courtWrap}>
                  <BetweenInningsMlbView
                    summary={summary}
                    plays={playsData?.plays ?? []}
                    dark={dark}
                    transitionDescription={inningBreakDescription || statusDescription}
                  />
                </View>
              );
            }
            if (!latestPlay || sport !== 'nba') {
              return (
                <View style={styles.courtWrap}>
                  <CourtView
                    sport={sport}
                    homeLogo={summary.home.team.logo}
                    homeColor={summary.home.team.color}
                    awayColor={summary.away.team.color}
                    homeTeamAbbr={summary.home.team.abbreviation}
                    isLive={playsData?.status?.state === 'in' ||
                      (!!summary.status.description && !summary.status.description.toLowerCase().includes('final') && !summary.status.description.toLowerCase().includes('scheduled'))}
                    isDelayed={!!summary.status.description?.toLowerCase().includes('delay')}
                    latestPlay={latestPlay}
                    runnerStatePlay={latestFieldPlay}
                  />
                </View>
              );
            }
            const kind = classifyPlay(latestPlay);
            const homeId = summary.home.team.abbreviation;
            const awayId = summary.away.team.abbreviation;
            // Resolve which team's color to use
            const isHomePlay = latestPlay.teamId === homeId || latestPlay.teamId === String(summary.home.team.displayName);
            const isAwayPlay = latestPlay.teamId === awayId || latestPlay.teamId === String(summary.away.team.displayName);
            const possessionTeam = isHomePlay ? summary.home.team
              : isAwayPlay ? summary.away.team
              : null;
            const possessionColor = possessionTeam?.color
              ? `#${possessionTeam.color}`
              : (cfg?.color ?? '#888');

            return (
              <>
                {/* POSSESSION banner */}
                <PossessionBanner team={possessionTeam} color={possessionColor} dark={dark} />

                {/* Court + animated overlays */}
                <View style={styles.courtWrap}>
                  <View style={{ position: 'relative' }}>
                    <CourtView
                      sport={sport}
                      homeLogo={summary.home.team.logo}
                      homeColor={summary.home.team.color}
                      awayColor={summary.away.team.color}
                      homeTeamAbbr={summary.home.team.abbreviation}
                    />
                    {/* Animated shot marker */}
                    <CourtPlayOverlay
                      play={latestPlay}
                      kind={kind}
                      teamColor={possessionColor}
                      offenseLeft={isHomePlay}
                    />
                    {/* Big highlight banner for major plays.
                       For turnovers: the team that COMMITS the turnover loses
                       possession, so the arrow points away from them. */}
                    <PlayHighlight
                      play={latestPlay}
                      kind={kind}
                      teamColor={possessionColor}
                      possessionAfterArrow={
                        kind === 'turnover'
                          ? (isHomePlay ? 'left' : isAwayPlay ? 'right' : null)
                          : null
                      }
                    />
                  </View>
                </View>
              </>
            );
          })()}

          {/* Play list */}
          {playsLoading && !playsData ? (
            <ActivityIndicator style={{ marginTop: 40 }} size="large" color={cfg?.color ?? '#888'} />
          ) : (
            <View style={[{ paddingBottom: 24 }, { backgroundColor: cardBg }]}>
              {(() => {
                const plays = playsData?.plays ?? [];
                if (plays.length === 0) return (
                  <View style={styles.noPlays}>
                    <Text style={[styles.noPlaysText, { color: sub }]}>No play-by-play available yet</Text>
                  </View>
                );

                // For MLB, collapse individual pitch events into at-bat groups
                // so the zone visualization shows all pitches together
                if (sport === 'mlb') {
                  type AtBatGroup = { kind: 'atbat'; atBatId: string; pitches: Play[]; header: Play | null };
                  type PlainPlay  = { kind: 'play'; play: Play; index: number };
                  const items: Array<AtBatGroup | PlainPlay> = [];
                  const abMap: Record<string, AtBatGroup> = {};

                  // MLB: process ALL plays so older innings can collapse into
                  // their own dropdown sections (server now sends up to 400).
                  plays.forEach((play, i) => {
                    if (play.atBatId && play.pitchCoordinate) {
                      if (!abMap[play.atBatId]) {
                        abMap[play.atBatId] = { kind: 'atbat', atBatId: play.atBatId, pitches: [], header: null };
                        items.push(abMap[play.atBatId]);
                      }
                      abMap[play.atBatId].pitches.push(play);
                    } else if (play.atBatId && !play.pitchCoordinate && play.text.match(/pitches to|grounded|singled|doubled|tripled|homered|struck out|walked|flied|lined|popped|hit by/i)) {
                      if (!abMap[play.atBatId]) {
                        abMap[play.atBatId] = { kind: 'atbat', atBatId: play.atBatId, pitches: [], header: null };
                        items.push(abMap[play.atBatId]);
                      }
                      if (!abMap[play.atBatId].header) abMap[play.atBatId].header = play;
                    } else {
                      items.push({ kind: 'play', play, index: i });
                    }
                  });

                  // ── Group items by inning so old innings can collapse into a tappable header.
                  // The period for the at-bat group comes from its header/first pitch; for plain
                  // plays it's just play.period. Items are reverse-chronological, so the FIRST
                  // group is the current/most-recent inning (always expanded).
                  //
                  // ESPN's period string varies: "1st Inning", "Top of the 5th", "Bottom of the
                  // 5th Inning" all need to bucket into the same Inning N. We extract the inning
                  // number with a regex so half-innings collapse into one group.
                  const inningOf = (item: AtBatGroup | PlainPlay): string => {
                    const raw = item.kind === 'atbat'
                      ? (item.header ?? item.pitches[0])?.period
                      : item.play.period;
                    if (!raw) return 'Inning';
                    const m = raw.match(/(\d+)(?:st|nd|rd|th)/i);
                    return m ? `Inning ${m[1]}` : raw;
                  };
                  const groups: Array<{ inning: string; items: Array<AtBatGroup | PlainPlay> }> = [];
                  for (const item of items) {
                    const inn = inningOf(item);
                    const last = groups[groups.length - 1];
                    if (last && last.inning === inn) last.items.push(item);
                    else groups.push({ inning: inn, items: [item] });
                  }

                  // Render a single item to JSX. Hoisted so we can use it inside the
                  // expanded section without duplicating logic.
                  const renderItem = (item: AtBatGroup | PlainPlay, i: number) => {
                    if (item.kind === 'atbat') {
                      const { pitches, header, atBatId } = item;
                      // Sorted pitches — only plays whose text starts with "Pitch N :"
                      const allSortedEarly = [...pitches].sort((a, b) => (a.atBatPitchNumber ?? 0) - (b.atBatPitchNumber ?? 0));
                      const realPitchesEarly = allSortedEarly.filter(p => /^Pitch \d+\s*:/i.test(p.text));
                      // If no explicit header (= result play without pitchCoord), fall back to
                      // first real pitch. Skip the entire group if we have nothing to show.
                      const headerPlay = header ?? realPitchesEarly[0] ?? allSortedEarly[0];
                      if (!headerPlay) return null;
                      const primary = headerPlay.participants?.[0];
                      const primaryHeadshot = primary?.headshot
                        || (primary?.name ? playerHeadshotMap[primary.name.toLowerCase()] : null)
                        || (primary?.name ? playerHeadshotMap[primary.name.split(' ').pop()?.toLowerCase() ?? ''] : null);
                      const teamColor = headerPlay.teamId === summary.home.team.abbreviation
                        ? `#${summary.home.team.color}`
                        : headerPlay.teamId === summary.away.team.abbreviation
                        ? `#${summary.away.team.color}` : undefined;
                      const accent = teamColor ?? sub;
                      // Only keep plays whose text starts with "Pitch N :" — the actual pitch events
                      const allSorted = allSortedEarly;
                      const sortedPitches = allSorted.filter(p => /^Pitch \d+\s*:/i.test(p.text));
                      // Outcome badge — scan all plays in the at-bat for outcomeAbbr
                      const outcomePlay = [header, ...allSorted].find(p => p?.outcomeAbbr);
                      // Result play = the one whose TEXT describes the final outcome
                      // (e.g. "Judge grounds out, shortstop to first"). Not a pitch
                      // line. This is what tells us how the batter got out.
                      const RESULT_RE = /grounds?\s|grounded|flies?\s?out|fly out|flied|pops?\s?out|popped|lines?\s?out|lined|singl|doubl|tripl|home run|homer|strikes?\s?out|struck out|walks?|hit by|sacrifice|fielder'?s choice|double play|triple play|reach(es|ed)|forced? out|out at|tagged|thrown out|grounder|fly ball|line drive|pop up/i;
                      const resultPlay =
                        [header, ...allSorted].find(p => p && !/^Pitch \d+\s*:/i.test(p.text) && RESULT_RE.test(p.text))
                        ?? outcomePlay;
                      const resultText = resultPlay?.text || null;
                      // Prefer the tidy abbreviation, else parse the result text so
                      // field outs (groundout/flyout/popout/lineout/…) still show.
                      const outcomeKind =
                        (outcomePlay ? outcomeFromAbbr(
                          outcomePlay.outcomeAbbr, outcomePlay.scoreValue,
                          outcomePlay.onFirst, outcomePlay.onSecond, outcomePlay.onThird,
                        ) : null)
                        ?? outcomeFromText(resultText);
                      // Base state: prefer play with outcomeAbbr (most up-to-date), else header, else first pitch
                      const basesPlay =
                        [outcomePlay, resultPlay, header, ...[...allSorted].reverse()]
                          .find(p => p && (p.onFirst || p.onSecond || p.onThird || p.outs != null))
                        ?? outcomePlay ?? header ?? allSorted[allSorted.length - 1];
                      const hasBaseData = !!(basesPlay && (basesPlay.onFirst || basesPlay.onSecond || basesPlay.onThird || basesPlay.outs != null));

                      return (
                        <Animated.View key={atBatId} entering={FadeInDown.duration(240)}
                          style={[playStyles.row, { backgroundColor: cardBg, borderBottomColor: border },
                            headerPlay.scoringPlay && { backgroundColor: accent + '12', borderLeftWidth: 3, borderLeftColor: accent },
                          ]}>

                          {/* Situation strip */}
                          <View style={playStyles.situation}>
                            {i === 0 && <View style={playStyles.liveDot} />}
                            <Text style={[playStyles.situationTxt, { color: sub }]} numberOfLines={1}>
                              {[
                                headerPlay.awayScore != null ? `${headerPlay.awayScore}–${headerPlay.homeScore}` : null,
                                headerPlay.period,
                              ].filter(Boolean).join('  ·  ')}
                            </Text>
                            {headerPlay.scoringPlay && headerPlay.scoreValue > 0 && (
                              <Text style={[playStyles.scoreDelta, { color: accent }]}>▲{headerPlay.scoreValue}</Text>
                            )}
                          </View>

                          {/* Resolve pitcher/batter once for the whole card */}
                          {(() => null)()}
                          {(() => {
                            // Type-based lookup is stable across polls; index-based would
                            // swap roles when ESPN reorders participants.
                            const parts = headerPlay.participants ?? [];
                            const pitcher = parts.find(p => p.type === 'pitcher')
                              ?? (parts.length === 2 ? parts[0] : undefined);
                            const batter  = parts.find(p => p.type === 'batter')
                              ?? (parts.length === 2 ? parts[1] : undefined);
                            const resolve = (p: typeof pitcher) => {
                              if (!p) return undefined;
                              if (p.headshot) return p.headshot;
                              const k = p.name?.toLowerCase() ?? '';
                              return playerHeadshotMap[k]
                                ?? playerHeadshotMap[p.name?.split(' ').pop()?.toLowerCase() ?? ''];
                            };
                            const pitcherShot = resolve(pitcher);
                            const batterShot  = resolve(batter);

                            // Headline title (computed here so we can use pitcher/batter names)
                            const headlineText = (() => {
                              const t = headerPlay.text;
                              if (t.match(/^End Batter|^End At-Bat/i))
                                return outcomePlay?.text ?? primary?.name ?? t;
                              if (t.match(/^Pitch \d+\s*:/i)) {
                                if (pitcher?.name && batter?.name) return `${pitcher.name} pitches to ${batter.name}`;
                                if (pitcher?.name) return `${pitcher.name} at bat`;
                                return outcomePlay?.text ?? t;
                              }
                              return t;
                            })();

                            return (
                              <>
                                {/* ── TOP ROW: avatars + headline ── */}
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                                  {/* Left: avatars + text stack */}
                                  <View style={{ flex: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                                    {/* Pitcher VS Batter — pitcher always on left */}
                                    {(batter || pitcher) ? (
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                        <AtBatAvatar url={pitcherShot} name={pitcher?.name} dark={dark} accent={accent} />
                                        <Text style={{ color: sub, fontSize: 9, fontFamily: F.black }}>VS</Text>
                                        <AtBatAvatar url={batterShot} name={batter?.name} dark={dark} accent={accent}
                                          ringColor={headerPlay.scoringPlay ? accent : undefined} />
                                      </View>
                                    ) : (
                                      <AtBatAvatar url={primaryHeadshot ?? undefined} name={primary?.name} dark={dark} accent={accent}
                                        ringColor={headerPlay.scoringPlay ? accent : undefined} />
                                    )}
                                    {/* Headline + outcome badge + RBI count */}
                                    <View style={{ flex: 1, gap: 5, minWidth: 0 }}>
                                      <Text style={[playStyles.headline, { color: headerPlay.scoringPlay ? accent : text }]}>
                                        {headlineText}
                                      </Text>
                                      {(() => {
                                        // RBI = runs scored on the outcome play. Show next to the
                                        // outcome badge whenever a hit/HR drove in at least one run.
                                        const rbi = outcomePlay?.scoreValue ?? 0;
                                        const showRbi = outcomeKind && rbi > 0 &&
                                          (outcomeKind === '1B' || outcomeKind === '2B' || outcomeKind === '3B' ||
                                           outcomeKind === 'HR' || outcomeKind === 'HR2' || outcomeKind === 'HR3' || outcomeKind === 'SLAM');
                                        if (!outcomeKind && !showRbi) return null;
                                        return (
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            {outcomeKind && <OutcomeBadge kind={outcomeKind} />}
                                            {showRbi && (
                                              <View style={{
                                                paddingHorizontal: 8, paddingVertical: 3,
                                                borderRadius: 6,
                                                backgroundColor: '#FF9F0A22',
                                                borderWidth: 1, borderColor: '#FF9F0A66',
                                              }}>
                                                <Text style={{ color: '#FF9F0A', fontSize: 11, fontFamily: F.black, letterSpacing: 0.3 }}>
                                                  {rbi} RBI
                                                </Text>
                                              </View>
                                            )}
                                          </View>
                                        );
                                      })()}
                                      {/* Full descriptive result — always shows HOW the at-bat
                                          ended (e.g. "Judge grounds out, shortstop to first"),
                                          so completed at-bats are never left blank. */}
                                      {resultText && !/^Pitch \d+\s*:/i.test(resultText) && resultText !== headlineText && (
                                        <Text style={{ color: sub, fontSize: 12, fontFamily: F.regular, lineHeight: 16 }}>
                                          {resultText}
                                        </Text>
                                      )}
                                      {(() => {
                                        const lastPitchWithMeta = [...sortedPitches].reverse().find(p => p.pitchCount != null || p.onDeck) ?? null;
                                        const normPitcher = pitcher?.name?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
                                        const pitcherBox = normPitcher
                                          ? (summary.pitcherTeams ?? [])
                                              .flatMap(team => team.athletes)
                                              .find(a => {
                                                const n = a.name.toLowerCase().replace(/[^a-z]/g, '');
                                                return n.includes(normPitcher) || normPitcher.includes(n);
                                              })
                                          : undefined;
                                        const boxPitchCount = Number(pitcherBox?.stats?.PC ?? NaN);
                                        const numPC = (v: any) => (typeof v === 'number' ? v : undefined);
                                        const pitchCount = numPC(lastPitchWithMeta?.pitchCount)
                                          ?? numPC(headerPlay.pitchCount)
                                          ?? (!Number.isNaN(boxPitchCount) ? boxPitchCount : null);
                                        const onDeck = lastPitchWithMeta?.onDeck ?? headerPlay.onDeck ?? null;
                                        if (pitchCount == null && !onDeck) return null;
                                        return (
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                                            {pitchCount != null ? (
                                              <Text style={{ color: sub, fontSize: 11, fontFamily: F.black, letterSpacing: 0.4 }}>
                                                PC {pitchCount}
                                              </Text>
                                            ) : null}
                                            {onDeck ? (
                                              <Text style={{ color: sub, fontSize: 11, fontFamily: F.bold }} numberOfLines={1}>
                                                On deck: {onDeck.name}
                                              </Text>
                                            ) : null}
                                          </View>
                                        );
                                      })()}
                                    </View>
                                  </View>
                                </View>

                                {/* Balls / Strikes / Outs count for the at-bat */}
                                {(() => {
                                  const lastPitch = sortedPitches[sortedPitches.length - 1];
                                  const balls = Math.min(3, lastPitch?.resultCount?.balls ?? 0);
                                  const strikes = Math.min(2, lastPitch?.resultCount?.strikes ?? 0);
                                  const outs = Math.min(3, basesPlay?.outs ?? 0);
                                  if (sortedPitches.length === 0 && outs === 0) return null;
                                  const Dots = ({ n, total, on }: { n: number; total: number; on: string }) => (
                                    <View style={{ flexDirection: 'row', gap: 3 }}>
                                      {Array.from({ length: total }).map((_, i) => (
                                        <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < n ? on : (dark ? '#3a3a3c' : '#d1d1d6') }} />
                                      ))}
                                    </View>
                                  );
                                  return (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 }}>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                        <Text style={{ color: sub, fontSize: 10, fontFamily: F.black }}>B</Text>
                                        <Dots n={balls} total={3} on="#34C759" />
                                      </View>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                        <Text style={{ color: sub, fontSize: 10, fontFamily: F.black }}>S</Text>
                                        <Dots n={strikes} total={2} on="#FFD60A" />
                                      </View>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                        <Text style={{ color: sub, fontSize: 10, fontFamily: F.black }}>O</Text>
                                        <Dots n={outs} total={3} on="#FF3B30" />
                                      </View>
                                    </View>
                                  );
                                })()}

                                {/* ── BOTTOM ROW: pitch list (left) | base diamond over strike zone (right) ── */}
                                {sortedPitches.length > 0 && (
                                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 6 }}>
                                    <View style={{ flex: 1, gap: 4 }}>
                                      {[...sortedPitches].reverse().map(p => {
                                        const color = pitchColor(p.text);
                                        // Drop the "Pitch N :" prefix (already shown by the
                                        // numbered dot). Keep everything else verbatim so the
                                        // pitch type is fully readable — "Knuckle Curve", not "KC".
                                        const outcome = p.text.replace(/^Pitch \d+ :\s*/i, '');
                                        return (
                                          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                                            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: color, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                                              <Text style={{ color: '#fff', fontSize: 9, fontFamily: F.black }}>{p.atBatPitchNumber}</Text>
                                            </View>
                                            <Text style={{ color: sub, fontSize: 11, fontFamily: F.regular, flex: 1, lineHeight: 15 }} numberOfLines={2} ellipsizeMode="tail">
                                              {outcome}
                                              {p.pitchType?.text ? `  ·  ${p.pitchType.text}` : ''}
                                              {p.pitchVelocity ? `  ·  ${p.pitchVelocity} mph` : ''}
                                            </Text>
                                          </View>
                                        );
                                      })}
                                    </View>
                                    <View style={{
                                      flexShrink: 0,
                                      alignItems: 'center',
                                      gap: 4,
                                      transform: [{ translateY: -14 }],
                                      marginBottom: -14,
                                    }}>
                                      {hasBaseData && (
                                        <BaseDiamond
                                          onFirst={basesPlay.onFirst}
                                          onSecond={basesPlay.onSecond}
                                          onThird={basesPlay.onThird}
                                          outs={basesPlay.outs}
                                          dark={dark}
                                        />
                                      )}
                                      <StrikeZone pitches={sortedPitches} dark={dark} />
                                    </View>
                                  </View>
                                )}
                              </>
                            );
                          })()}
                        </Animated.View>
                      );
                    }

                    // ── Plain MLB play (pinch runner, pitching change, inning break…) ──
                    const { play, index } = item;
                    const teamColor = play.teamId === summary.home.team.abbreviation
                      ? `#${summary.home.team.color}`
                      : play.teamId === summary.away.team.abbreviation
                      ? `#${summary.away.team.color}` : undefined;
                    const playAccent = teamColor ?? sub;

                    // Inning transition ("Middle of 4th", "End of inning")
                    const isInningBreak = !play.participants?.length &&
                      /middle|end of|start of|top of|bottom of/i.test(play.text);
                    if (isInningBreak) {
                      return (
                        <Animated.View key={play.id} entering={FadeInDown.duration(200)}
                          style={[playStyles.row, { backgroundColor: cardBg, borderBottomColor: border }]}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: playAccent + '22', alignItems: 'center', justifyContent: 'center' }}>
                              <IconSymbol name="baseball.fill" size={17} color={playAccent} />
                            </View>
                            <Text style={{ color: sub, fontSize: 13, fontFamily: F.bold }}>{play.text}</Text>
                          </View>
                        </Animated.View>
                      );
                    }

                    // Pinch runner / substitution — participant IS the incoming player
                    const isPinchPlay = /ran for|replaced by|pinch run/i.test(play.text);
                    if (isPinchPlay) {
                      const runner = play.participants?.[0];
                      const runnerShot = runner?.headshot
                        || (runner?.name ? playerHeadshotMap[runner.name.toLowerCase()] : null)
                        || (runner?.name ? playerHeadshotMap[runner.name.split(' ').pop()?.toLowerCase() ?? ''] : null);
                      return (
                        <Animated.View key={play.id} entering={FadeInDown.duration(220)}
                          style={[playStyles.row, { backgroundColor: cardBg, borderBottomColor: border }]}>
                          <View style={playStyles.situation}>
                            {index === 0 && <View style={playStyles.liveDot} />}
                            <Text style={[playStyles.situationTxt, { color: sub }]}>
                              {[play.awayScore != null ? `${play.awayScore}–${play.homeScore}` : null, play.period].filter(Boolean).join('  ·  ')}
                            </Text>
                          </View>
                          <View style={playStyles.body}>
                            <View style={[playStyles.avatarWrap, { borderColor: 'transparent' }]}>
                              {runnerShot
                                ? <Image source={{ uri: runnerShot }} style={playStyles.avatar} contentFit="cover" />
                                : <View style={[playStyles.avatarFallback, { backgroundColor: playAccent + '22' }]}>
                                    {runner?.name
                                      ? <Text style={[playStyles.avatarInitials, { color: playAccent }]}>
                                          {runner.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}
                                        </Text>
                                      : <IconSymbol name="figure.run" size={22} color={playAccent} />}
                                  </View>
                              }
                            </View>
                            <View style={playStyles.textCol}>
                              <Text style={[playStyles.headline, { color: text }]}>{play.typeText || play.text}</Text>
                              <Text style={[playStyles.subLine, { color: sub }]} numberOfLines={2}>{play.text}</Text>
                            </View>
                          </View>
                        </Animated.View>
                      );
                    }

                    // All other plain MLB plays
                    return (
                      <PulsingPlayRow
                        key={play.id} play={play} sub={sub} text={text}
                        border={border} cardBg={cardBg}
                        isLatestScoring={index === latestScoringIdx}
                        isFirst={index === 0} teamColor={teamColor}
                        awayAbbr={summary.away.team.abbreviation}
                        homeAbbr={summary.home.team.abbreviation}
                        headshotMap={playerHeadshotMap}
                        awayTeamId={summary.away.team.id}
                        homeTeamId={summary.home.team.id}
                        awayLogo={dark ? (summary.away.team.logoDark ?? summary.away.team.logo) : summary.away.team.logo}
                        homeLogo={dark ? (summary.home.team.logoDark ?? summary.home.team.logo) : summary.home.team.logo}
                      />
                    );
                  };

                  // Render inning groups: first one expanded, others collapsible.
                  return groups.map((g, gIdx) => {
                    const isCurrent = gIdx === 0;
                    const isExpanded = isCurrent || expandedInnings.has(g.inning);
                    const count = g.items.length;
                    // Current inning toggles like the others (expanded by default).
                    // Users can collapse it if they want; older innings start collapsed.
                    const isUserToggled = expandedInnings.has(g.inning);
                    const open = isCurrent ? !isUserToggled : isUserToggled;
                    return (
                      <View key={`inning-${g.inning}-${gIdx}`}>
                        <Pressable
                          onPress={() => toggleInning(g.inning)}
                          style={{
                            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                            paddingVertical: 12, paddingHorizontal: 16,
                            backgroundColor: dark ? '#161618' : '#f5f5f7',
                            borderTopWidth: 1, borderTopColor: border,
                            borderBottomWidth: open ? 1 : 0, borderBottomColor: border,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ color: text, fontSize: 13, fontFamily: F.black, letterSpacing: 0.5 }}>
                              {g.inning.toUpperCase()}
                            </Text>
                            {isCurrent && (
                              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' }} />
                            )}
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ color: sub, fontSize: 11, fontFamily: F.bold }}>
                              {count} {count === 1 ? 'play' : 'plays'}
                            </Text>
                            <Text style={{ color: sub, fontSize: 12, fontFamily: F.bold }}>
                              {open ? '▾' : '▸'}
                            </Text>
                          </View>
                        </Pressable>
                        {open && g.items.map((it, idx) => renderItem(it, idx))}
                      </View>
                    );
                  });
                }

                // Non-MLB (NBA/NFL/NHL): group plays by quarter/period with the
                // same collapsible dropdown UI as MLB innings. Most-recent period
                // expanded by default; older periods start collapsed.
                //
                // ESPN's period string varies by sport — normalize so:
                //  NBA: "1st Quarter" → "Quarter 1"
                //  NFL: "2nd Quarter" → "Quarter 2"
                //  NHL: "3rd Period"  → "Period 3"
                //  OT:  "OT", "Overtime", "1st OT" stays as-is
                const periodOf = (p: typeof plays[number]): string => {
                  const raw = p.period;
                  if (!raw) return 'Game';
                  if (/^OT|overtime/i.test(raw)) return raw;
                  const m = raw.match(/(\d+)(?:st|nd|rd|th)\s*(Quarter|Period|Half)/i);
                  if (m) return `${m[2]} ${m[1]}`;
                  return raw;
                };

                const periodGroups: Array<{ period: string; plays: typeof plays }> = [];
                for (const play of plays) {
                  const per = periodOf(play);
                  const last = periodGroups[periodGroups.length - 1];
                  if (last && last.period === per) last.plays.push(play);
                  else periodGroups.push({ period: per, plays: [play] });
                }

                return periodGroups.map((g, gIdx) => {
                  const isCurrent = gIdx === 0;
                  const isUserToggled = expandedInnings.has(g.period);
                  const open = isCurrent ? !isUserToggled : isUserToggled;
                  const count = g.plays.length;
                  return (
                    <View key={`period-${g.period}-${gIdx}`}>
                      <Pressable
                        onPress={() => toggleInning(g.period)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          paddingVertical: 12, paddingHorizontal: 16,
                          backgroundColor: dark ? '#161618' : '#f5f5f7',
                          borderTopWidth: 1, borderTopColor: border,
                          borderBottomWidth: open ? 1 : 0, borderBottomColor: border,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ color: text, fontSize: 13, fontFamily: F.black, letterSpacing: 0.5 }}>
                            {g.period.toUpperCase()}
                          </Text>
                          {isCurrent && (
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' }} />
                          )}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ color: sub, fontSize: 11, fontFamily: F.bold }}>
                            {count} {count === 1 ? 'play' : 'plays'}
                          </Text>
                          <Text style={{ color: sub, fontSize: 12, fontFamily: F.bold }}>
                            {open ? '▾' : '▸'}
                          </Text>
                        </View>
                      </Pressable>
                      {open && g.plays.map((play, i) => {
                        const teamColor = play.teamId === summary.home.team.abbreviation
                          ? `#${summary.home.team.color}`
                          : play.teamId === summary.away.team.abbreviation
                          ? `#${summary.away.team.color}` : undefined;
                        return (
                          <PulsingPlayRow
                            key={play.id} play={play} sub={sub} text={text}
                            border={border} cardBg={cardBg}
                            isLatestScoring={false}
                            isFirst={isCurrent && i === 0} teamColor={teamColor}
                            awayAbbr={summary.away.team.abbreviation}
                            homeAbbr={summary.home.team.abbreviation}
                            headshotMap={playerHeadshotMap}
                            awayTeamId={summary.away.team.id}
                            homeTeamId={summary.home.team.id}
                            awayLogo={dark ? (summary.away.team.logoDark ?? summary.away.team.logo) : summary.away.team.logo}
                            homeLogo={dark ? (summary.home.team.logoDark ?? summary.home.team.logo) : summary.home.team.logo}
                          />
                        );
                      })}
                    </View>
                  );
                });
              })()}
              {(playsData?.plays ?? []).length === 0 && (
                <View style={styles.noPlays}>
                  <Text style={[styles.noPlaysText, { color: sub }]}>No play-by-play available yet</Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {activeTab === 'scoring' && (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: 8 }]} showsVerticalScrollIndicator={false}>
          {playsLoading && !playsData ? (
            <ActivityIndicator style={{ marginTop: 40 }} size="large" color={cfg?.color ?? '#888'} />
          ) : (() => {
            // Only scoring plays, oldest → newest so it reads like a recap.
            const scoring = [...(playsData?.plays ?? [])].filter(p => p.scoringPlay).reverse();
            if (scoring.length === 0) {
              return (
                <View style={styles.noPlays}>
                  <Text style={[styles.noPlaysText, { color: sub }]}>No scoring plays yet</Text>
                </View>
              );
            }
            // Group by period (inning / quarter / period).
            const groups: { period: string; plays: typeof scoring }[] = [];
            for (const p of scoring) {
              const last = groups[groups.length - 1];
              if (last && last.period === p.period) last.plays.push(p);
              else groups.push({ period: p.period || '', plays: [p] });
            }
            return groups.map((g, gi) => (
              <View key={`sg-${gi}`} style={{ marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
                  <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: cfg?.color ?? '#888' }} />
                  <Text style={{ color: text, fontSize: 13, fontFamily: F.black, letterSpacing: 0.5 }}>{g.period.toUpperCase()}</Text>
                </View>
                {g.plays.map((p, pi) => {
                  const isHome = p.teamId === summary.home.team.id || p.teamId === summary.home.team.abbreviation;
                  const tInfo = isHome ? summary.home.team : summary.away.team;
                  const teamColor = `#${tInfo.color}`;
                  // Prefer the scorer/batter (not the pitcher) for the headshot.
                  const sParts = p.participants ?? [];
                  const scorer = sParts.find(pp => ['batter', 'scorer', 'rusher', 'receiver'].includes(pp.type))
                    ?? sParts.find(pp => pp.type !== 'pitcher')
                    ?? sParts[0];
                  const shot = scorer?.headshot
                    || (scorer?.name ? playerHeadshotMap[scorer.name.toLowerCase()] : null)
                    || (scorer?.name ? playerHeadshotMap[scorer.name.split(' ').pop()?.toLowerCase() ?? ''] : null);
                  const teamLogo = dark && tInfo.logoDark ? tInfo.logoDark : tInfo.logo;
                  return (
                    <View key={`sp-${gi}-${pi}`} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingVertical: 12, paddingHorizontal: 16,
                      backgroundColor: cardBg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border,
                      borderLeftWidth: 3, borderLeftColor: teamColor,
                    }}>
                      {/* Scorer headshot, else team logo */}
                      {shot
                        ? <Image source={{ uri: shot }} style={{ width: 40, height: 40, borderRadius: 20 }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={shot} />
                        : teamLogo
                          ? <Image source={{ uri: teamLogo }} style={{ width: 40, height: 40 }} contentFit="contain" />
                          : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: teamColor }} />}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: text, fontSize: 13, fontFamily: F.bold, lineHeight: 18 }}>{p.text}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <Text style={{ color: teamColor, fontSize: 11, fontFamily: F.black }}>{tInfo.abbreviation}</Text>
                          {p.clock ? <Text style={{ color: sub, fontSize: 11, fontFamily: F.regular }}>· {p.clock}</Text> : null}
                        </View>
                      </View>
                      {/* Running score */}
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: text, fontSize: 15, fontFamily: F.black }}>
                          {p.awayScore}–{p.homeScore}
                        </Text>
                        <Text style={{ color: sub, fontSize: 10, fontFamily: F.bold }}>
                          {summary.away.team.abbreviation} · {summary.home.team.abbreviation}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ));
          })()}
        </ScrollView>
      )}

      {activeTab === 'chat' && (
        <GameChat
          gameId={String(id)}
          text={text}
          sub={sub}
          cardBg={cardBg}
          border={border}
          bg={bg}
        />
      )}
    </SafeAreaView>
  );
}

function fmtML(ml: number | null | undefined): string {
  if (ml == null) return '--';
  return ml > 0 ? `+${ml}` : String(ml);
}

function abbreviatePropType(name: string): string {
  const map: Record<string, string> = {
    'Total Points': 'PTS', 'Total Assists': 'AST', 'Total Rebounds': 'REB',
    'Total Three Point': '3PM', 'Total Steals': 'STL', 'Total Blocks': 'BLK',
    'Passing Yards': 'PASS YDS', 'Rushing Yards': 'RUSH YDS', 'Receiving Yards': 'REC YDS',
    'Passing Touchdowns': 'PASS TD', 'Receiving Receptions': 'REC',
    'Total Strikeouts': 'K', 'Total Hits': 'H', 'Total Bases': 'TB',
    'Total Shots': 'SOG', 'Total Goals': 'G',
  };
  for (const [k, v] of Object.entries(map)) {
    if (name.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return name.split(' ').slice(-1)[0];
}

function OddsPill({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <View style={styles.oddsPill}>
      <Text style={[styles.oddsPillLabel, { color: sub }]}>{label}</Text>
      <Text style={[styles.oddsPillValue, { color }]}>{value}</Text>
    </View>
  );
}

function SectionTitle({ label, color, text }: { label: string; color: string; text: string }) {
  return (
    <View style={[styles.teamHeader, { borderLeftColor: color }]}>
      <Text style={[styles.teamName, { color: text }]}>{label}</Text>
    </View>
  );
}

function PitcherSide({ probable, label, color, sub, text }: { probable?: Probable; label: string; color: string; sub: string; text: string }) {
  if (!probable) {
    return (
      <View style={styles.pitcherSide}>
        <Text style={[styles.pitcherTeam, { color: sub }]}>{label}</Text>
        <Text style={[styles.pitcherName, { color: sub }]}>TBD</Text>
      </View>
    );
  }
  const { pitcher } = probable;
  const stats = pitcher.stats ?? {};
  const statLine = [
    stats.ERA && `ERA ${stats.ERA}`,
    (stats.W || stats.L) && `${stats.W ?? '0'}-${stats.L ?? '0'}`,
    stats.WHIP && `WHIP ${stats.WHIP}`,
    stats.SO && `${stats.SO} K`,
    stats.K && `${stats.K} K`,
  ].filter(Boolean).join('  |  ');
  return (
    <View style={styles.pitcherSide}>
      <Text style={[styles.pitcherTeam, { color: sub }]}>{label}</Text>
      {pitcher.headshot
        ? <Image source={{ uri: pitcher.headshot }} style={styles.pitcherHeadshot} contentFit="cover" />
        : <View style={[styles.pitcherHeadshot, { backgroundColor: sub + '30' }]} />
      }
      <View style={[styles.pitcherAccent, { backgroundColor: color }]} />
      <Text style={[styles.pitcherName, { color: text }]} numberOfLines={2}>{pitcher.displayName}</Text>
      {statLine ? <Text style={[styles.pitcherArm, { color: sub }]} numberOfLines={1}>{statLine}</Text> : null}
      {pitcher.throwingArm ? <Text style={[styles.pitcherArm, { color: sub }]}>{pitcher.throwingArm}HP</Text> : null}
    </View>
  );
}

function TeamHeader({ side, sub, text, dark, onPress }: { side: GameSummary['home']; sub: string; text: string; dark?: boolean; onPress?: () => void }) {
  const color = `#${side.team.color}`;
  const logoUri = dark && side.team.logoDark ? side.team.logoDark : side.team.logo;
  // Whole side becomes a press target so the user can tap the logo,
  // score, or abbreviation to navigate to the team profile.
  const Container: any = onPress ? Pressable : View;
  return (
    <Container style={styles.teamSide} onPress={onPress}>
      <View style={[styles.teamAccent, { backgroundColor: color }]} />
      {logoUri
        ? <Image source={{ uri: logoUri }} style={styles.headerLogo} contentFit="contain" transition={200} />
        : null
      }
      <Text style={[styles.headerScore, { color: text }]}>{side.score}</Text>
      <Text style={[styles.headerAbbr, { color: sub }]}>{side.team.abbreviation}</Text>
      {side.record ? <Text style={{ color: sub, fontSize: 11, fontFamily: F.regular, marginTop: 1 }}>{side.record}</Text> : null}
    </Container>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 80 },
  errorText: { fontSize: 15, fontFamily: F.regular },

  // Segment switcher
  segmentBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  segmentTab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  segmentText: { fontSize: 12, fontFamily: F.black, letterSpacing: 1 },

  // Mini score bar shown above the chat tab so users always see score + period
  chatMiniScore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chatMiniSide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatMiniLogo: { width: 22, height: 22 },
  chatMiniAbbr: { fontSize: 12, fontFamily: F.bold, letterSpacing: 0.5 },
  chatMiniScoreText: { fontSize: 18, fontFamily: F.black, marginHorizontal: 4 },
  chatMiniCenter: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 8 },
  chatMiniStatus: { fontSize: 11, fontFamily: F.black, letterSpacing: 1, textTransform: 'uppercase' },
  chatMiniClock: { fontSize: 10, fontFamily: F.regular },

  postseasonBanner: { marginHorizontal: 16, marginTop: 12, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, gap: 2 },
  postseasonNote: { fontSize: 11, fontFamily: F.black, color: '#fff', letterSpacing: 1, textTransform: 'uppercase' },
  seriesText: { fontSize: 14, fontFamily: F.black, color: '#fff', letterSpacing: 0.5 },

  scoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 8,
  },
  teamSide: { flex: 1, alignItems: 'center', gap: 6 },
  teamAccent: { width: 40, height: 4, borderRadius: 2 },
  headerLogo: { width: 60, height: 60 },
  headerScore: { fontSize: 40, fontFamily: F.black },
  headerAbbr: { fontSize: 12, fontFamily: F.bold, letterSpacing: 1 },
  scoreCenter: { flex: 1, alignItems: 'center', gap: 4 },
  vs: { fontSize: 18, fontFamily: F.regular },
  statusText: { fontSize: 14, fontFamily: F.black, letterSpacing: 0.5, textAlign: 'center' },
  clock: { fontSize: 12, fontFamily: F.regular },

  section: { marginTop: 16, marginHorizontal: 16 },
  // Fixed min height so a 2-line team name (e.g. "San Francisco Giants") doesn't
  // push that team's table lower than the other when shown side-by-side on web.
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, borderLeftWidth: 4, paddingLeft: 10, marginBottom: 6, minHeight: 52 },
  teamLogo: { width: 24, height: 24 },
  teamName: { fontSize: 14, fontFamily: F.black, letterSpacing: 0.5, flex: 1 },

  // Probable pitchers
  pitchersCard: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  pitcherSide: { flex: 1, alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, gap: 6 },
  pitcherDivider: { width: 1 },
  pitcherTeam: { fontSize: 10, fontFamily: F.black, letterSpacing: 1 },
  pitcherHeadshot: { width: 80, height: 80, borderRadius: 40 },
  pitcherAccent: { width: 32, height: 3, borderRadius: 2 },
  pitcherName: { fontSize: 13, fontFamily: F.bold, textAlign: 'center' },
  pitcherArm: { fontSize: 10, fontFamily: F.regular, letterSpacing: 0.5 },

  // Pre-game leaders
  leadersRow: { flexDirection: 'row', gap: 10 },
  leadersCard: { flex: 1, borderRadius: 14, borderWidth: 1, overflow: 'hidden', paddingBottom: 8 },
  leadersTeamBar: { height: 4 },
  leadersTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  leadersTeamLogo: { width: 20, height: 20 },
  leadersTeamAbbr: { fontSize: 12, fontFamily: F.black, letterSpacing: 0.5 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, gap: 6 },
  leaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  leaderHeadshot: { width: 36, height: 36, borderRadius: 18 },
  leaderInfo: { flex: 1 },
  leaderName: { fontSize: 11, fontFamily: F.bold },
  leaderCat: { fontSize: 9, fontFamily: F.regular },
  leaderValue: { fontSize: 14, fontFamily: F.black },

  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderTopWidth: 0, paddingVertical: 9, paddingHorizontal: 8 },
  colRow: { borderTopWidth: 1, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  benchRow: { opacity: 0.85 },
  subIndent: {
    marginLeft: 18,
    borderLeftWidth: 2,
    borderLeftColor: '#3a3a3c',
    paddingLeft: 6,
  },
  colLabel: { fontSize: 10, fontFamily: F.black, letterSpacing: 0.5 },

  // Fixed width (not flex:1) so it behaves correctly inside the horizontal
  // ScrollView used for sports with many stat columns (NBA boxscore = 9).
  // ~150pt is enough for a 28pt headshot + first/last name on one line.
  playerCol: { width: 150, flexDirection: 'row', alignItems: 'center', gap: 8 },

  // ─────────────────────────────────────────────────────────────────────
  // Sticky-player-column box-score table (three side-by-side "tracks").
  // All three tracks must use the SAME row heights so rows stay aligned
  // horizontally — using fixed `height` + `overflow: hidden` so the
  // headshot/name on the left can't push a row taller than the matching
  // stats row on the right (this caused the misalignment seen on web).
  // ─────────────────────────────────────────────────────────────────────
  bsTableWrap: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  bsPlayerTrack: {
    width: 160,
    flexDirection: 'column',
  },
  bsStarTrack: {
    width: 36,
    flexDirection: 'column',
  },
  // One row in the stats track. 56pt is tall enough for the player track's
  // 28pt headshot + 2 lines of label text. `overflow: hidden` clips any
  // natural-content overflow so the tracks never drift apart.
  // On web we force `width: 100%` so the row fills the ScrollView and the
  // `flex: 1` stat cols can stretch evenly (no gap before the ★ column).
  bsStatsRow: Platform.OS === 'web'
    ? ({
        height: 56,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
      } as any)
    : {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
      },
  bsPlayerCell: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  bsStarCell: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  // Header row shared by all three tracks — same height in each so the
  // first body row starts at the same y-offset across them.
  bsHeaderCell: {
    height: 30,
    paddingHorizontal: 8,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  // Stats header has the same 30pt height as bsHeaderCell but uses flex-row
  // because it holds multiple stat-label cells (PTS, MIN, FG, …) side by side.
  // Web: width 100% so the flex:1 stat cols stretch evenly to fill it.
  bsStatsHeader: Platform.OS === 'web'
    ? ({
        height: 30,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
      } as any)
    : {
        height: 30,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
      },
  // On web, render the two team boxscore tables SIDE BY SIDE (50/50) so
  // wide screens use horizontal space instead of one long stack. The flex
  // child below targets each <Animated.View style={styles.section}> so
  // they share the row equally.
  bsTeamsRowWeb: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  bsTeamColWeb: {
    flex: 1,
    minWidth: 0, // allow flex children to shrink below intrinsic width
  },
  headshot: { width: 28, height: 28, borderRadius: 14 },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 12, fontFamily: F.bold },
  playerPos: { fontSize: 10, fontFamily: F.regular },
  // Phone: fixed 38pt-wide column so 9 columns add up to a knowable scroll
  // width inside the horizontal stats ScrollView. WEB: flex so each column
  // stretches to fill the available row width (eliminating the empty gap
  // between the last stat and the ★ column on wide screens). minWidth keeps
  // them readable even when the window is resized smaller.
  statCol: Platform.OS === 'web'
    ? ({ flex: 1, minWidth: 38, textAlign: 'center', fontSize: 13, fontFamily: F.regular } as any)
    : { width: 38, textAlign: 'center', fontSize: 12, fontFamily: F.regular },
  starCol: { width: 28, alignItems: 'center', justifyContent: 'center' },

  teamStatRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderTopWidth: 0, paddingVertical: 10, paddingHorizontal: 12 },
  teamStatVal: { flex: 1, fontSize: 14, fontFamily: F.bold },
  teamStatLabel: { flex: 1, fontSize: 11, fontFamily: F.regular, textAlign: 'center' },

  // Betting odds
  oddsCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  oddsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  oddsTitle: { fontSize: 14, fontFamily: F.black, letterSpacing: 0.5 },
  oddsProvider: { fontSize: 10, fontFamily: F.regular },
  oddsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  oddsPill: { flex: 1, alignItems: 'center', gap: 3 },
  oddsPillLabel: { fontSize: 9, fontFamily: F.black, letterSpacing: 0.5 },
  oddsPillValue: { fontSize: 15, fontFamily: F.black },
  ouRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  ouLabel: { fontSize: 11, fontFamily: F.regular },
  ouDivider: { fontSize: 11, fontFamily: F.regular },

  // Player props
  propsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Platform.OS === 'web' ? 6 : 8 },
  propCard: Platform.OS === 'web'
    ? ({ width: '16%', minWidth: 150, borderRadius: 10, borderWidth: 1, alignItems: 'center', paddingBottom: 8, paddingHorizontal: 6, gap: 3, overflow: 'hidden' } as any)
    : { width: '30%', borderRadius: 12, borderWidth: 1, alignItems: 'center', paddingBottom: 10, paddingHorizontal: 6, gap: 4, overflow: 'hidden' },
  propHeroBlock: Platform.OS === 'web'
    ? ({ width: '100%', height: 88, position: 'relative', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden', paddingTop: 8 } as any)
    : { width: '100%', height: 126, position: 'relative', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden', paddingTop: 10 },
  propHeroImg: Platform.OS === 'web'
    ? ({ position: 'absolute', top: 8, width: '72%', height: 62, alignSelf: 'center' } as any)
    : { position: 'absolute', top: 10, width: '76%', height: 92, alignSelf: 'center' },
  propAccent: { width: Platform.OS === 'web' ? 22 : 28, height: 3, borderRadius: 2 },
  propName: { fontSize: Platform.OS === 'web' ? 10 : 11, fontFamily: F.bold, textAlign: 'center', width: '100%', paddingVertical: 2, paddingHorizontal: 2 },
  propType: { fontSize: Platform.OS === 'web' ? 8 : 9, fontFamily: F.black, letterSpacing: 0.5 },
  propLine: { fontSize: Platform.OS === 'web' ? 15 : 18, fontFamily: F.black },
  propOddsRow: { flexDirection: 'row', gap: 4 },
  propOdds: { fontSize: Platform.OS === 'web' ? 9 : 10, fontFamily: F.bold },

  // NEW: tabbed + grouped prop view (FanDuel/Fliff-style)
  propTabRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 3,
    marginBottom: 12,
  },
  propTabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 7,
  },
  propTabLabel: { fontSize: 11, fontFamily: F.black, letterSpacing: 1.5 },
  propsGroupedList: { gap: 8 },
  propGroupCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  propGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  propGroupHeadshot: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  propGroupName: { fontSize: 14, fontFamily: F.bold },
  propGroupSub: { fontSize: 10, fontFamily: F.black, letterSpacing: 1.5 },
  propLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  propLineType: { fontSize: 12, fontFamily: F.bold },
  propLineNum: { fontSize: 14, fontFamily: F.black, marginTop: 1 },
  propLineOdds: { flexDirection: 'row', gap: 6 },
  propOddPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    minWidth: 56,
  },
  propOddLabel: { fontSize: 8, fontFamily: F.black, letterSpacing: 1 },
  propOddValue: { fontSize: 12, fontFamily: F.black, marginTop: 2 },
  noPropsCard: { padding: 16, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  noPropsText: { fontSize: 12, fontFamily: F.regular },

  // Fantasy players section
  fantasyHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  fantasyProviderDot: { width: 8, height: 8, borderRadius: 4 },
  fantasySectionTitle: { fontSize: 14, fontFamily: F.black, letterSpacing: 0.4, flex: 1 },
  fantasyLeagueName: { fontSize: 11, fontFamily: F.regular },
  fantasyCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  fantasyPlayerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 14, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  fantasyTeamAccent: { width: 3, alignSelf: 'stretch' },
  fantasyHeadshot: { width: 44, height: 44, borderRadius: 22 },
  fantasyPlayerInfo: { flex: 1, gap: 3 },
  fantasyPlayerName: { fontSize: 14, fontFamily: F.bold },
  fantasyPlayerPos: { fontSize: 11, fontFamily: F.regular },
  fantasyStatRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  fantasyStat: { alignItems: 'center', gap: 1 },
  fantasyStatVal: { fontSize: 13, fontFamily: F.black },
  fantasyStatKey: { fontSize: 9, fontFamily: F.regular, letterSpacing: 0.3 },
  fantasyPtsBlock: { alignItems: 'center', minWidth: 44 },
  fantasyPts: { fontSize: 22, fontFamily: F.black },
  fantasyPtsLabel: { fontSize: 9, fontFamily: F.black, letterSpacing: 0.5 },

  // Plays tab
  playsScoreCard: { flexDirection: 'row', alignItems: 'center', margin: 16, borderRadius: 16, borderWidth: 1, paddingVertical: 16, paddingHorizontal: 12 },
  playsScoreTeam: { flex: 1, alignItems: 'center', gap: 4 },
  playsScoreLogo: { width: 44, height: 44 },
  playsScoreAbbr: { fontSize: 11, fontFamily: F.bold, letterSpacing: 1 },
  playsScoreCenter: { flex: 1, alignItems: 'center', gap: 4 },
  playsScoreStatus: { fontSize: 13, fontFamily: F.black, letterSpacing: 0.5, textAlign: 'center' },
  playsScoreClock: { fontSize: 11, fontFamily: F.regular },

  courtWrap: { marginHorizontal: 16, marginBottom: 16 },

  playsCard: { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  noPlays: { alignItems: 'center', paddingVertical: 40 },
  noPlaysText: { fontSize: 14, fontFamily: F.regular },
});

const betPanelStyles = StyleSheet.create({
  panel: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  panelHeader: {
    fontSize: 10,
    fontFamily: F.black,
    letterSpacing: 2,
    color: '#FFD700',
    marginBottom: 4,
  },
  parlayGroup: {
    gap: 6,
  },
  parlayName: {
    fontSize: 12,
    fontFamily: F.bold,
    color: '#aaa',
    marginBottom: 2,
  },
  legRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legDesc: {
    flex: 1,
    fontSize: 13,
    fontFamily: F.bold,
  },
  legOdds: {
    fontSize: 13,
    fontFamily: F.black,
    minWidth: 44,
    textAlign: 'right',
  },
  finalNote: {
    fontSize: 11,
    fontFamily: F.black,
    color: '#FFD700',
    letterSpacing: 1,
    marginTop: 4,
    textAlign: 'center',
  },
});
