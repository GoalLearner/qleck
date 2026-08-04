import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme';

interface Props {
  size: number; // outer svg size
  radius: number;
  strokeWidth: number;
  progress: number; // 0..1
  color?: string;
  children?: React.ReactNode; // centered content
}

export default function ProgressRing({ size, radius, strokeWidth, progress, color = colors.accent, children }: Props) {
  const c = size / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(progress, 0), 1));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={c} cy={c} r={radius} fill="none" stroke={colors.ringTrack} strokeWidth={strokeWidth} />
        <Circle
          cx={c} cy={c} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
        />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </View>
    </View>
  );
}
