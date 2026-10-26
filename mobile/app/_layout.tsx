import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Oswald_400Regular, Oswald_600SemiBold, Oswald_700Bold, useFonts } from '@expo-google-fonts/oswald';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerForPushNotifications } from '@/lib/notifications';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const [fontsLoaded] = useFonts({ Oswald_400Regular, Oswald_600SemiBold, Oswald_700Bold });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Register for push notifications (game start, finals, trades) once on launch.
  useEffect(() => {
    registerForPushNotifications();
    // When the user taps a notification, deep-link to the relevant game/screen.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data: any = resp.notification.request.content.data || {};
      try {
        if (data.eventId && data.sport) {
          router.push({ pathname: '/game/[id]', params: { id: String(data.eventId), sport: String(data.sport) } } as any);
        } else if (data.type === 'news' && data.sport) {
          router.push(`/${data.sport}` as any);
        }
      } catch {}
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return null;

  const isDark = colorScheme === 'dark';

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="game/[id]" options={{ title: 'Box Score', headerBackTitle: '', headerBackButtonDisplayMode: 'minimal' }} />
        <Stack.Screen name="team/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="player/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
