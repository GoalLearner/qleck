import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ScreenBackground from '../components/ScreenBackground';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  onClose: () => void;
}

const PERKS = [
  'Unlimited access to all account analytics and insights',
  'See your most engaging followers and content',
  'Track multiple accounts and switch with a single tap',
  'Watch and repost stories and videos easily',
  'Repost photos and videos with captions and hashtags',
  'Protect your privacy',
  'Remove all ads and limits',
];

const PLANS = [
  { id: 'weekly', title: 'WEEKLY', price: '$3.99', note: '', badge: 'POPULAR' },
  { id: 'monthly', title: 'MONTHLY', price: '$8.99', note: '', badge: 'SAVE 44%' },
  { id: 'yearly', title: 'YEARLY', price: '$29.99', note: '$2.49 / month', badge: 'SAVE 84%' },
];

export default function PaywallScreen({ onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState('weekly');

  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.close} onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={26} color={colors.textMuted} />
        </Pressable>

        <Ionicons name="diamond" size={48} color={colors.accent} style={styles.crown} />
        <Text style={styles.title}>Premium Unlimited</Text>

        <View style={styles.perks}>
          {PERKS.map((p) => (
            <View key={p} style={styles.perkRow}>
              <Ionicons name="checkmark" size={18} color={colors.accent} />
              <Text style={styles.perkText}>{p}</Text>
            </View>
          ))}
        </View>

        <View style={styles.plans}>
          {PLANS.map((plan) => {
            const active = plan.id === selected;
            return (
              <Pressable
                key={plan.id}
                onPress={() => setSelected(plan.id)}
                style={[styles.plan, active && styles.planActive]}
              >
                <View style={[styles.radio, active && styles.radioActive]} />
                <View style={styles.planTextWrap}>
                  <Text style={styles.planTitle}>
                    {plan.title}: {plan.price}
                  </Text>
                  {plan.note ? <Text style={styles.planNote}>{plan.note}</Text> : null}
                </View>
                {plan.badge ? (
                  <View style={[styles.badge, active && styles.badgeActive]}>
                    <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{plan.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.cta}>
          <Text style={styles.ctaText}>GET PREMIUM</Text>
        </Pressable>
        <Text style={styles.commit}>No commitment. Cancel anytime.</Text>
        <Text style={styles.restore}>Restore Purchases</Text>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl },
  close: { alignSelf: 'flex-start', padding: spacing.xs },
  crown: { alignSelf: 'center', marginTop: spacing.sm },
  title: {
    color: colors.text,
    fontSize: font.hero,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  perks: { gap: spacing.md, marginBottom: spacing.xl },
  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  perkText: { flex: 1, color: colors.text, fontSize: font.body, lineHeight: 21 },
  plans: { gap: spacing.md, marginBottom: spacing.xl },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  planActive: { borderColor: colors.accent },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textFaint,
  },
  radioActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  planTextWrap: { flex: 1 },
  planTitle: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  planNote: { color: colors.textMuted, fontSize: font.label, marginTop: 2 },
  badge: {
    backgroundColor: colors.pill,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeActive: { backgroundColor: colors.accent },
  badgeText: { color: colors.textMuted, fontSize: font.small, fontWeight: '800' },
  badgeTextActive: { color: colors.bgBottom },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg + 2,
    alignItems: 'center',
  },
  ctaText: { color: colors.bgBottom, fontSize: font.title, fontWeight: '800' },
  commit: { color: colors.text, fontSize: font.label, textAlign: 'center', marginTop: spacing.md },
  restore: { color: colors.accent, fontSize: font.label, textAlign: 'center', marginTop: spacing.md },
});
