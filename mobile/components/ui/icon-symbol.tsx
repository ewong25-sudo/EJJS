// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialIcons>['name']>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'flame.fill': 'whatshot',
  'sportscourt.fill': 'sports-basketball',
  'football.fill': 'sports-football',
  'baseball.fill': 'sports-baseball',
  'hockey.puck.fill': 'sports-hockey',
  'newspaper.fill': 'newspaper',
  'list.number': 'format-list-numbered',
  'person.fill': 'person',
  'person.crop.circle.fill': 'account-circle',
  'star.fill': 'star',
  'star': 'star-outline',
  'gearshape.fill': 'settings',
  'bell.fill': 'notifications',
  'chevron.down': 'expand-more',
  'camera.fill': 'camera-alt',
  'trophy.fill': 'emoji-events',
  'ticket.fill': 'confirmation-number',
  'magnifyingglass': 'search',
  'figure.run': 'directions-run',
  'checkmark': 'check',
  'xmark': 'close',
  'checkmark.circle.fill': 'check-circle',
  'xmark.circle.fill': 'cancel',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
