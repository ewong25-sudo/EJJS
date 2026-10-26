import { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';

interface Props {
  /** Optional maxWidth override; defaults to 1180 (good for ~6-col grids). */
  maxWidth?: number;
  /** Extra style merged onto the inner container. */
  style?: ViewStyle | ViewStyle[];
}

/**
 * <WebContainer> centers and constrains its children on WEB only.
 *
 * On native (iOS/Android) it's a no-op pass-through so phone layouts are
 * untouched. On web, it caps the content at `maxWidth` and centers it in
 * the viewport so a 27" monitor doesn't stretch UI components edge-to-edge.
 *
 * Use it inside a tab's <ScrollView contentContainerStyle={...}> as the
 * direct child, or wrap a screen's root view with it.
 */
export function WebContainer({ children, maxWidth = 1180, style }: PropsWithChildren<Props>) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={styles.outer}>
      <View style={[styles.inner, { maxWidth }, style]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    paddingHorizontal: 16,
  },
});
