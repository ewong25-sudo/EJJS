import axios from 'axios';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { API } from '@/constants/api';
import { F } from '@/constants/fonts';
import { formatPropLine } from '@/constants/prop-utils';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { SportKey } from '@/types/sports';

interface TrendingProp {
  gameId: string;
  sport: SportKey;
  athleteId: string;
  athleteName: string;
  headshot: string;
  teamColor: string;
  typeAbbr: string;            // PTS, REB, AST, etc.
  line: string;
  overOdds: string;
  underOdds: string;
}

// Map ESPN type names to a short stat label (PTS, REB, AST, etc.)
function abbreviate(typeName: string): string {
  const t = typeName.toLowerCase();
  if (t.includes('three')) return '3PT';
  if (t.includes('pts+reb+ast') || (t.includes('point') && t.includes('rebound') && t.includes('assist'))) return 'PRA';
  if (t.includes('points')) return 'PTS';
  if (t.includes('assist')) return 'AST';
  if (t.includes('rebound')) return 'REB';
  if (t.includes('steal')) return 'STL';
  if (t.includes('block')) return 'BLK';
  if (t.includes('passing yard')) return 'PASS YDS';
  if (t.includes('rushing yard')) return 'RUSH YDS';
  if (t.includes('receiving yard')) return 'REC YDS';
  if (t.includes('reception')) return 'REC';
  if (t.includes('strikeout')) return 'K';
  if (t.includes('total base')) return 'TB';
  if (t.includes('home run')) return 'HR';
  if (t.includes('rbi')) return 'RBI';
  if (t.includes('single')) return 'H';
  if (t.includes('hit')) return 'H';
  if (t.includes('run')) return 'R';
  if (t.includes('goal')) return 'G';
  if (t.includes('shot')) return 'SOG';
  if (t.includes('save')) return 'SV';
  return typeName.split(' ').slice(0, 2).join(' ').toUpperCase();
}

// Pick most-relevant props per sport (mirrors leader categories)
function isHeroProp(sport: SportKey, typeName: string): boolean {
  const t = typeName.toLowerCase();
  if (sport === 'nba') return /(points|rebound|assist)$/.test(t) && !t.includes('+');
  if (sport === 'mlb') return t.includes('total strikeouts') || t.includes('total hits') || t.includes('home run') || t.includes('total bases');
  if (sport === 'nfl') return t.includes('passing yard') || t.includes('rushing yard') || t.includes('receiving yard') || t.includes('reception');
  if (sport === 'nhl') return t.includes('shots') || t.includes('points') || t.includes('goals');
  return false;
}

interface Props {
  sports?: SportKey[];
  cardBg: string;
  border: string;
  text: string;
  sub: string;
  cfgColor?: string;
}

export function TrendingProps({ sports = ['nba', 'nfl', 'mlb', 'nhl'], cardBg, border, text, sub }: Props) {
  const router = useRouter();
  const [props, setProps] = useState<TrendingProp[]>([]);

  useEffect(() => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dates = [today, tomorrow, dayAfter].map(d => d.toISOString().slice(0, 10));

    (async () => {
      const all: TrendingProp[] = [];

      for (const sport of sports) {
        try {
          // Try today first, then tomorrow, then day-after — keep looking until
          // we find upcoming games for this sport
          let games: any[] = [];
          for (const date of dates) {
            const { data } = await axios.get(`${API}/sports/${sport}/scores?date=${date}`);
            const upcoming = (data.games || []).filter((g: any) => g.status?.state !== 'post');
            if (upcoming.length > 0) {
              games = upcoming.slice(0, 3);
              break;
            }
          }

          for (const g of games) {
            try {
              const summary = await axios.get(`${API}/sports/${sport}/game/${g.id}`);
              const d = summary.data;
              const playerProps: any[] = (d.playerProps || []).filter((p: any) =>
                isHeroProp(sport, p.typeName) &&
                !p.typeName.toLowerCase().includes('milestone')
              );
              // Match each prop with the most likely leader for "trending" feel
              for (const p of playerProps.slice(0, 6)) {
                const teamColor = (() => {
                  // Use home or away team color based on which team the player is on.
                  // Without explicit team in props, default to game's home color.
                  return d.home?.team?.color ? `#${d.home.team.color}` : (SPORT_CONFIG[sport]?.color ?? '#888');
                })();
                // Fallback: build standard ESPN headshot URL from athleteId so
                // every card has an image even if ESPN omits the field.
                const espnPath = sport === 'nba' ? 'nba'
                  : sport === 'nfl' ? 'nfl'
                  : sport === 'mlb' ? 'mlb'
                  : 'nhl';
                const headshot = p.athlete.headshot && p.athlete.headshot.startsWith('http')
                  ? p.athlete.headshot
                  : `https://a.espncdn.com/i/headshots/${espnPath}/players/full/${p.athleteId}.png`;
                all.push({
                  gameId: g.id,
                  sport,
                  athleteId: p.athleteId,
                  athleteName: p.athlete.name,
                  headshot,
                  teamColor,
                  typeAbbr: abbreviate(p.typeName),
                  line: p.line,
                  overOdds: p.overOdds,
                  underOdds: p.underOdds ?? '-110',
                });
              }
            } catch { /* skip game on error */ }
          }
        } catch { /* skip sport on error */ }
      }

      // Dedupe by player+stat (some games repeat)
      const seen = new Set<string>();
      const unique = all.filter(p => {
        const key = `${p.athleteId}-${p.typeAbbr}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setProps(unique.slice(0, 18));            // cap at ~18 cards
    })();
  }, [sports.join(',')]);

  if (props.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      {props.map((p, i) => {
        const overPos = String(p.overOdds ?? '').startsWith('+');
        const underPos = String(p.underOdds ?? '').startsWith('+');
        const lastName = p.athleteName.split(' ').slice(-1)[0] || p.athleteName;
        return (
          <Animated.View
            key={`${p.athleteId}-${p.typeAbbr}-${i}`}
            entering={FadeInDown.delay(i * 60).duration(380).springify()}
            style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}
          >
            <Pressable
              onPress={() => router.push({ pathname: '/game/[id]', params: { id: p.gameId, sport: p.sport } } as any)}
              style={{ flex: 1, width: '100%', alignItems: 'center' }}
            >
              {/* Hero: headshot only */}
              <View style={styles.hero}>
                {p.headshot
                  ? <Image source={{ uri: p.headshot }} style={styles.heroImg} contentFit="cover" contentPosition="top" />
                  : <View style={styles.heroImg} />}
              </View>
              {/* Name — sits UNDER the headshot, not overlaid on it */}
              <Text style={[styles.name, { color: text }]} numberOfLines={1}>
                {lastName}
              </Text>
              {/* Team-color accent */}
              <View style={[styles.accent, { backgroundColor: p.teamColor }]} />
              {/* Stat type */}
              <Text style={[styles.type, { color: sub }]}>{p.typeAbbr}</Text>
              {/* Line */}
              <Text style={[styles.line, { color: text }]}>{formatPropLine(p.line)}</Text>
              {/* O / U odds */}
              <View style={styles.oddsRow}>
                <Text style={[styles.odds, { color: overPos ? '#ff9f0a' : '#34c759' }]}>O {p.overOdds}</Text>
                <Text style={[styles.odds, { color: underPos ? '#ff9f0a' : '#34c759' }]}>U {p.underOdds}</Text>
              </View>
            </Pressable>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 8 },
  card: {
    width: 130,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    paddingBottom: 10,
    paddingHorizontal: 6,
    gap: 4,
    overflow: 'hidden',
  },
  hero: {
    width: '100%',
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroImg: {
    width: '100%',
    height: '100%',
  },
  name: {
    fontSize: 12,
    fontFamily: F.bold,
    textAlign: 'center',
    width: '100%',
    paddingTop: 5,
    paddingHorizontal: 2,
  },
  accent: { width: 30, height: 3, borderRadius: 2 },
  type: { fontSize: 10, fontFamily: F.black, letterSpacing: 1 },
  line: { fontSize: 20, fontFamily: F.black, marginVertical: 2 },
  oddsRow: { flexDirection: 'row', gap: 6 },
  odds: { fontSize: 10, fontFamily: F.bold },
});
