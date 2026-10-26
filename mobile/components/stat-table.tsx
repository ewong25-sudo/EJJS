import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { F } from '@/constants/fonts';

export interface StatRow {
  key: string;
  label: ReactNode;     // first (frozen) column content — text or a custom node
  cells: (string | number)[];
  onPress?: () => void;
}

interface Props {
  firstColLabel: string;     // header for the frozen column (e.g. "SPLITS", "YEAR", "DATE")
  columns: string[];         // stat column headers
  rows: StatRow[];
  text: string; sub: string; border: string; cardBg: string; dark: boolean;
  firstColWidth?: number;
  colWidth?: number;
  cellColor?: (col: string, value: string) => string | undefined;
}

// Generic frozen-first-column table with a horizontally scrollable stat area —
// the same pattern used in standings and the box score. The first column stays
// pinned while the stat columns scroll left/right.
export function StatTable({ firstColLabel, columns, rows, text, sub, border, cardBg, dark, firstColWidth = 132, colWidth = 52, cellColor }: Props) {
  const HEADER_H = 32;
  const ROW_H = 44;
  return (
    <View style={[s.wrap, { backgroundColor: cardBg, borderColor: border }]}>
      {/* Frozen first column */}
      <View style={{ width: firstColWidth, borderRightWidth: 1, borderRightColor: border }}>
        <View style={[s.headCell, { height: HEADER_H, borderBottomColor: border }]}>
          <Text style={[s.headText, { color: sub }]}>{firstColLabel}</Text>
        </View>
        {rows.map((r, i) => (
          <Pressable key={r.key} onPress={r.onPress} disabled={!r.onPress}
            style={{ height: ROW_H, justifyContent: 'center', paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: border, backgroundColor: i % 2 ? (dark ? '#161618' : '#fafafa') : 'transparent' }}>
            {typeof r.label === 'string'
              ? <Text style={{ color: text, fontSize: 13, fontFamily: F.bold }} numberOfLines={1}>{r.label}</Text>
              : r.label}
          </Pressable>
        ))}
      </View>

      {/* Scrollable stat columns */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
        <View>
          <View style={{ height: HEADER_H, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: border }}>
            {columns.map(c => (
              <View key={c} style={{ width: colWidth, alignItems: 'center' }}>
                <Text style={[s.headText, { color: sub }]}>{c}</Text>
              </View>
            ))}
          </View>
          {rows.map((r, i) => (
            <View key={r.key} style={{ height: ROW_H, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: border, backgroundColor: i % 2 ? (dark ? '#161618' : '#fafafa') : 'transparent' }}>
              {columns.map((c, ci) => {
                const v = String(r.cells[ci] ?? '--');
                const col = cellColor?.(c, v);
                return (
                  <View key={c} style={{ width: colWidth, alignItems: 'center' }}>
                    <Text style={{ color: col ?? text, fontSize: 12, fontFamily: ci === 0 ? F.bold : F.regular }}>{v}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  headCell: { justifyContent: 'center', paddingHorizontal: 10, borderBottomWidth: 1 },
  headText: { fontSize: 10, fontFamily: F.black, letterSpacing: 0.5 },
});
