import axios from 'axios';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from '@/constants/fonts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NewsArticle, SportKey } from '@/types/sports';
import { API } from '@/constants/api';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NewsCard } from '@/components/news-card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RosterPlayer {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jersey: string;
  position: string;
  headshot: string;
  age: number | null;
  height: string;
  weight: string;
  experience: string | number;
  college: string;
  injuryStatus: string;
}

interface TeamInfo {
  id: string;
  displayName: string;
  shortName: string;
  nickname: string;
  abbreviation: string;
  location: string;
  logo: string;
  logoDark: string;
  color: string;
  altColor: string;
  venue: string;
  conference: string;
  division: string;
  record: {
    summary: string;
    wins: number;
    losses: number;
    ties: number;
    winPct: number;
    gamesBack: number;
  };
  standingSummary: string;
}

interface ScheduleGame {
  id: string;
  date: string;
  state: string;
  detail: string;
  isHome: boolean;
  opponent: { id: string; abbreviation: string; displayName: string; logo: string; color: string } | null;
  myScore: string;
  oppScore: string;
  result: 'W' | 'L' | null;
}

interface TeamProfile {
  team: TeamInfo;
  players: RosterPlayer[];
  sport: SportKey;
}

interface TeamSchedule {
  team: { id: string; displayName: string; abbreviation: string; logo: string; color: string };
  games: ScheduleGame[];
  sport: SportKey;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Sort players: starters/active first (jersey ASC), then bench, then unknown
function sortRoster(players: RosterPlayer[]): RosterPlayer[] {
  return [...players].sort((a, b) => {
    const ja = Number(a.jersey) || 9999;
    const jb = Number(b.jersey) || 9999;
    return ja - jb;
  });
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type Section = 'ROSTER' | 'SCHEDULE' | 'NEWS';

export default function TeamProfileScreen() {
  const { id, sport = 'nba' } = useLocalSearchParams<{ id: string; sport: string }>();
  const router = useRouter();
  const dark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';

  const [profile, setProfile] = useState<TeamProfile | null>(null);
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [section, setSection] = useState<Section>('ROSTER');
  const [teamNews, setTeamNews] = useState<NewsArticle[]>([]);

  const cardBg = dark ? '#1c1c1e' : '#fff';
  const border = dark ? '#2c2c2e' : '#e5e5e5';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.allSettled([
      axios.get<TeamProfile>(`${API}/sports/${sport}/teams/${id}/profile`),
      axios.get<TeamSchedule>(`${API}/sports/${sport}/teams/${id}/schedule`),
    ])
      .then(([profRes, schedRes]) => {
        if (profRes.status === 'fulfilled') setProfile(profRes.value.data);
        else setError('Team profile not available');
        if (schedRes.status === 'fulfilled') setSchedule(schedRes.value.data);
      })
      .finally(() => setLoading(false));
  }, [id, sport]);

  // Team news — fetch the sport's news and prefer items mentioning this team.
  useEffect(() => {
    if (!id) return;
    axios.get<{ articles: NewsArticle[] }>(`${API}/sports/${sport}/news`)
      .then(({ data }) => {
        const all = data.articles || [];
        const name = (profile?.team?.displayName || '').toLowerCase();
        const nick = name.split(' ').pop() || '';
        const mine = name
          ? all.filter(a => `${a.headline} ${a.description ?? ''}`.toLowerCase().includes(nick))
          : [];
        setTeamNews(mine.length ? mine : all.slice(0, 12));
      })
      .catch(() => {});
  }, [id, sport, profile?.team?.displayName]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <ActivityIndicator size="large" color="#4f8ef7" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <Text style={{ color: '#fff', fontFamily: F.bold }}>{error || 'No data'}</Text>
      </View>
    );
  }

  const team = profile.team;
  const accentColor = `#${team.color || '4f8ef7'}`;
  const rosterSorted = sortRoster(profile.players);

  // On WEB we render in a centered max-width container so it doesn't sprawl.
  const Wrap = ({ children }: { children: any }) =>
    isWeb ? <View style={styles.webOuter}><View style={styles.webInner}>{children}</View></View> : <>{children}</>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#000' }} showsVerticalScrollIndicator={false}>
      {/* HERO */}
      <View style={styles.hero}>
        <LinearGradient
          colors={[accentColor, `${accentColor}AA`, '#000']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          entering={FadeIn.duration(300)}
          style={[styles.backBtn, { top: insets.top + 8 }]}
        >
          <Pressable onPress={() => router.back()} style={styles.backPressable} hitSlop={20}>
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
        </Animated.View>

        {/* HUGE watermark logo — fills most of the hero as a faded
            background element. Positioned right-of-center so the text block
            sits on top of it but the silhouette still reads as "the team's
            logo IS the hero". A subtle gradient fades it into the bottom
            of the hero so it never competes with the text legibility. */}
        {team.logo ? (
          <Animated.View entering={FadeIn.duration(700)} style={styles.watermarkWrap} pointerEvents="none">
            <Image source={{ uri: team.logo }} style={styles.watermark} contentFit="contain" />
          </Animated.View>
        ) : null}
        {/* Soft gradient overlay on top of the watermark so the text stays
            crisp regardless of how busy the logo art is. */}
        <LinearGradient
          colors={['transparent', 'transparent', 'rgba(0,0,0,0.55)', '#000']}
          locations={[0, 0.45, 0.8, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <Animated.View entering={FadeInDown.delay(100).duration(450)} style={[styles.heroMeta, { paddingTop: insets.top + 60 }]}>
          {/* Name block — logo is now the background, so name takes full width */}
          <View style={styles.heroNameBlock}>
            {team.location ? <Text style={styles.heroLocation}>{team.location.toUpperCase()}</Text> : null}
            <Text style={styles.heroNickname} numberOfLines={1}>{team.nickname || team.shortName}</Text>
          </View>

          {/* Record / standing badges */}
          <View style={styles.heroBadgeRow}>
            {team.record.summary ? (
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>{team.record.summary}</Text>
              </View>
            ) : null}
            {team.standingSummary ? (
              <View style={[styles.heroBadge, { borderColor: 'rgba(255,255,255,0.3)' }]}>
                <Text style={styles.heroBadgeText}>{team.standingSummary.toUpperCase()}</Text>
              </View>
            ) : null}
            {team.division ? (
              <View style={[styles.heroBadge, { borderColor: 'rgba(255,255,255,0.2)' }]}>
                <Text style={styles.heroBadgeText}>{team.division.toUpperCase()}</Text>
              </View>
            ) : null}
          </View>

          {/* Meta row: venue, conference */}
          {(team.venue || team.conference) ? (
            <View style={styles.heroMetaRow}>
              {team.venue ? <Text style={styles.heroMetaText}>{team.venue}</Text> : null}
              {team.venue && team.conference ? <Text style={styles.heroMetaText}>·</Text> : null}
              {team.conference ? <Text style={styles.heroMetaText}>{team.conference}</Text> : null}
            </View>
          ) : null}
        </Animated.View>
      </View>

      {/* SEGMENT SWITCHER (Roster / Schedule) */}
      <Wrap>
        <View style={[styles.segmentBar, { backgroundColor: cardBg, borderColor: border }]}>
          {(['ROSTER', 'SCHEDULE', 'NEWS'] as const).map(s => (
            <Pressable key={s} onPress={() => setSection(s)} style={styles.segmentBtn}>
              <Text style={[styles.segmentText, { color: section === s ? accentColor : sub, fontFamily: section === s ? F.black : F.bold }]}>
                {s}
              </Text>
              {section === s ? <View style={[styles.segmentUnderline, { backgroundColor: accentColor }]} /> : null}
            </Pressable>
          ))}
        </View>

        {/* ──────────────── ROSTER ──────────────── */}
        {section === 'ROSTER' && (
          <View style={styles.section}>
            {rosterSorted.length === 0 ? (
              <Text style={[styles.emptyText, { color: sub }]}>Roster not available</Text>
            ) : (
              <View style={isWeb ? styles.rosterGridWeb : undefined}>
                {rosterSorted.map((p, i) => (
                  <Animated.View
                    key={p.id || `${p.fullName}-${i}`}
                    entering={FadeInDown.delay(Math.min(i, 20) * 30).duration(380).springify()}
                    style={isWeb ? styles.rosterGridItemWeb : undefined}
                  >
                    <Pressable
                      onPress={() => p.id && router.push({ pathname: '/player/[id]', params: { id: p.id, sport } } as any)}
                      style={[styles.playerRow, { backgroundColor: cardBg, borderColor: border }]}
                    >
                      {/* Jersey number */}
                      <View style={[styles.jerseyBlock, { backgroundColor: accentColor + '22', borderColor: accentColor + '55' }]}>
                        <Text style={[styles.jerseyText, { color: accentColor }]}>
                          {p.jersey ? `#${String(p.jersey).replace(/^#+/, '')}` : '—'}
                        </Text>
                      </View>

                      {/* Headshot */}
                      {p.headshot ? (
                        <Image source={{ uri: p.headshot }} style={styles.headshot} contentFit="cover" />
                      ) : (
                        <View style={[styles.headshot, { backgroundColor: sub + '30', alignItems: 'center', justifyContent: 'center' }]}>
                          <IconSymbol name="person.fill" size={20} color={sub} />
                        </View>
                      )}

                      {/* Name + position */}
                      <View style={styles.playerInfo}>
                        <Text style={[styles.playerName, { color: text }]} numberOfLines={1}>{p.fullName}</Text>
                        <Text style={[styles.playerMeta, { color: sub }]} numberOfLines={1}>
                          {p.position}
                          {p.height ? `  ·  ${p.height}` : ''}
                          {p.weight ? `  ·  ${p.weight}` : ''}
                          {p.age ? `  ·  ${p.age}y` : ''}
                        </Text>
                      </View>

                      {/* Injury chip */}
                      {p.injuryStatus && /IL|IR|OUT|SUSP|DAY/i.test(p.injuryStatus) ? (
                        <View style={styles.injuryChip}>
                          <Text style={styles.injuryText}>{p.injuryStatus}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ──────────────── SCHEDULE ──────────────── */}
        {section === 'SCHEDULE' && (
          <View style={styles.section}>
            {!schedule || schedule.games.length === 0 ? (
              <Text style={[styles.emptyText, { color: sub }]}>Schedule not available</Text>
            ) : (
              <>{(() => {
                // Group games by "Month Year" with a header for each month.
                const monthGroups: { key: string; games: typeof schedule.games }[] = [];
                for (const g of schedule.games) {
                  const k = new Date(g.date).toLocaleString('en-US', { month: 'long', year: 'numeric' });
                  const last = monthGroups[monthGroups.length - 1];
                  if (last && last.key === k) last.games.push(g); else monthGroups.push({ key: k, games: [g] });
                }
                return monthGroups.map(grp => (
                  <View key={grp.key} style={{ marginBottom: 12 }}>
                    <Text style={[styles.monthHeader, { color: accentColor }]}>{grp.key.toUpperCase()}</Text>
                    <View style={isWeb ? styles.scheduleGridWeb : undefined}>
                {grp.games.map((game, i) => {
                  const isPre = game.state === 'pre';
                  const isLive = game.state === 'in';
                  const isToday = new Date(game.date).toDateString() === new Date().toDateString();
                  const oppColor = game.opponent ? `#${game.opponent.color}` : '#888';
                  return (
                    <Animated.View
                      key={game.id}
                      entering={FadeInDown.delay(Math.min(i, 20) * 25).duration(350).springify()}
                      style={isWeb ? styles.scheduleGridItemWeb : undefined}
                    >
                      <Pressable
                        onPress={() => router.push(`/game/${game.id}?sport=${sport}` as any)}
                        style={[styles.gameRow, { backgroundColor: cardBg, borderColor: border }, isToday && { borderColor: accentColor, borderWidth: 1.5 }]}
                      >
                        <View style={styles.dateCol}>
                          <Text style={[styles.dateDay, { color: sub }]}>{fmtDate(game.date).split(' ')[0].toUpperCase()}</Text>
                          <Text style={[styles.dateNum, { color: text }]}>{fmtDate(game.date).split(' ')[1]}</Text>
                        </View>

                        <View style={[styles.haBadge, { backgroundColor: game.isHome ? accentColor + '22' : 'transparent', borderColor: game.isHome ? accentColor : border }]}>
                          <Text style={[styles.haText, { color: game.isHome ? accentColor : sub }]}>{game.isHome ? 'H' : 'A'}</Text>
                        </View>

                        <View style={styles.oppRow}>
                          {game.opponent?.logo
                            ? <Image source={{ uri: game.opponent.logo }} style={styles.oppLogo} contentFit="contain" />
                            : <View style={[styles.oppLogo, { backgroundColor: oppColor + '30' }]} />}
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.oppName, { color: text }]} numberOfLines={1}>
                              {game.opponent?.abbreviation ?? 'TBD'}
                            </Text>
                            {isPre
                              ? <Text style={[styles.gameTime, { color: isToday ? accentColor : sub }]}>{isToday ? 'Today · ' : ''}{fmtTime(game.date)}</Text>
                              : isLive
                              ? <Text style={[styles.gameTime, { color: '#FF3B30' }]}>LIVE · {game.detail}</Text>
                              : <Text style={[styles.gameTime, { color: sub }]}>{game.detail}</Text>}
                          </View>
                        </View>

                        <View style={styles.scoreCol}>
                          {game.result ? (
                            <>
                              <Text style={[styles.result, { color: game.result === 'W' ? '#34c759' : '#ff3b30' }]}>{game.result}</Text>
                              <Text style={[styles.scoreText, { color: text }]}>{game.myScore}–{game.oppScore}</Text>
                            </>
                          ) : (
                            <Text style={[styles.upcoming, { color: sub }]}>—</Text>
                          )}
                        </View>
                      </Pressable>
                    </Animated.View>
                  );
                })}
                    </View>
                  </View>
                ));
              })()}</>
            )}
          </View>
        )}

        {/* ──────────────── NEWS ──────────────── */}
        {section === 'NEWS' && (
          <View style={styles.section}>
            {teamNews.length === 0 ? (
              <Text style={[styles.emptyText, { color: sub }]}>No recent news</Text>
            ) : (
              <View style={isWeb ? styles.scheduleGridWeb : undefined}>
                {teamNews.map((article, i) => (
                  <View key={article.id ?? i} style={isWeb ? styles.scheduleGridItemWeb : undefined}>
                    <NewsCard article={article} index={i} />
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </Wrap>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Hero
  hero: {
    height: 320,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'flex-end',
  },
  backBtn: { position: 'absolute', left: 16, zIndex: 10 },
  backPressable: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { color: '#fff', fontSize: 20, fontFamily: F.bold },

  // Watermark fills most of the hero so the team logo IS the visual identity
  // of the page, not a tiny corner decoration. Anchored on the right so the
  // text block on the left can sit cleanly on the color-bleed area.
  watermarkWrap: {
    position: 'absolute',
    right: '-15%',
    top: '-10%',
    bottom: '-10%',
    width: '70%',
    opacity: 0.35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermark: { width: '100%', height: '100%' },

  heroMeta: { paddingHorizontal: 20, paddingBottom: 24 },
  heroNameBlock: { },
  heroLocation: {
    fontSize: 14,
    fontFamily: F.bold,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1.5,
  },
  heroNickname: {
    fontSize: 44,
    fontFamily: F.black,
    color: '#fff',
    letterSpacing: 0.5,
    lineHeight: 50,
    marginTop: 2,
  },
  heroBadgeRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  heroBadge: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  heroBadgeText: { color: '#fff', fontSize: 11, fontFamily: F.black, letterSpacing: 1 },

  heroMetaRow: { flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' },
  heroMetaText: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontFamily: F.regular },

  // Segment bar
  segmentBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginTop: 0,
  },
  segmentBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', position: 'relative' },
  segmentText: { fontSize: 13, letterSpacing: 1.2 },
  segmentUnderline: { position: 'absolute', bottom: 0, left: 20, right: 20, height: 2, borderRadius: 1 },

  section: { paddingTop: 12, paddingBottom: 40 },
  emptyText: { fontSize: 14, fontFamily: F.regular, textAlign: 'center', marginTop: 24, paddingHorizontal: 16 },

  // Roster
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  jerseyBlock: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jerseyText: { fontSize: 14, fontFamily: F.black },
  headshot: { width: 44, height: 44, borderRadius: 22 },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 15, fontFamily: F.bold },
  playerMeta: { fontSize: 12, fontFamily: F.regular, marginTop: 2 },
  injuryChip: { backgroundColor: '#FF3B3020', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  injuryText: { color: '#FF3B30', fontSize: 10, fontFamily: F.bold },

  // Schedule rows (reused styling from old layout)
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  dateCol: { width: 32, alignItems: 'center' },
  dateDay: { fontSize: 9, fontFamily: F.black, letterSpacing: 0.5 },
  dateNum: { fontSize: 16, fontFamily: F.black },
  haBadge: { width: 22, height: 22, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  haText: { fontSize: 10, fontFamily: F.black },
  oppRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  oppLogo: { width: 32, height: 32, borderRadius: 4 },
  oppName: { fontSize: 14, fontFamily: F.bold },
  gameTime: { fontSize: 11, fontFamily: F.regular, marginTop: 2 },
  scoreCol: { alignItems: 'flex-end', minWidth: 44 },
  result: { fontSize: 16, fontFamily: F.black },
  scoreText: { fontSize: 12, fontFamily: F.regular, marginTop: 1 },
  upcoming: { fontSize: 13, fontFamily: F.regular },

  // Web overrides
  webOuter: { width: '100%', alignItems: 'center' },
  webInner: { width: '100%', maxWidth: 1180, paddingHorizontal: 16 },
  // Roster: 3-up grid on desktop, single column on smaller screens
  rosterGridWeb: ({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' } as any),
  rosterGridItemWeb: ({ width: '33.333%', minWidth: 320 } as any),
  // Schedule: 2-up grid (games are wider)
  monthHeader: { fontSize: 13, fontFamily: F.black, letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  scheduleGridWeb: ({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' } as any),
  scheduleGridItemWeb: ({ width: '50%', minWidth: 320 } as any),
});
