// Home = the coach surface (owner call, 2026-08-24): Qleck is a personalized
// coach that builds systems for goals, with community around it — so Home
// centers on YOUR goal and this week's reps, not mock social plans. The old
// Rally demo content (events/invites/polls) came off this screen; real
// community surfaces return via ROADMAP.md P6 (friends-lite, cheers).
//
// P1: renders the protocol locked during onboarding (in-memory; P2a persists
// it, P4 turns these rows into real dated check-ins).
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import YouAvatar from '../components/YouAvatar';
import SectionLabel from '../components/SectionLabel';
import type { Protocol, ProtocolStep } from '../api/coachTypes';
import { useRally } from '../state/RallyContext';
import { CATS, colors, fonts, radii } from '../theme';

/* ── protocol pieces, cream-palette ─────────────────────────────────────── */

function kindLook(kind: ProtocolStep['kind']) {
  if (kind === 'duration') return { glyph: 'D', bg: colors.openBg, fg: colors.accentLink };
  if (kind === 'quantity') return { glyph: '#', bg: CATS.lav.bg, fg: CATS.lav.fg };
  return { glyph: '✓', bg: CATS.mint.bg, fg: CATS.mint.fg };
}

function stepMetric(step: ProtocolStep): string {
  const freq = `×${step.frequency.per_week}/wk`;
  if (step.kind === 'duration' && step.duration_minutes) return `${step.duration_minutes} min ${freq}`;
  if (step.kind === 'quantity' && step.quantity) return `${step.quantity.amount} ${step.quantity.unit} ${freq}`;
  return freq;
}

function StepRow({ step, last }: { step: ProtocolStep; last: boolean }) {
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
        {!!step.details && (
          <Text numberOfLines={2} style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 }}>
            {step.details}
          </Text>
        )}
      </View>
      <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: look.fg }}>{stepMetric(step)}</Text>
    </View>
  );
}

function GoalHero({ protocol }: { protocol: Protocol }) {
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

function ProtocolToday({ protocol }: { protocol: Protocol }) {
  // P1 has no real dates yet: everyone is in week 1. P2a adds the temporal
  // layer; P4 turns this list into dated, checkable reps.
  const week = 1;
  const phase = protocol.phases.find(p => week >= p.start_week && week <= p.end_week) ?? protocol.phases[0];
  const nextMilestone = [...protocol.milestones].sort((a, b) => a.week - b.week).find(m => m.week >= week);

  return (
    <>
      <GoalHero protocol={protocol} />

      <SectionLabel style={{ marginTop: 22 }}>THIS WEEK · {phase.title.toUpperCase()}</SectionLabel>
      <View
        style={{
          marginHorizontal: 14, backgroundColor: colors.card, borderRadius: radii.card,
          borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 4,
          shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
        }}
      >
        {phase.steps.map((step, i) => (
          <StepRow key={step.id} step={step} last={i === phase.steps.length - 1} />
        ))}
      </View>

      {nextMilestone && (
        <View
          style={{
            marginTop: 12, marginHorizontal: 14, backgroundColor: colors.inviteBg,
            borderWidth: 1, borderColor: colors.inviteBorder, borderRadius: radii.row,
            paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 10,
          }}
        >
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: colors.inviteAccent }}>⚑</Text>
          <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inviteAccent }}>
            Week {nextMilestone.week} — {nextMilestone.title}
          </Text>
        </View>
      )}

      <Text
        style={{
          marginTop: 18, marginHorizontal: 30, fontFamily: fonts.regular, fontStyle: 'italic',
          fontSize: 13, lineHeight: 20, color: colors.faintText, textAlign: 'center',
        }}
      >
        “{protocol.coach_notes}”
      </Text>
    </>
  );
}

function NoGoalYet() {
  return (
    <View style={{ marginTop: 16, marginHorizontal: 14, backgroundColor: colors.navy, borderRadius: 28, padding: 24 }}>
      <Text style={{ fontSize: 10.5, fontFamily: fonts.extrabold, letterSpacing: 1.4, color: 'rgba(245,242,234,0.5)' }}>
        QOACH
      </Text>
      <Text style={{ fontFamily: fonts.serif, fontSize: 21, lineHeight: 27, color: colors.creamText, marginTop: 8 }}>
        No goal locked yet.
      </Text>
      <Text style={{ fontSize: 13, lineHeight: 20, fontFamily: fonts.regular, color: 'rgba(245,242,234,0.65)', marginTop: 8 }}>
        Qoach turns any realistic goal into a week-by-week system. Goal intake currently lives in
        sign-up — starting a goal from here lands with the living-protocol phase of the roadmap.
      </Text>
    </View>
  );
}

/* ── the screen ─────────────────────────────────────────────────────────── */

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useRally();

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 2 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 26, letterSpacing: -0.3, color: colors.ink }}>
              Morning, {profile.firstName}.
            </Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 5 }}>
              {profile.protocol ? 'Week 1 · day one counts double.' : 'Your coach is ready when you are.'}
            </Text>
          </View>
          <Pressable onPress={() => navigation.navigate('You')}>
            <YouAvatar size={40} fontSize={14} />
          </Pressable>
        </View>

        {profile.protocol ? <ProtocolToday protocol={profile.protocol} /> : <NoGoalYet />}
      </ScrollView>
    </FadeInUp>
  );
}
