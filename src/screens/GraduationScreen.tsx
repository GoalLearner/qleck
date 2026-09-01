// The end of a plan — the moment the product exists for.
//
// A protocol has a fixed length, and until now reaching the end of one did
// nothing: reps stopped appearing and the goal quietly read as a permanent
// rest day. This screen is what happens instead — the run in review, then a
// deliberate choice about what comes next.
//
// The verdict is behavioural only (reps banked, days shown up), never an
// outcome claim, matching the rule the coach prompts follow.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useAppearance } from '../state/ThemeContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Confetti, { type ConfettiHandle } from '../components/Confetti';
import { goalTitle } from '../components/protocolViews';
import { celebratePlan } from '../lib/celebrate';
import { planEndDate, planStats, type PlanStats } from '../lib/protocolTime';
import { useRally, type ActiveGoal } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

type Choice = 'maintain' | 'extend' | 'close';

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ fontFamily: fonts.serif, fontSize: 34, lineHeight: 40, color: tone ?? colors.ink }}>
        {value}
      </Text>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, lineHeight: 16, color: colors.muted, textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}

function WeekBars({ stats }: { stats: PlanStats }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 68 }}>
      {stats.weeks.map(w => {
        const frac = w.expected > 0 ? w.banked / w.expected : 0;
        return (
          <View key={w.week} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={{ width: '100%', height: 46, justifyContent: 'flex-end', backgroundColor: colors.chipBg, borderRadius: 6, overflow: 'hidden' }}>
              <View style={{ height: `${Math.max(4, frac * 100)}%`, backgroundColor: colors.success, borderRadius: 6 }} />
            </View>
            <Text style={{ fontFamily: fonts.bold, fontSize: 9.5, color: colors.sectionLabel }}>{w.week}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ChoiceCard({ title, blurb, tone, onPress, busy, disabled }: {
  title: string; blurb: string; tone: 'primary' | 'plain';
  onPress: () => void; busy?: boolean; disabled?: boolean;
}) {
  const primary = tone === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={{
        borderRadius: radii.card, paddingVertical: 18, paddingHorizontal: 20,
        backgroundColor: primary ? colors.navy : colors.card,
        borderWidth: 1, borderColor: primary ? colors.navy : colors.border,
        opacity: disabled ? 0.45 : 1,
        flexDirection: 'row', alignItems: 'center', gap: 14,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, color: primary ? colors.creamText : colors.ink }}>
          {title}
        </Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 18, marginTop: 3, color: primary ? colors.onNavyMuted : colors.muted }}>
          {blurb}
        </Text>
      </View>
      {busy && <ActivityIndicator color={primary ? colors.creamText : colors.muted} />}
    </Pressable>
  );
}

export default function GraduationScreen() {
  useAppearance();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { goals, checkInsByGoal, completeGoalById, graduate } = useRally();
  const goalId: string = route.params?.goalId;
  const goal: ActiveGoal | undefined = goals.find(g => g.id === goalId);

  const confettiRef = useRef<ConfettiHandle>(null);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The salute belongs to arriving here, not to any particular choice.
  useEffect(() => {
    const t = setTimeout(() => { confettiRef.current?.fire(); celebratePlan(); }, 320);
    return () => clearTimeout(t);
  }, []);

  if (!goal) {
    // The goal left the active list (already graduated in another session).
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.ink, textAlign: 'center' }}>
          This plan is already wrapped up.
        </Text>
        <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 20 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.accentLink }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const stats = planStats(goal.protocol, goal.startedOn, checkInsByGoal[goal.id] ?? [], goal.pauses);
  const pct = Math.round(stats.adherence * 100);
  const reached = stats.milestones.filter(m => m.reached).length;
  const weeks = goal.protocol.duration_weeks;

  const run = async (choice: Choice) => {
    setBusy(choice);
    setError(null);
    try {
      if (choice === 'close') await completeGoalById(goal.id);
      else await graduate(goal.id, choice, choice === 'extend' ? weeks : undefined);
      navigation.goBack();
    } catch (e) {
      // Close-out never depends on the AI, so it stays available when the
      // coach is down — say so rather than stranding the user here.
      setError(
        choice === 'close'
          ? "Couldn't close this out — check your connection and try again."
          : "Qoach couldn't write that plan just now. You can try again, or close this goal out.",
      );
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 28) + 12,
          paddingBottom: Math.max(insets.bottom, 24) + 32,
          paddingHorizontal: 22,
          width: '100%', maxWidth: 680, alignSelf: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.5, color: colors.sectionLabel }}>
          PLAN COMPLETE
        </Text>
        <Text style={{ fontFamily: fonts.serif, fontSize: 32, lineHeight: 38, color: colors.ink, marginTop: 8 }}>
          {goalTitle(goal.statement, goal.protocol)}
        </Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 8 }}>
          {weeks} weeks · {goal.startedOn} to {planEndDate(goal.startedOn, weeks, goal.pauses)}
        </Text>

        {/* the run in review */}
        <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, padding: 20, marginTop: 22 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat value={`${pct}%`} label="of your reps banked" tone={colors.success} />
            <Stat value={String(stats.bestStreak)} label="day best streak" />
            <Stat value={String(stats.activeDays)} label="days you showed up" />
          </View>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 16, marginBottom: 10 }}>
            {stats.banked} of {stats.expected} reps, week by week
          </Text>
          <WeekBars stats={stats} />
        </View>

        {/* milestones */}
        {stats.milestones.length > 0 && (
          <View style={{ marginTop: 18 }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel, marginBottom: 10 }}>
              MILESTONES · {reached} OF {stats.milestones.length}
            </Text>
            <View style={{ gap: 8 }}>
              {stats.milestones.map(m => (
                <View
                  key={m.milestone.id}
                  style={{
                    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
                    backgroundColor: m.reached ? colors.doneBg : colors.card,
                    borderWidth: 1, borderColor: m.reached ? colors.doneBorder : colors.border,
                    borderRadius: 18, paddingVertical: 13, paddingHorizontal: 16,
                  }}
                >
                  <Text style={{ fontFamily: fonts.extrabold, fontSize: 14, color: m.reached ? colors.success : colors.sectionLabel, marginTop: 1 }}>
                    {m.reached ? '✓' : '·'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.serif, fontSize: 15, lineHeight: 20, color: colors.ink }}>
                      {m.milestone.title}
                    </Text>
                    <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, lineHeight: 17, color: colors.muted, marginTop: 2 }}>
                      week {m.milestone.week} — {m.milestone.criteria}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: m.reached ? colors.success : colors.sectionLabel }}>
                    {Math.round(m.adherence * 100)}%
                  </Text>
                </View>
              ))}
            </View>
            <Text style={{ fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: colors.sectionLabel, marginTop: 8 }}>
              Judged on the reps you banked that week.
            </Text>
          </View>
        )}

        {/* what now */}
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel, marginTop: 26, marginBottom: 10 }}>
          WHAT NOW
        </Text>
        <View style={{ gap: 10 }}>
          <ChoiceCard
            tone="primary"
            title="Keep it going, lighter"
            blurb="Qoach writes a maintenance version — the anchors stay, the scaffolding goes."
            busy={busy === 'maintain'}
            disabled={!!busy && busy !== 'maintain'}
            onPress={() => run('maintain')}
          />
          <ChoiceCard
            tone="plain"
            title={`Give it another ${weeks} weeks`}
            blurb="Same goal, same history — Qoach builds the next phases on top."
            busy={busy === 'extend'}
            disabled={!!busy && busy !== 'extend'}
            onPress={() => run('extend')}
          />
          <ChoiceCard
            tone="plain"
            title="Close it out"
            blurb="Done is done. It moves to your archive and goes quiet."
            busy={busy === 'close'}
            disabled={!!busy && busy !== 'close'}
            onPress={() => run('close')}
          />
        </View>

        {error && (
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.danger, marginTop: 14 }}>
            {error}
          </Text>
        )}

        <Pressable onPress={() => navigation.goBack()} disabled={!!busy} style={{ alignSelf: 'center', marginTop: 22, padding: 8 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.muted }}>Decide later</Text>
        </Pressable>
      </ScrollView>

      <Confetti ref={confettiRef} />
    </View>
  );
}
