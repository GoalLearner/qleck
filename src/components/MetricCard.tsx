import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Metric } from '../data/types';
import { colors, font, radius, spacing } from '../theme';

/** A single dashboard tile: big number + label, with an optional ▲/▼ delta. */
export default function MetricCard({ metric }: { metric: Metric }) {
  const { value, unit, label, delta, trend } = metric;
  const deltaColor = trend === 'down' ? colors.down : colors.up;
  const arrow = trend === 'down' ? '▼' : '▲';

  return (
    <View style={styles.card}>
      <View style={styles.valueRow}>
        <Text style={styles.value}>
          {value}
          {unit ? <Text style={styles.unit}>{unit}</Text> : null}
        </Text>
        {delta != null && trend ? (
          <Text style={[styles.delta, { color: deltaColor }]}>
            {arrow} {delta}
          </Text>
        ) : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 96,
    justifyContent: 'center',
  },
  valueRow: { flexDirection: 'row', alignItems: 'flex-start' },
  value: { color: colors.text, fontSize: font.metric, fontWeight: '800' },
  unit: { fontSize: font.body, fontWeight: '700' },
  delta: { fontSize: font.small, fontWeight: '700', marginLeft: 6, marginTop: 4 },
  label: { color: colors.textMuted, fontSize: font.label, marginTop: 6 },
});
