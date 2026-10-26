import { API } from '@/constants/api';
import { F } from '@/constants/fonts';
import { formatPropLine, sportsbookLine } from '@/constants/prop-utils';
import { PropProgressRing } from '@/components/ui/PropProgressRing';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  BetLeg,
  BetType,
  Parlay,
  calcLegStatus as calcLegStatusFromGame,
  calcParlayStatus,
  fmtOdds,
  getBetsSync,
  loadBets,
  saveBets,
  subscribeToBets,
} from '@/hooks/use-bets';
import axios from 'axios';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { TrendingProps } from '@/components/trending-props';
import { TrendingIcon } from '@/components/trending-icon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameOption {
  id: string;
  label: string; // "LAL @ BOS"
  awayAbbr: string;
  homeAbbr: string;
  awayName: string;
  homeName: string;
  state: string; // pre/in/post
  awayLogo?: string;
  homeLogo?: string;
  gameTime?: string;
}

// Selectable sportsbooks. Each game's odds + player props are fetched for the
// chosen book, since the available props differ between platforms.
const SPORTSBOOKS: { key: string; label: string }[] = [
  { key: 'draftkings', label: 'DraftKings' },
  { key: 'caesars', label: 'Caesars' },
  { key: 'fanduel', label: 'FanDuel' },
];

interface GameDetails {
  gameOdds: {
    spread: string;
    overUnder: number | null;
    awayMoneyLine: number | null;
    homeMoneyLine: number | null;
    overOdds: number | null;
    underOdds: number | null;
  } | null;
  playerProps: Array<{
    athleteId: string;
    typeName: string;
    line: string;
    overOdds: string;
    underOdds?: string;
    athlete: { name: string };
  }>;
  away: { team: { id?: string; abbreviation: string; displayName: string } };
  home: { team: { id?: string; abbreviation: string; displayName: string } };
  playerTeams?: Array<{
    teamId: string;
    athletes: Array<{ id: string; name: string; position: string; starter: boolean }>;
  }>;
  rosterPlayers?: Array<{ id: string; name: string; position: string; teamId: string }>;
}

interface PendingBet {
  type: BetType;
  teamAbbr?: string;
  line?: number;
  odds: number;
  direction?: 'over' | 'under';
  playerName?: string;
  statKey?: string;
  statLine?: number;
  description: string;
  athleteId?: string;
  teamLogoUrl?: string;
}

const SPORT_PROP_CATS: Record<string, string[]> = {
  nba: ['Points', 'Rebounds', 'Assists', '3-Pointers', 'Steals', 'Blocks', 'PRA'],
  nfl: ['Pass Yds', 'Rush Yds', 'Rec Yds', 'Pass TDs', 'Receptions', 'INTs', 'Sacks'],
  mlb: ['Hits', 'Strikeouts', 'Total Bases', 'RBIs', 'Runs'],
  nhl: ['Goals', 'Assists', 'Shots', 'Points', 'Saves'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPORTS = ['nba', 'nfl', 'mlb', 'nhl'] as const;
type Sport = typeof SPORTS[number];

const SPORT_LABEL: Record<Sport, string> = { nba: 'NBA', nfl: 'NFL', mlb: 'MLB', nhl: 'NHL' };


function toDecimal(odds: number) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}
function calcCombinedOdds(legs: Partial<BetLeg>[]): number | null {
  const valid = legs.filter(l => l.odds && !isNaN(l.odds!));
  if (!valid.length) return null;
  const dec = valid.reduce((a, l) => a * toDecimal(l.odds!), 1);
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}
function calcPotentialPayout(legs: Partial<BetLeg>[], stake: number) {
  const valid = legs.filter(l => l.odds && !isNaN(l.odds!));
  if (!valid.length || !stake) return 0;
  const dec = valid.reduce((a, l) => a * toDecimal(l.odds!), 1);
  return Math.round(stake * dec * 100) / 100;
}
function autoDescription(leg: Partial<BetLeg>): string {
  if (leg.type === 'moneyline') return `${leg.teamAbbr || '?'} ML`;
  if (leg.type === 'spread') return `${leg.teamAbbr || '?'} ${leg.line != null ? (leg.line > 0 ? `+${leg.line}` : leg.line) : ''}`;
  if (leg.type === 'over') return `Over ${leg.line != null ? formatPropLine(leg.line) : ''}`;
  if (leg.type === 'under') return `Under ${leg.line != null ? formatPropLine(leg.line) : ''}`;
  if (leg.type === 'prop') return `${leg.playerName || '?'} ${leg.statLine != null ? formatPropLine(leg.statLine) : ''} ${leg.statKey || ''}`;
  return '';
}
function statusColor(s: string) {
  if (s === 'winning' || s === 'won') return '#34C759';
  if (s === 'losing' || s === 'lost') return '#FF3B30';
  if (s === 'push') return '#FF9F0A';
  return '#8e8e93';
}
// Monochrome typographic glyphs only — no emoji. Color is applied by the caller
// (parlayStatusColor) so a green ▲ = winning, red ▼ = losing, etc.
function statusIcon(s: string) {
  if (s === 'won') return '✓';
  if (s === 'lost') return '✗';
  if (s === 'winning') return '▲';
  if (s === 'losing') return '▼';
  if (s === 'push') return '=';
  return '·';
}
function parlayStatusColor(s: string) {
  if (s === 'won') return '#34C759';
  if (s === 'lost') return '#FF3B30';
  if (s === 'push') return '#FF9F0A';
  return '#FFD700';
}
function emptyLeg(): Partial<BetLeg> {
  return { gameId: '', sport: 'nba', gameLabel: '', type: 'moneyline', status: 'pending' };
}

function fmtTime(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// LegBuilder — smart dropdowns
// ---------------------------------------------------------------------------

function LegBuilder({
  leg, index, onChange, onRemove, onReplaceWithProps, border, text, sub, dark,
}: {
  leg: Partial<BetLeg>; index: number;
  onChange: (l: Partial<BetLeg>) => void;
  onRemove: () => void;
  onReplaceWithProps: (newLegs: Partial<BetLeg>[]) => void;
  border: string; text: string; sub: string; dark: boolean;
}) {
  const [games, setGames] = useState<GameOption[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [showGameList, setShowGameList] = useState(false);
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedPropCat, setSelectedPropCat] = useState<string>('');
  const [pendingBets, setPendingBets] = useState<PendingBet[]>([]);
  const [dateOffset, setDateOffset] = useState(0);
  // Sportsbook selector — props/odds shown are specific to the chosen book.
  const [selectedBook, setSelectedBook] = useState<string>('draftkings');
  const [bookOpen, setBookOpen] = useState(false);
  const prevSportRef = useRef<string | undefined>(undefined);

  const inputBg = dark ? '#2c2c2e' : '#f2f2f7';
  const chipBg = dark ? '#3a3a3c' : '#e5e5ea';
  const selectedChipBg = '#FFD700';

  // Fetch games list. Only wipe the selected game when the sport actually changes.
  useEffect(() => {
    if (!leg.sport) return;

    const sportChanged = prevSportRef.current !== undefined && prevSportRef.current !== leg.sport;
    prevSportRef.current = leg.sport;

    if (sportChanged) {
      // User switched sports — clear previous game + details
      setDetails(null);
      setPendingBets([]);
      setSelectedPropCat('');
      onChange({ ...leg, gameId: '', gameLabel: '', teamAbbr: undefined, line: undefined, odds: undefined, description: '' });
    }
    // Always clear the game list so it reloads for the current sport/date
    setGames([]);
    setGamesLoading(true);

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dateOffset);
    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    axios.get(`${API}/sports/${leg.sport}/scores?date=${dateStr}`)
      .then(({ data }) => {
        const mapped: GameOption[] = (data.games || []).map((g: any) => ({
          id: g.id,
          label: g.shortName || `${g.away?.team?.abbreviation} @ ${g.home?.team?.abbreviation}`,
          awayAbbr: g.away?.team?.abbreviation || '',
          homeAbbr: g.home?.team?.abbreviation || '',
          awayName: g.away?.team?.displayName || g.away?.team?.abbreviation || '',
          homeName: g.home?.team?.displayName || g.home?.team?.abbreviation || '',
          state: g.status?.state || 'pre',
          awayLogo: g.away?.team?.logo,
          homeLogo: g.home?.team?.logo,
          gameTime: g.date,
        }));
        setGames(mapped);
      })
      .catch(() => {})
      .finally(() => setGamesLoading(false));
  }, [leg.sport, dateOffset]);

  // Map ESPN typeName → clean display category
  function extractCategory(typeName: string): string {
    const t = typeName.toLowerCase();
    if (t.includes('three') || t.includes('3-point')) return '3-Pointers';
    if (t.includes('pts+reb') || (t.includes('point') && t.includes('rebound') && t.includes('assist'))) return 'PRA';
    if (t.includes('point') && t.includes('rebound')) return 'Pts+Reb';
    if (t.includes('point') && t.includes('assist')) return 'Pts+Ast';
    if (t.includes('point') && !t.includes('passing') && !t.includes('power')) return 'Points';
    if (t.includes('assist')) return 'Assists';
    if (t.includes('rebound')) return 'Rebounds';
    if (t.includes('steal')) return 'Steals';
    if (t.includes('block')) return 'Blocks';
    if (t.includes('passing yard')) return 'Pass Yds';
    if (t.includes('rushing yard')) return 'Rush Yds';
    if (t.includes('receiving yard')) return 'Rec Yds';
    if (t.includes('passing td') || t.includes('passing touchdown')) return 'Pass TDs';
    if (t.includes('reception')) return 'Receptions';
    if (t.includes('interception')) return 'INTs';
    if (t.includes('sack')) return 'Sacks';
    if (t.includes('strikeout')) return 'Strikeouts';
    if (t.includes('total base')) return 'Total Bases';
    if (t.includes('hit')) return 'Hits';
    if (t.includes('rbi')) return 'RBIs';
    if (t.includes('run')) return 'Runs';
    if (t.includes('home run')) return 'Home Runs';
    if (t.includes('shot')) return 'Shots';
    if (t.includes('goal')) return 'Goals';
    if (t.includes('save')) return 'Saves';
    if (t.includes('power play')) return 'Power Play';
    return typeName;
  }

  // Fetch game details when game selected
  function selectGame(game: GameOption) {
    setShowGameList(false);
    setSelectedPropCat('');
    setPendingBets([]);
    onChange({ ...leg, gameId: game.id, gameLabel: game.label, type: 'moneyline', teamAbbr: undefined, line: undefined, odds: undefined });
    loadDetails(game.id, selectedBook);
  }

  // Fetch a game's odds/props for a specific sportsbook. Re-called when the
  // user switches books so the displayed props match that platform.
  function loadDetails(gameId: string, book: string) {
    setDetails(null);
    setDetailsLoading(true);
    axios.get(`${API}/sports/${leg.sport}/game/${gameId}?book=${book}`)
      .then(({ data }) => setDetails(data))
      .catch(() => {})
      .finally(() => setDetailsLoading(false));
  }

  // Re-fetch when the chosen sportsbook changes (if a game is selected).
  useEffect(() => {
    if (leg.gameId) loadDetails(leg.gameId, selectedBook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBook]);

  function betKey(b: PendingBet): string {
    if (b.type === 'moneyline') return `ml|${b.teamAbbr}`;
    if (b.type === 'spread') return `spread|${b.teamAbbr}`;
    if (b.type === 'over') return `total|over`;
    if (b.type === 'under') return `total|under`;
    return `prop|${b.playerName}|${b.statKey}|${b.direction}`;
  }
  function toggleBet(bet: PendingBet) {
    const k = betKey(bet);
    setPendingBets(prev =>
      prev.some(x => betKey(x) === k) ? prev.filter(x => betKey(x) !== k) : [...prev, bet]
    );
  }
  function promptManualBet(playerName: string, cat: string, direction: 'over' | 'under') {
    Alert.prompt(`${playerName} — ${direction === 'over' ? 'Over' : 'Under'}`, `Enter ${cat} line (e.g. 25.5):`, lineStr => {
      const line = parseFloat(lineStr || '');
      if (!line) return;
      Alert.prompt('Enter Odds', 'American odds (e.g. -110 or +150):', oddsStr => {
        const odds = parseInt(oddsStr?.replace(/[^-\d]/g, '') || '-110', 10);
        const desc = `${playerName} ${direction === 'over' ? 'Over' : 'Under'} ${line} ${cat}`;
        toggleBet({ type: 'prop', playerName, statKey: cat, statLine: line, odds, direction, description: desc });
      }, 'plain-text', '-110');
    });
  }
  function addBetsToSlip() {
    if (!pendingBets.length) return;
    const newLegs: Partial<BetLeg>[] = pendingBets.map(b => ({
      gameId: leg.gameId ?? '',
      sport: leg.sport ?? 'nba',
      gameLabel: leg.gameLabel ?? '',
      type: b.type,
      teamAbbr: b.teamAbbr,
      line: b.line,
      odds: b.odds,
      playerName: b.playerName,
      statKey: b.statKey,
      statLine: b.statLine,
      propDirection: b.direction,
      status: 'pending' as const,
      description: b.description,
      athleteId: b.athleteId,
      teamLogoUrl: b.teamLogoUrl,
    }));
    onReplaceWithProps(newLegs);
    setPendingBets([]);
  }

  const selectedGame = games.find(g => g.id === leg.gameId);

  function parseSpread(s: string) {
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function renderBetBrowser(d: GameDetails) {
    // --- Game Lines ---
    const awayAbbr = d.away.team.abbreviation;
    const homeAbbr = d.home.team.abbreviation;
    const awayML = d.gameOdds?.awayMoneyLine ?? null;
    const homeML = d.gameOdds?.homeMoneyLine ?? null;
    const spread = d.gameOdds?.spread ? parseSpread(d.gameOdds.spread) : null;
    const total = d.gameOdds?.overUnder ?? null;
    const overOdds = d.gameOdds?.overOdds ?? -110;
    const underOdds = d.gameOdds?.underOdds ?? -110;

    // --- Player Props ---
    const catOrder: string[] = [];
    const catSeen = new Set<string>();
    for (const p of d.playerProps) {
      const cat = extractCategory(p.typeName);
      if (!catSeen.has(cat)) { catOrder.push(cat); catSeen.add(cat); }
    }
    for (const cat of (SPORT_PROP_CATS[leg.sport ?? 'nba'] ?? [])) {
      if (!catSeen.has(cat)) { catOrder.push(cat); catSeen.add(cat); }
    }
    const activeCat = selectedPropCat || catOrder[0] || '';
    // Deduplicate by athleteId — ESPN sometimes returns separate over/under entries per player
    const _seenPropIds = new Set<string>();
    const espnForCat = d.playerProps
      .filter(p => extractCategory(p.typeName) === activeCat)
      .filter(p => { if (_seenPropIds.has(p.athleteId)) return false; _seenPropIds.add(p.athleteId); return true; });
    const espnNames = new Set(espnForCat.map(p => p.athlete.name));

    const seenNames = new Set<string>(espnNames);
    const manualAthletes: Array<{ name: string; starter: boolean }> = [];
    for (const p of d.rosterPlayers ?? []) {
      if (p.name && !seenNames.has(p.name)) { seenNames.add(p.name); manualAthletes.push({ name: p.name, starter: false }); }
    }
    for (const team of d.playerTeams ?? []) {
      for (const a of team.athletes) {
        if (a.name && !seenNames.has(a.name)) { seenNames.add(a.name); manualAthletes.push({ name: a.name, starter: a.starter }); }
        else if (a.name && a.starter) { const idx = manualAthletes.findIndex(x => x.name === a.name); if (idx >= 0) manualAthletes[idx].starter = true; }
      }
    }
    manualAthletes.sort((a, b) => (b.starter ? 1 : 0) - (a.starter ? 1 : 0));

    const hasGameOdds = !!(awayML || homeML || spread !== null || total !== null);

    const activeBook = SPORTSBOOKS.find(b => b.key === selectedBook) ?? SPORTSBOOKS[0];

    return (
      <View>
        {/* Sportsbook selector — odds/props shown match the chosen platform */}
        <View style={{ marginBottom: 14 }}>
          <Text style={[styles.propSectionLabel, { color: sub, marginBottom: 6 }]}>SPORTSBOOK</Text>
          <TouchableOpacity activeOpacity={0.8} onPress={() => setBookOpen(o => !o)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
              backgroundColor: dark ? '#1c1c1e' : '#fff', borderWidth: 1, borderColor: border }}>
            <Text style={{ color: text, fontSize: 15, fontFamily: F.bold }}>{activeBook.label}</Text>
            <Text style={{ color: sub, fontSize: 13 }}>{bookOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {bookOpen && (
            <View style={{ marginTop: 6, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: border, backgroundColor: dark ? '#1c1c1e' : '#fff' }}>
              {SPORTSBOOKS.map((b, i) => {
                const active = b.key === selectedBook;
                return (
                  <TouchableOpacity key={b.key} activeOpacity={0.7}
                    onPress={() => { setSelectedBook(b.key); setBookOpen(false); }}
                    style={{ paddingHorizontal: 14, paddingVertical: 12, backgroundColor: active ? '#FFD70018' : 'transparent',
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: border }}>
                    <Text style={{ color: active ? '#FFD700' : text, fontSize: 15, fontFamily: active ? F.black : F.regular }}>{b.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Game Lines */}
        {hasGameOdds && (
          <View style={{ marginBottom: 12 }}>
            <Text style={[styles.propSectionLabel, { color: sub, marginBottom: 8 }]}>GAME LINES</Text>
            {/* Moneyline */}
            {(awayML || homeML) && (
              <>
                <Text style={[styles.propLine, { color: sub, marginBottom: 4 }]}>Moneyline</Text>
                <View style={styles.betOptionsRow}>
                  {awayML && (
                    <TouchableOpacity activeOpacity={0.7}
                      onPress={() => toggleBet({ type: 'moneyline', teamAbbr: awayAbbr, odds: awayML, description: `${awayAbbr} ML`, teamLogoUrl: selectedGame?.awayLogo || `https://a.espncdn.com/i/teamlogos/${leg.sport}/500/${awayAbbr.toLowerCase()}.png` })}
                      style={[styles.betOptionCard, { borderColor: pendingBets.some(b => betKey(b) === `ml|${awayAbbr}`) ? '#FFD700' : border, backgroundColor: pendingBets.some(b => betKey(b) === `ml|${awayAbbr}`) ? '#FFD70018' : (dark ? '#1c1c1e' : '#fff') }]}>
                      <Text style={[styles.betOptionLabel, { color: pendingBets.some(b => betKey(b) === `ml|${awayAbbr}`) ? '#FFD700' : text }]}>{awayAbbr}</Text>
                      <Text style={[styles.betOptionSub, { color: sub }]}>Away</Text>
                      <Text style={[styles.betOptionValue, { color: pendingBets.some(b => betKey(b) === `ml|${awayAbbr}`) ? '#FFD700' : '#34C759' }]}>{fmtOdds(awayML)}</Text>
                    </TouchableOpacity>
                  )}
                  {homeML && (
                    <TouchableOpacity activeOpacity={0.7}
                      onPress={() => toggleBet({ type: 'moneyline', teamAbbr: homeAbbr, odds: homeML, description: `${homeAbbr} ML`, teamLogoUrl: selectedGame?.homeLogo || `https://a.espncdn.com/i/teamlogos/${leg.sport}/500/${homeAbbr.toLowerCase()}.png` })}
                      style={[styles.betOptionCard, { borderColor: pendingBets.some(b => betKey(b) === `ml|${homeAbbr}`) ? '#FFD700' : border, backgroundColor: pendingBets.some(b => betKey(b) === `ml|${homeAbbr}`) ? '#FFD70018' : (dark ? '#1c1c1e' : '#fff') }]}>
                      <Text style={[styles.betOptionLabel, { color: pendingBets.some(b => betKey(b) === `ml|${homeAbbr}`) ? '#FFD700' : text }]}>{homeAbbr}</Text>
                      <Text style={[styles.betOptionSub, { color: sub }]}>Home</Text>
                      <Text style={[styles.betOptionValue, { color: pendingBets.some(b => betKey(b) === `ml|${homeAbbr}`) ? '#FFD700' : '#34C759' }]}>{fmtOdds(homeML)}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
            {/* Spread */}
            {spread !== null && (
              <>
                <Text style={[styles.propLine, { color: sub, marginTop: 8, marginBottom: 4 }]}>Spread</Text>
                <View style={styles.betOptionsRow}>
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={() => toggleBet({ type: 'spread', teamAbbr: awayAbbr, line: spread, odds: -110, description: `${awayAbbr} ${spread > 0 ? '+' : ''}${spread}`, teamLogoUrl: selectedGame?.awayLogo || `https://a.espncdn.com/i/teamlogos/${leg.sport}/500/${awayAbbr.toLowerCase()}.png` })}
                    style={[styles.betOptionCard, { borderColor: pendingBets.some(b => betKey(b) === `spread|${awayAbbr}`) ? '#FFD700' : border, backgroundColor: pendingBets.some(b => betKey(b) === `spread|${awayAbbr}`) ? '#FFD70018' : (dark ? '#1c1c1e' : '#fff') }]}>
                    <Text style={[styles.betOptionLabel, { color: pendingBets.some(b => betKey(b) === `spread|${awayAbbr}`) ? '#FFD700' : text }]}>{awayAbbr}</Text>
                    <Text style={[styles.betOptionSub, { color: sub }]}>{spread > 0 ? `+${spread}` : spread}</Text>
                    <Text style={[styles.betOptionValue, { color: pendingBets.some(b => betKey(b) === `spread|${awayAbbr}`) ? '#FFD700' : '#34C759' }]}>-110</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={() => toggleBet({ type: 'spread', teamAbbr: homeAbbr, line: -spread, odds: -110, description: `${homeAbbr} ${-spread > 0 ? '+' : ''}${-spread}`, teamLogoUrl: selectedGame?.homeLogo || `https://a.espncdn.com/i/teamlogos/${leg.sport}/500/${homeAbbr.toLowerCase()}.png` })}
                    style={[styles.betOptionCard, { borderColor: pendingBets.some(b => betKey(b) === `spread|${homeAbbr}`) ? '#FFD700' : border, backgroundColor: pendingBets.some(b => betKey(b) === `spread|${homeAbbr}`) ? '#FFD70018' : (dark ? '#1c1c1e' : '#fff') }]}>
                    <Text style={[styles.betOptionLabel, { color: pendingBets.some(b => betKey(b) === `spread|${homeAbbr}`) ? '#FFD700' : text }]}>{homeAbbr}</Text>
                    <Text style={[styles.betOptionSub, { color: sub }]}>{-spread > 0 ? `+${-spread}` : -spread}</Text>
                    <Text style={[styles.betOptionValue, { color: pendingBets.some(b => betKey(b) === `spread|${homeAbbr}`) ? '#FFD700' : '#34C759' }]}>-110</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            {/* Total */}
            {total !== null && (
              <>
                <Text style={[styles.propLine, { color: sub, marginTop: 8, marginBottom: 4 }]}>Total</Text>
                <View style={styles.betOptionsRow}>
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={() => toggleBet({ type: 'over', line: total, odds: overOdds, description: `Over ${total}` })}
                    style={[styles.betOptionCard, { borderColor: pendingBets.some(b => betKey(b) === 'total|over') ? '#FFD700' : border, backgroundColor: pendingBets.some(b => betKey(b) === 'total|over') ? '#FFD70018' : (dark ? '#1c1c1e' : '#fff') }]}>
                    <Text style={[styles.betOptionLabel, { color: pendingBets.some(b => betKey(b) === 'total|over') ? '#FFD700' : text }]}>Over</Text>
                    <Text style={[styles.betOptionSub, { color: sub }]}>{total}</Text>
                    <Text style={[styles.betOptionValue, { color: pendingBets.some(b => betKey(b) === 'total|over') ? '#FFD700' : '#34C759' }]}>{fmtOdds(overOdds)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={() => toggleBet({ type: 'under', line: total, odds: underOdds, description: `Under ${total}` })}
                    style={[styles.betOptionCard, { borderColor: pendingBets.some(b => betKey(b) === 'total|under') ? '#FFD700' : border, backgroundColor: pendingBets.some(b => betKey(b) === 'total|under') ? '#FFD70018' : (dark ? '#1c1c1e' : '#fff') }]}>
                    <Text style={[styles.betOptionLabel, { color: pendingBets.some(b => betKey(b) === 'total|under') ? '#FFD700' : text }]}>Under</Text>
                    <Text style={[styles.betOptionSub, { color: sub }]}>{total}</Text>
                    <Text style={[styles.betOptionValue, { color: pendingBets.some(b => betKey(b) === 'total|under') ? '#FFD700' : '#34C759' }]}>{fmtOdds(underOdds)}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        {/* Player Props */}
        <Text style={[styles.propSectionLabel, { color: sub, marginBottom: 8 }]}>PLAYER PROPS</Text>

        {/* Category pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled style={{ marginBottom: 8 }}>
          <View style={[styles.chipRow, { flexWrap: 'nowrap' }]}>
            {catOrder.map(cat => (
              <TouchableOpacity key={cat} activeOpacity={0.7} onPress={() => setSelectedPropCat(cat)}
                style={[styles.chip, { backgroundColor: activeCat === cat ? '#FFD700' : chipBg }]}>
                <Text style={[styles.chipText, { color: activeCat === cat ? '#000' : sub }]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Two-column team layout — ESPN prop players only */}
        {(() => {
          const awayTeamId = (d.away.team as any).id || '';
          const homeTeamId = (d.home.team as any).id || '';

          // Map rosterPlayers by ESPN athlete ID so we can look up team
          const rosterById: Record<string, string> = {};
          for (const rp of d.rosterPlayers ?? []) {
            rosterById[rp.id] = rp.teamId;
          }

          // Split ESPN prop players into away / home using athleteId → teamId
          type PropEntry = typeof espnForCat[0];
          const awayProps: PropEntry[] = [];
          const homeProps: PropEntry[] = [];
          for (const p of espnForCat) {
            const teamId = rosterById[p.athleteId];
            if (teamId === awayTeamId) awayProps.push(p);
            else if (teamId === homeTeamId) homeProps.push(p);
            // unknown team — skip (rare, keeps columns clean)
          }

          function renderPropPlayer(p: PropEntry) {
            // Force sportsbook-style decimal lines (no whole numbers)
            const line = sportsbookLine(p.line);
            const lineDisp = formatPropLine(p.line);
            const oOdds = parseInt(p.overOdds?.replace(/[^-\d]/g, '') || '-110', 10);
            const uOdds = parseInt((p.underOdds ?? '-110')?.replace(/[^-\d]/g, '') || '-110', 10);
            const overK = `prop|${p.athlete.name}|${activeCat}|over`;
            const underK = `prop|${p.athlete.name}|${activeCat}|under`;
            const overSel = pendingBets.some(b => betKey(b) === overK);
            const underSel = pendingBets.some(b => betKey(b) === underK);
            const lastName = p.athlete.name.split(' ').slice(-1)[0];
            return (
              <View key={p.athleteId} style={[styles.tpRow, { borderBottomColor: border }]}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[styles.tpName, { color: text }]}>{lastName}</Text>
                  <Text style={[styles.tpLine, { color: sub }]}>{lineDisp}</Text>
                </View>
                <TouchableOpacity activeOpacity={0.7}
                  onPress={() => toggleBet({ type: 'prop', playerName: p.athlete.name, statKey: activeCat, statLine: line, odds: oOdds, direction: 'over', description: `${p.athlete.name} Over ${lineDisp} ${activeCat}`, athleteId: p.athleteId })}
                  style={[styles.tpBtn, { backgroundColor: overSel ? '#34C759' : (dark ? '#3a3a3c' : '#e5e5ea') }]}>
                  <Text style={[styles.tpBtnLabel, { color: overSel ? '#fff' : '#34C759' }]}>O</Text>
                  <Text style={[styles.tpBtnOdds, { color: overSel ? '#fff' : sub }]}>{fmtOdds(oOdds)}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7}
                  onPress={() => toggleBet({ type: 'prop', playerName: p.athlete.name, statKey: activeCat, statLine: line, odds: uOdds, direction: 'under', description: `${p.athlete.name} Under ${lineDisp} ${activeCat}`, athleteId: p.athleteId })}
                  style={[styles.tpBtn, { backgroundColor: underSel ? '#FF3B30' : (dark ? '#3a3a3c' : '#e5e5ea') }]}>
                  <Text style={[styles.tpBtnLabel, { color: underSel ? '#fff' : '#FF3B30' }]}>U</Text>
                  <Text style={[styles.tpBtnOdds, { color: underSel ? '#fff' : sub }]}>{fmtOdds(uOdds)}</Text>
                </TouchableOpacity>
              </View>
            );
          }

          function renderColumn(props: PropEntry[], abbr: string) {
            if (props.length === 0) return (
              <View style={[styles.tpColumn, { borderColor: border, backgroundColor: dark ? '#1c1c1e' : '#fff' }]}>
                <Text style={[styles.tpTeamHeader, { color: sub }]}>{abbr}</Text>
                <Text style={[styles.noOddsText, { color: sub, paddingVertical: 12, textAlign: 'center' }]}>No props</Text>
              </View>
            );
            return (
              <View style={[styles.tpColumn, { borderColor: border, backgroundColor: dark ? '#1c1c1e' : '#fff' }]}>
                <Text style={[styles.tpTeamHeader, { color: sub }]}>{abbr}</Text>
                {props.map(renderPropPlayer)}
              </View>
            );
          }

          if (espnForCat.length === 0) {
            return (
              <Text style={[styles.noOddsText, { color: sub }]}>No props available for this category</Text>
            );
          }

          return (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              {renderColumn(awayProps, awayAbbr)}
              {renderColumn(homeProps, homeAbbr)}
            </View>
          );
        })()}

        {/* Add to slip button */}
        {pendingBets.length > 0 && (
          <TouchableOpacity activeOpacity={0.8} onPress={addBetsToSlip} style={styles.addPropsBtn}>
            <Text style={styles.addPropsBtnText}>Add {pendingBets.length} Bet{pendingBets.length !== 1 ? 's' : ''} to Slip ✓</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.legCard, { borderColor: border, backgroundColor: dark ? '#2c2c2e' : '#f5f5f7' }]}>
      {/* Header */}
      <View style={styles.legHeader}>
        <Text style={[styles.legNum, { color: sub }]}>LEG {index + 1}</Text>
        <TouchableOpacity onPress={onRemove} hitSlop={8}>
          <Text style={{ fontSize: 12, fontFamily: F.bold, color: '#FF3B30' }}>✕ Remove</Text>
        </TouchableOpacity>
      </View>

      {/* 1. Sport */}
      <Text style={[styles.dropLabel, { color: sub }]}>Sport</Text>
      <View style={styles.chipRow}>
        {SPORTS.map(s => (
          <Pressable
            key={s}
            onPress={() => onChange({ ...emptyLeg(), sport: s })}
            style={[styles.chip, { backgroundColor: leg.sport === s ? selectedChipBg : chipBg }]}
          >
            <Text style={[styles.chipText, { color: leg.sport === s ? '#000' : sub }]}>{SPORT_LABEL[s]}</Text>
          </Pressable>
        ))}
      </View>

      {/* 2. Game picker */}
      <Text style={[styles.dropLabel, { color: sub }]}>Game</Text>

      {/* Date tabs */}
      <View style={[styles.chipRow, { marginBottom: 8 }]}>
        {[{ offset: 0, label: 'Today' }, { offset: 1, label: 'Tomorrow' }].map(({ offset, label }) => (
          <TouchableOpacity
            key={offset}
            activeOpacity={0.7}
            onPress={() => setDateOffset(offset)}
            style={[styles.chip, { backgroundColor: dateOffset === offset ? selectedChipBg : chipBg }]}
          >
            <Text style={[styles.chipText, { color: dateOffset === offset ? '#000' : sub }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {gamesLoading ? (
        <ActivityIndicator size="small" color={sub} style={{ marginVertical: 12 }} />
      ) : games.length === 0 ? (
        <Text style={[styles.gameListEmpty, { color: sub }]}>No games available</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10, paddingRight: 4 }}>
            {games.map(g => {
              const isSelected = g.id === leg.gameId;
              return (
                <Pressable
                  key={g.id}
                  onPress={() => selectGame(g)}
                  style={[
                    styles.gameCard,
                    {
                      borderColor: isSelected ? '#FFD700' : border,
                      backgroundColor: dark ? '#1c1c1e' : '#fff',
                    },
                  ]}
                >
                  {/* Away row */}
                  <View style={styles.gameCardRow}>
                    {g.awayLogo
                      ? <Image source={{ uri: g.awayLogo }} style={styles.gameCardLogo} contentFit="contain" />
                      : <View style={[styles.gameCardLogo, { backgroundColor: sub + '30', borderRadius: 4 }]} />}
                    <Text style={[styles.gameCardAbbr, { color: text }]}>{g.awayAbbr}</Text>
                    <Text style={[styles.gameCardName, { color: sub }]} numberOfLines={1}>{g.awayName}</Text>
                  </View>
                  {/* Divider */}
                  <View style={[styles.gameCardDivider, { backgroundColor: border }]} />
                  {/* Home row */}
                  <View style={styles.gameCardRow}>
                    {g.homeLogo
                      ? <Image source={{ uri: g.homeLogo }} style={styles.gameCardLogo} contentFit="contain" />
                      : <View style={[styles.gameCardLogo, { backgroundColor: sub + '30', borderRadius: 4 }]} />}
                    <Text style={[styles.gameCardAbbr, { color: text }]}>{g.homeAbbr}</Text>
                    <Text style={[styles.gameCardName, { color: sub }]} numberOfLines={1}>{g.homeName}</Text>
                  </View>
                  {/* Status bar */}
                  <View style={[styles.gameCardStatusBar, { borderTopColor: border, backgroundColor: dark ? '#2c2c2e' : '#f5f5f7' }]}>
                    <Text style={[styles.gameCardSport, { color: sub }]}>{(leg.sport ?? 'nba').toUpperCase()}</Text>
                    {g.state === 'in' ? (
                      <View style={styles.gameCardLiveRow}>
                        <View style={styles.gameCardLiveDot} />
                        <Text style={styles.gameCardLiveText}>LIVE</Text>
                      </View>
                    ) : g.state === 'post' ? (
                      <Text style={[styles.gameCardTime, { color: sub }]}>Final</Text>
                    ) : (
                      <Text style={[styles.gameCardTime, { color: sub }]}>{g.gameTime ? fmtTime(g.gameTime) : ''}</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* 3. Bet browser — unified after game selected */}
      {leg.gameId && (
        detailsLoading
          ? <ActivityIndicator color={sub} style={{ marginVertical: 16 }} />
          : details
            ? renderBetBrowser(details)
            : <Text style={[styles.noOddsText, { color: sub }]}>Loading bet options…</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// CompactLegCard — committed leg display
// ---------------------------------------------------------------------------

function CompactLegCard({ leg, index, onRemove, border, text, sub, dark }: {
  leg: Partial<BetLeg>; index: number; onRemove: () => void;
  border: string; text: string; sub: string; dark: boolean;
}) {
  const SPORT_ACCENT: Record<string, string> = { nba: '#17408B', nfl: '#013369', mlb: '#002D72', nhl: '#003087' };
  const accent = SPORT_ACCENT[leg.sport ?? 'nba'] ?? '#555';

  // Pick the image to show in the avatar circle:
  //   • Player prop → that player's headshot
  //   • Moneyline / spread → the team's logo
  //   • Over / Under (game total) → no image, use the sport accent badge
  const avatarUrl =
    leg.type === 'prop' && leg.athleteId && leg.sport
      ? `https://a.espncdn.com/i/headshots/${leg.sport}/players/full/${leg.athleteId}.png`
      : (leg.type === 'moneyline' || leg.type === 'spread') && leg.teamLogoUrl
        ? leg.teamLogoUrl
        : null;

  return (
    <View style={[styles.compactLeg, { backgroundColor: dark ? '#2c2c2e' : '#f5f5f7', borderColor: border }]}>
      <View style={[styles.compactAccent, { backgroundColor: accent }]}>
        <Text style={styles.compactSport}>{(leg.sport ?? 'NBA').toUpperCase()}</Text>
      </View>

      {/* Team logo / player headshot circle */}
      <View style={[styles.compactAvatar, { backgroundColor: dark ? '#1c1c1e' : '#fff', borderColor: border }]}>
        {avatarUrl
          ? <Image source={{ uri: avatarUrl }} style={{ width: 32, height: 32 }} contentFit="contain" />
          : <Text style={{ fontSize: 14, fontFamily: F.black, color: sub }}>
              {leg.type === 'over' ? 'O' : leg.type === 'under' ? 'U' : '?'}
            </Text>
        }
      </View>

      <View style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8 }}>
        <Text style={[styles.compactDesc, { color: text }]} numberOfLines={1}>{leg.description || autoDescription(leg)}</Text>
        <Text style={[styles.compactGame, { color: sub }]} numberOfLines={1}>{leg.gameLabel || ''}</Text>
      </View>
      <View style={{ paddingRight: 12, alignItems: 'flex-end', justifyContent: 'center', gap: 6 }}>
        <Text style={[styles.compactOdds, { color: '#FFD700' }]}>{fmtOdds(leg.odds ?? 0)}</Text>
        <TouchableOpacity onPress={onRemove} hitSlop={8}>
          <Text style={{ color: '#FF3B30', fontSize: 12, fontFamily: F.bold }}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// New Parlay Modal
// ---------------------------------------------------------------------------

function NewParlayModal({ visible, onClose, onSave, dark, border, text, sub, cardBg, bg }: {
  visible: boolean; onClose: () => void;
  onSave: (name: string, stake: number, legs: Partial<BetLeg>[]) => void;
  dark: boolean; border: string; text: string; sub: string; cardBg: string; bg: string;
}) {
  const [stake, setStake] = useState('');
  const [legs, setLegs] = useState<Partial<BetLeg>[]>([emptyLeg()]);
  const [saving, setSaving] = useState(false);

  function reset() { setStake(''); setLegs([emptyLeg()]); setSaving(false); }
  function handleClose() { reset(); onClose(); }

  function handleReplaceWithProps(idx: number, newLegs: Partial<BetLeg>[]) {
    setLegs(current => {
      const next = [
        ...current.slice(0, idx),
        ...newLegs,
        ...current.slice(idx + 1),
      ];
      const hasDraft = next.some(l => !l.description || !l.odds);
      return hasDraft ? next : [...next, emptyLeg()];
    });
  }

  async function handleSave() {
    // Only persist FULLY-FILLED legs — empty "draft" rows the user added but
    // never completed should never reach the saved parlay.
    const validLegs = legs.filter(l => l.gameId && l.odds && l.description);
    if (!validLegs.length) { Alert.alert('Incomplete', 'Select at least one game and bet.'); return; }
    setSaving(true);
    const autoName = `Parlay · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    try { await onSave(autoName, parseFloat(stake) || 0, validLegs); reset(); onClose(); }
    finally { setSaving(false); }
  }

  const combinedOdds = calcCombinedOdds(legs);
  const payout = calcPotentialPayout(legs, parseFloat(stake) || 0);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={[styles.modalSafe, { backgroundColor: bg }]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalHeader, { borderBottomColor: border }]}>
            <TouchableOpacity onPress={handleClose}>
              <Text style={[styles.modalCancel, { color: sub }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: text }]}>New Parlay</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color="#FFD700" />
                : <Text style={styles.modalSave}>Save</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="always" nestedScrollEnabled>
            <View style={styles.stakeRow}>
              <Text style={[styles.stakeLabel, { color: sub }]}>$</Text>
              <TextInput
                style={[styles.stakeInput, { borderColor: border, color: text, backgroundColor: dark ? '#2c2c2e' : '#f2f2f7' }]}
                placeholder="Stake"
                placeholderTextColor={sub}
                keyboardType="numeric"
                value={stake}
                onChangeText={setStake}
              />
            </View>

            {combinedOdds != null && (
              <View style={[styles.payoutBar, { backgroundColor: dark ? '#2c2c2e' : '#f2f2f7', borderColor: border }]}>
                <View style={styles.payoutItem}>
                  <Text style={[styles.payoutLabel, { color: sub }]}>COMBINED ODDS</Text>
                  <Text style={[styles.payoutValue, { color: '#FFD700' }]}>{fmtOdds(combinedOdds)}</Text>
                </View>
                <View style={[{ width: 1, backgroundColor: border }]} />
                <View style={styles.payoutItem}>
                  <Text style={[styles.payoutLabel, { color: sub }]}>TO WIN</Text>
                  <Text style={[styles.payoutValue, { color: '#34C759' }]}>${payout.toFixed(2)}</Text>
                </View>
              </View>
            )}

            <Text style={[styles.sectionLabel, { color: text }]}>Legs</Text>

            {legs.map((leg, i) => {
              const isCommitted = !!(leg.description && leg.odds && leg.gameId);
              if (isCommitted) {
                return (
                  <CompactLegCard
                    key={i}
                    leg={leg}
                    index={i}
                    onRemove={() => setLegs(l => l.filter((_, idx) => idx !== i))}
                    border={border} text={text} sub={sub} dark={dark}
                  />
                );
              }
              return (
                <LegBuilder
                  key={i}
                  leg={leg}
                  index={i}
                  onChange={updated => setLegs(l => l.map((x, idx) => idx === i ? updated : x))}
                  onRemove={() => setLegs(l => l.filter((_, idx) => idx !== i))}
                  onReplaceWithProps={newLegs => handleReplaceWithProps(i, newLegs)}
                  border={border} text={text} sub={sub} dark={dark}
                />
              );
            })}

            <TouchableOpacity
              style={[styles.addLegBtn, { borderColor: '#FFD700' }]}
              onPress={() => setLegs(l => [...l, emptyLeg()])}
            >
              <Text style={styles.addLegText}>+ Add Another Game / Sport</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// PropProgressRing is imported from @/components/ui/PropProgressRing

// ---------------------------------------------------------------------------
// Parlay card
// ---------------------------------------------------------------------------

function ParlayCard({ parlay, onDelete, border, text, sub, cardBg }: {
  parlay: Parlay; onDelete: () => void;
  border: string; text: string; sub: string; cardBg: string;
}) {
  const clr = parlayStatusColor(parlay.status);
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.parlayCard, { backgroundColor: cardBg, borderColor: border }]}>
      <View style={[styles.parlayTopBar, { backgroundColor: clr + '18' }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.parlayName, { color: text }]}>{parlay.name}</Text>
          <Text style={[styles.parlayMeta, { color: sub }]}>
            {parlay.legs.length} leg{parlay.legs.length !== 1 ? 's' : ''} · Stake ${parlay.stake.toFixed(2)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.parlayOdds, { color: clr }]}>{fmtOdds(parlay.combinedOdds)}</Text>
          <Text style={[{ fontSize: 9, fontFamily: F.black, letterSpacing: 0.5, color: sub }]}>ODDS</Text>
        </View>
      </View>

      {parlay.legs.map(leg => (
        <View key={leg.id} style={[styles.legRow, { borderBottomColor: border }]}>
          <PropProgressRing leg={leg} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.legDesc, { color: text }]}>{leg.description || autoDescription(leg)}</Text>
            <Text style={[styles.legGame, { color: sub }]}>{leg.gameLabel} · {leg.sport?.toUpperCase()}</Text>
          </View>
          <Text style={[styles.legOdds, { color: statusColor(leg.status) }]}>{fmtOdds(leg.odds)}</Text>
        </View>
      ))}

      <View style={styles.parlayFooter}>
        <Text style={[{ fontSize: 10, fontFamily: F.black, letterSpacing: 0.5, color: sub }]}>TO WIN</Text>
        <Text style={[styles.parlayPayout, { color: '#34C759' }]}>${parlay.potentialPayout.toFixed(2)}</Text>
      </View>

      {parlay.status === 'active' ? (
        <View style={[styles.parlayActions, { borderTopColor: border }]}>
          <TouchableOpacity onPress={onDelete} style={styles.actionBtn}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.parlayActions, { borderTopColor: border }]}>
          <Text style={[{ flex: 1, fontSize: 13, fontFamily: F.black, color: clr }]}>
            {parlay.status.toUpperCase()} · ${parlay.status === 'won' ? parlay.potentialPayout.toFixed(2) : '0.00'}
          </Text>
          <TouchableOpacity onPress={onDelete} style={styles.actionBtn}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function BetsScreen() {
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#000' : '#f2f2f7';
  const cardBg = dark ? '#1c1c1e' : '#fff';
  const border = dark ? '#2c2c2e' : '#e5e5e5';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';

  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const betHdrX = useSharedValue(-40);
  const betHdrOpacity = useSharedValue(0);
  const betRingScale = useSharedValue(0.5);
  useEffect(() => {
    betHdrX.value = withSpring(0, { damping: 20, stiffness: 150 });
    betHdrOpacity.value = withTiming(1, { duration: 350 });
    betRingScale.value = withSpring(1, { damping: 14, stiffness: 100 });
  }, []);
  const betHdrStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: betHdrX.value }],
    opacity: betHdrOpacity.value,
  }));
  const betRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: betRingScale.value }],
    opacity: betHdrOpacity.value,
  }));

  useEffect(() => {
    loadBets().then(setParlays);
    const unsub = subscribeToBets(() => setParlays(getBetsSync()));
    return unsub;
  }, []);

  async function refreshLiveStatuses() {
    const current = await loadBets();
    if (!current.length) return;
    const updated = await Promise.all(current.map(async parlay => {
      if (parlay.status !== 'active') return parlay;
      const updatedLegs = await Promise.all(parlay.legs.map(async leg => {
        if (!leg.gameId || !leg.sport) return leg;
        try {
          const { data } = await axios.get(`${API}/sports/${leg.sport}/game/${leg.gameId}`);
          const status = calcLegStatusFromGame(leg, data);
          let currentStatValue = leg.currentStatValue;
          if (leg.type === 'prop' && leg.playerName && leg.statKey) {
            const STAT_KEY_MAP: Record<string, string> = {
              'Points': 'PTS', 'Rebounds': 'REB', 'Assists': 'AST', 'Steals': 'STL', 'Blocks': 'BLK',
              '3-Pointers': '3PM', 'Pass Yds': 'YDS', 'Rush Yds': 'YDS', 'Rec Yds': 'YDS',
              'Receptions': 'REC', 'Pass TDs': 'TD', 'Strikeouts': 'K', 'Hits': 'H',
              'Total Bases': 'TB', 'RBIs': 'RBI', 'Runs': 'R', 'Home Runs': 'HR',
              'Shots': 'SOG', 'Goals': 'G', 'Saves': 'SV',
            };
            const mappedKey = STAT_KEY_MAP[leg.statKey] ?? leg.statKey;
            const norm = leg.playerName.toLowerCase().replace(/[^a-z]/g, '');
            outer: for (const team of data.playerTeams ?? []) {
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
        } catch { return leg; }
      }));
      const p2 = { ...parlay, legs: updatedLegs };
      return { ...p2, status: calcParlayStatus(p2) };
    }));

    // Detect newly settled parlays and notify
    for (let i = 0; i < updated.length; i++) {
      const prev = current[i];
      const next = updated[i];
      if (prev.status === 'active' && next.status !== 'active') {
        const won = next.status === 'won';
        const push = next.status === 'push';
        Alert.alert(
          won ? 'Parlay Hit!' : push ? 'Push' : 'Parlay Lost',
          won
            ? `${next.name}\nYou won $${next.potentialPayout.toFixed(2)}!`
            : push
            ? `${next.name}\nYour stake is returned.`
            : `${next.name}\nBetter luck next time.`,
        );
        // Sync result to server
        try { await axios.post(`${API}/bets/${next.id}/settle`, { status: next.status }); } catch {}
      }
    }

    await saveBets(updated);
    setParlays(updated);
  }

  useEffect(() => {
    refreshLiveStatuses();
    refreshRef.current = setInterval(refreshLiveStatuses, 5000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, []);

  async function handleSave(name: string, stake: number, legs: Partial<BetLeg>[]) {
    try {
      const { data } = await axios.post(`${API}/bets`, { name, stake, legs });
      const updated = [...parlays, data.parlay as Parlay];
      await saveBets(updated);
      setParlays(updated);
    } catch {
      const id = Math.random().toString(36).slice(2);
      const completedLegs: BetLeg[] = legs.map((l, i) => ({
        id: `${id}-${i}`,
        gameId: l.gameId ?? '',
        sport: l.sport ?? 'nba',
        gameLabel: l.gameLabel ?? '',
        type: l.type ?? 'moneyline',
        teamAbbr: l.teamAbbr,
        line: l.line,
        odds: l.odds ?? 0,
        description: l.description || autoDescription(l),
        status: 'pending',
        playerName: l.playerName,
        statKey: l.statKey,
        statLine: l.statLine,
      }));
      const local: Parlay = {
        id, status: 'active', createdAt: Date.now(), stake,
        name: name || `Parlay · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        legs: completedLegs,
        combinedOdds: calcCombinedOdds(completedLegs) ?? 0,
        potentialPayout: calcPotentialPayout(completedLegs, stake),
      };
      const updated = [...parlays, local];
      await saveBets(updated);
      setParlays(updated);
    }
  }

  async function handleDelete(id: string) {
    // Update state immediately so UI responds instantly
    const updated = parlays.filter(p => p.id !== id);
    setParlays(updated);
    await saveBets(updated);
    try { await axios.delete(`${API}/bets/${id}`); } catch {}
  }

  const active = parlays.filter(p => p.status === 'active');
  const settled = parlays.filter(p => p.status !== 'active');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient colors={['#1C1200', '#2A1C00', '#080600']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.betHeader}>
          <Animated.View style={[styles.betHeaderRingWrap, betRingStyle]}>
            <View style={styles.betHeaderRing1} />
            <View style={styles.betHeaderRing2} />
          </Animated.View>
          <View style={styles.betHeaderShimmer} />
          <View style={styles.betHeaderInner}>
            <View style={styles.betHeaderAccentBar} />
            <Animated.View style={[styles.betHeaderTitleBlock, betHdrStyle]}>
              <Text style={styles.betHeaderTitle}>BETTING SLIP</Text>
              <Text style={styles.betHeaderSub}>YOUR ACTIVE WAGERS</Text>
            </Animated.View>
            <TouchableOpacity style={styles.newBtn} onPress={() => setShowNew(true)}>
              <Text style={styles.newBtnText}>+ New Parlay</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <Text style={[styles.sectionHeader, { color: sub }]}>ACTIVE SLIPS</Text>
        {active.length === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[{ fontSize: 15, fontFamily: F.bold, color: sub }]}>No active parlays</Text>
            <Text style={[{ fontSize: 12, fontFamily: F.regular, color: sub }]}>Tap "New Parlay" to build one</Text>
          </View>
        )}
        {active.map(p => (
          <ParlayCard key={p.id} parlay={p} onDelete={() => handleDelete(p.id)}
            border={border} text={text} sub={sub} cardBg={cardBg} />
        ))}

        {/* PAST SLIPS — auto-populated when active parlays settle (every leg
           hits or one fails). Each shows its final WON/LOST status. */}
        {settled.length > 0 && (
          <>
            <TouchableOpacity onPress={() => setShowSettled(v => !v)} style={styles.pastSlipsHeader}>
              <Text style={[styles.sectionHeader, { color: sub, marginTop: 0 }]}>
                PAST SLIPS · {settled.length}
              </Text>
              <View style={styles.pastSlipsCounts}>
                {/* Quick win/loss tally */}
                {(() => {
                  const won  = settled.filter(p => p.status === 'won').length;
                  const lost = settled.filter(p => p.status === 'lost').length;
                  return (
                    <>
                      {won  > 0 && <Text style={styles.pastSlipWon}>{won}W</Text>}
                      {lost > 0 && <Text style={styles.pastSlipLost}>{lost}L</Text>}
                    </>
                  );
                })()}
                <Text style={[styles.pastSlipsChevron, { color: sub }]}>{showSettled ? '▲' : '▼'}</Text>
              </View>
            </TouchableOpacity>
            {showSettled && settled
              .slice()
              .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))   // newest first
              .map(p => (
                <ParlayCard key={p.id} parlay={p} onDelete={() => handleDelete(p.id)}
                  border={border} text={text} sub={sub} cardBg={cardBg} />
              ))}
          </>
        )}
        {/* TRENDING PLAYER PROPS — one section per sport */}
        {(['nba', 'nfl', 'mlb', 'nhl'] as const).map(s => (
          <View key={s} style={{ marginTop: 24 }}>
            <View style={styles.trendingHeaderRow}>
              <TrendingIcon size={18} color="#ff6b35" />
              <Text style={[styles.trendingTitleNew, { color: text }]}>
                {s.toUpperCase()} TRENDING PROPS
              </Text>
            </View>
            <TrendingProps cardBg={cardBg} border={border} text={text} sub={sub} sports={[s]} />
          </View>
        ))}
      </ScrollView>

      <NewParlayModal visible={showNew} onClose={() => setShowNew(false)} onSave={handleSave}
        dark={dark} border={border} text={text} sub={sub} cardBg={cardBg} bg={bg} />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 60 },
  hotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#ff3b30',
    shadowColor: '#ff3b30',
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  hotPillDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' },
  hotPillText: { color: '#fff', fontSize: 9, fontFamily: F.black, letterSpacing: 1.5 },

  // New small-icon header for trending props sections (each sport)
  trendingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,       // matches body padding so icon isn't at edge
    marginBottom: 10,
  },
  trendingTitleNew: {
    fontSize: 13,
    fontFamily: F.black,
    letterSpacing: 1.5,
  },

  betHeader: { minHeight: 120, paddingTop: 20, paddingBottom: 24, paddingHorizontal: 22, overflow: 'hidden', position: 'relative' },
  betHeaderInner: { flexDirection: 'row', alignItems: 'center', gap: 0, position: 'relative', zIndex: 2 },
  betHeaderAccentBar: { width: 5, height: 52, borderRadius: 3, marginRight: 14, backgroundColor: '#FFD700' },
  betHeaderTitleBlock: { flex: 1 },
  betHeaderTitle: { fontSize: 48, fontFamily: F.black, color: '#fff', letterSpacing: 6, lineHeight: 62, paddingTop: 6, includeFontPadding: true },
  betHeaderSub: { fontSize: 10, fontFamily: F.bold, color: 'rgba(255,255,255,0.4)', letterSpacing: 4, marginTop: 4 },
  betHeaderRingWrap: { position: 'absolute', top: -40, right: -40, zIndex: 1, width: 260, height: 200 },
  betHeaderRing1: { width: 160, height: 160, borderRadius: 80, borderWidth: 22, borderColor: 'rgba(255,215,0,0.1)', position: 'absolute', top: 0, right: 0 },
  betHeaderRing2: { width: 90, height: 90, borderRadius: 45, borderWidth: 14, borderColor: 'rgba(255,215,0,0.06)', position: 'absolute', top: 70, right: 100 },
  betHeaderShimmer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1.5, backgroundColor: 'rgba(255,215,0,0.15)', zIndex: 3 },
  newBtn: { backgroundColor: '#FFD700', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  newBtnText: { fontSize: 13, fontFamily: F.black, color: '#000' },

  sectionHeader: { fontSize: 11, fontFamily: F.black, letterSpacing: 1, marginHorizontal: 16, marginTop: 16, marginBottom: 8 },
  pastSlipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  pastSlipsCounts: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pastSlipWon:  { fontSize: 11, fontFamily: F.black, color: '#34C759', letterSpacing: 0.5 },
  pastSlipLost: { fontSize: 11, fontFamily: F.black, color: '#FF3B30', letterSpacing: 0.5 },
  pastSlipsChevron: { fontSize: 10, fontFamily: F.bold, marginLeft: 4 },
  sectionLabel: { fontSize: 15, fontFamily: F.black, marginBottom: 10 },

  emptyCard: { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, padding: 24, alignItems: 'center', gap: 6 },

  parlayCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  parlayTopBar: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  parlayName: { fontSize: 15, fontFamily: F.black },
  parlayMeta: { fontSize: 11, fontFamily: F.regular, marginTop: 2 },
  parlayOdds: { fontSize: 22, fontFamily: F.black },

  legRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  legIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  legDesc: { fontSize: 13, fontFamily: F.bold },
  legGame: { fontSize: 10, fontFamily: F.regular, marginTop: 2 },
  legOdds: { fontSize: 13, fontFamily: F.black, minWidth: 44, textAlign: 'right' },

  parlayFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  parlayPayout: { fontSize: 20, fontFamily: F.black },

  parlayActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8, gap: 8, alignItems: 'center' },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  deleteText: { fontSize: 12, fontFamily: F.bold, color: '#FF3B30' },
  settleText: { fontSize: 12, fontFamily: F.bold },

  // Modal
  modalSafe: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  modalCancel: { fontSize: 15, fontFamily: F.regular },
  modalTitle: { fontSize: 17, fontFamily: F.black },
  modalSave: { fontSize: 15, fontFamily: F.black, color: '#FFD700' },
  modalScroll: { padding: 16, paddingBottom: 80 },

  stakeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  stakeLabel: { fontSize: 22, fontFamily: F.black },
  stakeInput: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 20, fontFamily: F.black },

  payoutBar: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, marginBottom: 20, overflow: 'hidden' },
  payoutItem: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  payoutLabel: { fontSize: 9, fontFamily: F.black, letterSpacing: 0.5 },
  payoutValue: { fontSize: 22, fontFamily: F.black, marginTop: 4 },

  // Leg builder
  legCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  legHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  legNum: { fontSize: 10, fontFamily: F.black, letterSpacing: 1 },

  dropLabel: { fontSize: 11, fontFamily: F.black, letterSpacing: 0.5, marginBottom: 6, marginTop: 10 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  chipText: { fontSize: 12, fontFamily: F.black },

  dropBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  dropBtnText: { fontSize: 14, fontFamily: F.regular, flex: 1 },

  gameList: { borderWidth: 1, borderRadius: 12, marginTop: 4, overflow: 'hidden' },
  gameListEmpty: { padding: 16, fontSize: 13, fontFamily: F.regular, textAlign: 'center' },
  gameListItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  gameListLabel: { fontSize: 14, fontFamily: F.bold, flex: 1 },
  livePill: { backgroundColor: '#FF3B30', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  livePillText: { color: '#fff', fontSize: 9, fontFamily: F.black },
  finalTag: { fontSize: 11, fontFamily: F.regular, fontStyle: 'italic' },

  betOptionsRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  betOptionCard: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4 },
  betOptionLabel: { fontSize: 16, fontFamily: F.black },
  betOptionSub: { fontSize: 11, fontFamily: F.regular },
  betOptionValue: { fontSize: 18, fontFamily: F.black, marginTop: 4 },

  propSectionLabel: { fontSize: 10, fontFamily: F.black, letterSpacing: 0.5, marginBottom: 6, marginTop: 4 },
  propLine: { fontSize: 12, fontFamily: F.regular, marginTop: 2 },
  addPropsBtn: { backgroundColor: '#FFD700', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  addPropsBtnText: { fontSize: 15, fontFamily: F.black, color: '#000' },

  noOddsText: { fontSize: 13, fontFamily: F.regular, textAlign: 'center', paddingVertical: 12 },

  // Two-column team player props
  tpColumn: { flex: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  tpTeamHeader: { fontSize: 10, fontFamily: F.black, letterSpacing: 0.5, textAlign: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  tpRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  tpName: { fontSize: 12, fontFamily: F.bold },
  tpLine: { fontSize: 10, fontFamily: F.regular, marginTop: 1 },
  tpBtn: { borderRadius: 7, paddingHorizontal: 5, paddingVertical: 4, minWidth: 34, alignItems: 'center' },
  tpBtnLabel: { fontSize: 11, fontFamily: F.black },
  tpBtnOdds: { fontSize: 9, fontFamily: F.regular, marginTop: 1 },
  tpBenchDivider: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingTop: 4, marginTop: 2 },
  tpBenchLabel: { fontSize: 9, fontFamily: F.black, letterSpacing: 0.5 },

  oddsOverrideRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  descPreviewBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
  descPreview: { fontSize: 14, fontFamily: F.bold, flex: 1 },
  descOdds: { fontSize: 14, fontFamily: F.black },

  addLegBtn: { borderWidth: 1.5, borderRadius: 14, borderStyle: 'dashed', paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  addLegText: { fontSize: 15, fontFamily: F.black, color: '#FFD700' },

  // CompactLegCard
  compactLeg: { flexDirection: 'row', alignItems: 'stretch', borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: 'hidden', minHeight: 60 },
  compactAccent: { width: 44, alignItems: 'center', justifyContent: 'center' },
  compactAvatar: {
    width: 40, height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'center',
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  compactSport: { color: '#fff', fontSize: 9, fontFamily: F.black, letterSpacing: 0.5 },
  compactDesc: { fontSize: 13, fontFamily: F.bold },
  compactGame: { fontSize: 10, fontFamily: F.regular, marginTop: 2 },
  compactOdds: { fontSize: 16, fontFamily: F.black },

  // Game cards
  gameCard: { width: 170, borderRadius: 14, borderWidth: 2, overflow: 'hidden' },
  gameCardRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  gameCardLogo: { width: 26, height: 26 },
  gameCardAbbr: { fontSize: 13, fontFamily: F.black },
  gameCardName: { fontSize: 10, fontFamily: F.regular, flex: 1 },
  gameCardDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10 },
  gameCardStatusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  gameCardSport: { fontSize: 9, fontFamily: F.black, letterSpacing: 0.5 },
  gameCardTime: { fontSize: 10, fontFamily: F.regular },
  gameCardLiveRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gameCardLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' },
  gameCardLiveText: { fontSize: 10, fontFamily: F.black, color: '#FF3B30' },

  // LegStatusRing
  legRing: { width: 36, height: 36, borderRadius: 18, borderWidth: 2.5, overflow: 'hidden' },
  legRingImg: { width: 36, height: 36 },
  legRingInner: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
