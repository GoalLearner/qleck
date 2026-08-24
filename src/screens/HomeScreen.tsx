// Today — the daily check-in loop, ported from the Claude Design canvas
// `Qleck Today.dc.html` onto the real temporal layer (src/lib/protocolTime)
// and the outbox-backed check-in record. States: morning (reps to do),
// day done, rest day, missed-yesterday banner, milestone flag, no goal.
//
// Two layouts from the same data: the phone loop (canvas §1) and, on wide web
// viewports, the desktop two-column Today (canvas §2) — reps left under a
// per-goal group header, a living sidebar right (progress ring, streak,
// week dots, next milestones). Checks toggle (un-check is a real server
// delete), quantity reps log an actual number, and Qoach's one-liner reacts
// to what's left.
//
// P2a renders and records; P4 adds nudges, adaptation and the milestone
// celebration moment (the canvas' "ease this week" card ships then, when the
// revise flow gets a client).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import { Pop } from '../onboarding/ui';
import YouAvatar from '../components/YouAvatar';
import type { Protocol } from '../api/coachTypes';
import { localDate } from '../api/device';
import {
  missedYesterday, phaseForWeek, repsForDate, streakDays, tomorrowPreview, weekdayName,
  weekOf, weekStrip, type CheckIn, type DayRep, type WeekDay,
} from '../lib/protocolTime';
import { useRally } from '../state/RallyContext';
import { colors, fonts } from '../theme';

const INK = colors.ink;
const FADED = colors.sectionLabel;
const GREEN = '#47694f';

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
// receipts (owner call, 2026-08-24 — evidence is the reward).
function DayDone({ streak, preview }: { streak: number; preview: string | null }) {
  return (
    <View
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
    </View>
  );
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

/* ── shared per-day derivations ─────────────────────────────────────────── */

function useTodayModel(protocol: Protocol, startedOn: string, checkIns: CheckIn[]) {
  const today = localDate();
  const week = weekOf(startedOn, today, protocol.duration_weeks);
  const phase = phaseForWeek(protocol, week);
  const reps = repsForDate(protocol, startedOn, today, checkIns);
  const done = reps.filter(r => r.checked).length;
  return {
    today, week, phase, reps, done,
    total: reps.length,
    allDone: reps.length > 0 && done === reps.length,
    restDay: reps.length === 0,
    strip: weekStrip(protocol, startedOn, today, checkIns),
    streak: streakDays(today, checkIns),
    missed: missedYesterday(protocol, startedOn, today, checkIns),
    preview: tomorrowPreview(protocol, startedOn, today, checkIns),
  };
}

function loggedValueFor(checkIns: CheckIn[], stepId: string, today: string): number | null {
  return checkIns.find(c => c.step_id === stepId && c.local_date === today)?.value ?? null;
}

/* ── the phone loop (canvas §1) ─────────────────────────────────────────── */

function TodayLoop({ protocol, startedOn, checkIns }: { protocol: Protocol; startedOn: string; checkIns: CheckIn[] }) {
  const { checkInStep, uncheckStep, profile } = useRally();
  const m = useTodayModel(protocol, startedOn, checkIns);
  const nextMilestone = [...protocol.milestones].sort((a, b) => a.week - b.week).find(mi => mi.week >= m.week);

  return (
    <>
      <Header
        title={greeting(m.restDay && !m.allDone, profile.firstName)}
        sub={`${weekdayName(m.today)} · week ${m.week} of ${protocol.duration_weeks}`}
      />
      <WeekStrip days={m.strip} />

      <View style={{ flex: 1, gap: 14, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 130 }}>
        {m.missed && !m.allDone && <MissedBanner />}

        {m.allDone && (
          <Pop>
            <DayDone streak={m.streak} preview={m.preview} />
          </Pop>
        )}

        {m.restDay ? (
          <RestDay preview={m.preview} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: FADED }}>TODAY'S REPS</Text>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: FADED }}>
                {m.phase.title.toUpperCase()}
              </Text>
            </View>
            {m.reps.map(rep => (
              <RepCard
                key={rep.step.id}
                rep={rep}
                loggedValue={loggedValueFor(checkIns, rep.step.id, m.today)}
                onCheck={() => checkInStep(rep.step.id, rep.step.kind === 'duration' ? rep.step.duration_minutes ?? null : rep.step.kind === 'quantity' ? rep.step.quantity?.amount ?? null : null)}
                onUncheck={() => uncheckStep(rep.step.id)}
              />
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

function DesktopToday({ protocol, startedOn, checkIns }: { protocol: Protocol; startedOn: string; checkIns: CheckIn[] }) {
  const { checkInStep, uncheckStep, profile } = useRally();
  const navigation = useNavigation<any>();
  const m = useTodayModel(protocol, startedOn, checkIns);
  const [open, setOpen] = useState(true);
  const [qtyVals, setQtyVals] = useState<Record<string, number>>({});

  const milestones = [...protocol.milestones].sort((a, b) => a.week - b.week).filter(mi => mi.week >= m.week).slice(0, 2);
  const nudge = nudgeLine(m.done, m.total);
  const milestoneDots = ['#4d5680', GREEN];

  const qtyFor = (rep: DayRep): QtyControls | undefined => {
    const q = rep.step.quantity;
    if (rep.step.kind !== 'quantity' || !q) return undefined;
    const stepSize = q.amount >= 20 ? 5 : 1;
    const value = qtyVals[rep.step.id] ?? q.amount;
    const set = (v: number) => setQtyVals(prev => ({ ...prev, [rep.step.id]: v }));
    return {
      value, unit: q.unit,
      inc: () => set(Math.min(999, value + stepSize)),
      dec: () => set(Math.max(stepSize === 5 ? 5 : 0, value - stepSize)),
      log: () => checkInStep(rep.step.id, value),
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
            {weekdayName(m.today)} · week {m.week} of {protocol.duration_weeks} — {m.phase.title}
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
              <DayDone streak={m.streak} preview={m.preview} />
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

              {/* goal group header — one goal today; the grouping is the
                  multi-goal shape the canvas runs two of */}
              <Pressable
                onPress={() => setOpen(o => !o)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 8 }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN }} />
                <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.extrabold, fontSize: 11.5, letterSpacing: 1.2, color: INK }}>
                  {protocol.goal_statement.toUpperCase()}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: FADED }}>· {m.phase.title}</Text>
                <View style={{ flex: 1 }} />
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, color: GREEN }}>{m.done}/{m.total}</Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: FADED, width: 12, textAlign: 'center' }}>{open ? '▾' : '▸'}</Text>
              </Pressable>

              {open && m.reps.map(rep => (
                <RepCard
                  key={rep.step.id}
                  rep={rep}
                  loggedValue={loggedValueFor(checkIns, rep.step.id, m.today)}
                  qty={qtyFor(rep)}
                  onCheck={() => checkInStep(rep.step.id, rep.step.kind === 'duration' ? rep.step.duration_minutes ?? null : null)}
                  onUncheck={() => uncheckStep(rep.step.id)}
                />
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
            <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.muted, marginTop: 12 }}>
              week {m.week} of {protocol.duration_weeks}
            </Text>
          </SideCard>

          {milestones.length > 0 && (
            <SideCard tinted>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: colors.inviteAccent }}>⚑ NEXT MILESTONES</Text>
              {milestones.map((mi, i) => (
                <View key={mi.id}>
                  {i > 0 && <View style={{ height: 1, backgroundColor: colors.inviteBorder, marginVertical: 12 }} />}
                  <View style={{ flexDirection: 'row', gap: 9, marginTop: i === 0 ? 12 : 0 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: milestoneDots[i % 2], marginTop: 5 }} />
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
  const { profile, goalStartedOn, checkIns } = useRally();
  const wide = Platform.OS === 'web' && width >= 980;

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: wide ? 26 : Math.max(insets.top, 58) + 16 }}
        showsVerticalScrollIndicator={false}
      >
        {profile.protocol ? (
          wide
            ? <DesktopToday protocol={profile.protocol} startedOn={goalStartedOn} checkIns={checkIns} />
            : <TodayLoop protocol={profile.protocol} startedOn={goalStartedOn} checkIns={checkIns} />
        ) : (
          <View style={wide ? { width: '100%', maxWidth: 560, alignSelf: 'center', paddingTop: 40 } : undefined}>
            <Header title={greeting(false, profile.firstName)} sub="Nothing on the clock yet" />
            <NoGoalYet />
          </View>
        )}
      </ScrollView>
    </FadeInUp>
  );
}
