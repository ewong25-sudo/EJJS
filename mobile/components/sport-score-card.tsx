import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { F } from '@/constants/fonts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SportGame, SportKey } from '@/types/sports';

interface Props { game: SportGame; sport: SportKey; index: number; }

function tc(hex: string) { return hex.startsWith('#') ? hex : `#${hex}`; }

function fmtGameTime(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

// Short date for the status bar — "Mon, Jun 23". Shows "Today"/"Yesterday"
// when relevant so the most common cases read naturally.
function fmtGameDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOf(d) - startOf(now)) / 86400000);
    if (dayDiff === 0) return 'Today';
    if (dayDiff === -1) return 'Yesterday';
    if (dayDiff === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export function SportScoreCard({ game, sport, index }: Props) {
  const dark = useColorScheme() === 'dark';
  const cardBg = dark ? '#1c1c1e' : '#fff';
  const border = dark ? '#2c2c2e' : '#e5e5e5';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';
  const dimmed = dark ? '#636366' : '#adadb8';

  const isLive = game.status.state === 'in';
  const isPre = game.status.state === 'pre';
  const isFinal = game.status.state === 'post';

  const awayScore = Number(game.away.score ?? 0);
  const homeScore = Number(game.home.score ?? 0);
  const awayWin = isFinal && awayScore > homeScore;
  const homeWin = isFinal && homeScore > awayScore;

  const router = useRouter();
  const scale = useSharedValue(1);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View entering={FadeIn.delay(index * 50).duration(300)} style={cardStyle}>
      <Pressable
        onPress={() => router.push(`/game/${game.id}?sport=${sport}` as any)}
        onPressIn={() => { scale.value = withSpring(0.98, { damping: 20 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 20 }); }}
        style={[styles.card, { backgroundColor: cardBg, borderColor: border }, !dark && styles.shadow]}
      >
        {/* Away team row */}
        <TeamRow
          team={game.away.team}
          score={game.away.score}
          record={game.away.record}
          isPre={isPre}
          isLoser={isFinal && !awayWin && awayScore !== homeScore}
          text={text}
          sub={sub}
          dimmed={dimmed}
          dark={dark}
        />

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: border }]} />

        {/* Home team row */}
        <TeamRow
          team={game.home.team}
          score={game.home.score}
          record={game.home.record}
          isPre={isPre}
          isLoser={isFinal && !homeWin && awayScore !== homeScore}
          text={text}
          sub={sub}
          dimmed={dimmed}
          dark={dark}
        />

        {/* Status bar */}
        <View style={[styles.statusBar, { borderTopColor: border }]}>
          <View style={styles.statusLeft}>
            {/* Game date — sits across from the time/status on the right */}
            {game.date ? <Text style={[styles.statusDate, { color: sub }]}>{fmtGameDate(game.date)}</Text> : null}
            {game.note ? <Text style={[styles.roundNote, { color: sub }]}>{game.note}</Text> : null}
            {game.seriesSummary ? <Text style={[styles.seriesText, { color: sub }]}>{game.seriesSummary}</Text> : null}
          </View>
          {isLive ? (
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{game.status.detail || 'LIVE'}</Text>
            </View>
          ) : isPre ? (
            <Text style={[styles.statusTime, { color: sub }]}>{fmtGameTime(game.date)}</Text>
          ) : (
            <Text style={[styles.statusFinal, { color: sub }]}>
              {game.status.detail?.toLowerCase().includes('final') ? 'Final' : game.status.detail || 'Final'}
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function TeamRow({ team, score, record, isPre, isLoser, text, sub, dimmed, dark }: {
  team: SportGame['away']['team'];
  score: string | undefined;
  record: string | undefined;
  isPre: boolean;
  isLoser: boolean;
  text: string;
  sub: string;
  dimmed: string;
  dark: boolean;
}) {
  const nameColor = isLoser ? dimmed : text;
  const scoreColor = isLoser ? dimmed : text;
  const teamColor = tc(team.color);
  const logoUri = dark && team.logoDark ? team.logoDark : team.logo;

  return (
    <View style={styles.teamRow}>
      {/* Color accent */}
      <View style={[styles.accent, { backgroundColor: teamColor }]} />

      {/* Logo */}
      {logoUri
        ? <Image source={{ uri: logoUri }} style={styles.logo} contentFit="contain" transition={150} />
        : <View style={[styles.logo, { backgroundColor: teamColor + '22' }]} />
      }

      {/* Name + record */}
      <View style={styles.nameBlock}>
        <Text style={[styles.abbr, { color: nameColor }]} numberOfLines={1}>{team.abbreviation}</Text>
        {record ? <Text style={[styles.record, { color: isLoser ? dimmed : sub }]}>{record}</Text> : null}
      </View>

      {/* Score or dash */}
      {!isPre ? (
        <Text style={[styles.score, { color: scoreColor }]}>{score ?? '-'}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },

  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingRight: 16,
    gap: 10,
  },
  accent: {
    width: 3,
    alignSelf: 'stretch',
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 2,
  },
  nameBlock: {
    flex: 1,
    gap: 1,
  },
  abbr: {
    fontSize: 15,
    fontFamily: F.bold,
    letterSpacing: 0.2,
  },
  record: {
    fontSize: 11,
    fontFamily: F.regular,
  },
  score: {
    fontSize: 22,
    fontFamily: F.black,
    letterSpacing: -0.5,
    minWidth: 32,
    textAlign: 'right',
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 13, // align with content, past accent
  },

  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusLeft: { flex: 1, gap: 1 },
  statusDate: { fontSize: 12, fontFamily: F.bold },
  roundNote: { fontSize: 10, fontFamily: F.black, letterSpacing: 0.3, textTransform: 'uppercase' },
  seriesText: { fontSize: 10, fontFamily: F.regular },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF3B30',
  },
  liveText: {
    fontSize: 11,
    fontFamily: F.black,
    color: '#FF3B30',
    letterSpacing: 0.3,
  },
  statusTime: {
    fontSize: 12,
    fontFamily: F.bold,
  },
  statusFinal: {
    fontSize: 12,
    fontFamily: F.regular,
    fontStyle: 'italic',
  },
});
