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
import { CreamCard, GoalHero, MilestoneStrip, StepRow } from '../components/protocolViews';
import type { Protocol } from '../api/coachTypes';
import { useRally } from '../state/RallyContext';
import { CATS, colors, fonts, radii } from '../theme';

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
      <CreamCard>
        {phase.steps.map((step, i) => (
          <StepRow key={step.id} step={step} last={i === phase.steps.length - 1} />
        ))}
      </CreamCard>

      {nextMilestone && <MilestoneStrip week={nextMilestone.week} title={nextMilestone.title} />}

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
        Tap + and tell Qoach what you want to pull off — any realistic goal becomes a
        week-by-week system you can hold yourself to.
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
