import axios from 'axios';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from '@/constants/fonts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { API } from '@/constants/api';
import { StatTable } from '@/components/stat-table';

interface StatRow {
  abbr: string;
  label: string;
  value: string;
  rank: string | null;
}

interface PlayerProfile {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  headshot: string;
  jersey: string | null;
  position: string | null;
  height: string | null;
  weight: string | null;
  age: number | null;
  dob: string | null;
  birthplace: string | null;
  college: string | null;
  draft: string | null;
  experience: string | null;
  debutYear: number | null;
  status: string | null;
  team: { id: string; name: string; abbreviation: string; logo: string | null; color: string | null };
  statsSummary: { label: string; stats: StatRow[] };
}

interface GameLogGame {
  id: string;
  date: string;
  opponent: string;
  atVs: string;
  result: string;
  score: string;
  stats: Record<string, string>;
}

interface GameLogData {
  labels: string[];
  games: GameLogGame[];
}

interface CareerSeason {
  year: number;
  displayYear: string;
  stats: Record<string, string>;
}

interface CareerData {
  labels: string[];
  seasons: CareerSeason[];
}

// Game log columns — Basic vs Advanced (Advanced shows everything ESPN shows)
const GAMELOG_KEYS_BASIC: Record<string, string[]> = {
  nba: ['FG', '3PT', 'REB', 'AST', 'PTS'],
  mlb: ['AB', 'H', 'R', 'RBI', 'HR'],
  nfl: ['CMP', 'YDS', 'TD', 'INT'],
  nhl: ['G', 'A', 'SOG', '+/-'],
};

const GAMELOG_KEYS_ADV: Record<string, string[]> = {
  nba: ['MIN', 'FG', 'FG%', '3PT', '3P%', 'FT', 'FT%', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'PTS'],
  mlb: ['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'HBP', 'K', 'SB', 'AVG', 'OBP', 'SLG'],
  nfl: ['CMP', 'ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACK', 'RTG'],
  nhl: ['G', 'A', 'PTS', '+/-', 'SOG', 'PIM', 'TOI'],
};

// Career columns — Basic vs Advanced
const CAREER_KEYS_BASIC: Record<string, string[]> = {
  nba: ['GP', 'PTS', 'REB', 'AST', 'FG%', '3P%'],
  mlb: ['AB', 'H', 'HR', 'RBI', 'AVG', 'OBP'],
  nfl: ['GP', 'YDS', 'TD', 'INT'],
  nhl: ['GP', 'G', 'A', 'PTS'],
};

const CAREER_KEYS_ADV: Record<string, string[]> = {
  nba: ['GP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', 'FG%', '3PT', '3P%', 'FT', 'FT%', 'OR', 'DR', 'PF'],
  mlb: ['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'HBP', 'SO', 'SB', 'CS', 'AVG', 'OBP', 'SLG', 'OPS'],
  nfl: ['GP', 'CMP', 'ATT', 'YDS', 'TD', 'INT', 'SACK', 'RTG'],
  nhl: ['GP', 'G', 'A', 'PTS', '+/-', 'SOG', 'PIM', 'TOI'],
};

// Stats that should be displayed with "/" instead of "-" (made/attempted format)
const SLASH_FORMAT_STATS = new Set(['FG', '3PT', 'FT', 'CMP', 'H-AB']);

// Wider columns for stats that show two numbers (4/18) or longer values
const WIDE_STATS = new Set(['FG', '3PT', 'FT', 'CMP', 'H-AB', 'MIN', 'TOI', 'AVG', 'OBP', 'SLG', 'OPS', 'FG%', '3P%', 'FT%']);

function isWide(key: string): boolean {
  return WIDE_STATS.has(key);
}

function fmtStat(key: string, value: string | undefined): string {
  if (!value) return '--';
  if (SLASH_FORMAT_STATS.has(key) && value.includes('-')) {
    return value.replace('-', '/');
  }
  return value;
}

function parseDOB(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = months[parseInt(mm, 10) - 1] ?? mm;
    return `${monthName} ${parseInt(dd, 10)}, ${yyyy}`;
  }
  return raw;
}

export default function PlayerProfileScreen() {
  const { id, sport = 'nba' } = useLocalSearchParams<{ id: string; sport: string }>();
  const router = useRouter();
  // Pulls in the device-specific safe-area inset (notch / Dynamic Island
  // height) so the back button always lands BELOW the status bar instead
  // of getting clipped at a hardcoded `top: 18`.
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gamelog, setGamelog] = useState<GameLogData | null>(null);
  const [career, setCareer] = useState<CareerData | null>(null);
  const [splits, setSplits] = useState<{ labels: string[]; rows: { name: string; stats: Record<string, string> }[] } | null>(null);
  const [showAllGames, setShowAllGames] = useState(false);
  const [gamelogMode, setGamelogMode] = useState<'basic' | 'advanced'>('basic');
  const [careerMode, setCareerMode] = useState<'basic' | 'advanced'>('basic');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    // Fetch profile + gamelog + career in parallel
    Promise.all([
      axios.get<PlayerProfile>(`${API}/sports/${sport}/player/${id}`),
      axios.get<GameLogData>(`${API}/sports/${sport}/player/${id}/gamelog`).catch(() => null),
      axios.get<CareerData>(`${API}/sports/${sport}/player/${id}/career`).catch(() => null),
      axios.get<{ labels: string[]; rows: { name: string; stats: Record<string, string> }[] }>(`${API}/sports/${sport}/player/${id}/splits`).catch(() => null),
    ]).then(([profileRes, gamelogRes, careerRes, splitsRes]) => {
      setProfile(profileRes.data);
      if (gamelogRes) setGamelog(gamelogRes.data);
      if (careerRes) setCareer(careerRes.data);
      if (splitsRes && splitsRes.data?.rows?.length) setSplits(splitsRes.data);
    }).catch(() => setError('Could not load player'))
      .finally(() => setLoading(false));
  }, [id, sport]);

  const accentColor = profile?.team?.color ? `#${profile.team.color}` : '#1a1a2e';

  // Compute luminance of the team color so we never show dark text on a dark hero
  const hexColor = profile?.team?.color ?? '';
  const r = parseInt(hexColor.slice(0, 2), 16) || 0;
  const g = parseInt(hexColor.slice(2, 4), 16) || 0;
  const b = parseInt(hexColor.slice(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const lastNameColor = luminance < 0.35 ? '#e8e8e8' : accentColor;
  const rankColor = luminance < 0.35 ? 'rgba(255,255,255,0.55)' : accentColor;

  // Dynamic font size for last name based on length — works on both native and web
  // (adjustsFontSizeToFit is iOS-only and doesn't work on RN web)
  const lastNameLength = (profile?.lastName ?? '').length;
  const lastNameFontSize = lastNameLength > 12 ? 26
    : lastNameLength > 10 ? 30
    : lastNameLength > 8 ? 36
    : lastNameLength > 6 ? 42
    : 48;

  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: '#000' }]}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[s.center, { backgroundColor: '#000' }]}>
        <Text style={{ color: '#fff', fontFamily: F.bold }}>{error || 'No data'}</Text>
      </View>
    );
  }

  const bioRows: Array<{ label: string; value: string }> = [
    profile.dob ? { label: 'Born', value: `${parseDOB(profile.dob)}${profile.birthplace ? `  ·  ${profile.birthplace}` : ''}` } : null,
    profile.height || profile.weight ? { label: 'Size', value: [profile.height, profile.weight].filter(Boolean).join('  ·  ') } : null,
    profile.college ? { label: 'College', value: profile.college } : null,
    profile.draft ? { label: 'Draft', value: profile.draft } : null,
    profile.experience ? { label: 'Experience', value: profile.experience } : null,
    profile.status ? { label: 'Status', value: profile.status } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const rawGamelogKeys = (gamelogMode === 'advanced' ? GAMELOG_KEYS_ADV : GAMELOG_KEYS_BASIC)[sport] ?? GAMELOG_KEYS_BASIC.nba;
  const rawCareerKeys = (careerMode === 'advanced' ? CAREER_KEYS_ADV : CAREER_KEYS_BASIC)[sport] ?? CAREER_KEYS_BASIC.nba;
  const gamelogKeys = gamelog ? rawGamelogKeys.filter(k => gamelog.labels.includes(k)) : rawGamelogKeys;
  const careerKeys = career ? rawCareerKeys.filter(k => career.labels.includes(k)) : rawCareerKeys;
  const visibleGames = showAllGames ? (gamelog?.games ?? []) : (gamelog?.games ?? []).slice(0, 10);

  // Theme colors for the new stat-table sections.
  const stCardBg = dark ? '#1c1c1e' : '#fff';
  const stBorder = dark ? '#2c2c2e' : '#e5e5ea';
  const stText = dark ? '#fff' : '#000';
  const stSub = dark ? '#8e8e93' : '#6e6e73';

  // Summary cards (top of the reference): pull the "Last seven days" split.
  const last7 = splits?.rows.find(r => /last seven days/i.test(r.name));
  const isPitcherSplits = !!splits?.labels.includes('ERA') && !!splits?.labels.includes('IP');
  const summaryCards = last7
    ? (isPitcherSplits
        ? [
            { label: 'W-L LAST 7 DAYS', value: `${last7.stats['W'] ?? '0'}-${last7.stats['L'] ?? '0'}` },
            { label: 'ERA LAST 7 DAYS', value: last7.stats['ERA'] ?? '--' },
            { label: 'K LAST 7 DAYS', value: last7.stats['K'] ?? '--' },
          ]
        : [
            { label: 'AVG LAST 7 DAYS', value: last7.stats['AVG'] ?? '--' },
            { label: 'HR LAST 7 DAYS', value: last7.stats['HR'] ?? '--' },
            { label: 'RBI LAST 7 DAYS', value: last7.stats['RBI'] ?? '--' },
          ])
    : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#000' }} showsVerticalScrollIndicator={false}>
      {/* HERO */}
      <View style={s.hero}>
        <LinearGradient
          colors={[accentColor, `${accentColor}99`, '#000']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          entering={FadeIn.duration(300)}
          // Add the device safe-area inset so the button always sits BELOW the
          // status bar / notch / Dynamic Island and stays tappable. Generous
          // hitSlop gives ~20pt of forgiveness around the visible circle.
          style={[s.backBtn, { top: insets.top + 8 }]}
        >
          <Pressable onPress={() => router.back()} style={s.backPressable} hitSlop={20}>
            <Text style={s.backArrow}>←</Text>
          </Pressable>
        </Animated.View>

        {profile.team.logo && (
          <Animated.View entering={FadeIn.duration(600)} style={s.teamLogoWrap}>
            <Image source={{ uri: profile.team.logo }} style={s.teamLogoWatermark} contentFit="contain" />
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.delay(100).duration(450)} style={s.heroMeta}>
          <View style={s.heroNameRow}>
            <View style={s.heroNameBlock}>
              {profile.jersey && (
                <Text style={s.jerseyNumber}>#{String(profile.jersey).replace(/^#+/, '')}</Text>
              )}
              <Text style={s.heroName}>{profile.firstName}</Text>
              <Text
                style={[s.heroLastName, { color: lastNameColor, fontSize: lastNameFontSize }]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {profile.lastName}
              </Text>
            </View>
            <Animated.View entering={FadeInUp.duration(500).springify()} style={s.heroImageBlock}>
              <Image
                source={{ uri: profile.headshot }}
                style={s.headshot}
                contentFit="contain"
                contentPosition="bottom"
              />
            </Animated.View>
          </View>

          <View style={s.heroBadgeRow}>
            {profile.position && (
              <View style={s.heroBadge}>
                <Text style={s.heroBadgeText}>{profile.position.toUpperCase()}</Text>
              </View>
            )}
            {profile.team.abbreviation ? (
              <View style={[s.heroBadge, { borderColor: 'rgba(255,255,255,0.3)' }]}>
                <Text style={s.heroBadgeText}>{profile.team.abbreviation}</Text>
              </View>
            ) : null}
            {profile.age ? (
              <View style={[s.heroBadge, { borderColor: 'rgba(255,255,255,0.2)' }]}>
                <Text style={s.heroBadgeText}>AGE {profile.age}</Text>
              </View>
            ) : null}
          </View>
        </Animated.View>
      </View>

      {/* SEASON STATS */}
      {profile.statsSummary.stats.length > 0 && (
        <Animated.View entering={FadeInDown.delay(150).duration(400)} style={s.section}>
          <View style={s.sectionHeader}>
            <View style={[s.sectionAccent, { backgroundColor: accentColor }]} />
            <Text style={s.sectionTitle}>SEASON STATS</Text>
            <Text style={s.sectionSub}>{profile.statsSummary.label}</Text>
          </View>
          <View style={s.statsGrid}>
            {profile.statsSummary.stats.slice(0, 6).map((stat, i) => (
              <Animated.View
                key={stat.abbr}
                entering={FadeInDown.delay(180 + i * 40).duration(350)}
                style={s.statBox}
              >
                <Text style={s.statValue}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
                {stat.rank && (
                  <Text style={[s.statRank, { color: rankColor }]}>
                    {stat.rank}
                  </Text>
                )}
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      )}

      {/* SUMMARY CARDS — last 7 days headline stats */}
      {summaryCards.length > 0 && (
        <Animated.View entering={FadeInDown.delay(150).duration(400)} style={[s.section, { flexDirection: 'row', gap: 10 }]}>
          {summaryCards.map(c => (
            <View key={c.label} style={{ flex: 1, backgroundColor: stCardBg, borderWidth: 1, borderColor: stBorder, borderRadius: 12, paddingVertical: 14, alignItems: 'center', gap: 6 }}>
              <View style={{ backgroundColor: accentColor, alignSelf: 'stretch', marginHorizontal: -1, marginTop: -14, paddingVertical: 6, borderTopLeftRadius: 11, borderTopRightRadius: 11 }}>
                <Text style={{ color: '#fff', fontSize: 9, fontFamily: F.black, letterSpacing: 0.3, textAlign: 'center' }}>{c.label}</Text>
              </View>
              <Text style={{ color: stText, fontSize: 26, fontFamily: F.black }}>{c.value}</Text>
            </View>
          ))}
        </Animated.View>
      )}

      {/* SPLITS — grouped into Recent / Home-Away-Day-Night / By Month so the
          categories are clearly separated instead of one long clumped list. */}
      {splits && splits.rows.length > 0 && (() => {
        const isMonth = (n: string) => /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(n);
        const isRecent = (n: string) => /last/i.test(n);
        const isHomeAway = (n: string) => /^(home|away|road)$/i.test(n);
        const isDayNight = (n: string) => /^(day|night)$/i.test(n);
        const groups: { title: string; rows: typeof splits.rows }[] = [
          { title: 'RECENT', rows: splits.rows.filter(r => isRecent(r.name)) },
          { title: 'HOME / AWAY', rows: splits.rows.filter(r => isHomeAway(r.name)) },
          { title: 'DAY / NIGHT', rows: splits.rows.filter(r => isDayNight(r.name)) },
          { title: 'BY MONTH', rows: splits.rows.filter(r => isMonth(r.name)) },
        ].filter(g => g.rows.length > 0);
        return (
          <Animated.View entering={FadeInDown.delay(180).duration(400)} style={s.section}>
            <View style={s.sectionHeader}>
              <View style={[s.sectionAccent, { backgroundColor: accentColor }]} />
              <Text style={s.sectionTitle}>SPLITS</Text>
            </View>
            {groups.map((g, gi) => (
              <View key={g.title} style={{ marginTop: gi === 0 ? 0 : 16 }}>
                <Text style={{ color: stSub, fontSize: 11, fontFamily: F.black, letterSpacing: 0.8, marginBottom: 6 }}>{g.title}</Text>
                <StatTable
                  firstColLabel="SPLIT"
                  columns={splits.labels}
                  rows={g.rows.map(r => ({ key: r.name, label: r.name, cells: splits.labels.map(l => r.stats[l] ?? '--') }))}
                  text={stText} sub={stSub} border={stBorder} cardBg={stCardBg} dark={dark}
                  firstColWidth={140}
                />
              </View>
            ))}
          </Animated.View>
        );
      })()}

      {/* CAREER STATS */}
      {career && career.seasons.length > 0 && (
        <Animated.View entering={FadeInDown.delay(200).duration(400)} style={s.section}>
          <View style={s.sectionHeader}>
            <View style={[s.sectionAccent, { backgroundColor: accentColor }]} />
            <Text style={s.sectionTitle}>CAREER STATS</Text>
            <View style={s.toggleWrap}>
              <Pressable
                onPress={() => setCareerMode('basic')}
                style={[s.toggleBtn, careerMode === 'basic' && { backgroundColor: accentColor }]}
              >
                <Text style={[s.toggleText, careerMode === 'basic' && { color: '#fff' }]}>BASIC</Text>
              </Pressable>
              <Pressable
                onPress={() => setCareerMode('advanced')}
                style={[s.toggleBtn, careerMode === 'advanced' && { backgroundColor: accentColor }]}
              >
                <Text style={[s.toggleText, careerMode === 'advanced' && { color: '#fff' }]}>ADV</Text>
              </Pressable>
            </View>
          </View>
          {careerMode === 'basic' ? (
            // BASIC mode: stretch to container width using flex
            <View style={s.careerTable}>
              <View style={[s.careerRow, s.careerHeaderRow]}>
                <View style={s.careerYearCellFlex}>
                  <Text style={s.careerHeaderText}>YEAR</Text>
                </View>
                {careerKeys.map(k => (
                  <View key={k} style={s.careerCellFlex}>
                    <Text style={s.careerHeaderText}>{k}</Text>
                  </View>
                ))}
              </View>
              {career.seasons.map((season, i) => (
                <View key={season.year} style={[s.careerRow, i % 2 === 0 && s.careerRowAlt]}>
                  <View style={s.careerYearCellFlex}>
                    <Text style={[s.careerYearText, { color: accentColor === '#1a1a2e' ? '#aaa' : accentColor }]}>
                      {season.displayYear}
                    </Text>
                  </View>
                  {careerKeys.map(k => (
                    <View key={k} style={s.careerCellFlex}>
                      <Text style={s.careerStatText}>{fmtStat(k, season.stats[k])}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            // ADV mode: horizontal scroll
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={s.careerTable}>
                <View style={[s.careerRow, s.careerHeaderRow]}>
                  <View style={s.careerYearCell}>
                    <Text style={s.careerHeaderText}>YEAR</Text>
                  </View>
                  {careerKeys.map(k => (
                    <View key={k} style={[s.careerCell, isWide(k) && s.careerWideCell]}>
                      <Text style={s.careerHeaderText}>{k}</Text>
                    </View>
                  ))}
                </View>
                {career.seasons.map((season, i) => (
                  <View key={season.year} style={[s.careerRow, i % 2 === 0 && s.careerRowAlt]}>
                    <View style={s.careerYearCell}>
                      <Text style={[s.careerYearText, { color: accentColor === '#1a1a2e' ? '#aaa' : accentColor }]}>
                        {season.displayYear}
                      </Text>
                    </View>
                    {careerKeys.map(k => (
                      <View key={k} style={[s.careerCell, isWide(k) && s.careerWideCell]}>
                        <Text style={s.careerStatText}>{fmtStat(k, season.stats[k])}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </Animated.View>
      )}

      {/* GAME LOG */}
      {gamelog && gamelog.games.length > 0 && (
        <Animated.View entering={FadeInDown.delay(250).duration(400)} style={s.section}>
          <View style={s.sectionHeader}>
            <View style={[s.sectionAccent, { backgroundColor: accentColor }]} />
            <Text style={s.sectionTitle}>GAME LOG</Text>
            <View style={s.toggleWrap}>
              <Pressable
                onPress={() => setGamelogMode('basic')}
                style={[s.toggleBtn, gamelogMode === 'basic' && { backgroundColor: accentColor }]}
              >
                <Text style={[s.toggleText, gamelogMode === 'basic' && { color: '#fff' }]}>BASIC</Text>
              </Pressable>
              <Pressable
                onPress={() => setGamelogMode('advanced')}
                style={[s.toggleBtn, gamelogMode === 'advanced' && { backgroundColor: accentColor }]}
              >
                <Text style={[s.toggleText, gamelogMode === 'advanced' && { color: '#fff' }]}>ADV</Text>
              </Pressable>
            </View>
          </View>
          {gamelogMode === 'basic' ? (
            // BASIC: stretch to fill container width
            <View style={s.gameLogCard}>
              <View style={[s.gameLogRow, s.gameLogHeader]}>
                <Text style={[s.glHeaderText, s.glDateCol]}>DATE</Text>
                <Text style={[s.glHeaderText, s.glOppCol]}>OPP</Text>
                <Text style={[s.glHeaderText, s.glResultCol]}>RESULT</Text>
                {gamelogKeys.map(k => (
                  <Text key={k} style={[s.glHeaderText, s.glStatCellFlex]}>{k}</Text>
                ))}
              </View>
              {visibleGames.map((game, i) => {
                const isW = game.result?.toUpperCase().startsWith('W');
                const isL = game.result?.toUpperCase().startsWith('L');
                return (
                  <View
                    key={game.id}
                    style={[s.gameLogRow, i % 2 === 0 && s.gameLogRowAlt, i === visibleGames.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <Text style={[s.glDateText, s.glDateCol]}>{game.date}</Text>
                    <Text style={[s.glOppText, s.glOppCol]} numberOfLines={1}>{game.atVs} {game.opponent}</Text>
                    <Text
                      style={[
                        s.glResultText,
                        s.glResultCol,
                        { color: isW ? '#34c759' : isL ? '#ff453a' : '#8e8e93' },
                      ]}
                      numberOfLines={1}
                    >
                      {game.result}{game.score ? ` ${game.score}` : ''}
                    </Text>
                    {gamelogKeys.map(k => (
                      <Text key={k} style={[s.glStatText, s.glStatCellFlex]}>
                        {fmtStat(k, game.stats[k])}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </View>
          ) : (
            // ADV: horizontal scroll
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={s.gameLogCard}>
                <View style={[s.gameLogRow, s.gameLogHeader]}>
                  <Text style={[s.glHeaderText, s.glDateCol]}>DATE</Text>
                  <Text style={[s.glHeaderText, s.glOppCol]}>OPP</Text>
                  <Text style={[s.glHeaderText, s.glResultCol]}>RESULT</Text>
                  {gamelogKeys.map(k => (
                    <Text key={k} style={[s.glHeaderText, isWide(k) ? s.glStatCellWide : s.glStatCell]}>{k}</Text>
                  ))}
                </View>
                {visibleGames.map((game, i) => {
                  const isW = game.result?.toUpperCase().startsWith('W');
                  const isL = game.result?.toUpperCase().startsWith('L');
                  return (
                    <View
                      key={game.id}
                      style={[s.gameLogRow, i % 2 === 0 && s.gameLogRowAlt, i === visibleGames.length - 1 && { borderBottomWidth: 0 }]}
                    >
                      <Text style={[s.glDateText, s.glDateCol]}>{game.date}</Text>
                      <Text style={[s.glOppText, s.glOppCol]} numberOfLines={1}>{game.atVs} {game.opponent}</Text>
                      <Text
                        style={[
                          s.glResultText,
                          s.glResultCol,
                          { color: isW ? '#34c759' : isL ? '#ff453a' : '#8e8e93' },
                        ]}
                        numberOfLines={1}
                      >
                        {game.result}{game.score ? ` ${game.score}` : ''}
                      </Text>
                      {gamelogKeys.map(k => (
                        <Text key={k} style={[s.glStatText, isWide(k) ? s.glStatCellWide : s.glStatCell]}>
                          {fmtStat(k, game.stats[k])}
                        </Text>
                      ))}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
          {(gamelog.games.length > 10) && (
            <Pressable
              onPress={() => setShowAllGames(v => !v)}
              style={s.showMoreBtn}
            >
              <Text style={[s.showMoreText, { color: accentColor === '#1a1a2e' ? '#888' : accentColor }]}>
                {showAllGames ? 'Show Less' : `Show All ${gamelog.games.length} Games`}
              </Text>
            </Pressable>
          )}
        </Animated.View>
      )}

      {/* BIO */}
      {bioRows.length > 0 && (
        <Animated.View entering={FadeInDown.delay(300).duration(400)} style={s.section}>
          <View style={s.sectionHeader}>
            <View style={[s.sectionAccent, { backgroundColor: accentColor }]} />
            <Text style={s.sectionTitle}>PLAYER INFO</Text>
          </View>
          <View style={s.bioCard}>
            {bioRows.map((row, i) => (
              <View
                key={row.label}
                style={[s.bioRow, i === bioRows.length - 1 && { borderBottomWidth: 0 }]}
              >
                <Text style={s.bioLabel}>{row.label}</Text>
                <Text style={s.bioValue} numberOfLines={2}>{row.value}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Hero
  hero: {
    height: 420,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'flex-end',
  },
  backBtn: {
    position: 'absolute',
    // `top` is set inline from useSafeAreaInsets() so the button respects
    // the notch / Dynamic Island on every device instead of being clipped.
    left: 16,
    zIndex: 10,
  },
  backPressable: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { color: '#fff', fontSize: 20, fontFamily: F.bold },
  teamLogoWrap: {
    position: 'absolute',
    bottom: 90,
    right: -20,
    opacity: 0.18,
    zIndex: 1,
  },
  teamLogoWatermark: { width: 190, height: 190 },

  heroMeta: {
    position: 'relative',
    zIndex: 3,
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  heroNameBlock: {
    flex: 1,
  },
  heroImageBlock: {
    width: 140,
    height: 200,
  },
  headshot: { width: '100%', height: '100%' },

  jerseyNumber: {
    fontFamily: F.black,
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 2,
    marginBottom: 2,
  },
  heroName: {
    fontFamily: F.bold,
    fontSize: 28,
    color: '#fff',
    letterSpacing: 1,
    lineHeight: 30,
  },
  heroLastName: {
    fontFamily: F.black,
    fontSize: 44,
    letterSpacing: 1,
    marginTop: -2,
    includeFontPadding: false,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  heroBadge: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  heroBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: F.black,
    letterSpacing: 1.5,
  },

  // Sections
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionAccent: { width: 4, height: 18, borderRadius: 2 },
  sectionTitle: { fontSize: 13, fontFamily: F.black, color: '#fff', letterSpacing: 2 },
  sectionSub: { fontSize: 11, fontFamily: F.regular, color: '#666', flex: 1 },

  // Season stats grid — 3 cols
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statBox: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  statValue: { fontSize: 28, fontFamily: F.black, color: '#fff', letterSpacing: 1 },
  statLabel: { fontSize: 10, fontFamily: F.bold, color: '#8e8e93', letterSpacing: 1, marginTop: 2 },
  statRank: { fontSize: 12, fontFamily: F.black, letterSpacing: 0.5, marginTop: 5 },

  // Toggle (Basic / ADV)
  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  toggleText: {
    fontSize: 10,
    fontFamily: F.black,
    color: '#8e8e93',
    letterSpacing: 1,
  },

  // Career stats table
  careerTable: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    overflow: 'hidden',
    minWidth: '100%',
  },
  careerHeaderRow: {
    backgroundColor: '#111',
  },
  careerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  careerRowAlt: {
    backgroundColor: '#252527',
  },
  careerYearCell: {
    width: 72,
    paddingHorizontal: 12,
  },
  careerCell: {
    width: 50,
    alignItems: 'center',
  },
  careerWideCell: {
    width: 70,
  },
  // Flex variants for BASIC mode — fill container width
  careerYearCellFlex: {
    width: 76,
    paddingLeft: 12,
  },
  careerCellFlex: {
    flex: 1,
    alignItems: 'center',
    minWidth: 36,
  },
  careerHeaderText: {
    fontSize: 10,
    fontFamily: F.black,
    color: '#666',
    letterSpacing: 1,
    textAlign: 'center',
  },
  careerYearText: {
    fontSize: 12,
    fontFamily: F.black,
    letterSpacing: 0.5,
  },
  careerStatText: {
    fontSize: 12,
    fontFamily: F.bold,
    color: '#fff',
    textAlign: 'center',
  },

  // Game log
  gameLogCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    overflow: 'hidden',
    minWidth: '100%',
  },
  gameLogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  gameLogHeader: {
    backgroundColor: '#111',
    paddingVertical: 8,
  },
  gameLogRowAlt: {
    backgroundColor: '#252527',
  },
  glHeaderText: {
    fontSize: 9,
    fontFamily: F.black,
    color: '#555',
    letterSpacing: 1,
    textAlign: 'center',
  },
  glDateText: {
    fontSize: 11,
    fontFamily: F.regular,
    color: '#888',
  },
  glOppText: {
    fontSize: 12,
    fontFamily: F.bold,
    color: '#ccc',
  },
  glResultText: {
    fontSize: 11,
    fontFamily: F.black,
    letterSpacing: 0.3,
  },
  glDateCol: {
    width: 52,
  },
  glOppCol: {
    width: 78,
  },
  glResultCol: {
    width: 96,            // wide enough for "L 127-126 OT"
    textAlign: 'left',
  },
  glStatCell: {
    width: 42,
    textAlign: 'center',
  },
  glStatCellWide: {
    width: 60,            // wide enough for "12/27" or "33.3"
    textAlign: 'center',
  },
  // Flex variant for BASIC mode game log — fills container width
  glStatCellFlex: {
    flex: 1,
    textAlign: 'center',
    minWidth: 30,
  },
  glStatText: {
    fontSize: 12,
    fontFamily: F.bold,
    color: '#fff',
  },
  showMoreBtn: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 6,
  },
  showMoreText: {
    fontSize: 12,
    fontFamily: F.black,
    letterSpacing: 1,
  },

  // Bio card
  bioCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 14,
    overflow: 'hidden',
  },
  bioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
    gap: 12,
  },
  bioLabel: {
    width: 88,
    fontSize: 11,
    fontFamily: F.black,
    color: '#8e8e93',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  bioValue: { flex: 1, fontSize: 14, fontFamily: F.bold, color: '#fff' },
});
