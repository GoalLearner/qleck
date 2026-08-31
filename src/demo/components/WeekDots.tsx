import React from 'react';
import { Text, View } from 'react-native';
import { Challenge } from '../types';
import { colors, fonts } from '../../theme';

const DAY_LETTERS = 'MTWTFSS';

// Mon–Sun check-in dots. Today (index 6 in the mock week) gets the card
// background when unchecked, matching the design.
export default function WeekDots({ challenge, size = 30, gap = 7 }: { challenge: Challenge; size?: number; gap?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap }}>
      {challenge.week.map((v, i) => (
        <View
          key={i}
          style={{
            width: size, height: size, borderRadius: size / 2,
            backgroundColor: v ? colors.successDot : i === 6 ? colors.card : colors.dotIdle,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: size > 30 ? 10.5 : 10, fontFamily: fonts.extrabold, color: v ? colors.successFg : colors.dotIdleFg }}>
            {DAY_LETTERS[i]}
          </Text>
        </View>
      ))}
    </View>
  );
}
