import axios from 'axios';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { API } from '@/constants/api';
import { F } from '@/constants/fonts';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { SportKey } from '@/types/sports';

interface TrendingLeg {
  gameId: string;
  sport: SportKey;
  gameLabel: string;
  description: string;
  odds: number;          // American odds
  teamLogo?: string;
}

interface TrendingParlay {
  id: string;
  title: string;
  legs: TrendingLeg[];
  combinedOdds: number;
}

function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return -Math.round(100 / (decimal - 1));
}

function combineOdds(americans: number[]): number {
  const dec = americans.reduce((a, b) => a * americanToDecimal(b), 1);
  return decimalToAmerican(dec);
}

function fmtOdds(american: number): string {
  return american > 0 ? `+${american}` : String(american);
}

// Build a handful of trending parlay ideas from today's games per sport.
// These are algorithmically derived "popular" lines, not user-generated.
function buildParlays(sport: SportKey, games: any[]): TrendingParlay[] {
  if (!games.length) return [];
  const out: TrendingParlay[] = [];

  // 1) "Chalk Special" — top 3 favorite moneylines
  const withFav = games
    .filter(g => g.odds?.awayMoneyLine != null && g.odds?.homeMoneyLine != null)
    .map(g => {
      const aml = Number(g.odds.awayMoneyLine);
      const hml = Number(g.odds.homeMoneyLine);
      const favoriteIsHome = hml < aml;
      const favOdds = favoriteIsHome ? hml : aml;
      const favTeam = favoriteIsHome ? g.home : g.away;
      return { game: g, favTeam, favOdds, favoriteIsHome };
    })
    .filter(x => x.favOdds < 0)              // only real favorites
    .sort((a, b) => a.favOdds - b.favOdds);  // most favored first

  if (withFav.length >= 2) {
    const top = withFav.slice(0, Math.min(3, withFav.length));
    out.push({
      id: `${sport}-chalk`,
      title: 'Chalk Special',
      legs: top.map(x => ({
        gameId: x.game.id,
        sport,
        gameLabel: `${x.game.away.team.abbreviation} @ ${x.game.home.team.abbreviation}`,
        description: `${x.favTeam.team.abbreviation} ML`,
        odds: x.favOdds,
        teamLogo: x.favTeam.team.logo,
      })),
      combinedOdds: combineOdds(top.map(x => x.favOdds)),
    });
  }

  // 2) "Underdog Special" — top 2 underdogs by upside
  const withDog = games
    .filter(g => g.odds?.awayMoneyLine != null && g.odds?.homeMoneyLine != null)
    .map(g => {
      const aml = Number(g.odds.awayMoneyLine);
      const hml = Number(g.odds.homeMoneyLine);
      const dogIsHome = hml > aml;
      const dogOdds = dogIsHome ? hml : aml;
      const dogTeam = dogIsHome ? g.home : g.away;
      return { game: g, dogTeam, dogOdds };
    })
    .filter(x => x.dogOdds > 100)
    .sort((a, b) => b.dogOdds - a.dogOdds);

  if (withDog.length >= 2) {
    const top = withDog.slice(0, 2);
    out.push({
      id: `${sport}-dog`,
      title: 'Underdog Special',
      legs: top.map(x => ({
        gameId: x.game.id,
        sport,
        gameLabel: `${x.game.away.team.abbreviation} @ ${x.game.home.team.abbreviation}`,
        description: `${x.dogTeam.team.abbreviation} ML`,
        odds: x.dogOdds,
        teamLogo: x.dogTeam.team.logo,
      })),
      combinedOdds: combineOdds(top.map(x => x.dogOdds)),
    });
  }

  // 3) "Over Stack" — top 2 game totals OVER
  const withTotal = games
    .filter(g => g.odds?.overUnder != null && g.odds?.overOdds != null);

  if (withTotal.length >= 2) {
    const top = withTotal.slice(0, 2);
    out.push({
      id: `${sport}-over`,
      title: 'Over Stack',
      legs: top.map((g: any) => ({
        gameId: g.id,
        sport,
        gameLabel: `${g.away.team.abbreviation} @ ${g.home.team.abbreviation}`,
        description: `Over ${g.odds.overUnder}`,
        odds: Number(g.odds.overOdds) || -110,
      })),
      combinedOdds: combineOdds(top.map((g: any) => Number(g.odds.overOdds) || -110)),
    });
  }

  return out;
}

interface Props {
  sports?: SportKey[];                 // which sports to pull from
  cardBg: string;
  border: string;
  text: string;
  sub: string;
  compact?: boolean;                   // home page = compact horizontal scroll
}

export function TrendingParlays({ sports = ['nba', 'nfl', 'mlb', 'nhl'], cardBg, border, text, sub, compact }: Props) {
  const router = useRouter();
  const [parlays, setParlays] = useState<TrendingParlay[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    // For each sport: pull today's scoreboard, then fetch full summary for the
    // first 4 upcoming/live games (these contain `gameOdds`).
    Promise.all(sports.map(async (s) => {
      try {
        const { data } = await axios.get(`${API}/sports/${s}/scores?date=${today}`);
        const games = (data.games || []).filter((g: any) => g.status?.state !== 'post').slice(0, 4);
        const enriched = await Promise.all(games.map(async (g: any) => {
          try {
            const r = await axios.get(`${API}/sports/${s}/game/${g.id}`);
            const o = r.data.gameOdds;
            return {
              ...g,
              odds: o ? {
                awayMoneyLine: o.awayMoneyLine,
                homeMoneyLine: o.homeMoneyLine,
                spread: o.spread,
                overUnder: o.overUnder,
                overOdds: o.overOdds,
                underOdds: o.underOdds,
              } : null,
            };
          } catch { return g; }
        }));
        return buildParlays(s, enriched);
      } catch { return [] as TrendingParlay[]; }
    })).then(results => {
      // Interleave top parlays from each sport so user sees variety
      const merged: TrendingParlay[] = [];
      const maxLen = Math.max(...results.map(r => r.length));
      for (let i = 0; i < maxLen; i++) {
        for (const r of results) {
          if (r[i]) merged.push(r[i]);
        }
      }
      setParlays(merged);
    });
  }, [sports.join(',')]);

  if (parlays.length === 0) return null;

  const onParlayPress = (p: TrendingParlay) => {
    // Tap any game in the parlay to view its details (use first leg)
    const first = p.legs[0];
    if (first) router.push({ pathname: '/game/[id]', params: { id: first.gameId, sport: first.sport } } as any);
  };

  const Content = (
    <View style={compact ? styles.row : styles.column}>
      {parlays.map((p, i) => (
        <Animated.View
          key={p.id}
          entering={FadeInDown.delay(i * 80).duration(380).springify()}
          style={[styles.card, { backgroundColor: cardBg, borderColor: border }, compact && styles.cardCompact]}
        >
          <Pressable onPress={() => onParlayPress(p)} style={{ flex: 1 }}>
            <View style={styles.cardHeader}>
              <View style={[styles.fireBadge, { backgroundColor: '#ff6b35' }]}>
                <Text style={styles.fireBadgeText}>HOT</Text>
              </View>
              <Text style={[styles.title, { color: text }]} numberOfLines={1}>{p.title}</Text>
              <Text style={[styles.odds, { color: '#FFD700' }]}>{fmtOdds(p.combinedOdds)}</Text>
            </View>
            <View style={styles.legs}>
              {p.legs.map((leg, li) => {
                const sportCfg = SPORT_CONFIG[leg.sport];
                return (
                  <View key={li} style={styles.legRow}>
                    <View style={[styles.sportDot, { backgroundColor: sportCfg.color }]} />
                    {leg.teamLogo ? <Image source={{ uri: leg.teamLogo }} style={styles.legLogo} contentFit="contain" /> : <View style={styles.legLogo} />}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.legDesc, { color: text }]} numberOfLines={1}>{leg.description}</Text>
                      <Text style={[styles.legGame, { color: sub }]} numberOfLines={1}>{leg.gameLabel}</Text>
                    </View>
                    <Text style={[styles.legOdds, { color: sub }]}>{fmtOdds(leg.odds)}</Text>
                  </View>
                );
              })}
            </View>
            <View style={[styles.footer, { borderTopColor: border }]}>
              <Text style={[styles.footerText, { color: sub }]}>{p.legs.length}-leg parlay</Text>
              <Text style={[styles.footerCta, { color: '#FFD700' }]}>View →</Text>
            </View>
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );

  if (compact) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {Content}
      </ScrollView>
    );
  }
  return Content;
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  column: { gap: 10, paddingHorizontal: 16 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 12,
  },
  cardCompact: {
    width: 270,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  fireBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  fireBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: F.black,
    letterSpacing: 1.2,
  },
  title: { flex: 1, fontSize: 13, fontFamily: F.black, letterSpacing: 0.5 },
  odds: { fontSize: 15, fontFamily: F.black },
  legs: { gap: 8 },
  legRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sportDot: { width: 4, height: 28, borderRadius: 2 },
  legLogo: { width: 22, height: 22 },
  legDesc: { fontSize: 12, fontFamily: F.bold },
  legGame: { fontSize: 10, fontFamily: F.regular, marginTop: 1 },
  legOdds: { fontSize: 11, fontFamily: F.black },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { fontSize: 10, fontFamily: F.bold, letterSpacing: 0.5 },
  footerCta: { fontSize: 11, fontFamily: F.black, letterSpacing: 0.5 },
});
