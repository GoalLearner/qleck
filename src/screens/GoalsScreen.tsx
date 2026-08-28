// Goals — "the plan, without the wall", ported from the Claude Design canvas
// `Qleck Goals.dc.html`. Two levels: a calm shelf (one card per system with
// where you are and what today costs) → a detail view (the goal in its own
// words, the week track, and the phases as an accordion — only the phase
// you're living in opens with full reps; the rest fold to one row each).
// One readable column serves phone and desktop alike.
//
// Dropping a goal stays an explicit, two-tap act — never a side effect of
// adding another. "Tweak it with Qoach" wires to the P4 revise client; for
// now it opens the AdjustPlan modal.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAppearance } from '../state/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import YouAvatar from '../components/YouAvatar';
import { goalDot, goalTitle, kindLook } from '../components/protocolViews';
import type { ProtocolPhase, ProtocolStep } from '../api/coachTypes';
import { localDate } from '../api/device';
import { oddsTier, phaseForWeek, planEndDate, reforecastOdds, repsForDate, weekOf, type Reforecast } from '../lib/protocolTime';
import { Pop } from '../onboarding/ui';
import { useRally, type ActiveGoal } from '../state/RallyContext';
import { colors, fonts } from '../theme';


const COUNT_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five'];

function wkLabel(p: ProtocolPhase): string {
  return p.start_week === p.end_week ? `WEEK ${p.start_week}` : `WK ${p.start_week}–${p.end_week}`;
}

// The rep's cost as a quiet chip: "20 min · 3/wk", "45 min · daily", "weekly".
function freqChip(step: ProtocolStep): string {
  const parts: string[] = [];
  if (step.kind === 'duration' && step.duration_minutes) parts.push(`${step.duration_minutes} min`);
  if (step.kind === 'quantity' && step.quantity) parts.push(`${step.quantity.amount} ${step.quantity.unit}`);
  const pw = step.frequency.per_week;
  parts.push(pw >= 7 ? 'daily' : pw === 1 ? 'weekly' : `${pw}/wk`);
  return parts.join(' · ');
}

/* ── the week track: one cell per plan week ─────────────────────────────── */

/**
 * Plan progress. One cell per week reads beautifully for a 4-week plan and
 * breaks completely for a 52-week one: 52 cells plus their gaps need ~300px
 * and the shelf gives it 90, so the row ran off the card. Past ~14 weeks the
 * cells would be sub-pixel anyway, so long plans get a continuous bar instead
 * — same information, honest at any length.
 */
const MAX_CELLS = 14;

function WeekTrack({ weeks, week, filled, done = false }: {
  weeks: number; week: number; filled: boolean; done?: boolean;
}) {
  const height = filled ? 5 : 6;

  if (weeks > MAX_CELLS) {
    const frac = done ? 1 : Math.min(1, Math.max(0, (week - 1) / weeks));
    return (
      <View
        style={{
          flex: 1, height, borderRadius: 3, overflow: 'hidden',
          backgroundColor: filled ? colors.borderStrong : 'transparent',
          borderWidth: filled ? 0 : 1, borderColor: colors.outline,
        }}
      >
        <View
          style={{
            width: `${Math.max(frac * 100, done ? 100 : 2)}%`,
            height, borderRadius: 3,
            backgroundColor: done ? colors.success : colors.ink,
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: filled ? 4 : 5 }}>
      {Array.from({ length: weeks }, (_, i) => {
        // weekOf clamps at the duration, so the final cell would otherwise sit
        // on "current" forever and the track could never fill.
        const past = done || i < week - 1;
        const now = !done && i === week - 1;
        return (
          <View
            key={i}
            style={{
              flex: 1, minWidth: 0, height, borderRadius: 3, borderWidth: 1,
              backgroundColor: past ? colors.success : filled && now ? colors.ink : 'transparent',
              borderColor: past
                ? colors.success
                : filled
                  ? colors.borderStrong
                  : now ? colors.ink : colors.outline,
              ...(filled && !past && !now ? { backgroundColor: colors.borderStrong } : null),
            }}
          />
        );
      })}
    </View>
  );
}

/* ── level one: the shelf ───────────────────────────────────────────────── */

interface GoalModel {
  goal: ActiveGoal;
  dot: string;
  week: number;
  nowIdx: number;
  phase: ProtocolPhase;
  repsToday: number;
  /** Accepted odds re-forecast against actual adherence; null without odds. */
  rf: Reforecast | null;
}

function GoalCard({ m, onOpen }: { m: GoalModel; onOpen: () => void }) {
  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: 26, paddingVertical: 20, paddingHorizontal: 22,
      }}
    >
      {/* one title, once: the serif line carries the goal; the dot is its
          color key (owner call 2026-08-25 — the caps name was redundant) */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.dot, marginTop: 8 }} />
        <Text style={{ flex: 1, fontFamily: fonts.serif, fontSize: 17, lineHeight: 23.8, color: colors.ink }}>
          {goalTitle(m.goal.statement, m.goal.protocol)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.2, color: colors.sectionLabel }}>
            WEEK {m.week} OF {m.goal.protocol.duration_weeks}
          </Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.sectionLabel }}>›</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <View style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.successBg }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.success }}>Now: {m.phase.title}</Text>
        </View>
        <View style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.chipBg }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.muted }}>
            {m.repsToday} {m.repsToday === 1 ? 'rep' : 'reps'} today
          </Text>
        </View>
        {/* The accepted odds, re-forecast against how the plan is actually
            going (derived, never stored). Green while holding; amber with the
            drop spelled out when recent weeks slipped. Absent on goals from
            before the odds existed. */}
        {m.rf ? (
          <View style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: m.rf.drifted ? colors.inviteBg : colors.successBg }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 11, color: m.rf.drifted ? colors.inviteAccent : colors.success }}>
              {m.rf.drifted ? `was ${m.rf.original} · now ${m.rf.current}%` : `${oddsTier(m.rf.current).label} · ${m.rf.current}%`}
            </Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={{ width: 90, flexDirection: 'row' }}>
          <WeekTrack weeks={m.goal.protocol.duration_weeks} week={m.week} filled />
        </View>
      </View>
    </Pressable>
  );
}

/* ── level two: the detail with the phase accordion ─────────────────────── */

function RepRow({ step }: { step: ProtocolStep }) {
  const look = kindLook(step.kind);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 11, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: colors.chipBg }}>
      <View style={{ width: 28, height: 28, borderRadius: 10, backgroundColor: look.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: look.fg }}>{look.glyph}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 14, lineHeight: 18.2, color: colors.ink }}>{step.title}</Text>
        {!!step.details && (
          <Text style={{ fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 3 }}>
            {step.details}
          </Text>
        )}
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.chipBg, marginTop: 4 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 10.5, color: colors.muted }}>{freqChip(step)}</Text>
      </View>
    </View>
  );
}

function PhaseCard({ goal, phase, now, open, onToggle }: {
  goal: ActiveGoal; phase: ProtocolPhase; now: boolean; open: boolean; onToggle: () => void;
}) {
  const milestones = goal.protocol.milestones
    .filter(mi => mi.week >= phase.start_week && mi.week <= phase.end_week)
    .sort((a, b) => a.week - b.week);
  return (
    <View
      style={{
        backgroundColor: colors.card, borderWidth: 1, borderRadius: 26, overflow: 'hidden',
        borderColor: now ? colors.successBorder : colors.border,
      }}
    >
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 20 }}>
        <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: now ? colors.successBg : colors.chipBg }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 1, color: now ? colors.success : colors.sectionLabel }}>{wkLabel(phase)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 16.5, lineHeight: 20.6, color: now ? colors.ink : colors.inkSoft }}>{phase.title}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.sectionLabel, marginTop: 2 }}>{phase.focus}</Text>
        </View>
        {now ? (
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.successBg }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 1, color: colors.success }}>NOW</Text>
          </View>
        ) : (
          <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: colors.sectionLabel }}>{phase.steps.length} reps</Text>
        )}
        <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.sectionLabel, width: 12, textAlign: 'center' }}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && phase.steps.map(step => <RepRow key={step.id} step={step} />)}
      {open && milestones.map(mi => (
        <View
          key={mi.id}
          style={{
            marginHorizontal: 14, marginBottom: 14, marginTop: 10,
            flexDirection: 'row', alignItems: 'baseline', gap: 9,
            backgroundColor: colors.inviteBg, borderWidth: 1, borderColor: colors.inviteBorder,
            borderRadius: 16, paddingVertical: 11, paddingHorizontal: 15,
          }}
        >
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: colors.inviteAccent }}>⚑</Text>
          <Text style={{ flexShrink: 1, fontFamily: fonts.serif, fontSize: 14, lineHeight: 18.2, color: colors.ink }}>{mi.title}</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.inviteAccent }}>week {mi.week}</Text>
        </View>
      ))}
    </View>
  );
}

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
        alignSelf: 'center', marginTop: 22, paddingVertical: 9, paddingHorizontal: 20,
        borderRadius: 999, borderWidth: 1.5,
        borderColor: armed ? colors.danger : colors.dangerBorder,
      }}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.danger }}>
        {armed ? 'Tap again to drop this goal' : 'Drop this goal'}
      </Text>
    </Pressable>
  );
}

function DetailView({ m, onBack, onDrop, onTweak }: {
  m: GoalModel; onBack: () => void; onDrop: () => void; onTweak: () => void;
}) {
  const [open, setOpen] = useState<number>(m.nowIdx);
  const protocol = m.goal.protocol;
  return (
    <FadeInUp>
      <Pressable onPress={onBack} style={{ alignSelf: 'flex-start', paddingVertical: 2 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.muted }}>‹ Your systems</Text>
      </Pressable>

      <View style={{ marginTop: 14, backgroundColor: colors.navy, borderRadius: 26, paddingVertical: 22, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.dot, marginTop: 10 }} />
          <Text style={{ flex: 1, fontFamily: fonts.serif, fontSize: 20, lineHeight: 28, color: colors.creamText }}>
            {goalTitle(m.goal.statement, m.goal.protocol)}
          </Text>
        </View>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.onNavySoft, marginTop: 10 }}>
          {protocol.duration_weeks} weeks · {protocol.phases.length} phases · built with Qoach
          {m.rf ? ` · ${m.rf.current}% — ${m.rf.drifted ? `slipping, was ${m.rf.original}%` : oddsTier(m.rf.current).label.toLowerCase()} — if you do the reps` : ''}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, marginBottom: 20, marginHorizontal: 4 }}>
        <WeekTrack weeks={protocol.duration_weeks} week={m.week} filled={false} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: colors.muted }}>
          week {m.week} of {protocol.duration_weeks} · phase {m.nowIdx + 1} of {protocol.phases.length}
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        {protocol.phases.map((phase, pi) => (
          <PhaseCard
            key={phase.id}
            goal={m.goal}
            phase={phase}
            now={pi === m.nowIdx}
            open={pi === open}
            onToggle={() => setOpen(prev => (prev === pi ? -1 : pi))}
          />
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', marginTop: 14, paddingHorizontal: 4 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: colors.sectionLabel }}>Plan feels off? </Text>
        <Pressable onPress={onTweak}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: colors.accentLink, textDecorationLine: 'underline' }}>
            Tweak it with Qoach
          </Text>
        </Pressable>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: colors.sectionLabel }}> — nothing here is sacred.</Text>
      </View>

      <DropGoalButton onDrop={onDrop} />
    </FadeInUp>
  );
}

/* ── the screen ─────────────────────────────────────────────────────────── */

export default function GoalsScreen() {
  useAppearance();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { goals, finishedGoals, checkInsByGoal, dropGoal } = useRally();
  const [selId, setSelId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  };

  const today = localDate();
  const models: GoalModel[] = goals.map((goal, i) => {
    const week = weekOf(goal.startedOn, today, goal.protocol.duration_weeks);
    const phase = phaseForWeek(goal.protocol, week);
    return {
      goal, week, phase,
      dot: goalDot(i),
      nowIdx: Math.max(0, goal.protocol.phases.findIndex(p => p.id === phase.id)),
      repsToday: repsForDate(goal.protocol, goal.startedOn, today, checkInsByGoal[goal.id] ?? []).length,
      rf: reforecastOdds(goal.odds, goal.protocol, goal.startedOn, checkInsByGoal[goal.id] ?? [], today),
    };
  });
  const sel = models.find(m => m.goal.id === selId) ?? null;
  const liveCount = COUNT_WORDS[goals.length] ?? String(goals.length);

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 20 }}>
          {sel ? (
            <DetailView
              key={sel.goal.id}
              m={sel}
              onBack={() => setSelId(null)}
              onDrop={() => { dropGoal(sel.goal.id); setSelId(null); }}
              onTweak={() => navigation.navigate('AdjustPlan', { goalId: sel.goal.id })}
            />
          ) : (
            <FadeInUp>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 30, lineHeight: 34.5, color: colors.ink }}>Your systems</Text>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 6 }}>
                    {goals.length === 0 ? 'Nothing on the clock yet' : `${liveCount} live · built with Qoach`}
                  </Text>
                </View>
                <Pressable onPress={() => navigation.navigate('You')}>
                  <YouAvatar size={42} fontSize={13} />
                </Pressable>
              </View>

              <View style={{ gap: 12, marginTop: 24 }}>
                {goals.length === 0 && (
                  <View style={{ backgroundColor: colors.navy, borderRadius: 26, padding: 24 }}>
                    <Text style={{ fontFamily: fonts.serif, fontSize: 20, lineHeight: 26, color: colors.creamText }}>
                      No goal locked yet.
                    </Text>
                    <Text style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.onNavyMuted, marginTop: 8 }}>
                      Tap + and tell Qoach what you want to pull off — it turns any realistic goal
                      into a week-by-week protocol you can hold yourself to.
                    </Text>
                  </View>
                )}
                {models.map(m => (
                  <GoalCard key={m.goal.id} m={m} onOpen={() => setSelId(m.goal.id)} />
                ))}
                <Pressable
                  onPress={() => navigation.navigate('NewGoal')}
                  style={{
                    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.outline,
                    borderRadius: 26, padding: 16, alignItems: 'center',
                  }}
                >
                  <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.muted }}>
                    ＋ Start another system with Qoach
                  </Text>
                </Pressable>

                {/* The archive: plans that ended, completed or dropped. Before
                    this they simply disappeared, taking their history with
                    them. */}
                {finishedGoals.length > 0 && (
                  <View style={{ marginTop: 18 }}>
                    <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel, marginBottom: 10 }}>
                      FINISHED
                    </Text>
                    <View style={{ gap: 8 }}>
                      {finishedGoals.map(g => (
                        <View
                          key={g.id}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 12,
                            backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                            borderRadius: 20, paddingVertical: 14, paddingHorizontal: 18,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 21, color: colors.inkSoft }}>
                              {goalTitle(g.statement, g.protocol)}
                            </Text>
                            <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.sectionLabel, marginTop: 2 }}>
                              {g.protocol.duration_weeks} weeks · {g.startedOn} to {planEndDate(g.startedOn, g.protocol.duration_weeks)}
                            </Text>
                          </View>
                          <View style={{ width: 70, flexDirection: 'row' }}>
                            <WeekTrack weeks={g.protocol.duration_weeks} week={g.protocol.duration_weeks} filled done />
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            </FadeInUp>
          )}
        </View>
      </ScrollView>

      {toast !== '' && (
        <View pointerEvents="none" style={{ position: 'absolute', top: Math.max(insets.top, 24), left: 0, right: 0, alignItems: 'center', zIndex: 40 }}>
          <Pop>
            <View style={{ backgroundColor: colors.navy, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 18, maxWidth: 420 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.creamText }}>{toast}</Text>
            </View>
          </Pop>
        </View>
      )}
    </FadeInUp>
  );
}
