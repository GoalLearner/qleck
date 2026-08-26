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
import { Animated, Dimensions, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Confetti, { type ConfettiHandle } from '../components/Confetti';
import FadeInUp from '../components/FadeInUp';
import { goalDot, goalTitle } from '../components/protocolViews';
import { Pop } from '../onboarding/ui';
import YouAvatar from '../components/YouAvatar';
import type { ProtocolPhase } from '../api/coachTypes';
import { localDate } from '../api/device';
import { celebrateDay, celebrateGoal, hapticCheck } from '../lib/celebrate';
import {
  allCheckIns, mergedMissedYesterday, mergedTomorrowPreview, mergedWeekStrip,
  phaseForWeek, repsForDate, streakDays, weekdayName, weekOf,
  type CheckIn, type DayRep, type WeekDay,
} from '../lib/protocolTime';
import { useRally, type ActiveGoal } from '../state/RallyContext';
import { colors, fonts } from '../theme';


function greeting(restDay: boolean, name: string): string {
  if (restDay) return `Easy, ${name}.`;
  const h = new Date().getHours();
  const part = h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  return `${part}, ${name}.`;
}

/* ── week strip ─────────────────────────────────────────────────────────── */

function dotStyle(kind: WeekDay['kind']) {
  switch (kind) {
    case 'done': return { backgroundColor: colors.success, borderColor: colors.success };
    case 'today': return { backgroundColor: 'transparent', borderColor: colors.ink };
    case 'missed': return { backgroundColor: 'transparent', borderColor: colors.missed };
    case 'rest': return { backgroundColor: colors.trackIdle, borderColor: 'transparent' };
    default: return { backgroundColor: 'transparent', borderColor: colors.dotUpcoming };
  }
}

function WeekDots({ days }: { days: WeekDay[] }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
      {days.map(d => (
        <View key={d.date} style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, color: d.isToday ? colors.ink : colors.sectionLabel }}>{d.letter}</Text>
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
  if (k === 'quantity') return { glyph: '#', bg: colors.quantityBg, fg: colors.quantityFg };
  return { glyph: '✓', bg: colors.successBg, fg: colors.successFg };
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

/** −/value/+ and Log it. `stacked` lays it out full-width on its own row, which
 *  is the only way it fits a phone card; the desktop keeps it inline. */
function Stepper({ qty, stacked }: { qty: QtyControls; stacked: boolean }) {
  const round = (
    <>
      <Pressable
        onPress={qty.dec}
        hitSlop={6}
        style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: colors.outlineStrong, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 17, color: colors.ink }}>−</Text>
      </Pressable>
      <Text
        style={{
          minWidth: stacked ? 0 : 58, flex: stacked ? 1 : undefined, textAlign: 'center',
          fontFamily: fonts.extrabold, fontSize: 15, color: colors.ink,
        }}
      >
        {qty.value} {qty.unit}
      </Text>
      <Pressable
        onPress={qty.inc}
        hitSlop={6}
        style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: colors.outlineStrong, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 17, color: colors.ink }}>+</Text>
      </Pressable>
    </>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: stacked ? 1 : undefined }}>
      {round}
      <Pressable
        onPress={qty.log}
        style={{
          height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: colors.navy,
          alignItems: 'center', justifyContent: 'center', marginLeft: 4,
        }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 13.5, color: colors.creamText }}>Log it</Text>
      </Pressable>
    </View>
  );
}

function RepCard({ rep, onCheck, onUncheck, loggedValue, qty, stacked = false }: {
  rep: DayRep;
  onCheck: () => void;
  onUncheck: () => void;
  loggedValue?: number | null;
  qty?: QtyControls;
  /** Phone layout: the stepper gets its own row under the title. */
  stacked?: boolean;
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
  const stackStepper = showStepper && stacked;

  const check = (
    <Pressable onPress={rep.checked ? onUncheck : onCheck} hitSlop={6}>
      <Animated.View
        style={{
          width: 46, height: 46, borderRadius: 23,
          backgroundColor: rep.checked ? colors.success : 'transparent',
          borderWidth: 2, borderColor: rep.checked ? colors.success : colors.outline,
          alignItems: 'center', justifyContent: 'center',
          transform: [{ scale }],
        }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 20, color: rep.checked ? colors.creamText : 'transparent' }}>✓</Text>
      </Animated.View>
    </Pressable>
  );

  return (
    <View
      style={{
        backgroundColor: rep.checked ? colors.doneBg : colors.card,
        borderWidth: 1, borderColor: rep.checked ? colors.doneBorder : colors.border,
        borderRadius: 26, padding: rep.checked ? 14 : 18,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: chip.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: chip.fg }}>{chip.glyph}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, opacity: rep.checked ? 0.55 : 1 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 19.5, color: colors.ink }}>{rep.step.title}</Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: chip.fg, marginTop: 2 }}>{repMetric(rep, loggedValue)}</Text>
          {!rep.checked && !!rep.step.details && (
            <Text numberOfLines={2} style={{ fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 4 }}>
              {rep.step.details}
            </Text>
          )}
        </View>
        {showStepper
          ? (stacked ? null : <Stepper qty={qty!} stacked={false} />)
          : check}
      </View>
      {stackStepper && (
        <View style={{ flexDirection: 'row', marginTop: 14 }}>
          <Stepper qty={qty!} stacked />
        </View>
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
        alignItems: 'center', gap: 12, backgroundColor: colors.doneBg,
        borderWidth: 1, borderColor: colors.doneBorder, borderRadius: 26,
        paddingVertical: 22, paddingHorizontal: 18,
      }}
    >
      <Text style={{ fontFamily: fonts.serif, fontSize: 27, color: colors.ink }}>That's today.</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.successBg }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: colors.success }}>{streak}-day streak</Text>
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
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.sectionLabel }}>confetti's free — tap for an encore</Text>
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

/** The middle tier of the reward ladder: when one goal's last rep of the day
 * lands (and it isn't also the day's last — the full salute owns that), pop a
 * mini burst in the goal's color from its group header. Transition-only:
 * hydration arriving with goals already complete stays silent. */
function useGoalCelebrations(
  m: { perGoal: GoalToday[]; allDone: boolean },
  headerRefs: React.MutableRefObject<Record<string, View | null>>,
  onGoal: (x: number, y: number, color: string) => void,
) {
  const prev = useRef<Record<string, boolean>>({});
  const key = m.perGoal.map(g => `${g.goal.id}:${g.done}/${g.reps.length}`).join('|');
  useEffect(() => {
    const now: Record<string, boolean> = {};
    for (const g of m.perGoal) now[g.goal.id] = g.reps.length > 0 && g.done === g.reps.length;
    for (const g of m.perGoal) {
      const id = g.goal.id;
      if (now[id] && prev.current[id] === false && !m.allDone) {
        const el = headerRefs.current[id];
        if (el) {
          el.measureInWindow((x, y, w, h) => onGoal(x + w - 36, y + h / 2, g.dot));
        } else {
          onGoal(Dimensions.get('window').width / 2, 200, g.dot);
        }
      }
    }
    prev.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, m.allDone]);
}

function RestDay({ preview }: { preview: string | null }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 30, paddingHorizontal: 24 }}>
      <Text style={{ fontFamily: fonts.serif, fontSize: 30, color: colors.ink }}>Nothing scheduled.</Text>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.muted }}>Rest is part of the plan.</Text>
      {preview && (
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 20, color: colors.sectionLabel, marginTop: 10, textAlign: 'center' }}>
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
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 21.6, color: colors.onNavyMuted, textAlign: 'center' }}>
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
    return { goal: g, week, phase, reps, done: reps.filter(r => r.checked).length, dot: goalDot(i) };
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

/**
 * A goal group folds itself away once its last rep of the day is banked
 * (owner call 2026-08-25) — only unfinished work stays open, so a six-goal
 * morning shrinks as you work through it. An explicit tap on the header wins
 * over the default for the rest of the session, either direction: you can
 * reopen a finished goal to un-check something, or fold one you haven't
 * started yet.
 */
function useGroupFolding() {
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const defaultOpen = (g: GoalToday) => !(g.reps.length > 0 && g.done === g.reps.length);
  const isOpen = (g: GoalToday) => override[g.goal.id] ?? defaultOpen(g);
  const toggle = (g: GoalToday) =>
    setOverride(prev => ({ ...prev, [g.goal.id]: !(prev[g.goal.id] ?? defaultOpen(g)) }));
  return { isOpen, toggle };
}

// Just the goal name and the count — no phase, no method detail (owner call
// 2026-08-24: less information, keep it simple; the Goals tab holds the rest).
function GroupHeader({ g, open, onToggle, headerRef }: {
  g: GoalToday; open: boolean; onToggle: () => void; headerRef?: (el: View | null) => void;
}) {
  return (
    <Pressable
      ref={headerRef}
      onPress={onToggle}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 8 }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: g.dot }} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.extrabold, fontSize: 11.5, letterSpacing: 1.2, color: colors.ink }}>
        {goalTitle(g.goal.statement, g.goal.protocol).toUpperCase()}
      </Text>
      <View style={{ flex: 1 }} />
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, color: g.dot }}>{g.done}/{g.reps.length}</Text>
      <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.sectionLabel, width: 12, textAlign: 'center' }}>{open ? '▾' : '▸'}</Text>
    </Pressable>
  );
}

/**
 * Per-rep stepper state, shared by both layouts. The value seeds from the
 * step's own target, so "just do what the plan says" is one tap on Log it and
 * the honest number is a few taps either side of it.
 */
function useQtyControls(checkInStep: (goalId: string, stepId: string, value?: number | null) => void) {
  const [vals, setVals] = useState<Record<string, number>>({});
  return (g: GoalToday, rep: DayRep): QtyControls | undefined => {
    const q = rep.step.quantity;
    if (rep.step.kind !== 'quantity' || !q) return undefined;
    const stepSize = q.amount >= 20 ? 5 : 1;
    const key = `${g.goal.id}:${rep.step.id}`;
    const value = vals[key] ?? q.amount;
    const set = (v: number) => setVals(prev => ({ ...prev, [key]: v }));
    return {
      value, unit: q.unit,
      inc: () => set(Math.min(999, value + stepSize)),
      // A cap step ("at most 10 cigarettes") can legitimately be zero — that's
      // the win — so the floor is 0, not the step size.
      dec: () => set(Math.max(0, value - stepSize)),
      log: () => { hapticCheck(); checkInStep(g.goal.id, rep.step.id, value); },
    };
  };
}

/* ── the phone loop (canvas §1, grouped when goals run concurrently) ────── */

function TodayLoop({ goals, byGoal, celebrate, miniBurst }: {
  goals: ActiveGoal[]; byGoal: Record<string, CheckIn[]>;
  celebrate: () => void; miniBurst: (x: number, y: number, color: string) => void;
}) {
  const { checkInStep, uncheckStep, profile } = useRally();
  const m = useTodayModel(goals, byGoal);
  const fold = useGroupFolding();
  const headerRefs = useRef<Record<string, View | null>>({});
  const multi = m.perGoal.length > 1;
  const milestoneOwner = m.perGoal.find(g => nextMilestoneOf(g));
  const nextMilestone = milestoneOwner ? nextMilestoneOf(milestoneOwner) : null;
  useCelebrateOnDone(m.allDone, celebrate);
  useGoalCelebrations(m, headerRefs, miniBurst);
  const qtyFor = useQtyControls(checkInStep);

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
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel }}>TODAY'S REPS</Text>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: multi ? colors.success : colors.sectionLabel }}>
                {multi ? `${m.done} OF ${m.total} BANKED` : m.perGoal[0].phase.title.toUpperCase()}
              </Text>
            </View>
            {m.perGoal.filter(g => g.reps.length > 0).map(g => (
              <React.Fragment key={g.goal.id}>
                {multi && (
                  <GroupHeader
                    g={g}
                    headerRef={el => { headerRefs.current[g.goal.id] = el; }}
                    open={fold.isOpen(g)}
                    onToggle={() => fold.toggle(g)}
                  />
                )}
                {(!multi || fold.isOpen(g)) && g.reps.map(rep => (
                  <RepCard
                    key={rep.step.id}
                    rep={rep}
                    stacked
                    qty={qtyFor(g, rep)}
                    loggedValue={loggedValueFor(byGoal[g.goal.id] ?? [], rep.step.id, m.today)}
                    onCheck={() => { hapticCheck(); checkInStep(g.goal.id, rep.step.id, rep.step.kind === 'duration' ? rep.step.duration_minutes ?? null : null); }}
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
            <Circle cx={42} cy={42} r={34} fill="none" stroke={colors.ringTrack} strokeWidth={8} />
            <Circle
              cx={42} cy={42} r={34} fill="none" stroke={colors.success} strokeWidth={8} strokeLinecap="round"
              strokeDasharray={`${RING_C}`} strokeDashoffset={RING_C * (1 - frac)}
            />
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 16, color: colors.ink }}>
              {total > 0 ? `${done}/${total}` : '—'}
            </Text>
          </View>
        </View>
        <View>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel }}>TODAY</Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.ink, marginTop: 3 }}>reps banked</Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.muted, marginTop: 2 }}>resets at midnight</Text>
        </View>
      </View>
    </SideCard>
  );
}

function DesktopToday({ goals, byGoal, celebrate, miniBurst }: {
  goals: ActiveGoal[]; byGoal: Record<string, CheckIn[]>;
  celebrate: () => void; miniBurst: (x: number, y: number, color: string) => void;
}) {
  const { checkInStep, uncheckStep, profile } = useRally();
  const navigation = useNavigation<any>();
  const m = useTodayModel(goals, byGoal);
  const fold = useGroupFolding();
  const headerRefs = useRef<Record<string, View | null>>({});
  useCelebrateOnDone(m.allDone, celebrate);
  useGoalCelebrations(m, headerRefs, miniBurst);

  const milestoneRows = m.perGoal
    .map(g => ({ g, mi: nextMilestoneOf(g) }))
    .filter((r): r is { g: GoalToday; mi: NonNullable<ReturnType<typeof nextMilestoneOf>> } => r.mi !== null)
    .slice(0, 3);
  const nudge = nudgeLine(m.done, m.total);

  const qtyFor = useQtyControls(checkInStep);

  return (
    <View style={{ width: '100%', maxWidth: 1060, alignSelf: 'center' }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 40 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 34, lineHeight: 38, color: colors.ink }}>
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
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel }}>TODAY'S REPS</Text>
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.success }}>
                  {m.done} OF {m.total} BANKED
                </Text>
              </View>

              {m.perGoal.filter(g => g.reps.length > 0).map(g => (
                <React.Fragment key={g.goal.id}>
                  <GroupHeader
                    g={g}
                    headerRef={el => { headerRefs.current[g.goal.id] = el; }}
                    open={fold.isOpen(g)}
                    onToggle={() => fold.toggle(g)}
                  />
                  {fold.isOpen(g) && g.reps.map(rep => (
                    <RepCard
                      key={rep.step.id}
                      rep={rep}
                      loggedValue={loggedValueFor(byGoal[g.goal.id] ?? [], rep.step.id, m.today)}
                      qty={qtyFor(g, rep)}
                      onCheck={() => { hapticCheck(); checkInStep(g.goal.id, rep.step.id, rep.step.kind === 'duration' ? rep.step.duration_minutes ?? null : null); }}
                      onUncheck={() => uncheckStep(g.goal.id, rep.step.id)}
                    />
                  ))}
                </React.Fragment>
              ))}

              {nudge && (
                <Text style={{ paddingHorizontal: 4, paddingTop: 2, fontFamily: fonts.semibold, fontSize: 12.5, color: colors.sectionLabel }}>
                  {nudge} <Text style={{ color: colors.inkFaint }}>— Qoach</Text>
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
                <Text style={{ fontFamily: fonts.serif, fontSize: 30, color: colors.ink }}>{m.streak}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.ink }}>day streak</Text>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, lineHeight: 16, color: colors.muted, marginTop: 2 }}>
                  {m.allDone ? 'banked today — see you tomorrow' : '+1 lands when today is banked'}
                </Text>
              </View>
            </View>
          </SideCard>

          <SideCard>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel, marginBottom: 12 }}>THIS WEEK</Text>
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
                      <Text style={{ fontFamily: fonts.serif, fontSize: 14.5, lineHeight: 19, color: colors.ink }}>{mi.title}</Text>
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
        <Text style={{ fontFamily: fonts.serif, fontSize: 30, lineHeight: 34.5, color: colors.ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 5 }}>{sub}</Text>
      </View>
      <Pressable onPress={() => navigation.navigate('You')}>
        <YouAvatar size={40} fontSize={12} />
      </Pressable>
    </View>
  );
}

/**
 * A plan that reached its end. Today stops scheduling reps from it (there are
 * none left), so without this card it would simply vanish from the day — or,
 * if it were the only goal, read as a permanent rest day. The ceremony waits
 * here until the user opens it.
 */
function FinishedGoalCard({ goal, onOpen }: { goal: ActiveGoal; onOpen: () => void }) {
  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: colors.doneBg, borderWidth: 1, borderColor: colors.doneBorder,
        borderRadius: 26, paddingVertical: 18, paddingHorizontal: 20,
        flexDirection: 'row', alignItems: 'center', gap: 14,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.success }}>
          PLAN COMPLETE
        </Text>
        <Text style={{ fontFamily: fonts.serif, fontSize: 19, lineHeight: 25, color: colors.ink, marginTop: 6 }}>
          {goalTitle(goal.statement, goal.protocol)}
        </Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 18, color: colors.muted, marginTop: 4 }}>
          {goal.protocol.duration_weeks} weeks, done. See how it went and pick what's next.
        </Text>
      </View>
      <Text style={{ fontFamily: fonts.bold, fontSize: 18, color: colors.success }}>›</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const { profile, liveGoals, endedGoals, checkInsByGoal } = useRally();
  const goals = liveGoals;
  const wide = Platform.OS === 'web' && width >= 980;
  const confettiRef = useRef<ConfettiHandle>(null);
  const celebrate = useCallback(() => {
    confettiRef.current?.fire();
    celebrateDay();
  }, []);
  const miniBurst = useCallback((x: number, y: number, color: string) => {
    confettiRef.current?.fireMini(x, y, color);
    celebrateGoal();
  }, []);

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: wide ? 26 : Math.max(insets.top, 58) + 16 }}
        showsVerticalScrollIndicator={false}
      >
        {endedGoals.length > 0 && (
          <View
            style={{
              width: '100%', maxWidth: wide ? 1060 : undefined, alignSelf: 'center',
              paddingHorizontal: wide ? 40 : 24,
              paddingTop: goals.length > 0 ? 0 : Math.max(insets.top, 8),
              paddingBottom: goals.length > 0 ? 18 : 0,
              gap: 10,
            }}
          >
            {endedGoals.map(g => (
              <FinishedGoalCard
                key={g.id}
                goal={g}
                onOpen={() => navigation.navigate('Graduation', { goalId: g.id })}
              />
            ))}
          </View>
        )}

        {goals.length > 0 ? (
          wide
            ? <DesktopToday goals={goals} byGoal={checkInsByGoal} celebrate={celebrate} miniBurst={miniBurst} />
            : <TodayLoop goals={goals} byGoal={checkInsByGoal} celebrate={celebrate} miniBurst={miniBurst} />
        ) : endedGoals.length === 0 ? (
          <View style={wide ? { width: '100%', maxWidth: 560, alignSelf: 'center', paddingTop: 40 } : undefined}>
            <Header title={greeting(false, profile.firstName)} sub="Nothing on the clock yet" />
            <NoGoalYet />
          </View>
        ) : null}
      </ScrollView>
      {/* the salute lives outside the scroll so the cannons anchor to the
          viewport corners, exactly like the canvas' fixed overlay */}
      <Confetti ref={confettiRef} />
    </FadeInUp>
  );
}
