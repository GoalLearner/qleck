// Today — the daily check-in loop, ported from the Claude Design canvas
// `Qleck Today.dc.html` onto the real temporal layer (src/lib/protocolTime)
// and the outbox-backed check-in record. States: morning (reps to do),
// day done, rest day, missed-yesterday banner, milestone flag, no goal.
//
// P2a renders and records; P4 adds nudges, adaptation and the milestone
// celebration moment (the canvas' "ease this week" card ships then, when the
// revise flow gets a client).
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
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

function greeting(restDay: boolean, name: string): string {
  if (restDay) return `Easy, ${name}.`;
  const h = new Date().getHours();
  const part = h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  return `${part}, ${name}.`;
}

/* ── week strip ─────────────────────────────────────────────────────────── */

function dotStyle(kind: WeekDay['kind']) {
  switch (kind) {
    case 'done': return { backgroundColor: '#47694f', borderColor: '#47694f' };
    case 'today': return { backgroundColor: 'transparent', borderColor: INK };
    case 'missed': return { backgroundColor: 'transparent', borderColor: '#c96f5f' };
    case 'rest': return { backgroundColor: 'rgba(38,43,51,0.12)', borderColor: 'transparent' };
    default: return { backgroundColor: 'transparent', borderColor: 'rgba(38,43,51,0.22)' };
  }
}

function WeekStrip({ days }: { days: WeekDay[] }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, marginHorizontal: 24, paddingHorizontal: 6 }}>
      {days.map(d => (
        <View key={d.date} style={{ alignItems: 'center', gap: 7 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, color: d.isToday ? INK : FADED }}>{d.letter}</Text>
          <View style={[{ width: 10, height: 10, borderRadius: 5, borderWidth: 2 }, dotStyle(d.kind)]} />
        </View>
      ))}
    </View>
  );
}

/* ── rep card with the springy check ────────────────────────────────────── */

function kindChip(rep: DayRep) {
  const k = rep.step.kind;
  if (k === 'duration') return { glyph: 'D', bg: colors.openBg, fg: colors.accentLink };
  if (k === 'quantity') return { glyph: '#', bg: '#e4e6f4', fg: '#4d5680' };
  return { glyph: '✓', bg: '#dcecdf', fg: '#47694f' };
}

function repMetric(rep: DayRep): string {
  const s = rep.step;
  const base =
    s.kind === 'duration' && s.duration_minutes ? `${s.duration_minutes} min`
    : s.kind === 'quantity' && s.quantity ? `${s.quantity.amount} ${s.quantity.unit}`
    : 'once today';
  return rep.quotaLabel ? `${base} · ${rep.quotaLabel}` : base;
}

function RepCard({ rep, onCheck }: { rep: DayRep; onCheck: () => void }) {
  const chip = kindChip(rep);
  const scale = useRef(new Animated.Value(1)).current;
  const wasChecked = useRef(rep.checked);

  useEffect(() => {
    if (rep.checked && !wasChecked.current) {
      scale.setValue(0.5);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
    wasChecked.current = rep.checked;
  }, [rep.checked, scale]);

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
        <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: chip.fg, marginTop: 2 }}>{repMetric(rep)}</Text>
        {!rep.checked && !!rep.step.details && (
          <Text numberOfLines={2} style={{ fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 4 }}>
            {rep.step.details}
          </Text>
        )}
      </View>
      <Pressable onPress={rep.checked ? undefined : onCheck} hitSlop={6}>
        <Animated.View
          style={{
            width: 46, height: 46, borderRadius: 23,
            backgroundColor: rep.checked ? '#47694f' : 'transparent',
            borderWidth: 2, borderColor: rep.checked ? '#47694f' : 'rgba(38,43,51,0.18)',
            alignItems: 'center', justifyContent: 'center',
            transform: [{ scale }],
          }}
        >
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 20, color: rep.checked ? colors.creamText : 'transparent' }}>✓</Text>
        </Animated.View>
      </Pressable>
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
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: '#47694f' }}>{streak}-day streak</Text>
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

/* ── the screen ─────────────────────────────────────────────────────────── */

function TodayLoop({ protocol, startedOn, checkIns }: { protocol: Protocol; startedOn: string; checkIns: CheckIn[] }) {
  const { checkInStep, profile } = useRally();
  const today = localDate();
  const week = weekOf(startedOn, today, protocol.duration_weeks);
  const phase = phaseForWeek(protocol, week);
  const reps = repsForDate(protocol, startedOn, today, checkIns);
  const strip = weekStrip(protocol, startedOn, today, checkIns);
  const streak = streakDays(today, checkIns);
  const missed = missedYesterday(protocol, startedOn, today, checkIns);
  const preview = tomorrowPreview(protocol, startedOn, today, checkIns);
  const nextMilestone = [...protocol.milestones].sort((a, b) => a.week - b.week).find(m => m.week >= week);

  const allDone = reps.length > 0 && reps.every(r => r.checked);
  const restDay = reps.length === 0;

  return (
    <>
      <Header
        title={greeting(restDay && !allDone, profile.firstName)}
        sub={`${weekdayName(today)} · week ${week} of ${protocol.duration_weeks}`}
      />
      <WeekStrip days={strip} />

      <View style={{ flex: 1, gap: 14, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 130 }}>
        {missed && !allDone && (
          <View style={{ backgroundColor: colors.inviteBg, borderWidth: 1, borderColor: colors.inviteBorder, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 18.75, color: colors.inviteAccent }}>
              Yesterday slipped — today still makes this week work.
            </Text>
          </View>
        )}

        {allDone && (
          <Pop>
            <DayDone streak={streak} preview={preview} />
          </Pop>
        )}

        {restDay ? (
          <RestDay preview={preview} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: FADED }}>TODAY'S REPS</Text>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: FADED }}>
                {phase.title.toUpperCase()}
              </Text>
            </View>
            {reps.map(rep => (
              <RepCard key={rep.step.id} rep={rep} onCheck={() => checkInStep(rep.step.id, rep.step.kind === 'duration' ? rep.step.duration_minutes ?? null : rep.step.kind === 'quantity' ? rep.step.quantity?.amount ?? null : null)} />
            ))}
          </>
        )}

        {!restDay && nextMilestone && (
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
  const { profile, goalStartedOn, checkIns } = useRally();

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: Math.max(insets.top, 58) + 16 }}
        showsVerticalScrollIndicator={false}
      >
        {profile.protocol ? (
          <TodayLoop protocol={profile.protocol} startedOn={goalStartedOn} checkIns={checkIns} />
        ) : (
          <>
            <Header title={greeting(false, profile.firstName)} sub="Nothing on the clock yet" />
            <NoGoalYet />
          </>
        )}
      </ScrollView>
    </FadeInUp>
  );
}
