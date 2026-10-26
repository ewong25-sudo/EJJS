import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { F } from '@/constants/fonts';

interface Props {
  uri?: string | null;
  name?: string;
  size: number;
  dark: boolean;
  accent?: string;
  ringColor?: string;
  contentFit?: 'cover' | 'contain';
}

// A player headshot that ALWAYS renders something — if the image is missing or
// fails to load (ESPN has no photo for that player), it falls back to the
// player's initials in a colored circle instead of showing a blank.
export function PlayerHeadshot({ uri, name, size, dark, accent, ringColor, contentFit = 'cover' }: Props) {
  const [errored, setErrored] = useState(false);
  const initials = name ? name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() : '';
  const ringStyle = ringColor ? { borderWidth: 2, borderColor: ringColor } : {};

  if (!uri || errored) {
    return (
      <View style={[{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: dark ? '#2c2c2e' : '#e5e5ea',
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }, ringStyle]}>
        <Text style={{ color: accent || (dark ? '#9aa0a6' : '#6e6e73'), fontSize: Math.max(9, size * 0.36), fontFamily: F.black }}>
          {initials || '—'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: dark ? '#2c2c2e' : '#e5e5ea' }, ringStyle]}>
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        contentFit={contentFit}
        cachePolicy="memory-disk"
        recyclingKey={uri}
        transition={0}
        onError={() => setErrored(true)}
      />
    </View>
  );
}
