import axios from 'axios';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { NewsCard } from '@/components/news-card';
import { F } from '@/constants/fonts';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NewsArticle, SportKey } from '@/types/sports';

import { API } from '@/constants/api';
type Filter = 'ALL' | SportKey;

export default function TrendingScreen() {
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#000' : '#f2f2f7';
  const sub = dark ? '#8e8e93' : '#6e6e73';
  const chipBg = dark ? '#1c1c1e' : '#fff';
  const chipBorder = dark ? '#2c2c2e' : '#e5e5e5';

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get<{ articles: NewsArticle[] }>(`${API}/sports/all/news`)
      .then(r => setArticles(r.data.articles || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'ALL' ? articles : articles.filter(a => a.sport === filter);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <LinearGradient colors={['#8B1A1A', '#cc3300', '#ff6b35']} style={styles.header}>
        <Animated.View entering={FadeInUp.duration(500).springify()}>
          <View style={styles.headerRow}>
            <MaterialIcons name="whatshot" size={34} color="#fff" />
            <Text style={styles.title}>TRENDING</Text>
          </View>
          <Text style={styles.subtitle}>What's hot across all sports</Text>
        </Animated.View>
      </LinearGradient>

      {/* FILTER CHIPS */}
      <Animated.View entering={FadeInDown.delay(100).duration(400).springify()}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          style={[styles.filterBar, { borderBottomColor: chipBorder }]}
        >
          {(['ALL', 'nba', 'nfl', 'mlb', 'nhl'] as Filter[]).map(f => {
            const active = filter === f;
            const color = f === 'ALL' ? '#cc3300' : SPORT_CONFIG[f as SportKey].color;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.chip, { backgroundColor: active ? color : chipBg, borderColor: active ? color : chipBorder }]}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : sub }]}>
                  {f === 'ALL' ? 'ALL' : SPORT_CONFIG[f as SportKey].label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color="#cc3300" />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: sub }]}>No stories found</Text>
            </View>
          ) : (
            filtered.map((a, i) => (
              <NewsCard key={a.id} article={a} index={i} variant={i === 0 ? 'featured' : 'default'} />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingTop: 16, paddingBottom: 22, paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 36, fontFamily: F.black, color: '#fff', letterSpacing: 2 },
  subtitle: { fontSize: 12, fontFamily: F.regular, color: 'rgba(255,255,255,0.7)', marginTop: 4, letterSpacing: 0.5 },
  filterBar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  filterRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  chipText: { fontSize: 12, fontFamily: F.black, letterSpacing: 1 },
  list: { paddingTop: 8, paddingBottom: 32 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 15, fontFamily: F.regular },
});
