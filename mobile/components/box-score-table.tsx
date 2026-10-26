import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { F } from '@/constants/fonts';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PlayerHeadshot } from '@/components/player-headshot';

export interface BSAthlete {
  id: string;
  name: string;
  position: string;
  headshot: string;
  starter: boolean;
  stats: Record<string, string>;
}

interface Props {
  athletes: BSAthlete[];
  labels: string[];
  text: string; sub: string; border: string; cardBg: string;
  onOpenPlayer: (id: string) => void;
  isFav: (id: string) => boolean;
  toggleFav: (a: BSAthlete) => void;
  staggerSubs?: boolean;   // indent substitutes (batters only — not pitchers)
}

// Sticky-first-column stat table. The player column stays pinned on the left
// while the stat columns scroll horizontally — the same frozen-column pattern
// used in the standings. Reused for both hitters and pitchers.
export function BoxScoreTable({ athletes, labels, text, sub, border, cardBg, onOpenPlayer, isFav, toggleFav, staggerSubs = false }: Props) {
  // Always a horizontal ScrollView with fixed-width columns so the team column
  // stays frozen on the left while every stat column scrolls — consistent on
  // web and native, no clipping when there are many columns.
  const StatsContainer: any = ScrollView;
  const containerProps: any = { horizontal: true, showsHorizontalScrollIndicator: false, style: { flex: 1 }, contentContainerStyle: { flexDirection: 'column' } };

  return (
    <View style={[s.wrap, { backgroundColor: cardBg, borderColor: border }]}>
      {/* Fixed PLAYER column */}
      <View style={s.playerTrack}>
        <View style={[s.headerCell, { borderBottomColor: border }]}>
          <Text style={[s.colLabel, { color: sub }]}>PLAYER</Text>
        </View>
        {athletes.map((a, i) => (
          <Pressable key={a.name + i + '-n'} onPress={() => a.id && onOpenPlayer(a.id)}
            style={[s.playerCell, { borderBottomColor: border }, !a.starter && s.bench, staggerSubs && !a.starter && { paddingLeft: 30 }]}>
            {/* Subs (batters only) are clearly indented under the starter they
                replaced, with a corner connector so the substitution reads. */}
            {staggerSubs && !a.starter && (
              <View style={{ position: 'absolute', left: 12, top: -1, height: 27, width: 12, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: sub + '66', borderBottomLeftRadius: 6 }} />
            )}
            <PlayerHeadshot uri={a.headshot} name={a.name} size={28} dark={text === '#fff'} accent={sub} />
            <View style={{ flex: 1 }}>
              <Text style={[s.name, { color: text }]} numberOfLines={1}>{a.name}</Text>
              <Text style={[s.pos, { color: sub }]} numberOfLines={1}>
                {a.position}{!a.starter ? ' · IN' : ''}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* Scrollable STATS — the star is the LAST column inside the scroll so it
          sits immediately after the final stat (no dead gap) and stays aligned. */}
      {(() => (
        <StatsContainer {...containerProps}>
          <View style={[s.statsHeader, { borderBottomColor: border }]}>
            {labels.map(l => <Text key={l} style={[s.statCol, s.colLabel, { color: sub }]}>{l}</Text>)}
            <View style={s.starCol} />
          </View>
          {athletes.map((a, i) => {
            const faved = isFav(a.id);
            return (
              <View key={a.name + i + '-s'} style={[s.statsRow, { borderBottomColor: border }, !a.starter && s.bench]}>
                {labels.map((l, ci) => {
                  const val = a.stats[l] ?? '--';
                  const isPlusMinus = l === '+/-';
                  const pm = isPlusMinus ? Number(val) : 0;
                  const color = isPlusMinus ? (pm > 0 ? '#34c759' : pm < 0 ? '#ff3b30' : sub) : ci === 0 ? text : sub;
                  return <Text key={l} style={[s.statCol, { color, fontFamily: ci === 0 ? F.bold : F.regular }]}>{val}</Text>;
                })}
                <Pressable onPress={() => a.id ? toggleFav(a) : undefined} hitSlop={8} style={s.starCol}>
                  <IconSymbol name={faved ? 'star.fill' : 'star'} size={16} color={faved ? '#FFD700' : sub} />
                </Pressable>
              </View>
            );
          })}
        </StatsContainer>
      ))()}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  playerTrack: { width: 150, flexDirection: 'column' },
  statsRow: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  playerCell: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  headerCell: { height: 30, paddingHorizontal: 8, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  statsHeader: { height: 30, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  bench: { opacity: 0.85 },
  headshot: { width: 28, height: 28, borderRadius: 14 },
  name: { fontSize: 12, fontFamily: F.bold },
  pos: { fontSize: 10, fontFamily: F.regular },
  colLabel: { fontSize: 10, fontFamily: F.black, letterSpacing: 0.5 },
  statCol: { width: 52, textAlign: 'center', fontSize: 12, fontFamily: F.regular },
  starCol: { width: 34, alignItems: 'center', justifyContent: 'center' },
});
