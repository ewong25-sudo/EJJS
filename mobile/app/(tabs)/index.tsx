import axios from 'axios';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { LiveBadge } from '@/components/live-badge';
import { NewsCard } from '@/components/news-card';
import { TrendingProps } from '@/components/trending-props';
import { TrendingIcon } from '@/components/trending-icon';
import { WebContainer } from '@/components/web-container';
import { useTick } from '@/hooks/use-tick';
import { useLiveClock } from '@/hooks/use-live-clock';
import { F } from '@/constants/fonts';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NewsArticle, SportGame, SportKey } from '@/types/sports';

import { API } from '@/constants/api';
const SPORTS: SportKey[] = ['nba', 'nfl', 'mlb', 'nhl'];

// Local date (NOT UTC) — a game that's currently live in the US evening is on
// the US date, even if UTC has already rolled over to tomorrow.
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function HomeScreen() {
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#000' : '#f2f2f7';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';
  const cardBg = dark ? '#1c1c1e' : '#fff';
  const border = dark ? '#2c2c2e' : '#e5e5e5';

  const [liveGames, setLiveGames] = useState<Array<SportGame & { sport: SportKey }>>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Pull currently-LIVE games from every sport. We query TODAY's scoreboard
    // and also YESTERDAY's, because a late-night game can stay live past
    // midnight local time and still belong to the prior day's scoreboard.
    const yest = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();
    const fetchLive = () => {
      const dates = [todayISO(), yest];
      return Promise.all(SPORTS.flatMap(s =>
        dates.map(date =>
          axios.get<{ games: SportGame[] }>(`${API}/sports/${s}/scores?date=${date}`)
            .then(r => (r.data.games || [])
              .filter(g => g.status?.state === 'in')
              .map(g => ({ ...g, sport: s })))
            .catch(() => [] as Array<SportGame & { sport: SportKey }>)
        )
      )).then(all => {
        // Dedupe by game id (today + yesterday may both contain the same game)
        const seen = new Set<string>();
        const live: Array<SportGame & { sport: SportKey }> = [];
        for (const g of all.flat()) {
          if (seen.has(g.id)) continue;
          seen.add(g.id);
          live.push(g);
        }
        setLiveGames(live);
      });
    };

    Promise.all([
      fetchLive(),
      axios.get<{ articles: NewsArticle[] }>(`${API}/sports/all/news`)
        .then(r => setArticles(r.data.articles || []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));

    // Refresh every 3s while user stays on home page — picks up live score
    // changes in near real-time without manual refresh
    const interval = setInterval(fetchLive, 2000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* HEADER */}
        <LinearGradient colors={['#000000', '#000000', '#000000']} style={styles.header}>
          <Animated.View entering={FadeInUp.duration(500).springify()} style={styles.headerInner}>
            <Image
              source={require('@/assets/images/ejjs-logo.png')}
              style={styles.logo}
              contentFit="contain"
              transition={200}
            />
            <Text style={styles.dateText}>{dateStr}</Text>
            {liveGames.length > 0 && (
              <View style={styles.liveCount}>
                <View style={styles.liveCountDot} />
                <Text style={styles.liveCountText}>{liveGames.length} LIVE</Text>
              </View>
            )}
          </Animated.View>
        </LinearGradient>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 48 }} size="large" color="#4f8ef7" />
        ) : (
          // WebContainer is a no-op on iOS/Android, but on web it centers the
          // entire content column with a max-width so things don't sprawl to
          // both edges of a 27" monitor. Header gradient stays edge-to-edge
          // because it's rendered above this block.
          <WebContainer>
            {/* LIVE NOW — only games currently in-progress, across every sport.
               Section hides itself entirely when nothing is live. */}
            {liveGames.length > 0 && (
              <Animated.View entering={FadeInDown.delay(80).duration(450).springify()} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <LiveBadge />
                  <Text style={[styles.sectionTitle, { color: text }]}>Live Now</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.liveStrip}>
                  {liveGames.map((g, i) => (
                    <LiveGameChip key={g.id} game={g} sport={g.sport} cardBg={cardBg} border={border} sub={sub} index={i} />
                  ))}
                </ScrollView>
              </Animated.View>
            )}

            {/* TRENDING PLAYER PROPS — under Live Now */}
            <Animated.View entering={FadeInDown.delay(120).duration(450).springify()} style={styles.section}>
              <View style={styles.sectionHeader}>
                <TrendingIcon size={20} color="#ff6b35" />
                <Text style={[styles.sectionTitle, { color: text }]}>Trending Player Props</Text>
              </View>
              <TrendingProps cardBg={cardBg} border={border} text={text} sub={sub} />
            </Animated.View>

            {/* TOP STORIES — on web, render the cards in a flex-wrap grid so
                wide monitors get 2–3 stories per row instead of one long
                column with empty space on the sides. */}
            {articles.length > 0 && (
              <Animated.View entering={FadeInDown.delay(160).duration(450).springify()}>
                <View style={[styles.sectionHeader, { paddingHorizontal: 16 }]}>
                  <Text style={[styles.sectionTitle, { color: text }]}>Top Stories</Text>
                </View>
                <View style={styles.storiesGrid}>
                  {articles.map((a, i) => (
                    <View key={a.id} style={styles.storiesGridItem}>
                      <NewsCard
                        article={a}
                        index={i}
                        // Web: every card is "featured" (uniform tall card with
                        // image) so the 3-column grid stays clean. Phone: keep
                        // the mixed variants — first card is hero, next two
                        // compact, rest default.
                        variant={
                          Platform.OS === 'web'
                            ? 'featured'
                            : i === 0
                              ? 'featured'
                              : i < 3
                                ? 'compact'
                                : 'default'
                        }
                      />
                    </View>
                  ))}
                </View>
              </Animated.View>
            )}
          </WebContainer>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LiveGameChip({
  game, sport, cardBg, border, sub, index,
}: { game: SportGame; sport: SportKey; cardBg: string; border: string; sub: string; index: number }) {
  const cfg = SPORT_CONFIG[sport];
  const router = useRouter();
  const scale = useSharedValue(1);
  const chipStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Ticking clock for the chip — replaces any "M:SS" in detail with a value
  // that counts down every second. Pauses during stoppages.
  const detailLower = (game.status.detail || '').toLowerCase();
  const isLive = game.status.state === 'in';
  const isRunning = isLive && !/timeout|halftime|intermission|end of|end period|delay/i.test(detailLower);
  const liveClock = useLiveClock(game.status.clock, isLive, isRunning);
  const detailText = (() => {
    const raw = game.status.detail || '';
    // Replace the embedded clock (e.g. "1:39 - 2nd Quarter") with our ticking
    // value so the displayed clock advances every second
    if (liveClock && /\d+:\d{2}/.test(raw)) {
      return raw.replace(/\d+:\d{2}(\.\d)?/, liveClock);
    }
    return raw;
  })();

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 70).duration(400).springify()}
      style={chipStyle}
    >
      <Pressable
        onPressIn={() => { scale.value = withSpring(0.95, { damping: 12 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 12 }); }}
        onPress={() => router.push({ pathname: '/game/[id]', params: { id: game.id, sport } } as any)}
        style={[styles.chip, { backgroundColor: cardBg, borderColor: border }]}
      >
        <View style={[styles.chipAccent, { backgroundColor: cfg.color }]} />
        {/* Away team row */}
        <TeamRow team={game.away} score={game.away.score} sub={sub} />
        {/* Status middle */}
        <View style={styles.chipStatus}>
          <LiveBadge small />
          <Text style={[styles.chipDetail, { color: sub }]} numberOfLines={1}>{detailText}</Text>
        </View>
        {/* Home team row */}
        <TeamRow team={game.home} score={game.home.score} sub={sub} />
      </Pressable>
    </Animated.View>
  );
}

// Single-line team row: logo + abbr on left, score on right.
// Used to stack two teams vertically inside the compact chip.
function TeamRow({ team, score, sub }: any) {
  const logoUrl = team.team.logoDark || team.team.logo;
  return (
    <View style={styles.chipTeamRow}>
      <View style={styles.chipTeamLeft}>
        {logoUrl
          ? <Image source={{ uri: logoUrl }} style={styles.chipLogo} contentFit="contain" transition={200} />
          : null}
        <Text style={[styles.chipAbbr, { color: sub }]}>{team.team.abbreviation}</Text>
      </View>
      <Text style={styles.chipScore}>{score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingTop: 16, paddingBottom: 20, paddingHorizontal: 16 },
  headerInner: { alignItems: 'center', gap: 8 },
  logo: { width: 200, height: 200 },
  dateText: { fontSize: 12, fontFamily: F.regular, color: 'rgba(255,255,255,0.55)', letterSpacing: 0.5 },
  liveCount: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FF3B3020', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#FF3B3060' },
  liveCountDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' },
  liveCountText: { fontSize: 10, fontFamily: F.black, color: '#FF3B30', letterSpacing: 1 },
  section: { marginTop: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 12, marginTop: 20 },
  sectionTitle: { fontSize: 22, fontFamily: F.black, letterSpacing: 0.5 },
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
  liveStrip: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },

  // Top Stories grid — on phones each item is full-width (100%) so they
  // stack normally. On web (which actually honors `as any` percentage
  // breakpoints), the `webStoriesItem` style narrows items to a 3-up grid
  // via flex-basis. The flex wrap container drives the row breaks.
  storiesGrid: Platform.OS === 'web'
    ? { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' }
    : {},
  storiesGridItem: Platform.OS === 'web'
    ? ({ width: '33.333%', padding: 6 } as any)
    : { width: '100%' },
  // Compact + taller layout: away row, status, home row stacked vertically
  chip: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    width: 175,
    overflow: 'hidden',
    gap: 8,
  },
  chipAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  // Per-team row: logo+abbr on left, score on right
  chipTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chipTeamLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  chipLogo: { width: 26, height: 26 },
  chipAbbr: { fontSize: 12, fontFamily: F.black, letterSpacing: 0.5, color: '#fff' },
  chipScore: { fontSize: 22, fontFamily: F.black, color: '#fff', minWidth: 30, textAlign: 'right' },
  // Middle status row: live badge + clock
  chipStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#2c2c2e',
  },
  chipDetail: { fontSize: 10, fontFamily: F.bold, textAlign: 'center' },
});
