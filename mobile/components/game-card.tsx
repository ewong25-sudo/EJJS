import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { teamColor } from '@/constants/team-colors';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Game } from '@/types/nba';

interface Props {
  game: Game;
  isLive: boolean;
}

async function sendScoreNotification(game: Game, side: 'home' | 'away', delta: number) {
  const scorer = game[side].team;
  const other = game[side === 'home' ? 'away' : 'home'].team;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${game.away.team} @ ${game.home.team}`,
      body: `${scorer} on a ${delta}-point run! ${game.away.score}–${game.home.score}`,
      sound: true,
    },
    trigger: null,
  });
}

export function GameCard({ game, isLive }: Props) {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';

  const prevHome = useRef(game.home.score);
  const prevAway = useRef(game.away.score);

  const homeFlash = useSharedValue(0);
  const awayFlash = useSharedValue(0);

  useEffect(() => {
    const homeDelta = game.home.score - prevHome.current;
    const awayDelta = game.away.score - prevAway.current;

    if (homeDelta > 0) {
      homeFlash.value = withSequence(
        withTiming(1, { duration: 180 }),
        withTiming(0, { duration: 500 })
      );
      if (homeDelta >= 5) sendScoreNotification(game, 'home', homeDelta);
      prevHome.current = game.home.score;
    }

    if (awayDelta > 0) {
      awayFlash.value = withSequence(
        withTiming(1, { duration: 180 }),
        withTiming(0, { duration: 500 })
      );
      if (awayDelta >= 5) sendScoreNotification(game, 'away', awayDelta);
      prevAway.current = game.away.score;
    }
  }, [game.home.score, game.away.score]);

  const homeScoreStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      homeFlash.value,
      [0, 1],
      ['transparent', '#FFD700']
    ),
    borderRadius: 6,
    paddingHorizontal: 4,
  }));

  const awayScoreStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      awayFlash.value,
      [0, 1],
      ['transparent', '#FFD700']
    ),
    borderRadius: 6,
    paddingHorizontal: 4,
  }));

  const homeColor = teamColor(game.home.team);
  const awayColor = teamColor(game.away.team);

  const cardBg = dark ? '#1c1c1e' : '#ffffff';
  const borderColor = dark ? '#2c2c2e' : '#e5e5e5';
  const labelColor = dark ? '#8e8e93' : '#555555';
  const textColor = dark ? '#ffffff' : '#000000';
  const statusColor = dark ? '#8e8e93' : '#666666';
  const liveColor = '#ff3b30';

  return (
    <Pressable onPress={() => router.push(`/game/${game.id}`)}>
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        {/* AWAY */}
        <TeamBlock
          team={game.away}
          scoreStyle={awayScoreStyle}
          accentColor={awayColor}
          textColor={textColor}
          labelColor={labelColor}
        />

        {/* CENTER STATUS */}
        <View style={styles.center}>
          {isLive && (
            <View style={[styles.liveBadge, { borderColor: liveColor }]}>
              <Text style={[styles.liveText, { color: liveColor }]}>LIVE</Text>
            </View>
          )}
          <Text style={[styles.status, { color: statusColor }]} numberOfLines={1}>
            {game.status}
          </Text>
          {game.period > 0 && (
            <Text style={[styles.clock, { color: statusColor }]}>
              {`Q${game.period}  ${game.clock}`}
            </Text>
          )}
        </View>

        {/* HOME */}
        <TeamBlock
          team={game.home}
          scoreStyle={homeScoreStyle}
          accentColor={homeColor}
          textColor={textColor}
          labelColor={labelColor}
        />
      </View>
    </Pressable>
  );
}

function TeamBlock({
  team,
  scoreStyle,
  accentColor,
  textColor,
  labelColor,
}: {
  team: Game['home'];
  scoreStyle: any;
  accentColor: string;
  textColor: string;
  labelColor: string;
}) {
  return (
    <View style={styles.teamBlock}>
      <View style={[styles.accentBar, { backgroundColor: accentColor }]} />
      {team.logo ? (
        <Image source={{ uri: team.logo }} style={styles.logo} resizeMode="contain" />
      ) : null}
      <Animated.View style={scoreStyle}>
        <Text style={[styles.score, { color: textColor }]}>{team.score}</Text>
      </Animated.View>
      <Text style={[styles.tricode, { color: labelColor }]}>{team.team}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  teamBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  accentBar: {
    width: 32,
    height: 3,
    borderRadius: 2,
    marginBottom: 4,
  },
  logo: {
    width: 44,
    height: 44,
  },
  score: {
    fontSize: 22,
    fontWeight: '700',
  },
  tricode: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  liveBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  status: {
    fontSize: 12,
    textAlign: 'center',
  },
  clock: {
    fontSize: 11,
    textAlign: 'center',
  },
});
