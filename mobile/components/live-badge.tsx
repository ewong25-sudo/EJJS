import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { F } from '@/constants/fonts';

export function LiveBadge({ small = false }: { small?: boolean }) {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0.15, { duration: 500 }), withTiming(1, { duration: 500 })),
      -1
    );
    scale.value = withRepeat(
      withSequence(withSpring(1.25, { damping: 4 }), withTiming(1, { duration: 400 })),
      -1
    );
  }, []);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={[styles.badge, small && styles.small]}>
      <Animated.View style={[styles.dot, small && styles.dotSmall, dotStyle]} />
      {!small && <Text style={styles.text}>LIVE</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FF3B3020',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#FF3B3070',
  },
  small: { paddingHorizontal: 5, paddingVertical: 3, borderRadius: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  dotSmall: { width: 5, height: 5 },
  text: { fontSize: 11, fontFamily: F.black, color: '#FF3B30', letterSpacing: 1.2 },
});
