// Cream-palette renderers for the Qoach protocol, shared by the Today and
// Goals tabs. (The Qoach *conversation* stays Electric Night — the coach is
// its own sub-brand; once a plan is locked it lives in the app's cream world.)
import React from 'react';
import { Text, View } from 'react-native';
import type { Protocol, ProtocolStep } from '../api/coachTypes';
import { CATS, colors, fonts, radii } from '../theme';

/**
 * The goal as a label, not a sentence (owner call 2026-08-24: "just the goal
 * name, not all the extra stuff"). Full statements stay on the Goals tab;
 * lists get this: parentheticals, method clauses ("using…", "by…") and
 * from/to detail dropped, "over the next N weeks" tightened to "in N weeks".
 *   "Quit smoking (currently half a pack a day) using a structured taper"
 *     → "Quit smoking"
 *   "Lose 10 lbs (about 4.5 kg) over the next 12 weeks"
 *     → "Lose 10 lbs in 12 weeks"
 */
export function shortGoalName(statement: string): string {
  let s = statement.replace(/\s*\([^)]*\)/g, '');
  s = s.split(/\s+(?:using|with|via|through|by)\s+/i)[0];
  s = s.split(/\s+from\s+/i)[0];
  s = s.replace(/\s+over the next\s+/i, ' in ');
  s = s.replace(/,\s.*$/, '');
  return s.trim() || statement;
}

export function kindLook(kind: ProtocolStep['kind']) {
  if (kind === 'duration') return { glyph: 'D', bg: colors.openBg, fg: colors.accentLink };
  if (kind === 'quantity') return { glyph: '#', bg: CATS.lav.bg, fg: CATS.lav.fg };
  return { glyph: '✓', bg: CATS.mint.bg, fg: CATS.mint.fg };
}

export function stepMetric(step: ProtocolStep): string {
  const freq = `×${step.frequency.per_week}/wk`;
  if (step.kind === 'duration' && step.duration_minutes) return `${step.duration_minutes} min ${freq}`;
  if (step.kind === 'quantity' && step.quantity) return `${step.quantity.amount} ${step.quantity.unit} ${freq}`;
  return freq;
}

export function StepRow({ step, last, showDetails = true }: { step: ProtocolStep; last: boolean; showDetails?: boolean }) {
  const look = kindLook(step.kind);
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline,
      }}
    >
      <View
        style={{
          width: 30, height: 30, borderRadius: 10, backgroundColor: look.bg,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: look.fg }}>{look.glyph}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.ink }}>{step.title}</Text>
        {showDetails && !!step.details && (
          <Text numberOfLines={2} style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 }}>
            {step.details}
          </Text>
        )}
      </View>
      <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: look.fg }}>{stepMetric(step)}</Text>
    </View>
  );
}

export function GoalHero({ protocol }: { protocol: Protocol }) {
  return (
    <View style={{ marginTop: 16, marginHorizontal: 14, backgroundColor: colors.navy, borderRadius: 28, padding: 20 }}>
      <Text style={{ fontSize: 10.5, fontFamily: fonts.extrabold, letterSpacing: 1.4, color: 'rgba(245,242,234,0.5)' }}>
        YOUR GOAL
      </Text>
      <Text style={{ fontFamily: fonts.serif, fontSize: 21, lineHeight: 27, color: colors.creamText, marginTop: 8 }}>
        {protocol.goal_statement}
      </Text>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: 'rgba(245,242,234,0.65)', marginTop: 10 }}>
        {protocol.duration_weeks} weeks · {protocol.phases.length} phases · built with Qoach
      </Text>
    </View>
  );
}

export function CreamCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: 14, backgroundColor: colors.card, borderRadius: radii.card,
        borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 4,
        shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
      }}
    >
      {children}
    </View>
  );
}

export function MilestoneStrip({ week, title }: { week: number; title: string }) {
  return (
    <View
      style={{
        marginTop: 12, marginHorizontal: 14, backgroundColor: colors.inviteBg,
        borderWidth: 1, borderColor: colors.inviteBorder, borderRadius: radii.row,
        paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 10,
      }}
    >
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: colors.inviteAccent }}>⚑</Text>
      <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inviteAccent }}>
        Week {week} — {title}
      </Text>
    </View>
  );
}
