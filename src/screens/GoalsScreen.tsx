// Goals tab — every active goal's full protocol, phase by phase: the
// structured systems the user monitors themselves against. Goals run
// concurrently (owner call 2026-08-24); dropping one is the only way it ends,
// and it's an explicit, two-tap act — never a side effect of adding another.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import SectionLabel from '../components/SectionLabel';
import { CreamCard, GoalHero, MilestoneStrip, StepRow } from '../components/protocolViews';
import { useRally, type ActiveGoal } from '../state/RallyContext';
import { colors, fonts } from '../theme';

function DropGoalButton({ onDrop }: { onDrop: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Pressable
      onPress={() => (armed ? onDrop() : setArmed(true))}
      style={{
        alignSelf: 'center', marginTop: 16, paddingVertical: 9, paddingHorizontal: 20,
        borderRadius: 999, borderWidth: 1.5,
        borderColor: armed ? colors.danger : 'rgba(160,90,90,0.35)',
      }}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.danger }}>
        {armed ? 'Tap again to drop this goal' : 'Drop this goal'}
      </Text>
    </Pressable>
  );
}

function GoalSystem({ goal, onDrop }: { goal: ActiveGoal; onDrop: () => void }) {
  const protocol = goal.protocol;
  return (
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
      <DropGoalButton onDrop={onDrop} />
    </>
  );
}

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const { goals, dropGoal } = useRally();

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontFamily: fonts.serif, fontSize: 26, letterSpacing: -0.3, color: colors.ink, paddingHorizontal: 20, paddingTop: 8 }}>
          {goals.length > 1 ? 'Your systems' : 'Your system'}
        </Text>

        {goals.length === 0 ? (
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
          goals.map((goal, i) => (
            <React.Fragment key={goal.id}>
              {i > 0 && <View style={{ height: 1, backgroundColor: colors.hairline, marginHorizontal: 24, marginTop: 28 }} />}
              <GoalSystem goal={goal} onDrop={() => dropGoal(goal.id)} />
            </React.Fragment>
          ))
        )}
      </ScrollView>
    </FadeInUp>
  );
}
