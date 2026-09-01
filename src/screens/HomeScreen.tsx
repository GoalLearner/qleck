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
// TextInput is aliased: babel-preset-expo's web import-rewrite emitted a
// bare `TextInput.default` reference for the plain named import in THIS
// module (and only this one), which threw at runtime. The alias sidesteps
// whatever the rewrite trips on.
import { Animated, Dimensions, Platform, Pressable, ScrollView, Text, TextInput as RNTextInput, View, useWindowDimensions } from 'react-native';
import { useAppearance } from '../state/ThemeContext';
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
import { celebrateDay, celebrateGoal, celebratePlan, hapticCheck } from '../lib/celebrate';
import { loadSeenMilestones, markMilestonesSeen } from '../lib/milestones';
import {
  allCheckIns, freshMilestones, mergedMissedTwice, mergedMissedYesterday, mergedTomorrowPreview, mergedWeekStrip, oddsTier, phaseForWeek, reforecastOdds, repsForDate, streakDays, type ActiveGoalLike, type CheckIn, type ReachedMilestone, reachedMilestones, type DayRep, type WeekDay, weekOf, weekdayName,
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

function WeekDots({ days, selected, onPick }: {
  days: WeekDay[];
  /** The date being viewed (defaults to today's own styling). */
  selected?: string;
  /** Owner fix 3 (build 11): the dots are tappable — any day of the week
   *  opens as a read-only peek (past shows what was banked). */
  onPick?: (d: WeekDay) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
      {days.map(d => {
        const sel = selected != null && d.date === selected;
        return (
          <Pressable
            key={d.date}
            onPress={onPick ? () => onPick(d) : undefined}
            disabled={!onPick}
            hitSlop={8}
            style={{ alignItems: 'center', gap: 6 }}
          >
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, color: sel || d.isToday ? colors.ink : colors.sectionLabel }}>{d.letter}</Text>
            <View
              style={[
                { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
                dotStyle(d.kind),
                sel && !d.isToday ? { borderColor: colors.ink } : null,
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function WeekStrip({ days, selected, onPick }: { days: WeekDay[]; selected?: string; onPick?: (d: WeekDay) => void }) {
  return (
    <View style={{ marginTop: 22, marginHorizontal: 24, paddingHorizontal: 4 }}>
      <WeekDots days={days} selected={selected} onPick={onPick} />
    </View>
  );
}

/* ── day peek: tap a week dot to read any day (owner fix 3, build 11) ────
   Past days show what was actually banked; future days show what's
   scheduled. Nothing here is checkable — banking belongs to today. */
function DayPeek({ goals, byGoal, date, today, onBack }: {
  goals: ActiveGoal[]; byGoal: Record<string, CheckIn[]>;
  date: string; today: string; onBack: () => void;
}) {
  const per = goals
    .map((g, i) => ({
      goal: g, dot: goalDot(i),
      reps: repsForDate(g.protocol, g.startedOn, date, byGoal[g.id] ?? []),
    }))
    .filter(p => p.reps.length > 0);
  const total = per.reduce((n, p) => n + p.reps.length, 0);
  const done = per.reduce((n, p) => n + p.reps.filter(r => r.checked).length, 0);
  const past = date < today;
  const label = weekdayName(date).toUpperCase();
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel }}>
          {label}{past ? "'S REPS" : ' — SCHEDULED'}
        </Text>
        <Text numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right', fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: past && total > 0 && done === total ? colors.success : colors.sectionLabel }}>
          {total === 0 ? 'REST DAY' : past ? `${done} OF ${total} BANKED` : `${total} REP${total === 1 ? '' : 'S'}`}
        </Text>
      </View>
      {total === 0 ? (
        <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 26, padding: 18 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.muted }}>
            Nothing {past ? 'was' : 'is'} on the plan — a rest day.
          </Text>
        </View>
      ) : (
        per.map(p =>
          p.reps.map(rep => (
            <RepCard
              key={`${p.goal.id}:${rep.step.id}`}
              rep={rep}
              stacked
              readOnly
              loggedValue={loggedValueFor(byGoal[p.goal.id] ?? [], rep.step.id, date)}
              onCheck={() => {}}
              onUncheck={() => {}}
            />
          )),
        )
      )}
      <Pressable
        onPress={onBack}
        style={{ alignSelf: 'center', marginTop: 4, paddingHorizontal: 18, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: colors.ink }}>← BACK TO TODAY</Text>
      </Pressable>
    </>
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
  text: string;
  setText: (t: string) => void;
  unit: string;
  placeholder: string;
  /** True for a baseline-less measurement: blank must not log a fake 0. */
  needsNumber: boolean;
  log: () => void;
}

/** A typed number and Log it. The steppers are gone (owner call 2026-08-28):
 *  a measurement step ("glute circumference") needs the REAL number — 92.5,
 *  not a count nudged around a target — and the value lands in check-ins for
 *  the coach's future re-forecasts. Blank still logs the step's own target,
 *  so "just do what the plan says" stays one tap. `stacked` lays it out
 *  full-width on its own row, the only way it fits a phone card. */
function QtyInput({ qty, stacked }: { qty: QtyControls; stacked: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: stacked ? 1 : undefined }}>
      <View
        style={{
          flex: stacked ? 1 : undefined, minWidth: stacked ? 0 : 130,
          flexDirection: 'row', alignItems: 'center', gap: 6,
          height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.outlineStrong,
          paddingHorizontal: 14, backgroundColor: colors.card,
        }}
      >
        <RNTextInput
          value={qty.text}
          onChangeText={t => qty.setText(t.replace(/[^0-9.,]/g, ''))}
          placeholder={qty.placeholder}
          placeholderTextColor={colors.inkFaint}
          keyboardType="decimal-pad"
          inputMode="decimal"
          style={{
            flex: 1, minWidth: 34, paddingVertical: 0,
            fontFamily: fonts.extrabold, fontSize: 15, color: colors.ink,
          }}
        />
        <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.inkSoft, maxWidth: 110 }}>
          {qty.unit}
        </Text>
      </View>
      <Pressable
        onPress={qty.needsNumber && qty.text.trim() === '' ? undefined : qty.log}
        style={{
          height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: colors.navy,
          alignItems: 'center', justifyContent: 'center',
          opacity: qty.needsNumber && qty.text.trim() === '' ? 0.4 : 1,
        }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 13.5, color: colors.creamText }}>Log it</Text>
      </Pressable>
    </View>
  );
}

function RepCard({ rep, onCheck, onUncheck, loggedValue, qty, stacked = false, readOnly = false }: {
  rep: DayRep;
  onCheck: () => void;
  onUncheck: () => void;
  loggedValue?: number | null;
  qty?: QtyControls;
  /** Phone layout: the stepper gets its own row under the title. */
  stacked?: boolean;
  /** Day peek: the check displays state but takes no taps. */
  readOnly?: boolean;
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
    <Pressable onPress={readOnly ? undefined : rep.checked ? onUncheck : onCheck} disabled={readOnly} hitSlop={6}>
      <Animated.View
        style={{
          width: 46, height: 46, borderRadius: 23,
          backgroundColor: rep.checked ? colors.success : 'transparent',
          borderWidth: 2, borderColor: rep.checked ? colors.success : colors.outline,
          alignItems: 'center', justifyContent: 'center',
          opacity: readOnly && !rep.checked ? 0.45 : 1,
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
          ? (stacked ? null : <QtyInput qty={qty!} stacked={false} />)
          : check}
      </View>
      {stackStepper && (
        <View style={{ flexDirection: 'row', marginTop: 14 }}>
          <QtyInput qty={qty!} stacked />
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

/**
 * P4 live milestones: the moment one is earned, not a footnote at graduation.
 *
 * On first run the currently-earned set is recorded SILENTLY — otherwise
 * updating the app would throw a party for a milestone earned three weeks
 * ago. After that, anything newly earned is celebrated once.
 */
function useMilestoneCelebration(goals: ActiveGoal[], byGoal: Record<string, CheckIn[]>) {
  const [pending, setPending] = useState<ReachedMilestone | null>(null);
  const seenRef = useRef<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const seen = await loadSeenMilestones();
      if (!alive) return;
      if (seen.length === 0) {
        // Nothing recorded yet: adopt whatever is already earned as history.
        const earned = reachedMilestones(goals, byGoal).map(m => m.key);
        seenRef.current = earned;
        void markMilestonesSeen(earned);
      } else {
        seenRef.current = seen;
      }
    })();
    return () => { alive = false; };
    // Deliberately once: this is the seeding pass, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (seenRef.current === null || pending) return;
    const fresh = freshMilestones(goals, byGoal, seenRef.current);
    if (fresh.length === 0) return;
    const next = fresh[0];
    seenRef.current = [...seenRef.current, next.key];
    void markMilestonesSeen([next.key]);
    setPending(next);
    celebratePlan();
  }, [goals, byGoal, pending]);

  return { pending, dismiss: useCallback(() => setPending(null), []) };
}

function MilestoneCard({ hit, onDismiss }: { hit: ReachedMilestone; onDismiss: () => void }) {
  return (
    <Pop>
      <View
        style={{
          backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.success,
          borderRadius: 20, paddingHorizontal: 18, paddingVertical: 16, gap: 7,
        }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 1.5, color: colors.success }}>
          MILESTONE — WEEK {hit.milestone.week}
        </Text>
        <Text style={{ fontFamily: fonts.serif, fontSize: 21, lineHeight: 27, color: colors.ink }}>
          {hit.milestone.title}
        </Text>
        <Text style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 19.5, color: colors.inkSoft }}>
          {hit.milestone.criteria}
        </Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18, color: colors.muted }}>
          You earned this on {hit.goalTitle} — the week held.
        </Text>
        <Pressable
          onPress={onDismiss}
          style={{
            alignSelf: 'flex-start', marginTop: 4, height: 38, paddingHorizontal: 18,
            borderRadius: 19, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 12.5, color: colors.creamText }}>
            Nice
          </Text>
        </Pressable>
      </View>
    </Pop>
  );
}

/** P4 never-miss-twice: two scheduled days in a row passed unbanked. One
 *  miss is noise and gets the gentle banner above; two is the moment the
 *  habit is actually deciding, so this one is louder and hands back a rung —
 *  the rep after a miss, or one tap to an easier week. */
function ComebackBanner({ goals }: { goals: ActiveGoalLike[] }) {
  const navigation = useNavigation<any>();
  const first = goals[0];
  const name = goalTitle(first.protocol.goal_statement, first.protocol);
  const title = goals.length > 1 ? `Two misses in a row — ${goals.length} goals waiting.` : `Two misses in a row on ${name}.`;
  return (
    <View style={{ backgroundColor: colors.inviteBg, borderWidth: 1.5, borderColor: colors.inviteAccent, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, gap: 6 }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 13, lineHeight: 19, color: colors.inviteAccent }}>
        {title}
      </Text>
      <Text style={{ fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18.75, color: colors.ink }}>
        One missed day is noise. The rep after a miss is the one that decides the habit — and today is that rep. Small counts.
      </Text>
      <Pressable
        onPress={() => navigation.navigate('AdjustPlan', { goalId: first.id, reason: 'too_hard' })}
        hitSlop={6}
        style={{ alignSelf: 'flex-start', marginTop: 2 }}
      >
        <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: colors.accentLink, textDecorationLine: 'underline' }}>
          Too much right now? Make the weeks ahead easier
        </Text>
      </Pressable>
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
    missedTwiceGoals: mergedMissedTwice(goals, byGoal, today),
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
/**
 * QOACH'S CALL, given a real home. The tiny header chips only carry a number;
 * this card is where the number is EXPLAINED — what it measures, and whether
 * it is good — once, so every smaller mention inherits the meaning.
 */
function OddsCard({ perGoal, byGoal, today, multi }: {
  perGoal: GoalToday[]; byGoal: Record<string, CheckIn[]>; today: string; multi: boolean;
}) {
  const rows = perGoal
    .map(g => ({ g, rf: reforecastOdds(g.goal.odds, g.goal.protocol, g.goal.startedOn, byGoal[g.goal.id] ?? [], today) }))
    .filter((r): r is { g: GoalToday; rf: NonNullable<ReturnType<typeof reforecastOdds>> } => r.rf !== null);
  if (rows.length === 0) return null;
  return (
    <SideCard>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel, marginBottom: 10 }}>
        QOACH'S CALL
      </Text>
      <View style={{ gap: 12 }}>
        {rows.map(({ g, rf }) => {
          const tier = oddsTier(rf.current);
          return (
            <View key={g.goal.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ minWidth: 52, alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 26, color: rf.drifted ? colors.inviteAccent : colors.ink }}>
                  {rf.current}
                  <Text style={{ fontSize: 14, color: colors.muted }}>%</Text>
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 13, color: rf.drifted ? colors.inviteAccent : colors.success }}>
                  {rf.drifted ? `Slipping — was ${rf.original}%` : tier.label}
                </Text>
                {multi ? (
                  <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.muted, marginTop: 1 }}>
                    {goalTitle(g.goal.statement, g.goal.protocol)}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, lineHeight: 16.5, color: colors.muted, marginTop: 10 }}>
        {rows.some(r => r.rf.drifted)
          ? 'The odds this lands, updated as you go — bank reps and it climbs back.'
          : 'The odds this lands — if you do the reps as written. It moves with what you do.'}
      </Text>
    </SideCard>
  );
}

/** Single-goal Today has no group header, so the odds join the section label:
 *  "84% · BUILD THE GROOVE" (or "84→71% · ..." while drifted). */
function singleHeaderLabel(g: GoalToday, byGoal: Record<string, CheckIn[]>, today: string): string {
  const rf = reforecastOdds(g.goal.odds, g.goal.protocol, g.goal.startedOn, byGoal[g.goal.id] ?? [], today);
  const phase = g.phase.title.toUpperCase();
  if (!rf) return phase;
  if (rf.drifted) return `WAS ${rf.original} · NOW ${rf.current}% · ${phase}`;
  return `${oddsTier(rf.current).label.toUpperCase()} · ${rf.current}% · ${phase}`;
}

function GroupHeader({ g, checkIns, today, open, onToggle, headerRef }: {
  g: GoalToday; checkIns: CheckIn[]; today: string; open: boolean; onToggle: () => void; headerRef?: (el: View | null) => void;
}) {
  // The odds ride the header, re-forecast live: green while the plan holds,
  // amber with the drop spelled out when recent weeks slipped.
  const rf = reforecastOdds(g.goal.odds, g.goal.protocol, g.goal.startedOn, checkIns, today);
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
      {rf ? (
        <Text numberOfLines={1} style={{ fontFamily: fonts.extrabold, fontSize: 11.5, color: rf.drifted ? colors.inviteAccent : colors.success }}>
          {rf.drifted
            ? `was ${rf.original} · now ${rf.current}%`
            : `${oddsTier(rf.current).label} · ${rf.current}%`}
        </Text>
      ) : null}
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
  const [texts, setTexts] = useState<Record<string, string>>({});
  return (g: GoalToday, rep: DayRep): QtyControls | undefined => {
    const q = rep.step.quantity;
    if (rep.step.kind !== 'quantity' || !q) return undefined;
    const key = `${g.goal.id}:${rep.step.id}`;
    const text = texts[key] ?? '';
    // amount 0 means two opposite things, split by direction: an at_most cap
    // at 0 is abstinence (one blank tap logs the win), an at_least 0 is a
    // baseline-less measurement (a number must be typed — protocol prompt
    // v20's "first logged number IS the baseline").
    const needsNumber = q.amount === 0 && q.direction !== 'at_most';
    return {
      text,
      setText: (t: string) => setTexts(prev => ({ ...prev, [key]: t })),
      unit: q.unit,
      placeholder: q.amount > 0 ? String(q.amount) : '',
      needsNumber,
      log: () => {
        // Blank = the plan's own target (one tap keeps working); a typed
        // number — decimals included, comma tolerated — is the real value.
        // Zero is legitimate: on a cap step ("at most 10 cigarettes") it IS
        // the win.
        const parsed = Number(text.replace(',', '.'));
        const value = text.trim() !== '' && Number.isFinite(parsed) && parsed >= 0
          ? Math.min(parsed, 99999)
          : q.amount;
        hapticCheck();
        checkInStep(g.goal.id, rep.step.id, value);
        setTexts(prev => ({ ...prev, [key]: '' }));
      },
    };
  };
}

/** The re-forecast moment (canvas 5's promise made true): when the last two
 *  completed weeks slipped, the accepted odds drift down — derived, never
 *  stored — and this strip says so without guilt, with the way back named.
 *  It disappears on its own as banked reps pull the number home. */
function ReforecastStrip({ goal, checkIns, today }: { goal: ActiveGoal; checkIns: CheckIn[]; today: string }) {
  const navigation = useNavigation<any>();
  const rf = reforecastOdds(goal.odds, goal.protocol, goal.startedOn, checkIns, today);
  if (!rf || !rf.drifted) return null;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: colors.inviteBg, borderWidth: 1, borderColor: colors.inviteBorder,
        borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 1.3, color: colors.inviteAccent }}>
          QOACH RE-FORECAST
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 3 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 16, color: colors.ink }}>
            {rf.original} → {rf.current}%
          </Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.inkSoft }}>if you show up</Text>
        </View>
        <Text style={{ marginTop: 3, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17, color: colors.inkSoft }}>
          The plan still works — the showing up slipped. Bank reps and the number climbs back, or bend the plan.
        </Text>
      </View>
      <Pressable
        onPress={() => navigation.navigate('AdjustPlan', { goalId: goal.id })}
        style={{
          paddingHorizontal: 14, height: 38, borderRadius: 19,
          borderWidth: 1.5, borderColor: colors.inviteAccent,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: colors.inviteAccent }}>Adjust</Text>
      </Pressable>
    </View>
  );
}

/* ── the phone loop (canvas §1, grouped when goals run concurrently) ────── */

function TodayLoop({ goals, byGoal, celebrate, miniBurst }: {
  goals: ActiveGoal[]; byGoal: Record<string, CheckIn[]>;
  celebrate: () => void; miniBurst: (x: number, y: number, color: string) => void;
}) {
  const { checkInStep, uncheckStep, profile } = useRally();
  const m = useTodayModel(goals, byGoal);
  const milestone = useMilestoneCelebration(goals, byGoal);
  const fold = useGroupFolding();
  const headerRefs = useRef<Record<string, View | null>>({});
  const multi = m.perGoal.length > 1;
  const milestoneOwner = m.perGoal.find(g => nextMilestoneOf(g));
  const nextMilestone = milestoneOwner ? nextMilestoneOf(milestoneOwner) : null;
  useCelebrateOnDone(m.allDone, celebrate);
  useGoalCelebrations(m, headerRefs, miniBurst);
  const qtyFor = useQtyControls(checkInStep);
  // Owner fix 3 (build 11): tap a week dot to peek at any day of the week.
  // null = live today. All today-machinery (celebrations, folding, banners)
  // stays keyed to the real today — the peek is a read-only overlay.
  const [peek, setPeek] = useState<string | null>(null);

  if (peek) {
    return (
      <>
        <Header title={greeting(false, profile.firstName)} sub={`Peeking at ${weekdayName(peek)} — today keeps the clock`} />
        <WeekStrip days={m.strip} selected={peek} onPick={d => setPeek(d.date === m.today ? null : d.date)} />
        <View style={{ flex: 1, gap: 14, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 130 }}>
          <DayPeek goals={goals} byGoal={byGoal} date={peek} today={m.today} onBack={() => setPeek(null)} />
        </View>
      </>
    );
  }

  return (
    <>
      <Header title={greeting(m.restDay && !m.allDone, profile.firstName)} sub={headerSub(m)} />
      <WeekStrip days={m.strip} selected={m.today} onPick={d => setPeek(d.date === m.today ? null : d.date)} />

      <View style={{ flex: 1, gap: 14, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 130 }}>
        {milestone.pending ? <MilestoneCard hit={milestone.pending} onDismiss={milestone.dismiss} /> : null}
          {m.missedTwiceGoals.length > 0 && !m.allDone ? <ComebackBanner goals={m.missedTwiceGoals} /> : m.missed && !m.allDone ? <MissedBanner /> : null}

        {m.allDone && (
          <Pop>
            <DayDone streak={m.streak} preview={m.preview} onEncore={celebrate} />
          </Pop>
        )}

        {m.restDay ? (
          <RestDay preview={m.preview} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel }}>TODAY'S REPS</Text>
              {/* flexShrink: without it a long right label ("SOLID ODDS · 85%
                  · BUILD THE EASY-MILE HABIT") rammed into the left one. */}
              <Text numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right', fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: multi ? colors.success : colors.sectionLabel }}>
                {multi ? `${m.done} OF ${m.total} BANKED` : singleHeaderLabel(m.perGoal[0], byGoal, m.today)}
              </Text>
            </View>
            {m.perGoal.filter(g => g.reps.length > 0).map(g => (
              <React.Fragment key={g.goal.id}>
                {multi && (
                  <GroupHeader
                    g={g}
                    checkIns={byGoal[g.goal.id] ?? []}
                    today={m.today}
                    headerRef={el => { headerRefs.current[g.goal.id] = el; }}
                    open={fold.isOpen(g)}
                    onToggle={() => fold.toggle(g)}
                  />
                )}
                {(!multi || fold.isOpen(g)) && (
                  <ReforecastStrip goal={g.goal} checkIns={byGoal[g.goal.id] ?? []} today={m.today} />
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
  const milestone = useMilestoneCelebration(goals, byGoal);
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
  // Owner fix 3 (build 11): the sidebar's week dots peek any day, read-only.
  const [peek, setPeek] = useState<string | null>(null);

  return (
    <View style={{ width: '100%', maxWidth: 1060, alignSelf: 'center' }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 40 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 34, lineHeight: 38, color: colors.ink }}>
            {greeting(m.restDay && !m.allDone, profile.firstName)}
          </Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 6 }}>
            {peek ? `Peeking at ${weekdayName(peek)} — today keeps the clock` : headerSub(m)}
          </Text>
        </View>
        <Pressable onPress={() => navigation.navigate('You')}>
          <YouAvatar size={42} fontSize={13} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 22, paddingHorizontal: 40, paddingTop: 22, paddingBottom: 110 }}>
        {/* left column: the day's work */}
        {peek ? (
          <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
            <DayPeek goals={goals} byGoal={byGoal} date={peek} today={m.today} onBack={() => setPeek(null)} />
          </View>
        ) : (
        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          {milestone.pending ? <MilestoneCard hit={milestone.pending} onDismiss={milestone.dismiss} /> : null}
          {m.missedTwiceGoals.length > 0 && !m.allDone ? <ComebackBanner goals={m.missedTwiceGoals} /> : m.missed && !m.allDone ? <MissedBanner /> : null}

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
                    checkIns={byGoal[g.goal.id] ?? []}
                    today={m.today}
                    headerRef={el => { headerRefs.current[g.goal.id] = el; }}
                    open={fold.isOpen(g)}
                    onToggle={() => fold.toggle(g)}
                  />
                  {fold.isOpen(g) && (
                    <ReforecastStrip goal={g.goal} checkIns={byGoal[g.goal.id] ?? []} today={m.today} />
                  )}
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
        )}

        {/* right column: the living sidebar */}
        <View style={{ width: 264, gap: 12 }}>
          <ProgressRingCard done={m.done} total={m.total} />

          <OddsCard perGoal={m.perGoal} byGoal={byGoal} today={m.today} multi={m.perGoal.length > 1} />

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
            <WeekDots days={m.strip} selected={peek ?? m.today} onPick={d => setPeek(d.date === m.today ? null : d.date)} />
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
  useAppearance();
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
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
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
