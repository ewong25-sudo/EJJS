import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SPORT_CONFIG } from '@/constants/sport-config';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const dark = useColorScheme() === 'dark';
  const isWeb = Platform.OS === 'web';
  const inactive = dark ? '#9aa0a6' : '#6e6e73';
  const tabBg = dark ? (isWeb ? '#0a0a0a' : '#1c1c1e') : '#ffffff';
  const tabBorder = dark ? '#1c1c1e' : '#e5e5ea';

  // On web we move the tab bar to the TOP and style it like a real desktop
  // app navigation bar (taller, padded, bottom border) instead of leaving
  // it as a phone-style bottom bar floating on a 1920px screen.
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarInactiveTintColor: inactive,
        tabBarPosition: isWeb ? 'top' : 'bottom',
        // Web: bigger, lighter, top-aligned nav bar with a divider underneath.
        // Native: leave the platform default bottom bar alone.
        tabBarStyle: isWeb
          ? {
              backgroundColor: tabBg,
              borderBottomWidth: 1,
              borderBottomColor: tabBorder,
              borderTopWidth: 0,
              height: 64,
              paddingTop: 6,
              paddingBottom: 6,
              elevation: 0,
              shadowOpacity: 0,
            }
          : { backgroundColor: tabBg },
        // Smaller labels + no font scaling so all 8 tabs fit without the
        // "Ho…" / "Fan…" truncation. Tightened horizontal padding gives each
        // label room to render in full. On native we also clamp to a single
        // line and shrink the font so "Fantasy" renders whole on narrow phones.
        tabBarAllowFontScaling: false,
        tabBarLabelStyle: isWeb
          ? { fontSize: 11, fontWeight: '600', marginTop: 2 }
          : { fontSize: 9, marginTop: 1 },
        tabBarItemStyle: isWeb
          ? { paddingHorizontal: 2, maxWidth: 140 }
          : { paddingHorizontal: 0 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarActiveTintColor: '#0f3460', tabBarIcon: ({ color }) => <IconSymbol name="house.fill" size={isWeb ? 20 : 22} color={color} /> }} />
      <Tabs.Screen name="fantasy" options={{ title: 'Fantasy', tabBarActiveTintColor: '#6001D2', tabBarIcon: ({ color }) => <IconSymbol name="trophy.fill" size={isWeb ? 20 : 22} color={color} /> }} />
      <Tabs.Screen name="bets" options={{ title: 'Bets', tabBarActiveTintColor: '#FFD700', tabBarIcon: ({ color }) => <IconSymbol name="ticket.fill" size={isWeb ? 20 : 22} color={color} /> }} />
      <Tabs.Screen name="nba" options={{ title: 'NBA', tabBarActiveTintColor: SPORT_CONFIG.nba.color, tabBarIcon: ({ color }) => <IconSymbol name="sportscourt.fill" size={isWeb ? 20 : 22} color={color} /> }} />
      <Tabs.Screen name="nfl" options={{ title: 'NFL', tabBarActiveTintColor: SPORT_CONFIG.nfl.color, tabBarIcon: ({ color }) => <IconSymbol name="football.fill" size={isWeb ? 20 : 22} color={color} /> }} />
      <Tabs.Screen name="mlb" options={{ title: 'MLB', tabBarActiveTintColor: SPORT_CONFIG.mlb.color, tabBarIcon: ({ color }) => <IconSymbol name="baseball.fill" size={isWeb ? 20 : 22} color={color} /> }} />
      <Tabs.Screen name="nhl" options={{ title: 'NHL', tabBarActiveTintColor: SPORT_CONFIG.nhl.color, tabBarIcon: ({ color }) => <IconSymbol name="hockey.puck.fill" size={isWeb ? 20 : 22} color={color} /> }} />
      <Tabs.Screen name="trending" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarActiveTintColor: '#FF3B30', tabBarIcon: ({ color }) => <IconSymbol name="person.crop.circle.fill" size={isWeb ? 20 : 22} color={color} /> }} />
    </Tabs>
  );
}
