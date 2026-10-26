import axios from 'axios';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { API } from '@/constants/api';
import { F } from '@/constants/fonts';
import { StandingEntry, StandingGroup } from '@/types/sports';

// Layout constants — the team column is frozen on the left while the stat
// columns scroll horizontally. Row heights are fixed so the two stacks align.
const ROW_H = 46;
const HEADER_H = 38;
const TEAM_COL_W = 150;

type ViewTab = 'DIVISION' | 'LEAGUE' | 'WILDCARD' | 'OVERALL';

interface Col {
  key: string;
  label: string;
  w: number;
  get: (e: StandingEntry) => string | number;
  kind?: 'diff' | 'streak';
}

function columnsFor(sport: string): Col[] {
  const cols: Col[] = [
    { key: 'W', label: 'W', w: 40, get: e => e.wins },
    { key: 'L', label: 'L', w: 40, get: e => e.losses },
  ];
  if (sport === 'nhl') {
    cols.push({ key: 'PTS', label: 'PTS', w: 46, get: e => e.points ?? '-' });
  }
  cols.push({ key: 'PCT', label: 'PCT', w: 52, get: e => e.pct });
  cols.push({ key: 'GB', label: 'GB', w: 46, get: e => (e.gb === '0' ? '—' : e.gb) });
  cols.push({ key: 'HOME', label: 'HOME', w: 60, get: e => e.home ?? '-' });
  cols.push({ key: 'AWAY', label: 'AWAY', w: 60, get: e => e.away ?? '-' });
  if (sport === 'mlb') {
    cols.push({ key: 'RS', label: 'RS', w: 48, get: e => e.pointsFor ?? '-' });
    cols.push({ key: 'RA', label: 'RA', w: 48, get: e => e.pointsAgainst ?? '-' });
  }
  cols.push({ key: 'DIFF', label: 'DIFF', w: 56, get: e => e.diff ?? '-', kind: 'diff' });
  cols.push({ key: 'STRK', label: 'STRK', w: 50, get: e => e.streak ?? '-', kind: 'streak' });
  cols.push({ key: 'L10', label: 'L10', w: 52, get: e => e.last10 ?? '-' });
  return cols;
}

// Parse ".603" / "0.603" → number for re-ranking aggregated views.
const pctNum = (s: string) => Number(String(s).replace(/^\./, '0.')) || 0;

const shorten = (n: string) => n
  .replace('American League', 'AL')
  .replace('National League', 'NL')
  .replace('Eastern Conference', 'Eastern')
  .replace('Western Conference', 'Western')
  .replace(' Division', '')
  .replace(' Conference', '');

// Lighten a too-dark brand color so it's readable as TEXT on a dark theme.
function readableOnDark(hex: string, dark: boolean, fallback: string): string {
  if (!hex) return fallback;
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (dark && lum < 0.5) {
    const f = 0.6;
    r = Math.round(r + (255 - r) * f); g = Math.round(g + (255 - g) * f); b = Math.round(b + (255 - b) * f);
  }
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

interface Props {
  sport: string;
  accent: string;     // cfg.color
  bg: string; cardBg: string; text: string; sub: string; border: string; dark: boolean;
}

export function StandingsView({ sport, accent: rawAccent, bg, cardBg, text, sub, border, dark }: Props) {
  // Bright accent for TEXT; keep the raw accent for solid-fill backgrounds.
  const accent = readableOnDark(rawAccent, dark, sub);
  const router = useRouter();
  const [groups, setGroups] = useState<StandingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ViewTab>('DIVISION');

  const currentYear = new Date().getFullYear();
  const [season, setSeason] = useState<number>(currentYear);
  const [seasontype, setSeasontype] = useState<'1' | '2'>('2');
  const [yearOpen, setYearOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  const cols = useMemo(() => columnsFor(sport), [sport]);
  const preLabel = sport === 'mlb' ? 'Spring Training' : 'Preseason';
  // Wide layout (desktop web) → lay sections side by side instead of stacked.
  const { width: winW } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && winW >= 900;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get<{ groups: StandingGroup[] }>(
      `${API}/sports/${sport}/standings?season=${season}&seasontype=${seasontype}`
    )
      .then(r => { if (!cancelled) setGroups(r.data.groups || []); })
      .catch(() => { if (!cancelled) setGroups([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sport, season, seasontype]);

  // Build the sections shown for the active tab.
  const sections = useMemo<{ title: string; entries: StandingEntry[]; cutAfter?: number; conference?: string }[]>(() => {
    if (tab === 'DIVISION') {
      // Carry the parent conference so the desktop layout can put one league's
      // divisions on the left and the other's on the right.
      return groups.map(g => ({ title: shorten(g.name).toUpperCase(), entries: g.entries, conference: g.conference || g.name }));
    }
    // Aggregate division groups up to conference (LEAGUE) or everything (OVERALL).
    const rank = (entries: StandingEntry[]) =>
      [...entries].sort((a, b) => pctNum(b.pct) - pctNum(a.pct)).map((e, i) => ({ ...e, rank: i + 1 }));
    if (tab === 'LEAGUE') {
      const byConf: Record<string, StandingEntry[]> = {};
      for (const g of groups) {
        const c = g.conference || g.name;
        (byConf[c] ||= []).push(...g.entries);
      }
      return Object.entries(byConf).map(([title, entries]) => ({ title: title.toUpperCase(), entries: rank(entries) }));
    }
    if (tab === 'WILDCARD') {
      // Wildcard race (MLB): within each league, the division leaders are out
      // of the wildcard picture; everyone else is ranked by record. The top 3
      // per league hold wildcard spots — we mark the cut line.
      const byConf: Record<string, StandingGroup[]> = {};
      for (const g of groups) {
        const c = g.conference || g.name;
        (byConf[c] ||= []).push(g);
      }
      const out: { title: string; entries: StandingEntry[]; cutAfter?: number }[] = [];
      for (const [conf, divs] of Object.entries(byConf)) {
        // Division leader = top team (by pct) in each division
        const leaders = new Set<string>();
        for (const d of divs) {
          const top = [...d.entries].sort((a, b) => pctNum(b.pct) - pctNum(a.pct))[0];
          if (top) leaders.add(top.team.id);
        }
        const contenders = divs.flatMap(d => d.entries).filter(e => !leaders.has(e.team.id));
        out.push({ title: `${shorten(conf).toUpperCase()} WILD CARD`, entries: rank(contenders), cutAfter: 3 });
      }
      return out;
    }
    // OVERALL
    const all = groups.flatMap(g => g.entries);
    return [{ title: sport.toUpperCase(), entries: rank(all) }];
  }, [groups, tab, sport]);

  const headerCell = (label: string, w: number) => (
    <View key={label} style={{ width: w, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: sub, fontSize: 10, fontFamily: F.black, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );

  // Conference banner shown above a league's divisions (e.g. "AMERICAN LEAGUE").
  const confHeader = (name: string) => (
    <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, marginBottom: 4, borderBottomWidth: 2, borderBottomColor: accent }}>
      <Text style={{ color: text, fontSize: 16, fontFamily: F.black, letterSpacing: 0.5 }}>{name.toUpperCase()}</Text>
    </View>
  );

  // One standings section (a division/league) = title + frozen team column +
  // its own independent horizontal stat scroll.
  const renderSection = (sec: { title: string; entries: StandingEntry[]; cutAfter?: number }, key: string) => (
    <View key={key} style={{ marginBottom: 4 }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: accent }} />
        <Text style={{ color: accent, fontSize: 13, fontFamily: F.black, letterSpacing: 0.5 }}>{sec.title}</Text>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: TEAM_COL_W, borderRightWidth: 1, borderRightColor: border }}>
          <View style={{ height: HEADER_H, justifyContent: 'center', paddingLeft: 12, backgroundColor: bg }}>
            <Text style={{ color: sub, fontSize: 10, fontFamily: F.black, letterSpacing: 0.5 }}>TEAM</Text>
          </View>
          {sec.entries.map((e, i) => (
            <Pressable key={`l-${e.team.id}-${i}`} onPress={() => router.push(`/team/${e.team.id}?sport=${sport}` as any)}
              style={{ height: ROW_H, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, gap: 6, backgroundColor: cardBg, borderTopWidth: 1, borderTopColor: border,
                ...(sec.cutAfter && i === sec.cutAfter - 1 ? { borderBottomWidth: 2, borderBottomColor: '#FFD700' } : {}) }}>
              <Text style={{ width: 18, color: sub, fontSize: 11, fontFamily: F.bold, textAlign: 'center' }}>{e.rank}</Text>
              {e.team.logo
                ? <Image source={{ uri: e.team.logo }} style={{ width: 22, height: 22 }} contentFit="contain" />
                : <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: `#${e.team.color}` }} />}
              <Text style={{ flex: 1, color: text, fontSize: 13, fontFamily: F.bold }} numberOfLines={1}>
                {e.team.shortDisplayName || e.team.abbreviation}
              </Text>
            </Pressable>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={{ height: HEADER_H, flexDirection: 'row', alignItems: 'center', backgroundColor: bg }}>
              {cols.map(c => headerCell(c.label, c.w))}
            </View>
            {sec.entries.map((e, i) => (
              <View key={`r-${e.team.id}-${i}`} style={{ height: ROW_H, flexDirection: 'row', alignItems: 'center', backgroundColor: cardBg, borderTopWidth: 1, borderTopColor: border,
                ...(sec.cutAfter && i === sec.cutAfter - 1 ? { borderBottomWidth: 2, borderBottomColor: '#FFD700' } : {}) }}>
                {cols.map(c => {
                  const v = String(c.get(e));
                  let color = text;
                  if (c.kind === 'diff') color = v.startsWith('+') ? '#34c759' : v.startsWith('-') ? '#ff3b30' : sub;
                  if (c.kind === 'streak') color = v.startsWith('W') ? '#34c759' : v.startsWith('L') ? '#ff3b30' : sub;
                  return (
                    <View key={c.key} style={{ width: c.w, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color, fontSize: 12, fontFamily: c.key === 'W' || c.key === 'PTS' ? F.bold : F.regular }}>{v}</Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );

  // Wide DIVISION view: two conference columns (e.g. AL left, NL right).
  const divisionColumns = (() => {
    const confs: string[] = [];
    for (const s of sections) {
      const c = (s as any).conference || '';
      if (!confs.includes(c)) confs.push(c);
    }
    return confs.map(c => ({ conf: c, secs: sections.filter(s => ((s as any).conference || '') === c) }));
  })();

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {/* View tabs — WILDCARD only for MLB (it's a baseball playoff concept). */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10 }}>
        {(['DIVISION', 'LEAGUE', ...(sport === 'mlb' ? ['WILDCARD'] as const : []), 'OVERALL'] as ViewTab[]).map(t => {
          const active = tab === t;
          return (
            <Pressable key={t} onPress={() => setTab(t)}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                backgroundColor: active ? accent : (dark ? '#1c1c1e' : '#f2f2f7'),
                borderWidth: 1, borderColor: active ? accent : border }}>
              <Text style={{ color: active ? '#fff' : sub, fontSize: 11, fontFamily: F.black, letterSpacing: 0.3 }}>{t}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Season + type dropdowns */}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
        <Pressable onPress={() => setYearOpen(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8,
            borderRadius: 10, backgroundColor: dark ? '#1c1c1e' : '#f2f2f7', borderWidth: 1, borderColor: border }}>
          <Text style={{ color: text, fontSize: 13, fontFamily: F.bold }}>{season}</Text>
          <Text style={{ color: sub, fontSize: 11 }}>▾</Text>
        </Pressable>
        <Pressable onPress={() => setTypeOpen(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8,
            borderRadius: 10, backgroundColor: dark ? '#1c1c1e' : '#f2f2f7', borderWidth: 1, borderColor: border }}>
          <Text style={{ color: text, fontSize: 13, fontFamily: F.bold }}>{seasontype === '1' ? preLabel : 'Regular Season'}</Text>
          <Text style={{ color: sub, fontSize: 11 }}>▾</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={accent} />
      ) : sections.length === 0 ? (
        <Text style={{ color: sub, textAlign: 'center', marginTop: 40, fontFamily: F.regular }}>No standings available.</Text>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: isWide ? 16 : 0 }}>
          {isWide && tab === 'DIVISION' && divisionColumns.length > 1 ? (
            // Desktop DIVISION: one conference per column (e.g. AL left, NL right),
            // centered as a whole so there's no dead space on the right.
            <View style={{ flexDirection: 'row', gap: 24, justifyContent: 'center', alignSelf: 'center', maxWidth: 1320 }}>
              {divisionColumns.map((col, ci) => (
                <View key={`col-${ci}`} style={{ width: 560, minWidth: 460, maxWidth: 620 }}>
                  {confHeader(col.conf)}
                  {col.secs.map((sec, si) => renderSection(sec, `c${ci}-s${si}`))}
                </View>
              ))}
            </View>
          ) : isWide && sections.length > 1 ? (
            // Desktop LEAGUE/other multi-section: wrapping grid, centered.
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24, justifyContent: 'center', alignSelf: 'center', maxWidth: 1320 }}>
              {sections.map((sec, si) => (
                <View key={`sec-${si}`} style={{ width: 560, minWidth: 480, maxWidth: 640 }}>{renderSection(sec, `s${si}`)}</View>
              ))}
            </View>
          ) : isWide ? (
            // Desktop single section (OVERALL): centered.
            <View style={{ alignSelf: 'center', width: 620, maxWidth: '100%' }}>
              {sections.map((sec, si) => renderSection(sec, `s${si}`))}
            </View>
          ) : tab === 'DIVISION' ? (
            // Mobile DIVISION: insert a conference title whenever the league
            // changes so each division is clearly grouped under its conference.
            <View>
              {sections.map((sec, si) => {
                const conf = (sec as any).conference || '';
                const prevConf = si > 0 ? ((sections[si - 1] as any).conference || '') : null;
                return (
                  <View key={`s${si}`}>
                    {conf && conf !== prevConf ? confHeader(conf) : null}
                    {renderSection(sec, `s${si}`)}
                  </View>
                );
              })}
            </View>
          ) : (
            // Mobile: single stacked column.
            <View>{sections.map((sec, si) => renderSection(sec, `s${si}`))}</View>
          )}
        </ScrollView>
      )}

      {/* Year picker */}
      <PickerModal visible={yearOpen} onClose={() => setYearOpen(false)} title="Season"
        options={Array.from({ length: 12 }, (_, i) => ({ key: String(currentYear - i), label: String(currentYear - i) }))}
        selected={String(season)} onSelect={(k) => { setSeason(Number(k)); setYearOpen(false); }}
        dark={dark} text={text} sub={sub} accent={accent} cardBg={cardBg} border={border} />

      {/* Season-type picker */}
      <PickerModal visible={typeOpen} onClose={() => setTypeOpen(false)} title="Season Type"
        options={[{ key: '2', label: 'Regular Season' }, { key: '1', label: preLabel }]}
        selected={seasontype} onSelect={(k) => { setSeasontype(k as '1' | '2'); setTypeOpen(false); }}
        dark={dark} text={text} sub={sub} accent={accent} cardBg={cardBg} border={border} />
    </View>
  );
}

function PickerModal({ visible, onClose, title, options, selected, onSelect, dark, text, sub, accent, cardBg, border }: {
  visible: boolean; onClose: () => void; title: string;
  options: { key: string; label: string }[]; selected: string; onSelect: (k: string) => void;
  dark: boolean; text: string; sub: string; accent: string; cardBg: string; border: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: cardBg, borderColor: border }]} onPress={() => {}}>
          <Text style={{ color: text, fontSize: 15, fontFamily: F.black, marginBottom: 8, paddingHorizontal: 4 }}>{title}</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {options.map(o => {
              const active = o.key === selected;
              return (
                <Pressable key={o.key} onPress={() => onSelect(o.key)}
                  style={{ paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8, backgroundColor: active ? accent + '22' : 'transparent' }}>
                  <Text style={{ color: active ? accent : text, fontSize: 15, fontFamily: active ? F.black : F.regular }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  sheet: { width: '100%', maxWidth: 320, borderRadius: 16, borderWidth: 1, padding: 14 },
});
