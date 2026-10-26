import Svg, { Path } from 'react-native-svg';
import { View } from 'react-native';

interface Props {
  size?: number;
  color?: string;
}

// Small flame graphic — replaces the big "HOT" pill next to section headers.
// Uses pure SVG so it works cross-platform without any text emoji.
export function TrendingIcon({ size = 18, color = '#ff6b35' }: Props) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        {/* Stylized flame */}
        <Path
          d="M12.5 1.5c.3 0 .5.2.5.5 0 2.1 1.4 3.7 2.6 5.1 1.4 1.5 2.4 2.9 2.4 4.9 0 4.4-3.4 7.5-7.5 7.5S3 16.4 3 12c0-2 1-3.4 2.4-4.9C6.6 5.7 8 4.1 8 2c0-.3.2-.5.5-.5s.5.2.5.5c0 1.4-.5 2.6-1.1 3.6.4-.3.8-.5 1.3-.7.7-.2 1.4-.2 2 0 .5.1 1 .4 1.4.7.5.4.8.9 1 1.5.1.4.2.7.2 1 .1-.5.3-1 .5-1.5.3-.6.6-1.2 1-1.8.3-.6.6-1.3.6-2 0-.3.2-.5.5-.5z"
        />
      </Svg>
    </View>
  );
}
