// The Ledger (owner feature, build 12): a week grid of every habit in the
// plan — one row per step, one cell per day — so you can SEE how perfect
// the reps actually landed. Banked days fill green, scheduled-but-missed
// days fill red, off-days stay faint, and a row that hit every scheduled
// day so far wears a PERFECT chip. The ‹ › pager walks back to the week
// the plan started. Read-only by design: banking belongs to Today.
//
// Every style is inline and every color is read at render (theme rule —
// the palettes are rewritten in place when appearance flips).
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAppearance } from '../state/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import { goalDot, goalTitle } from '../components/protocolViews';
import type { ProtocolStep } from '../api/coachTypes';
import { localDate } from '../api/device';
import {
  addDays, phaseForWeek, planIsOver, stepPinnedOn, weekOf, weekStart, type CheckIn,
  type PauseSpan,
} from '../lib/protocolTime';
import { useRally } from '../state/RallyContext';
import { colors, fonts } from '../theme';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type CellState = 'banked' | 'missed' | 'pending' | 'off' | 'blank';

interface LedgerRow {
  step: ProtocolStep;
  cells: CellState[];
  /** Quota steps: "2 of 3" for the week; null for pinned-day steps. */
  quota: string | null;
  perfect: boolean;
}

function rowsForWeek(
  step: ProtocolStep, startedOn: string, durationWeeks: number,
  monday: string, today: string, checkIns: CheckIn[], pauses?: PauseSpan[],
): LedgerRow {
  const cells: CellState[] = [];
  const pinned = (step.frequency.days?.length ?? 0) > 0;
  let scheduledPast = 0, bankedPast = 0, bankedWeek = 0, inPlanDays = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const inPlan = date >= startedOn && !planIsOver(startedOn, durationWeeks, date, pauses);
    if (!inPlan) { cells.push('blank'); continue; }
    inPlanDays++;
    const banked = checkIns.some(c => c.step_id === step.id && c.local_date === date);
    if (banked) bankedWeek++;
    if (pinned) {
      const scheduled = stepPinnedOn(step, date);
      if (!scheduled) { cells.push(banked ? 'banked' : 'off'); continue; }
      if (banked) { cells.push('banked'); if (date <= today) { scheduledPast++; bankedPast++; } continue; }
      if (date < today) { cells.push('missed'); scheduledPast++; continue; }
      cells.push('pending');
      if (date === today) scheduledPast++;
    } else {
      cells.push(banked ? 'banked' : date <= today ? 'off' : 'pending');
    }
  }
  // A quota is only fair against the days the plan actually covered — a
  // "7 per week" habit on a plan that started Sunday has ONE possible day
  // that week, not seven (same at the plan's final partial week).
  const required = Math.min(step.frequency.per_week, inPlanDays);
  const quota = !pinned && step.frequency.per_week >= 1
    ? `${Math.min(bankedWeek, required)} of ${required}`
    : null;
  // PERFECT: pinned rows — every scheduled day so far banked (and at least
  // one banked); quota rows — the week's (pro-rated) quota already met.
  const perfect = pinned
    ? bankedPast > 0 && bankedPast === scheduledPast && !cells.includes('missed')
    : required >= 1 && bankedWeek >= required;
  return { step, cells, quota, perfect };
}

function Cell({ state }: { state: CellState }) {
  const box = { width: 24, height: 24, borderRadius: 7 } as const;
  switch (state) {
    case 'banked': return <View style={[box, { backgroundColor: colors.success }]} />;
    case 'missed': return <View style={[box, { backgroundColor: colors.missed, opacity: 0.75 }]} />;
    case 'pending': return <View style={[box, { borderWidth: 1.5, borderColor: colors.outline }]} />;
    case 'off': return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.trackIdle }} />
      </View>
    );
    default: return <View style={box} />;
  }
}

export default function LedgerScreen() {
  useAppearance();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { goals, checkInsByGoal } = useRally();
  const today = localDate();
  const thisMonday = weekStart(today);
  // Weeks run from the earliest plan's start week to the current week.
  const firstMonday = goals.length
    ? goals.map(g => weekStart(g.startedOn)).sort()[0]
    : thisMonday;
  const [monday, setMonday] = useState(thisMonday);
  const canBack = monday > firstMonday;
  const canFwd = monday < thisMonday;

  const perGoal = useMemo(() => goals.map((g, i) => {
    const week = weekOf(g.startedOn, addDays(monday, 6) < g.startedOn ? g.startedOn : addDays(monday, 6), g.protocol.duration_weeks, g.pauses);
    const phase = phaseForWeek(g.protocol, week);
    // Session-attached steps carry their schedule on the SESSION (2b) — the
    // same repair repsForDate performs, done here without mutating shared
    // protocol objects.
    const sessionDays = new Map((g.protocol.sessions ?? []).map(sess => [sess.id, sess.days]));
    const rows = phase.steps.map(raw => {
      const days = raw.session_id && (raw.frequency.days?.length ?? 0) === 0
        ? sessionDays.get(raw.session_id) ?? raw.frequency.days
        : raw.frequency.days;
      const s: ProtocolStep = days === raw.frequency.days ? raw : { ...raw, frequency: { ...raw.frequency, days: days ? [...days] : days } };
      return rowsForWeek(s, g.startedOn, g.protocol.duration_weeks, monday, today, checkInsByGoal[g.id] ?? [], g.pauses);
    });
    return { goal: g, dot: goalDot(i), rows: rows.filter(r => r.cells.some(c => c !== 'blank')) };
  }).filter(p => p.rows.length > 0), [goals, checkInsByGoal, monday, today]);

  const totalRows = perGoal.reduce((n, p) => n + p.rows.length, 0);
  const perfectRows = perGoal.reduce((n, p) => n + p.rows.filter(r => r.perfect).length, 0);
  const weekEnd = addDays(monday, 6);
  const fmt = (d: string) => {
    const dt = new Date(`${d}T12:00:00`);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 34) + 12, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 20 }}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ alignSelf: 'flex-start' }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.muted }}>‹ Back</Text>
          </Pressable>
          <Text style={{ fontFamily: fonts.serif, fontSize: 30, lineHeight: 34.5, color: colors.ink, marginTop: 12 }}>The ledger</Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 6 }}>
            {totalRows > 0
              ? `${perfectRows} of ${totalRows} habits perfect this week`
              : 'How the reps actually landed'}
          </Text>

          {/* week pager */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
            <Pressable
              onPress={() => canBack && setMonday(addDays(monday, -7))}
              disabled={!canBack}
              hitSlop={10}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: canBack ? colors.outline : colors.border, alignItems: 'center', justifyContent: 'center', opacity: canBack ? 1 : 0.35 }}
            >
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, color: colors.ink }}>‹</Text>
            </Pressable>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 1.4, color: colors.sectionLabel }}>
                {monday === thisMonday ? 'THIS WEEK' : 'WEEK OF'}
              </Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.ink, marginTop: 2 }}>
                {fmt(monday)} — {fmt(weekEnd)}
              </Text>
            </View>
            <Pressable
              onPress={() => canFwd && setMonday(addDays(monday, 7))}
              disabled={!canFwd}
              hitSlop={10}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: canFwd ? colors.outline : colors.border, alignItems: 'center', justifyContent: 'center', opacity: canFwd ? 1 : 0.35 }}
            >
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, color: colors.ink }}>›</Text>
            </Pressable>
          </View>

          {totalRows === 0 ? (
            <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 26, padding: 20, marginTop: 20 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.muted }}>
                Nothing ran this week — the plan hadn't started yet.
              </Text>
            </View>
          ) : perGoal.map(p => (
            <View key={p.goal.id} style={{ marginTop: 22 }}>
              {perGoal.length > 1 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.dot }} />
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.serif, fontSize: 15, color: colors.ink }}>
                    {goalTitle(p.goal.statement, p.goal.protocol)}
                  </Text>
                </View>
              )}
              <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 26, paddingVertical: 8, paddingHorizontal: 14 }}>
                {/* day letters */}
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                  <View style={{ flex: 1 }} />
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {DAY_LETTERS.map((l, i) => (
                      <View key={i} style={{ width: 24, alignItems: 'center' }}>
                        <Text style={{ fontFamily: fonts.extrabold, fontSize: 9.5, color: addDays(monday, i) === today ? colors.ink : colors.sectionLabel }}>{l}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ width: 56 }} />
                </View>
                {p.rows.map((r, ri) => (
                  <View key={r.step.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: ri === 0 ? 0 : 1, borderTopColor: colors.border }}>
                    <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                      <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, color: colors.ink }}>{r.step.title}</Text>
                      {r.quota && (
                        <Text style={{ fontFamily: fonts.semibold, fontSize: 10, color: colors.muted, marginTop: 1 }}>{r.quota} this week</Text>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {r.cells.map((c, i) => <Cell key={i} state={c} />)}
                    </View>
                    <View style={{ width: 56, alignItems: 'flex-end' }}>
                      {r.perfect && (
                        <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.successBg }}>
                          <Text style={{ fontFamily: fonts.extrabold, fontSize: 8, letterSpacing: 0.8, color: colors.success }}>PERFECT</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}

          {totalRows > 0 && (
            <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, lineHeight: 17, color: colors.sectionLabel, marginTop: 16, textAlign: 'center' }}>
              Green banked · red missed · outline still to come. Banking lives on Today.
            </Text>
          )}
        </View>
      </ScrollView>
    </FadeInUp>
  );
}
