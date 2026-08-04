import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ScreenBackground from '../components/ScreenBackground';
import AppHeader from '../components/AppHeader';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  onOpenPaywall: () => void;
}

export default function SettingsScreen({ onOpenPaywall }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <ScreenBackground>
      <View style={{ paddingTop: insets.top }}>
        <AppHeader title="Settings" />
      </View>
      <View style={styles.body}>
        <Pressable style={styles.premium} onPress={onOpenPaywall}>
          <Ionicons name="diamond-outline" size={20} color={colors.bgBottom} />
          <Text style={styles.premiumText}>Go Premium</Text>
        </Pressable>

        <Row icon="logo-instagram" label="Connect Instagram account" />
        <Row icon="sync-outline" label="Refresh data" />
        <Row icon="notifications-outline" label="Notifications" />
        <Row icon="shield-checkmark-outline" label="Privacy" />
        <Row icon="information-circle-outline" label="About" />
      </View>
    </ScreenBackground>
  );
}

function Row({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <Pressable style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  premium: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  premiumText: { color: colors.bgBottom, fontSize: font.body, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.card,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  rowLabel: { flex: 1, color: colors.text, fontSize: font.body },
});
