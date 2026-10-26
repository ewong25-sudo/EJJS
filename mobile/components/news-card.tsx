import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { F } from '@/constants/fonts';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NewsArticle } from '@/types/sports';

// ESPN league logo for the sport badge.
const LEAGUE_LOGO: Record<string, string> = {
  nba: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png',
  nfl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png',
  mlb: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png',
  nhl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png',
};

function ago(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

interface Props { article: NewsArticle; index: number; variant?: 'featured' | 'compact' | 'default'; }

function useCardPress() {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onIn = () => { scale.value = withSpring(0.97, { damping: 15 }); };
  const onOut = () => { scale.value = withSpring(1, { damping: 15 }); };
  return { style, onIn, onOut };
}

export function NewsCard({ article, index, variant = 'default' }: Props) {
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#1c1c1e' : '#fff';
  const border = dark ? '#2c2c2e' : '#efefef';
  const text = dark ? '#fff' : '#000';
  const sub = dark ? '#8e8e93' : '#6e6e73';
  const cfg = SPORT_CONFIG[article.sport];
  const sportColor = cfg?.color ?? '#888';
  const { style: pressStyle, onIn, onOut } = useCardPress();

  // Open the article in an in-app browser (SafariViewController / Chrome Custom
  // Tab) so the user reads/watches inside EJJS instead of leaving to Safari.
  function open() {
    if (article.url) WebBrowser.openBrowserAsync(article.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET, controlsColor: sportColor }).catch(() => {});
  }

  if (variant === 'featured') {
    return (
      <Animated.View entering={FadeInDown.delay(index * 60).duration(450).springify()} style={pressStyle}>
        <Pressable onPress={open} onPressIn={onIn} onPressOut={onOut}
          style={[styles.featured, { backgroundColor: bg, borderColor: border }, !dark && styles.shadow]}>
          {article.image
            ? <Image source={{ uri: article.image }} style={styles.featuredImg} contentFit="cover" transition={300} />
            : <View style={[styles.featuredImg, { backgroundColor: sportColor + '30' }]} />
          }
          <View style={styles.featuredBody}>
            <SportBadge color={sportColor} label={cfg?.label ?? article.sport.toUpperCase()} sport={article.sport} source={article.source} />
            <Text style={[styles.featuredHeadline, { color: text }]} numberOfLines={3}>{article.headline}</Text>
            <Text style={[styles.timeText, { color: sub }]}>{ago(article.published)}</Text>
          </View>
        </Pressable>
      </Animated.View>
    );
  }

  if (variant === 'compact') {
    return (
      <Animated.View entering={FadeInDown.delay(index * 50).duration(380).springify()} style={pressStyle}>
        <Pressable onPress={open} onPressIn={onIn} onPressOut={onOut}
          style={[styles.compact, { backgroundColor: bg, borderColor: border }]}>
          {article.image
            ? <Image source={{ uri: article.image }} style={styles.compactImg} contentFit="cover" transition={200} />
            : <View style={[styles.compactImg, { backgroundColor: sportColor + '30' }]} />
          }
          <View style={styles.compactBody}>
            <SportBadge color={sportColor} label={cfg?.label ?? article.sport.toUpperCase()} sport={article.sport} source={article.source} />
            <Text style={[styles.compactHeadline, { color: text }]} numberOfLines={2}>{article.headline}</Text>
            <Text style={[styles.timeText, { color: sub }]}>{ago(article.published)}</Text>
          </View>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.delay(index * 55).duration(400).springify()} style={pressStyle}>
      <Pressable onPress={open} onPressIn={onIn} onPressOut={onOut}
        style={[styles.card, { backgroundColor: bg, borderColor: border }, !dark && styles.shadow]}>
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <SportBadge color={sportColor} label={cfg?.label ?? article.sport.toUpperCase()} sport={article.sport} source={article.source} />
            <Text style={[styles.timeText, { color: sub }]}>{ago(article.published)}</Text>
          </View>
          <Text style={[styles.headline, { color: text }]} numberOfLines={3}>{article.headline}</Text>
          {article.description
            ? <Text style={[styles.desc, { color: sub }]} numberOfLines={2}>{article.description}</Text>
            : null
          }
        </View>
        {article.image
          ? <Image source={{ uri: article.image }} style={styles.thumb} contentFit="cover" transition={200} />
          : null
        }
      </Pressable>
    </Animated.View>
  );
}

function SportBadge({ color, label, sport, source }: { color: string; label: string; sport: string; source?: string }) {
  const logo = LEAGUE_LOGO[sport];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
      <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '55', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
        {logo ? <Image source={{ uri: logo }} style={{ width: 13, height: 13 }} contentFit="contain" /> : null}
        <Text style={[styles.badgeText, { color }]}>{label}</Text>
      </View>
      {source ? <Text style={{ fontSize: 9, fontFamily: F.bold, color: color, opacity: 0.85, letterSpacing: 0.3 }}>{source.toUpperCase()}</Text> : null}
    </View>
  );
}

// Web cards live in a grid that supplies its own padding, so we zero out
// the per-card horizontal margins on web only. On phone they keep the
// 16pt margin so cards inset nicely from the screen edge.
const M_H = Platform.OS === 'web' ? 0 : 16;

const styles = StyleSheet.create({
  shadow: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  // Web: force a min-height on each card so 2-line and 3-line headlines
  // produce identical-height cards in the grid (otherwise the row gets
  // staggered tops/bottoms). Phone keeps the natural-content height.
  featured: Platform.OS === 'web'
    ? ({ borderRadius: 20, borderWidth: 1, marginHorizontal: M_H, marginVertical: 7, overflow: 'hidden', height: 420 } as any)
    : { borderRadius: 20, borderWidth: 1, marginHorizontal: M_H, marginVertical: 7, overflow: 'hidden' },
  featuredImg: { width: '100%', height: 220 },
  // `height: 200` on web = (420 card) − (220 image). All cards same body
  // height, so headlines just truncate at numberOfLines={3} consistently.
  featuredBody: Platform.OS === 'web'
    ? ({ padding: 16, gap: 9, height: 200 } as any)
    : { padding: 16, gap: 9 },
  featuredHeadline: { fontSize: 19, fontFamily: F.bold, lineHeight: 26 },
  compact: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, marginHorizontal: M_H, marginVertical: 5, overflow: 'hidden', height: 96 },
  compactImg: { width: 110, height: '100%' },
  compactBody: { flex: 1, padding: 11, gap: 5, justifyContent: 'center' },
  compactHeadline: { fontSize: 13, fontFamily: F.bold, lineHeight: 18 },
  card: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, marginHorizontal: M_H, marginVertical: 5, padding: 13, gap: 11 },
  cardBody: { flex: 1, gap: 7 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headline: { fontSize: 14, fontFamily: F.bold, lineHeight: 20 },
  desc: { fontSize: 12, fontFamily: F.regular, lineHeight: 17 },
  thumb: { width: 76, height: 76, borderRadius: 10 },
  badge: { borderRadius: 4, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10, fontFamily: F.black, letterSpacing: 0.8 },
  timeText: { fontSize: 11, fontFamily: F.regular },
});
