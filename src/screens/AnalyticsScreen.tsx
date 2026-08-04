import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenBackground from '../components/ScreenBackground';
import AppHeader from '../components/AppHeader';
import ProfileSummary from '../components/ProfileSummary';
import MetricCard from '../components/MetricCard';
import { mockMetrics, mockProfile } from '../data/mockData';
import { Metric } from '../data/types';
import { colors, font, spacing } from '../theme';

// Group metrics into rows of two for the 2-column grid.
function rows<T>(items: T[], perRow = 2): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) out.push(items.slice(i, i + perRow));
  return out;
}

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const grid = rows<Metric>(mockMetrics);

  return (
    <ScreenBackground>
      <View style={{ paddingTop: insets.top }}>
        <AppHeader title={mockProfile.username} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        showsVerticalScrollIndicator={false}
      >
        <ProfileSummary profile={mockProfile} />

        {grid.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((m) => (
              <MetricCard key={m.key} metric={m} />
            ))}
            {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        ))}

        <Text style={styles.footnote}>
          Showing only metrics Instagram's official API provides. Counts marked over
          time are tracked locally from daily snapshots.
        </Text>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  footnote: {
    color: colors.textFaint,
    fontSize: font.small,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 16,
    paddingHorizontal: spacing.lg,
  },
});
