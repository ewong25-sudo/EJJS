import axios from 'axios';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, PanResponder, Platform, Pressable, SafeAreaView, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { LiveBadge } from '@/components/live-badge';
import { NewsCard } from '@/components/news-card';
import { SportScoreCard } from '@/components/sport-score-card';
import { F } from '@/constants/fonts';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NewsArticle, SportGame, SportKey, StandingEntry, StandingGroup } from '@/types/sports';

import { API } from '@/constants/api';
import { StandingsView } from '@/components/standings-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
const SEGMENTS = ['SCORES', 'STANDINGS', 'NEWS'] as const;
type Segment = typeof SEGMENTS[number];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s: string) {
  const d = new Date(s + 'T12:00:00');
  const t = toISO(new Date());
  const y = toISO(new Date(Date.now() - 86400000));
  if (s === t) return 'Today'; if (s === y) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function SportScreen({ sport }: { sport: SportKey }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cfg = SPORT_CONFIG[sport];
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#000' : '#f2f2f7';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';
  const cardBg = dark ? '#1c1c1e' : '#fff';
  const border = dark ? '#2c2c2e' : '#e5e5e5';

  const isNFL = sport === 'nfl';

  const [segment, setSegment] = useState<Segment>('SCORES');
  const [date, setDate] = useState(toISO(new Date()));
  const [nflWeek, setNflWeek] = useState<number | null>(null);
  const [nflSeasontype, setNflSeasontype] = useState(2);
  const [nflSeasonYear, setNflSeasonYear] = useState<number | null>(null);
  const [nflOffseason, setNflOffseason] = useState(false);
  const [games, setGames] = useState<SportGame[]>([]);
  const [groups, setGroups] = useState<StandingGroup[]>([]);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [loadingNews, setLoadingNews] = useState(false);
  const loadedStandings = useRef(false);
  const loadedNews = useRef(false);
  // Standings filter: 'ALL' (full league), a conference name, or a division name.
  const [standingsFilter, setStandingsFilter] = useState<string>('ALL');
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Segment indicator animation
  const segW = Dimensions.get('window').width / 3;
  const indicatorX = useSharedValue(0);
  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: indicatorX.value }] }));

  // Header entrance animations
  const headerTitleX = useSharedValue(-40);
  const headerOpacity = useSharedValue(0);
  const ringScale = useSharedValue(0.5);

  function switchSegment(s: Segment) {
    setSegment(s);
    const idx = SEGMENTS.indexOf(s);
    indicatorX.value = withTiming(idx * segW, { duration: 180 });
    if (s === 'STANDINGS' && !loadedStandings.current) fetchStandings();
    if (s === 'NEWS' && !loadedNews.current) fetchNews();
  }

  function shiftSegment(delta: number) {
    const idx = SEGMENTS.indexOf(segment);
    const next = SEGMENTS[Math.max(0, Math.min(SEGMENTS.length - 1, idx + delta))];
    if (next !== segment) switchSegment(next);
  }

  const segmentSwipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) < 36) return;
      shiftSegment(g.dx < 0 ? -1 : 1);
    },
  }), [segment]);

  const dateSwipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) < 36) return;
      if (isNFL) shiftWeek(g.dx < 0 ? 1 : -1);
      else shiftDate(g.dx < 0 ? 1 : -1);
    },
  }), [date, isNFL, nflWeek, nflSeasontype]);

  const isInitialMount = useRef(true);
  const nflUserWeek = useRef<number | null>(null); // only set by user navigation

  useEffect(() => {
    if (isNFL) {
      fetchNFLGames(undefined); // always fetch current week on mount
      return;
    }
    const initial = isInitialMount.current;
    isInitialMount.current = false;
    fetchGames(date, initial);
  }, []);

  useEffect(() => {
    if (!isNFL) {
      fetchGames(date);
    }
  }, [date]);

  // Re-fetch NFL only when user explicitly navigates weeks
  useEffect(() => {
    if (!isNFL || nflUserWeek.current === null) return;
    fetchNFLGames(nflUserWeek.current, nflSeasontype);
  }, [nflWeek, nflSeasontype]);

  async function fetchNFLGames(week?: number, seasontype?: number, year?: number, background = false) {
    if (!background) {
      setLoadingGames(true);
      setGames([]);
    }
    setNflOffseason(false);
    try {
      const st = seasontype ?? nflSeasontype;
      let params = week ? `?week=${week}&seasontype=${st}` : '';
      if (week && (year ?? nflSeasonYear)) params += `&year=${year ?? nflSeasonYear}`;
      const r = await axios.get<{ games: SportGame[]; week: number; seasontype: number; seasonYear: number }>(
        `${API}/sports/nfl/scores${params}`
      );
      const fetched = r.data.games || [];
      if (r.data.week) setNflWeek(r.data.week);
      if (r.data.seasontype) setNflSeasontype(r.data.seasontype);
      if (r.data.seasonYear) setNflSeasonYear(r.data.seasonYear);

      // Never show weeks where all games are already completed in the past
      const allPost = fetched.every(g => g.status.state === 'post');
      const oldGames = fetched.length > 0 && fetched.every(
        g => new Date(g.date).getTime() < Date.now() - 12 * 60 * 60 * 1000 // finished >12h ago
      );
      if (allPost && oldGames) {
        setNflOffseason(true);
        setGames([]);
        if (!background) setLoadingGames(false);
        return;
      }
      setNflOffseason(false);
      setGames(fetched);
    } catch {}
    if (!background) setLoadingGames(false);
  }

  async function fetchGames(targetDate: string, autoSkip = false, background = false) {
    if (!background) {
      setLoadingGames(true);
      setGames([]);
    }
    try {
      const r = await axios.get<{ games: SportGame[] }>(`${API}/sports/${sport}/scores?date=${targetDate}`);
      const fetched = r.data.games || [];
      if (fetched.length === 0 && autoSkip) {
        for (const delta of [1, -1]) {
          const limit = delta > 0 ? 14 : 30;
          for (let i = 1; i <= limit; i++) {
            const d = new Date(targetDate + 'T12:00:00');
            d.setDate(d.getDate() + delta * i);
            const iso = toISO(d);
            try {
              const r2 = await axios.get<{ games: SportGame[] }>(`${API}/sports/${sport}/scores?date=${iso}`);
              if ((r2.data.games || []).length > 0) {
                setDate(iso);
                return;
              }
            } catch { break; }
          }
        }
      }
      setGames(fetched);
    } catch {}
    if (!background) setLoadingGames(false);
  }

  async function fetchStandings() {
    loadedStandings.current = true;
    setLoadingStandings(true);
    try {
      const r = await axios.get<{ groups: StandingGroup[] }>(`${API}/sports/${sport}/standings`);
      setGroups(r.data.groups || []);
    } catch {}
    setLoadingStandings(false);
  }

  async function fetchNews() {
    loadedNews.current = true;
    setLoadingNews(true);
    try {
      const r = await axios.get<{ articles: NewsArticle[] }>(`${API}/sports/${sport}/news`);
      setNews(r.data.articles || []);
    } catch {}
    setLoadingNews(false);
  }

  const NFL_REGULAR_WEEKS = 18;
  const NFL_POSTSEASON_WEEKS = 5; // Wild Card, Divisional, Conf Champ, Pro Bowl, Super Bowl

  function shiftWeek(delta: number) {
    if (nflWeek === null) return;
    if (nflSeasontype === 2) {
      if (delta > 0 && nflWeek >= NFL_REGULAR_WEEKS) {
        // Cross into postseason
        setNflSeasontype(3);
        nflUserWeek.current = 1;
        setNflWeek(1);
        return;
      }
      const next = Math.max(1, nflWeek + delta);
      nflUserWeek.current = next;
      setNflWeek(next);
    } else if (nflSeasontype === 3) {
      if (delta < 0 && nflWeek <= 1) {
        // Cross back into regular season
        setNflSeasontype(2);
        nflUserWeek.current = NFL_REGULAR_WEEKS;
        setNflWeek(NFL_REGULAR_WEEKS);
        return;
      }
      const next = Math.min(NFL_POSTSEASON_WEEKS, Math.max(1, nflWeek + delta));
      nflUserWeek.current = next;
      setNflWeek(next);
    }
  }

  function nflWeekLabel(): string {
    if (nflWeek === null) return 'NFL';
    if (nflSeasontype === 1) return `Preseason Wk ${nflWeek}`;
    if (nflSeasontype === 3) {
      const names: Record<number, string> = { 1: 'Wild Card', 2: 'Divisional', 3: 'Conf. Championship', 4: 'Pro Bowl', 5: 'Super Bowl' };
      return names[nflWeek] ?? `Postseason Wk ${nflWeek}`;
    }
    return `Week ${nflWeek}`;
  }

  async function shiftDate(delta: number) {
    let d = new Date(date + 'T12:00:00');
    for (let attempts = 0; attempts < 14; attempts++) {
      d.setDate(d.getDate() + delta);
      const iso = toISO(d);
      try {
        const r = await axios.get<{ games: SportGame[] }>(`${API}/sports/${sport}/scores?date=${iso}`);
        if ((r.data.games || []).length > 0) {
          setDate(iso);
          return;
        }
      } catch { break; }
    }
    const fallback = new Date(date + 'T12:00:00');
    fallback.setDate(fallback.getDate() + delta);
    setDate(toISO(fallback));
  }

  useEffect(() => {
    headerTitleX.value = -40;
    headerOpacity.value = 0;
    ringScale.value = 0.5;
    headerTitleX.value = withSpring(0, { damping: 20, stiffness: 150 });
    headerOpacity.value = withTiming(1, { duration: 350 });
    ringScale.value = withSpring(1, { damping: 14, stiffness: 100 });
  }, [sport]);

  const headerTitleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: headerTitleX.value }],
    opacity: headerOpacity.value,
  }));
  const ringAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: headerOpacity.value,
  }));

  const liveCount = games.filter(g => g.status.state === 'in').length;

  // Poll live score cards quickly enough to feel like the game detail page.
  useEffect(() => {
    if (liveCount > 0 && segment === 'SCORES') {
      if (!liveIntervalRef.current) {
        liveIntervalRef.current = setInterval(() => {
          if (isNFL) {
            fetchNFLGames(nflWeek ?? undefined, nflSeasontype, undefined, true);
          } else {
            fetchGames(date, false, true);
          }
        }, 2500);
      }
    } else {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    }
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
  }, [liveCount, segment, date, nflWeek, nflSeasontype]);

  const segSubtitle = segment === 'SCORES' ? 'SCORES & SCHEDULES' : segment === 'STANDINGS' ? 'LEAGUE STANDINGS' : 'LATEST NEWS';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      {/* HEADER — pad top by the safe-area inset so the big sport title clears
          the notch / status bar on phones (RN SafeAreaView doesn't on Android). */}
      <LinearGradient colors={cfg.gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: insets.top + 16 }]}>
        {/* Decorative rings */}
        <Animated.View style={[styles.headerRingWrap, ringAnimStyle]}>
          <View style={styles.headerRing1} />
          <View style={styles.headerRing2} />
        </Animated.View>
        {/* Bottom shimmer line */}
        <View style={styles.headerShimmer} />
        {/* Content */}
        <View style={styles.headerInner}>
          <Animated.View style={[styles.headerTitleBlock, headerTitleStyle]}>
            {/* Accent bar lives INSIDE the title row so its height matches the
                logo + title and it stays vertically centered with them. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.headerAccentBar, { backgroundColor: cfg.accentColor }]} />
              <Image
                source={{ uri: `https://a.espncdn.com/i/teamlogos/leagues/500-dark/${sport}.png` }}
                style={styles.headerLeagueLogo}
                contentFit="contain"
                transition={200}
              />
              <Text style={styles.headerTitle} adjustsFontSizeToFit numberOfLines={1}>{cfg.label}</Text>
              {liveCount > 0 && segment === 'SCORES' ? <LiveBadge /> : null}
            </View>
            {/* Subtitle indented to line up under the logo (past the bar). */}
            <Text style={[styles.headerSub, { marginLeft: 17 }]}>{segSubtitle}</Text>
          </Animated.View>
        </View>
      </LinearGradient>

      {/* SEGMENT CONTROL */}
      <View style={[styles.segmentBar, { backgroundColor: cardBg, borderColor: border }]} {...segmentSwipe.panHandlers}>
        <Animated.View style={[styles.segmentIndicator, { width: segW, backgroundColor: cfg.color + '18' }, indicatorStyle]} />
        {SEGMENTS.map(s => (
          <Pressable key={s} style={styles.segmentBtn} onPress={() => switchSegment(s)}>
            <Text style={[styles.segmentText, { color: segment === s ? cfg.color : sub, fontFamily: segment === s ? F.black : F.bold }]}>{s}</Text>
            {segment === s ? <View style={[styles.segmentUnderline, { backgroundColor: cfg.color }]} /> : null}
          </Pressable>
        ))}
      </View>

      {/* SCORES */}
      {segment === 'SCORES' && (
        <>
          {/* Off-season state for NFL */}
          {isNFL && nflOffseason ? (
            <View style={styles.offseason}>
              <Text style={[styles.offseasonTitle, { color: text }]}>NFL Off Season</Text>
              <Text style={[styles.offseasonSub, { color: sub }]}>The next season schedule will appear here once released</Text>
            </View>
          ) : (
            <>
              <View style={[styles.dateRow, { borderColor: border }]} {...dateSwipe.panHandlers}>
                {isNFL ? (
                  <>
                    <Pressable onPress={() => shiftWeek(-1)} hitSlop={12}><Text style={[styles.chevron, { color: sub }]}>‹</Text></Pressable>
                    <Text style={[styles.dateLabel, { color: text }]}>{nflWeekLabel()}</Text>
                    <Pressable onPress={() => shiftWeek(1)} hitSlop={12}><Text style={[styles.chevron, { color: sub }]}>›</Text></Pressable>
                  </>
                ) : (
                  <>
                    <Pressable onPress={() => shiftDate(-1)} hitSlop={12}><Text style={[styles.chevron, { color: sub }]}>‹</Text></Pressable>
                    <Text style={[styles.dateLabel, { color: text }]}>{fmtDate(date)}</Text>
                    <Pressable onPress={() => shiftDate(1)} hitSlop={12}><Text style={[styles.chevron, { color: sub }]}>›</Text></Pressable>
                  </>
                )}
              </View>
              {loadingGames ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={cfg.color} />
              ) : games.length === 0 ? (
                <View style={styles.empty}><Text style={[styles.emptyText, { color: sub }]}>No games scheduled</Text></View>
              ) : (
                <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                  {/* Web: 2- or 3-up grid of game cards so wide monitors don't
                      leave huge dead space. Native: stacked column unchanged. */}
                  <View style={Platform.OS === 'web' ? styles.gamesGridWeb : undefined}>
                    {games.map((g, i) => (
                      <View key={g.id} style={Platform.OS === 'web' ? styles.gamesGridItemWeb : undefined}>
                        <SportScoreCard game={g} sport={sport} index={i} />
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}
            </>
          )}
        </>
      )}

      {/* STANDINGS */}
      {segment === 'STANDINGS' && (
        <StandingsView
          sport={sport} accent={cfg.color}
          bg={bg} cardBg={cardBg} text={text} sub={sub} border={border} dark={dark}
        />
      )}

      {/* NEWS */}
      {segment === 'NEWS' && (
        loadingNews ? <ActivityIndicator style={{ marginTop: 40 }} color={cfg.color} /> :
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {news.map((a, i) => <NewsCard key={a.id} article={a} index={i} variant={i === 0 ? 'featured' : 'default'} />)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 120, paddingTop: 20, paddingBottom: 28, paddingHorizontal: 22, overflow: 'hidden', position: 'relative' },
  headerInner: { flexDirection: 'row', alignItems: 'center', gap: 0, position: 'relative', zIndex: 2 },
  headerAccentBar: { width: 5, height: 56, borderRadius: 3 },
  headerTitleBlock: { flex: 1 },
  headerLeagueLogo: { width: 56, height: 56 },
  // lineHeight must clear the tall Oswald-Black caps or their tops get clipped
  // (especially under the header's overflow:hidden). ~1.25x fontSize + a touch
  // of top padding keeps the glyph tops fully visible.
  headerTitle: { fontSize: 60, fontFamily: F.black, color: '#fff', letterSpacing: 8, lineHeight: 78, paddingTop: 6, includeFontPadding: true },
  headerSub: { fontSize: 10, fontFamily: F.bold, color: 'rgba(255,255,255,0.4)', letterSpacing: 4, marginTop: 4 },
  headerRingWrap: { position: 'absolute', top: -40, right: -40, zIndex: 1, width: 260, height: 200 },
  headerRing1: { width: 160, height: 160, borderRadius: 80, borderWidth: 22, borderColor: 'rgba(255,255,255,0.07)', position: 'absolute', top: 0, right: 0 },
  headerRing2: { width: 90, height: 90, borderRadius: 45, borderWidth: 14, borderColor: 'rgba(255,255,255,0.05)', position: 'absolute', top: 70, right: 100 },
  headerShimmer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1.5, backgroundColor: 'rgba(255,255,255,0.1)', zIndex: 3 },
  segmentBar: { flexDirection: 'row', borderBottomWidth: 1, position: 'relative' },
  segmentIndicator: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, position: 'relative' },
  segmentText: { fontSize: 13, letterSpacing: 1 },
  segmentUnderline: { position: 'absolute', bottom: 0, left: 16, right: 16, height: 3, borderRadius: 2 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  chevron: { fontSize: 28, fontFamily: F.regular },
  dateLabel: { fontSize: 16, fontFamily: F.bold, letterSpacing: 0.5 },
  list: Platform.OS === 'web'
    ? ({ paddingTop: 8, paddingBottom: 32, maxWidth: 1180, width: '100%', alignSelf: 'center' } as any)
    : { paddingTop: 8, paddingBottom: 32 },
  // Web grid: rows of cards that flex-wrap automatically. Each card gets
  // 33.3% width (clamped to a sensible min via minWidth on the item) so on
  // narrower windows it gracefully degrades to 2 cols, then 1.
  gamesGridWeb: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', paddingHorizontal: 8 },
  gamesGridItemWeb: ({ width: '33.333%', minWidth: 320, padding: 6 } as any),
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 80 },
  emptyText: { fontSize: 15, fontFamily: F.regular },
  offseason: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  offseasonTitle: { fontSize: 26, fontFamily: F.black, letterSpacing: 1 },
  offseasonSub: { fontSize: 14, fontFamily: F.regular, textAlign: 'center' },
  offseasonBtn: { marginTop: 8, borderWidth: 1, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 20 },
  offseasonBtnText: { fontSize: 13, fontFamily: F.bold },
  sectionHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  sectionAccent: { width: 4, height: 16, borderRadius: 2 },
  sectionTitle: { flex: 1, fontSize: 12, fontFamily: F.black, letterSpacing: 1 },
  sectionCols: { flexDirection: 'row' },
  colHead: { width: 36, fontSize: 10, fontFamily: F.bold, textAlign: 'center', letterSpacing: 0.5 },
  standRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rank: { width: 22, fontSize: 12, fontFamily: F.regular, textAlign: 'center' },
  standAccent: { width: 3, height: 20, borderRadius: 2, marginHorizontal: 8 },
  standName: { flex: 1, fontSize: 14, fontFamily: F.bold },
  standStats: { flexDirection: 'row' },
  statCell: { width: 36, fontSize: 13, fontFamily: F.regular, textAlign: 'center' },
});
