import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ScreenBackground from './ScreenBackground';
import AppHeader from './AppHeader';
import { colors, font, spacing } from '../theme';

interface Props {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  blurb: string;
}

/** Simple "coming soon" body reused by tabs not yet built out. */
export default function Placeholder({ title, icon, blurb }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <ScreenBackground>
      <View style={{ paddingTop: insets.top }}>
        <AppHeader title={title} />
      </View>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={40} color={colors.accent} />
        </View>
        <Text style={styles.heading}>{title}</Text>
        <Text style={styles.blurb}>{blurb}</Text>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heading: { color: colors.text, fontSize: font.title, fontWeight: '700', marginBottom: spacing.sm },
  blurb: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', lineHeight: 21 },
});
