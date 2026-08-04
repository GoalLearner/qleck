import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import { Friend } from '../data/types';
import { fonts } from '../theme';

interface Props {
  friend: Pick<Friend, 'i' | 'c' | 'd'>;
  size?: number;
  fontSize?: number;
  ringColor?: string; // border used when overlapping in a stack
  ringWidth?: number;
  style?: ViewStyle;
}

export default function Avatar({ friend, size = 42, fontSize = 14, ringColor, ringWidth = 2, style }: Props) {
  return (
    <View
      style={[{
        width: size, height: size, borderRadius: size / 2, backgroundColor: friend.c,
        alignItems: 'center', justifyContent: 'center',
        ...(ringColor ? { borderColor: ringColor, borderWidth: ringWidth } : null),
      }, style]}
    >
      <Text style={{ color: friend.d, fontSize, fontFamily: fonts.extrabold }}>{friend.i}</Text>
    </View>
  );
}
