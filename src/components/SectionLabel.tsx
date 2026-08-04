import React from 'react';
import { Text, TextStyle } from 'react-native';
import { colors, fonts } from '../theme';

export default function SectionLabel({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return (
    <Text
      style={[{
        paddingTop: 22, paddingHorizontal: 20, paddingBottom: 10,
        fontSize: 11, fontFamily: fonts.extrabold, letterSpacing: 1.4, color: colors.sectionLabel,
      }, style]}
    >
      {children}
    </Text>
  );
}
