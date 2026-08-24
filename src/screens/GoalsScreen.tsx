// Goals tab — the full protocol, phase by phase: the structured system the
// user monitors themselves against. P1 renders it read-only; P4's execution
// engine turns these into dated, checkable reps with adaptation.
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import SectionLabel from '../components/SectionLabel';
import { CreamCard, GoalHero, MilestoneStrip, StepRow } from '../components/protocolViews';
import { useRally } from '../state/RallyContext';
import { colors, fonts } from '../theme';

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useRally();
  const protocol = profile.protocol;

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontFamily: fonts.serif, fontSize: 26, letterSpacing: -0.3, color: colors.ink, paddingHorizontal: 20, paddingTop: 8 }}>
          Your system
        </Text>

        {!protocol ? (
          <View style={{ marginTop: 16, marginHorizontal: 14, backgroundColor: colors.navy, borderRadius: 28, padding: 24 }}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 20, lineHeight: 26, color: colors.creamText }}>
              No goal locked yet.
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 20, fontFamily: fonts.regular, color: 'rgba(245,242,234,0.65)', marginTop: 8 }}>
              Tap + and tell Qoach what you want to pull off — it turns any realistic goal into a
              week-by-week protocol you can hold yourself to.
            </Text>
          </View>
        ) : (
          <>
            <GoalHero protocol={protocol} />

            {protocol.phases.map(phase => {
              const milestones = protocol.milestones
                .filter(m => m.week >= phase.start_week && m.week <= phase.end_week)
                .sort((a, b) => a.week - b.week);
              return (
                <React.Fragment key={phase.id}>
                  <SectionLabel style={{ marginTop: 22 }}>
                    {`WEEKS ${phase.start_week}–${phase.end_week} · ${phase.title.toUpperCase()}`}
                  </SectionLabel>
                  <Text style={{ paddingHorizontal: 22, marginTop: -4, marginBottom: 10, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.muted }}>
                    {phase.focus}
                  </Text>
                  <CreamCard>
                    {phase.steps.map((step, i) => (
                      <StepRow key={step.id} step={step} last={i === phase.steps.length - 1} />
                    ))}
                  </CreamCard>
                  {milestones.map(m => (
                    <MilestoneStrip key={m.id} week={m.week} title={m.title} />
                  ))}
                </React.Fragment>
              );
            })}

            <Text
              style={{
                marginTop: 20, marginHorizontal: 30, fontFamily: fonts.regular, fontStyle: 'italic',
                fontSize: 13, lineHeight: 20, color: colors.faintText, textAlign: 'center',
              }}
            >
              “{protocol.coach_notes}”
            </Text>
            <Text
              style={{
                marginTop: 14, marginHorizontal: 30, fontFamily: fonts.semibold,
                fontSize: 11.5, color: colors.sectionLabel, textAlign: 'center',
              }}
            >
              Check-ins and mid-plan adjustments arrive with the living-protocol phase.
            </Text>
          </>
        )}
      </ScrollView>
    </FadeInUp>
  );
}
