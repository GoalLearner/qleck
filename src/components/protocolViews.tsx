// Renderers for a locked Qoach protocol, shared by the Today and Goals tabs.
// Everything reads live palette tokens so the appearance switch reaches them
// (see src/state/ThemeContext.tsx) — never capture a color in a module const.
import React from 'react';
import { Text, View } from 'react-native';
import type { Protocol, ProtocolStep } from '../api/coachTypes';
import { colors, fonts, radii } from '../theme';

// One dot color per goal, by position — Today's groups and the Goals shelf
// must agree on which goal is which color. Lives on the palette so each mode
// gets dots that read against its own background.
export const goalDot = (i: number): string => colors.goalDots[i % colors.goalDots.length];

/**
 * The goal as a title: goal + measurable target + duration, nothing else.
 *
 * Prefers the coach's own `short_title` (prompt v12+) — only the coach knows
 * which words are the goal and which are method, and deriving that from prose
 * was a losing game of pattern-matching (each new phrasing shape (an em-dash
 * aside, "in manageable stages") slipped through untouched). The derivation
 * below stays as the fallback for goals locked before v12.
 *   "Cut doomscrolling from ~4+ hrs/day down to under 1 hour/day, through
 *    deliberate replacement habits" → "Cut doomscrolling to under 1 hour/day"
 *   "Step your bedtime down to 11pm in manageable stages — first to 1am"
 *    → "Step your bedtime down to 11pm"
 */
export function goalTitle(statement: string, protocol?: { short_title?: string } | null): string {
  const named = protocol?.short_title?.trim();
  // Guard against a title that grew into a sentence anyway — derive instead.
  if (named && named.split(/\s+/).length <= 9) return named;
  return deriveGoalTitle(statement);
}

export function deriveGoalTitle(statement: string): string {
  let s = statement.replace(/\s*\([^)]*\)/g, '');
  const dur = s.match(/(?:over the next|over|in|within)\s+\d+\s+(?:weeks?|months?|days?)/i)?.[0] ?? null;
  s = s.replace(/\s+from\s+.*?\s+(?:down\s+|up\s+)?to\s+/i, ' to ');
  // Trailing aside after an em/en dash or colon: "— first to 1am".
  s = s.split(/\s+[—–:]\s+/)[0];
  // Method clauses, including the bare-preposition kind ("in manageable
  // stages", "with a structured taper").
  s = s.split(/,?\s+(?:through|using|via|by)\s+/i)[0];
  s = s.replace(/\s+(?:in|with|through)\s+(?:small|manageable|gradual|deliberate|structured|realistic)\s+\w+.*$/i, '');
  s = s.split(/,?\s+with\s+(?!\d)/i)[0];
  s = s.replace(/,\s.*$/, '');
  s = s.replace(/\s*[.!]\s*$/, '').trim();
  if (dur && !s.toLowerCase().includes(dur.toLowerCase())) {
    s += ` in ${dur.match(/\d+\s+(?:weeks?|months?|days?)/i)![0]}`;
  }
  return s || statement;
}

export function kindLook(kind: ProtocolStep['kind']) {
  if (kind === 'duration') return { glyph: 'D', bg: colors.openBg, fg: colors.accentLink };
  if (kind === 'quantity') return { glyph: '#', bg: colors.quantityBg, fg: colors.quantityFg };
  return { glyph: '✓', bg: colors.successBg, fg: colors.successFg };
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
        {!!step.assumption && (
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: '#B07E14', marginTop: 3 }}>
            {step.assumption.charAt(0).toUpperCase() + step.assumption.slice(1)} — regenerate the goal to correct it
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
      <Text style={{ fontSize: 10.5, fontFamily: fonts.extrabold, letterSpacing: 1.4, color: colors.onNavySoft }}>
        YOUR GOAL
      </Text>
      <Text style={{ fontFamily: fonts.serif, fontSize: 21, lineHeight: 27, color: colors.creamText, marginTop: 8 }}>
        {protocol.goal_statement}
      </Text>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.onNavyMuted, marginTop: 10 }}>
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
        shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
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
