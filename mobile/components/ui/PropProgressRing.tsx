import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { F } from '@/constants/fonts';
import { BetLeg } from '@/hooks/use-bets';

const SIZE = 52;
const SW = 4.5;
const R = (SIZE - SW) / 2;
const C = 2 * Math.PI * R;
const CX = SIZE / 2;
const CY = SIZE / 2;

function arcColor(leg: BetLeg): string {
  if (leg.status === 'lost' || leg.status === 'losing') return '#FF3B30';
  if (leg.status === 'push') return '#FF9F0A';
  return '#34C759';
}

function calcTargetProgress(leg: BetLeg): number {
  if (leg.status === 'won') return 1;
  if (leg.status === 'push') return 0.5;

  if (leg.type === 'prop' && leg.statLine && leg.statLine > 0) {
    const curr = leg.currentStatValue ?? 0;
    return Math.max(0, Math.min(1, curr / leg.statLine));
  }

  return 0;
}

export function PropProgressRing({ leg }: { leg: BetLeg }) {
  const color = arcColor(leg);
  const target = calcTargetProgress(leg);

  const animVal = useRef(new Animated.Value(target)).current;
  const [strokeDashoffset, setStrokeDashoffset] = useState(C * (1 - target));

  useEffect(() => {
    const listener = animVal.addListener(({ value }) => {
      setStrokeDashoffset(C * (1 - value));
    });
    Animated.timing(animVal, {
      toValue: target,
      duration: 700,
      useNativeDriver: false,
    }).start();
    return () => animVal.removeListener(listener);
  }, [target]);

  const headshotUrl =
    leg.type === 'prop' && leg.athleteId && leg.sport
      ? `https://a.espncdn.com/i/headshots/${leg.sport}/players/full/${leg.athleteId}.png`
      : null;

  // For moneyline/spread bets, use team logo if available
  const centerImageUrl = headshotUrl ?? (
    (leg.type === 'moneyline' || leg.type === 'spread') && leg.teamLogoUrl
      ? leg.teamLogoUrl
      : null
  );

  // Status icons take priority; otherwise show "O" for over / "U" for under
  // (game total bets) so the user immediately sees which side they took.
  const symbol =
    leg.status === 'won' ? '✓' :
    leg.status === 'lost' ? '✗' :
    leg.status === 'push' ? '↔' :
    leg.type === 'over'  ? 'O' :
    leg.type === 'under' ? 'U' :
    '·';

  const progressPct = leg.type === 'prop' && leg.statLine && leg.statLine > 0
    ? Math.round((leg.currentStatValue ?? 0) / leg.statLine * 100)
    : null;

  return (
    <View style={{ width: SIZE, alignItems: 'center', marginRight: 10 }}>
      <View style={{ width: SIZE, height: SIZE }}>
        {/* SVG ring — track + fill arc */}
        <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
          {/* Dark track */}
          <Circle
            cx={CX} cy={CY} r={R}
            stroke="#333"
            strokeWidth={SW}
            fill="none"
          />
          {/* Animated fill arc, starts at 12 o'clock */}
          <Circle
            cx={CX} cy={CY} r={R}
            stroke={color}
            strokeWidth={SW}
            fill="none"
            strokeDasharray={C}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        </Svg>

        {/* Center: image or status symbol */}
        <View style={{
          position: 'absolute',
          top: SW + 2, left: SW + 2, right: SW + 2, bottom: SW + 2,
          borderRadius: 100,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {centerImageUrl ? (
            <Image
              source={{ uri: centerImageUrl }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : (
            <View style={{
              flex: 1, width: '100%',
              backgroundColor: color + '20',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{
                color,
                fontSize: (symbol === 'O' || symbol === 'U') ? 20 : 12,
                fontFamily: F.black,
                letterSpacing: 0.5,
              }}>{symbol}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Progress % below ring for prop bets */}
      {progressPct !== null && (
        <Text style={{ color: '#8e8e93', fontSize: 9, fontFamily: F.regular, marginTop: 2, textAlign: 'center' }}>
          {progressPct}%
        </Text>
      )}
    </View>
  );
}
