// Today — the daily check-in loop, ported from the Claude Design canvas
// `Qleck Today.dc.html` onto the real temporal layer (src/lib/protocolTime)
// and the outbox-backed check-in record. States: morning (reps to do),
// day done, rest day, missed-yesterday banner, milestone flag, no goal.
//
// Two layouts from the same data: the phone loop (canvas §1) and, on wide web
// viewports, the desktop two-column Today (canvas §2). Goals run
// CONCURRENTLY (owner call 2026-08-24): each active goal is its own labeled
// group with a color dot, phase and x/y count; the sidebar (ring, streak,
// week dots, milestones) merges across all of them. Checks toggle (un-check
// is a real server delete), quantity reps log an actual number, and Qoach's
// one-liner reacts to what's left.
//
// P2a renders and records; P4 adds nudges, adaptation and the milestone
// celebration moment (the canvas' "ease this week" card ships then, when the
// revise flow gets a client).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Confetti, { type ConfettiHandle } from '../components/Confetti';
import FadeInUp from '../components/FadeInUp';
import { shortGoalName } from '../components/protocolViews';
import { Pop } from '../onboarding/ui';
import YouAvatar from '../components/YouAvatar';
import type { ProtocolPhase } from '../api/coachTypes';
import { localDate } from '../api/device';
import {
  allCheckIns, mergedMissedYesterday, mergedTomorrowPreview, mergedWeekStrip,
  phaseForWeek, repsForDate, streakDays, weekdayName, weekOf,
  type CheckIn, type DayRep, type WeekDay,
} from '../lib/protocolTime';
import { useRally, type ActiveGoal } from '../state/RallyContext';
import { colors, fonts } from '../theme';

const INK = colors.ink;
const FADED = colors.sectionLabel;
const GREEN = '#47694f';

// One dot color per goal, by position — stable while the goal list is stable.
const GOAL_DOTS = [GREEN, '#4d5680', '#8a5f38', '#4f8fc9', '#c96f5f'];

function greeting(restDay: boolean, name: string): string {
  if (restDay) return `Easy, ${name}.`;
  const h = new Date().getHours();
  const part = h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  return `${part}, ${name}.`;
}

/* ── week strip ─────────────────────────────────────────────────────────── */

function dotStyle(kind: WeekDay['kind']) {
  switch (kind) {
    case 'done': return { backgroundColor: GREEN, borderColor: GREEN };
    case 'today': return { backgroundColor: 'transparent', borderColor: INK };
    case 'missed': return { backgroundColor: 'transparent', borderColor: '#c96f5f' };
    case 'rest': return { backgroundColor: 'rgba(38,43,51,0.12)', borderColor: 'transparent' };
    default: return { backgroundColor: 'transparent', borderColor: 'rgba(38,43,51,0.22)' };
  }
}

function WeekDots({ days }: { days: WeekDay[] }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
      {days.map(d => (
        <View key={d.date} style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, color: d.isToday ? INK : FADED }}>{d.letter}</Text>
          <View style={[{ width: 10, height: 10, borderRadius: 5, borderWidth: 2 }, dotStyle(d.kind)]} />
        </View>
      ))}
    </View>
  );
}

function WeekStrip({ days }: { days: WeekDay[] }) {
  return (
    <View style={{ marginTop: 22, marginHorizontal: 24, paddingHorizontal: 4 }}>
      <WeekDots days={days} />
    </View>
  );
}

/* ── rep card with the springy (and un-checkable) check ─────────────────── */

function kindChip(rep: DayRep) {
  const k = rep.step.kind;
  if (k === 'duration') return { glyph: 'D', bg: colors.openBg, fg: colors.accentLink };
  if (k === 'quantity') return { glyph: '#', bg: '#e4e6f4', fg: '#4d5680' };
  return { glyph: '✓', bg: '#dcecdf', fg: GREEN };
}

function repMetric(rep: DayRep, loggedValue?: number | null): string {
  const s = rep.step;
  const base =
    s.kind === 'duration' && s.duration_minutes ? `${s.duration_minutes} min`
    : s.kind === 'quantity' && s.quantity
      ? rep.checked && loggedValue != null
        ? `${loggedValue} ${s.quantity.unit} logged`
        : `${s.quantity.amount} ${s.quantity.unit}`
    : 'once today';
  return rep.quotaLabel ? `${base} · ${rep.quotaLabel}` : base;
}

interface QtyControls {
  value: number;
  unit: string;
  inc: () => void;
  dec: () => void;
  log: () => void;
}

function RepCard({ rep, onCheck, onUncheck, loggedValue, qty }: {
  rep: DayRep;
  onCheck: () => void;
  onUncheck: () => void;
  loggedValue?: number | null;
  qty?: QtyControls;
}) {
  const chip = kindChip(rep);
  const scale = useRef(new Animated.Value(1)).current;
  const wasChecked = useRef(rep.checked);

  useEffect(() => {
    if (rep.checked && !wasChecked.current) {
      scale.setValue(0.5);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
    if (!rep.checked) scale.setValue(1);
    wasChecked.current = rep.checked;
  }, [rep.checked, scale]);

  const showStepper = !!qty && !rep.checked;

  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: rep.checked ? '#eef4ec' : colors.card,
        borderWidth: 1, borderColor: rep.checked ? '#dcecdf' : colors.border,
        borderRadius: 26, padding: rep.checked ? 14 : 18,
      }}
    >
      <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: chip.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: chip.fg }}>{chip.glyph}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, opacity: rep.checked ? 0.55 : 1 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 19.5, color: INK }}>{rep.step.title}</Text>
        <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: chip.fg, marginTop: 2 }}>{repMetric(rep, loggedValue)}</Text>
        {!rep.checked && !!rep.step.details && (
          <Text numberOfLines={2} style={{ fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 4 }}>
            {rep.step.details}
          </Text>
        )}
      </View>
      {showStepper ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={qty!.dec}
            style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: 'rgba(38,43,51,0.15)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 17, color: INK }}>−</Text>
          </Pressable>
          <Text style={{ minWidth: 58, textAlign: 'center', fontFamily: fonts.extrabold, fontSize: 15, color: INK }}>
            {qty!.value} {qty!.unit}
          </Text>
          <Pressable
            onPress={qty!.inc}
            style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: 'rgba(38,43,51,0.15)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 17, color: INK }}>+</Text>
          </Pressable>
          <Pressable
            onPress={qty!.log}
            style={{ height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}
          >
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 13.5, color: colors.creamText }}>Log it</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={rep.checked ? onUncheck : onCheck} hitSlop={6}>
          <Animated.View
            style={{
              width: 46, height: 46, borderRadius: 23,
              backgroundColor: rep.checked ? GREEN : 'transparent',
              borderWidth: 2, borderColor: rep.checked ? GREEN : 'rgba(38,43,51,0.18)',
              alignItems: 'center', justifyContent: 'center',
              transform: [{ scale }],
            }}
          >
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 20, color: rep.checked ? colors.creamText : 'transparent' }}>✓</Text>
          </Animated.View>
        </Pressable>
      )}
    </View>
  );
}

/* ── day states ─────────────────────────────────────────────────────────── */

// A calm banner, not a takeover: the checked cards stay below as the day's
// receipts (owner call, 2026-08-24 — evidence is the reward). Tapping it
// replays the confetti salute (the canvas' encore).
function DayDone({ streak, preview, onEncore }: { streak: number; preview: string | null; onEncore: () => void }) {
  return (
    <Pressable
      onPress={onEncore}
      style={{
        alignItems: 'center', gap: 12, backgroundColor: '#eef4ec',
        borderWidth: 1, borderColor: '#dcecdf', borderRadius: 26,
        paddingVertical: 22, paddingHorizontal: 18,
      }}
    >
      <Text style={{ fontFamily: fonts.serif, fontSize: 27, color: INK }}>That's today.</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: '#dcecdf' }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: GREEN }}>{streak}-day streak</Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderStrong }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, color: colors.muted }}>+1</Text>
        </View>
      </View>
      {preview && (
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 20, color: colors.muted, textAlign: 'center' }}>
          {preview}
        </Text>
      )}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: FADED }}>confetti's free — tap for an encore</Text>
    </Pressable>
  );
}

/** Fire the salute when the last rep lands — not on a reload that already
 * shows a finished day (the canvas fires on the transition only). */
function useCelebrateOnDone(allDone: boolean, celebrate: () => void) {
  const prev = useRef(allDone);
  useEffect(() => {
    if (allDone && !prev.current) celebrate();
    prev.current = allDone;
  }, [allDone, celebrate]);
}

function RestDay({ preview }: { preview: string | null }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 30, paddingHorizontal: 24 }}>
      <Text style={{ fontFamily: fonts.serif, fontSize: 30, color: INK }}>Nothing scheduled.</Text>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.muted }}>Rest is part of the plan.</Text>
      {preview && (
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 20, color: FADED, marginTop: 10, textAlign: 'center' }}>
          {preview}
        </Text>
      )}
    </View>
  );
}

function NoGoalYet() {
  return (
    <View style={{ marginTop: 12, marginHorizontal: 24, backgroundColor: colors.navy, borderRadius: 26, paddingHorizontal: 24, paddingVertical: 30 }}>
      <Text style={{ fontFamily: fonts.serif, fontSize: 26, lineHeight: 31, color: colors.creamText, textAlign: 'center', marginBottom: 8 }}>
        No goal locked yet.
      </Text>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 21.6, color: 'rgba(242,239,231,0.7)', textAlign: 'center' }}>
        Tap + and tell Qoach what you want to pull off.
      </Text>
    </View>
  );
}

function MissedBanner() {
  return (
    <View style={{ backgroundColor: colors.inviteBg, borderWidth: 1, borderColor: colors.inviteBorder, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 18.75, color: colors.inviteAccent }}>
        Yesterday slipped — today still makes this week work.
      </Text>
    </View>
  );
}

/* ── shared per-day derivations, merged across every active goal ────────── */

interface GoalToday {
  goal: ActiveGoal;
  week: number;
  phase: ProtocolPhase;
  reps: DayRep[];
  done: number;
  dot: string;
}

function useTodayModel(goals: ActiveGoal[], byGoal: Record<string, CheckIn[]>) {
  const today = localDate();
  const perGoal: GoalToday[] = goals.map((g, i) => {
    const week = weekOf(g.startedOn, today, g.protocol.duration_weeks);
    const phase = phaseForWeek(g.protocol, week);
    const reps = repsForDate(g.protocol, g.startedOn, today, byGoal[g.id] ?? []);
    return { goal: g, week, phase, reps, done: reps.filter(r => r.checked).length, dot: GOAL_DOTS[i % GOAL_DOTS.length] };
  });
  const total = perGoal.reduce((n, g) => n + g.reps.length, 0);
  const done = perGoal.reduce((n, g) => n + g.done, 0);
  return {
    today, perGoal, done, total,
    allDone: total > 0 && done === total,
    restDay: total === 0,
    strip: mergedWeekStrip(goals, byGoal, today),
    streak: streakDays(today, allCheckIns(byGoal)),
    missed: mergedMissedYesterday(goals, byGoal, today),
    preview: mergedTomorrowPreview(goals, byGoal, today),
  };
}

function headerSub(m: ReturnType<typeof useTodayModel>): string {
  const day = weekdayName(m.today);
  if (m.perGoal.length === 1) {
    const g = m.perGoal[0];
    return `${day} · week ${g.week} of ${g.goal.protocol.duration_weeks} — ${g.phase.title}`;
  }
  return `${day} · ${m.perGoal.length} goals in motion`;
}

function loggedValueFor(rows: CheckIn[], stepId: string, today: string): number | null {
  return rows.find(c => c.step_id === stepId && c.local_date === today)?.value ?? null;
}

function nextMilestoneOf(g: GoalToday) {
  return [...g.goal.protocol.milestones].sort((a, b) => a.week - b.week).find(mi => mi.week >= g.week) ?? null;
}

/* ── goal group header (shared by both layouts) ─────────────────────────── */

// Just the goal name and the count — no phase, no method detail (owner call
// 2026-08-24: less information, keep it simple; the Goals tab holds the rest).
function GroupHeader({ g, open, onToggle }: { g: GoalToday; open: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 8 }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: g.dot }} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.extrabold, fontSize: 11.5, letterSpacing: 1.2, color: INK }}>
        {shortGoalName(g.goal.statement).toUpperCase()}
      </Text>
      <View style={{ flex: 1 }} />
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, color: g.dot }}>{g.done}/{g.reps.length}</Text>
      <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: FADED, width: 12, textAlign: 'center' }}>{open ? '▾' : '▸'}</Text>
    </Pressable>
  );
}

/* ── the phone loop (canvas §1, grouped when goals run concurrently) ────── */

function TodayLoop({ goals, byGoal, celebrate }: { goals: ActiveGoal[]; byGoal: Record<string, CheckIn[]>; celebrate: () => void }) {
  const { checkInStep, uncheckStep, profile } = useRally();
  const m = useTodayModel(goals, byGoal);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const multi = m.perGoal.length > 1;
  const milestoneOwner = m.perGoal.find(g => nextMilestoneOf(g));
  const nextMilestone = milestoneOwner ? nextMilestoneOf(milestoneOwner) : null;
  useCelebrateOnDone(m.allDone, celebrate);

  return (
    <>
      <Header title={greeting(m.restDay && !m.allDone, profile.firstName)} sub={headerSub(m)} />
      <WeekStrip days={m.strip} />

      <View style={{ flex: 1, gap: 14, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 130 }}>
        {m.missed && !m.allDone && <MissedBanner />}

        {m.allDone && (
          <Pop>
            <DayDone streak={m.streak} preview={m.preview} onEncore={celebrate} />
          </Pop>
        )}

        {m.restDay ? (
          <RestDay preview={m.preview} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: FADED }}>TODAY'S REPS</Text>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: multi ? GREEN : FADED }}>
                {multi ? `${m.done} OF ${m.total} BANKED` : m.perGoal[0].phase.title.toUpperCase()}
              </Text>
            </View>
            {m.perGoal.filter(g => g.reps.length > 0).map(g => (
              <React.Fragment key={g.goal.id}>
                {multi && (
                  <GroupHeader
                    g={g}
                    open={!closed[g.goal.id]}
                    onToggle={() => setClosed(prev => ({ ...prev, [g.goal.id]: !prev[g.goal.id] }))}
                  />
                )}
                {!closed[g.goal.id] && g.reps.map(rep => (
                  <RepCard
                    key={rep.step.id}
                    rep={rep}
                    loggedValue={loggedValueFor(byGoal[g.goal.id] ?? [], rep.step.id, m.today)}
                    onCheck={() => checkInStep(g.goal.id, rep.step.id, rep.step.kind === 'duration' ? rep.step.duration_minutes ?? null : rep.step.kind === 'quantity' ? rep.step.quantity?.amount ?? null : null)}
                    onUncheck={() => uncheckStep(g.goal.id, rep.step.id)}
                  />
                ))}
              </React.Fragment>
            ))}
          </>
        )}

        {!m.restDay && nextMilestone && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.inviteBg, borderWidth: 1, borderColor: colors.inviteBorder, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13 }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: colors.inviteAccent }}>⚑</Text>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.3, color: colors.inviteAccent }}>
              WEEK {nextMilestone.week} — {nextMilestone.title.toUpperCase()}
            </Text>
          </View>
        )}
      </View>
    </>
  );
}

/* ── the desktop Today (canvas §2): two columns, living sidebar ─────────── */

function nudgeLine(done: number, total: number): string | null {
  const left = total - done;
  if (total === 0 || left === 0) return null;
  if (done === 0) return total === 1 ? 'One rep today. Take it while it’s easy.' : 'Fresh list. Start with the quickest one.';
  if (left === 1) return 'One left. Close it out.';
  if (left === 2) return 'Two left — the next one takes thirty seconds.';
  return 'Rolling. Get the big one in before the day argues.';
}

function SideCard({ children, tinted = false }: { children: React.ReactNode; tinted?: boolean }) {
  return (
    <View
      style={{
        backgroundColor: tinted ? colors.inviteBg : colors.card,
        borderWidth: 1, borderColor: tinted ? colors.inviteBorder : colors.border,
        borderRadius: 26, padding: 18,
      }}
    >
      {children}
    </View>
  );
}

const RING_C = 213.6; // 2πr for r=34

function ProgressRingCard({ done, total }: { done: number; total: number }) {
  const frac = total > 0 ? done / total : 0;
  return (
    <SideCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 84, height: 84 }}>
          {/* the -90° start-at-noon rotation lives on the Svg itself:
              react-native-svg's per-element rotation props don't map to
              valid DOM attributes on web */}
          <Svg width={84} height={84} viewBox="0 0 84 84" style={{ transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={42} cy={42} r={34} fill="none" stroke="rgba(38,43,51,0.08)" strokeWidth={8} />
            <Circle
              cx={42} cy={42} r={34} fill="none" stroke={GREEN} strokeWidth={8} strokeLinecap="round"
              strokeDasharray={`${RING_C}`} strokeDashoffset={RING_C * (1 - frac)}
            />
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 16, color: INK }}>
              {total > 0 ? `${done}/${total}` : '—'}
            </Text>
          </View>
        </View>
        <View>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: FADED }}>TODAY</Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: INK, marginTop: 3 }}>reps banked</Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.muted, marginTop: 2 }}>resets at midnight</Text>
        </View>
      </View>
    </SideCard>
  );
}

function DesktopToday({ goals, byGoal, celebrate }: { goals: ActiveGoal[]; byGoal: Record<string, CheckIn[]>; celebrate: () => void }) {
  const { checkInStep, uncheckStep, profile } = useRally();
  const navigation = useNavigation<any>();
  const m = useTodayModel(goals, byGoal);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [qtyVals, setQtyVals] = useState<Record<string, number>>({});
  useCelebrateOnDone(m.allDone, celebrate);

  const milestoneRows = m.perGoal
    .map(g => ({ g, mi: nextMilestoneOf(g) }))
    .filter((r): r is { g: GoalToday; mi: NonNullable<ReturnType<typeof nextMilestoneOf>> } => r.mi !== null)
    .slice(0, 3);
  const nudge = nudgeLine(m.done, m.total);

  const qtyFor = (g: GoalToday, rep: DayRep): QtyControls | undefined => {
    const q = rep.step.quantity;
    if (rep.step.kind !== 'quantity' || !q) return undefined;
    const stepSize = q.amount >= 20 ? 5 : 1;
    const key = `${g.goal.id}:${rep.step.id}`;
    const value = qtyVals[key] ?? q.amount;
    const set = (v: number) => setQtyVals(prev => ({ ...prev, [key]: v }));
    return {
      value, unit: q.unit,
      inc: () => set(Math.min(999, value + stepSize)),
      dec: () => set(Math.max(stepSize === 5 ? 5 : 0, value - stepSize)),
      log: () => checkInStep(g.goal.id, rep.step.id, value),
    };
  };

  return (
    <View style={{ width: '100%', maxWidth: 1060, alignSelf: 'center' }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 40 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 34, lineHeight: 38, color: INK }}>
            {greeting(m.restDay && !m.allDone, profile.firstName)}
          </Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 6 }}>
            {headerSub(m)}
          </Text>
        </View>
        <Pressable onPress={() => navigation.navigate('You')}>
          <YouAvatar size={42} fontSize={13} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 22, paddingHorizontal: 40, paddingTop: 22, paddingBottom: 110 }}>
        {/* left column: the day's work */}
        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          {m.missed && !m.allDone && <MissedBanner />}

          {m.allDone && (
            <Pop>
              <DayDone streak={m.streak} preview={m.preview} onEncore={celebrate} />
            </Pop>
          )}

          {m.restDay ? (
            <RestDay preview={m.preview} />
          ) : (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 4 }}>
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: FADED }}>TODAY'S REPS</Text>
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: GREEN }}>
                  {m.done} OF {m.total} BANKED
                </Text>
              </View>

              {m.perGoal.filter(g => g.reps.length > 0).map(g => (
                <React.Fragment key={g.goal.id}>
                  <GroupHeader
                    g={g}
                    open={!closed[g.goal.id]}
                    onToggle={() => setClosed(prev => ({ ...prev, [g.goal.id]: !prev[g.goal.id] }))}
                  />
                  {!closed[g.goal.id] && g.reps.map(rep => (
                    <RepCard
                      key={rep.step.id}
                      rep={rep}
                      loggedValue={loggedValueFor(byGoal[g.goal.id] ?? [], rep.step.id, m.today)}
                      qty={qtyFor(g, rep)}
                      onCheck={() => checkInStep(g.goal.id, rep.step.id, rep.step.kind === 'duration' ? rep.step.duration_minutes ?? null : null)}
                      onUncheck={() => uncheckStep(g.goal.id, rep.step.id)}
                    />
                  ))}
                </React.Fragment>
              ))}

              {nudge && (
                <Text style={{ paddingHorizontal: 4, paddingTop: 2, fontFamily: fonts.semibold, fontSize: 12.5, color: FADED }}>
                  {nudge} <Text style={{ color: 'rgba(38,43,51,0.35)' }}>— Qoach</Text>
                </Text>
              )}
            </>
          )}
        </View>

        {/* right column: the living sidebar */}
        <View style={{ width: 264, gap: 12 }}>
          <ProgressRingCard done={m.done} total={m.total} />

          <SideCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ minWidth: 44, alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 30, color: INK }}>{m.streak}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: INK }}>day streak</Text>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, lineHeight: 16, color: colors.muted, marginTop: 2 }}>
                  {m.allDone ? 'banked today — see you tomorrow' : '+1 lands when today is banked'}
                </Text>
              </View>
            </View>
          </SideCard>

          <SideCard>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: FADED, marginBottom: 12 }}>THIS WEEK</Text>
            <WeekDots days={m.strip} />
            {m.perGoal.length === 1 && (
              <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.muted, marginTop: 12 }}>
                week {m.perGoal[0].week} of {m.perGoal[0].goal.protocol.duration_weeks}
              </Text>
            )}
          </SideCard>

          {milestoneRows.length > 0 && (
            <SideCard tinted>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: colors.inviteAccent }}>⚑ NEXT MILESTONES</Text>
              {milestoneRows.map(({ g, mi }, i) => (
                <View key={`${g.goal.id}:${mi.id}`}>
                  {i > 0 && <View style={{ height: 1, backgroundColor: colors.inviteBorder, marginVertical: 12 }} />}
                  <View style={{ flexDirection: 'row', gap: 9, marginTop: i === 0 ? 12 : 0 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: g.dot, marginTop: 5 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.serif, fontSize: 14.5, lineHeight: 19, color: INK }}>{mi.title}</Text>
                      <Text numberOfLines={2} style={{ fontFamily: fonts.semibold, fontSize: 11, lineHeight: 16.5, color: colors.inviteAccent, marginTop: 2 }}>
                        week {mi.week} — {mi.criteria}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </SideCard>
          )}
        </View>
      </View>
    </View>
  );
}

/* ── shared header + the screen ─────────────────────────────────────────── */

function Header({ title, sub }: { title: string; sub: string }) {
  const navigation = useNavigation<any>();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 24 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.serif, fontSize: 30, lineHeight: 34.5, color: INK }}>{title}</Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 5 }}>{sub}</Text>
      </View>
      <Pressable onPress={() => navigation.navigate('You')}>
        <YouAvatar size={40} fontSize={12} />
      </Pressable>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { profile, goals, checkInsByGoal } = useRally();
  const wide = Platform.OS === 'web' && width >= 980;
  const confettiRef = useRef<ConfettiHandle>(null);
  const celebrate = useCallback(() => confettiRef.current?.fire(), []);

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: wide ? 26 : Math.max(insets.top, 58) + 16 }}
        showsVerticalScrollIndicator={false}
      >
        {goals.length > 0 ? (
          wide
            ? <DesktopToday goals={goals} byGoal={checkInsByGoal} celebrate={celebrate} />
            : <TodayLoop goals={goals} byGoal={checkInsByGoal} celebrate={celebrate} />
        ) : (
          <View style={wide ? { width: '100%', maxWidth: 560, alignSelf: 'center', paddingTop: 40 } : undefined}>
            <Header title={greeting(false, profile.firstName)} sub="Nothing on the clock yet" />
            <NoGoalYet />
          </View>
        )}
      </ScrollView>
      {/* the salute lives outside the scroll so the cannons anchor to the
          viewport corners, exactly like the canvas' fixed overlay */}
      <Confetti ref={confettiRef} />
    </FadeInUp>
  );
}
