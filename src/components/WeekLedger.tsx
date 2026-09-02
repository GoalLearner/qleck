// The week grid as it lives INSIDE the day-complete card on Today.
//
// Same arithmetic as the full Ledger screen (src/lib/ledgerWeek.ts), two
// deliberate differences, both from the design's brief:
//
//  1. MISSES ARE QUIET. On the Ledger screen a miss is salmon, because that
//     screen is where you go to audit. Here it renders as `spent` — a faint
//     filled square: visibly not banked, visibly not an open outline, and
//     silent. At the moment you finish a day the card's one question is
//     "what did I bank", and salmon is an instruction about a Tuesday you
//     can no longer do anything about.
//  2. TODAY'S CELL MOVES. It arrives as an open outline and fills 0.7s after
//     the grid lands — one 1.12x breath, then a halo it keeps for the rest of
//     the day. It is the only animated cell, because it is the only one the
//     user just caused.
//
// Past six rows the grid becomes an accordion keyed by goal, one open at a
// time, so the card never grows past ~5 rows on a phone.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import FadeInUp from './FadeInUp';
import { goalTitle } from './protocolViews';
import {
  DAY_LETTERS, rowsForWeek, stepsWithSessionDays, todayColumn,
  type CellState, type LedgerRow,
} from '../lib/ledgerWeek';
import { phaseForWeek, weekOf, weekStart, type CheckIn } from '../lib/protocolTime';
import type { ActiveGoal } from '../state/RallyContext';
import { colors, fonts } from '../theme';

const CELL = 24;
const GAP = 5;
/** Past this many rows the grid groups by goal instead of listing every rep. */
const ACCORDION_AFTER = 6;

function Cell({ state, isToday }: { state: CellState; isToday: boolean }) {
  const live = isToday && state === 'banked';
  const t = useRef(new Animated.Value(live ? 0 : 1)).current;
  useEffect(() => {
    if (!live) return;
    Animated.timing(t, { toValue: 1, duration: 550, delay: 700, useNativeDriver: true }).start();
  }, [live, t]);

  const box = { width: CELL, height: CELL, borderRadius: 7 } as const;
  switch (state) {
    case 'blank': return <View style={box} />;
    case 'off': return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.inkFaint }} />
      </View>
    );
    case 'pending': return <View style={[box, { borderWidth: 1.5, borderColor: colors.outline }]} />;
    case 'missed': return <View style={[box, { backgroundColor: colors.spent }]} />;
    default: break;
  }
  if (!live) return <View style={[box, { backgroundColor: colors.success }]} />;
  // The breath is on the wrapper so the whole cell scales; the halo and the
  // fill ride its opacity, which keeps all of it on the native driver.
  return (
    <Animated.View style={[box, { transform: [{ scale: t.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 1.12, 1] }) }] }]}>
      <Animated.View style={{ position: 'absolute', left: -3, top: -3, right: -3, bottom: -3, borderRadius: 10, backgroundColor: colors.successHalo, opacity: t }} />
      <View style={[box, { position: 'absolute', borderWidth: 1.5, borderColor: colors.outline }]} />
      <Animated.View style={[box, { position: 'absolute', backgroundColor: colors.success, opacity: t }]} />
    </Animated.View>
  );
}

function Row({ row, col, delay }: { row: LedgerRow; col: number; delay: number }) {
  return (
    <FadeInUp distance={6} duration={400} delay={delay} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16.9, color: colors.ink }}>
          {row.step.title}
        </Text>
        {row.perfect ? (
          <View style={{ alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.successBg }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 9.5, letterSpacing: 0.9, color: colors.success }}>PERFECT</Text>
          </View>
        ) : null}
        {row.quota ? (
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.muted, marginTop: 3 }}>{row.quota}</Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {row.cells.map((c, i) => <Cell key={i} state={c} isToday={i === col} />)}
      </View>
    </FadeInUp>
  );
}

export default function WeekLedger({ goals, byGoal, today, nextLine, onOpenLedger }: {
  goals: ActiveGoal[];
  byGoal: Record<string, CheckIn[]>;
  today: string;
  /** The "Friday: ..." line, which moves down here once the card is open. */
  nextLine: string | null;
  onOpenLedger: () => void;
}) {
  const monday = weekStart(today);
  const col = todayColumn(monday, today);
  const [openGroup, setOpenGroup] = useState(0);

  const groups = useMemo(() => goals.map(g => {
    const week = weekOf(g.startedOn, today, g.protocol.duration_weeks, g.pauses);
    const steps = stepsWithSessionDays(g.protocol, phaseForWeek(g.protocol, week).steps);
    const rows = steps
      .map(s => rowsForWeek(s, g.startedOn, g.protocol.duration_weeks, monday, today, byGoal[g.id] ?? [], g.pauses))
      .filter(r => r.cells.some(c => c !== 'blank'));
    return { goal: g, rows };
  }).filter(gr => gr.rows.length > 0), [goals, byGoal, monday, today]);

  if (groups.length === 0) return null;
  const totalRows = groups.reduce((n, gr) => n + gr.rows.length, 0);
  const grouped = totalRows > ACCORDION_AFTER;
  let rendered = 0;

  return (
    <View style={{ paddingTop: 18 }}>
      {/* day letters, sitting over the cell columns */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', gap: GAP }}>
          {DAY_LETTERS.map((l, i) => (
            <View key={i} style={{ width: CELL, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 10, color: i === col ? colors.ink : colors.sectionLabel }}>{l}</Text>
            </View>
          ))}
        </View>
      </View>

      {groups.map((gr, gi) => {
        const open = !grouped || openGroup === gi;
        const perfect = gr.rows.filter(r => r.perfect).length;
        return (
          <View key={gr.goal.id}>
            {grouped ? (
              <Pressable
                onPress={() => setOpenGroup(gi)}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 11, marginTop: 4,
                }}
              >
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.bold, fontSize: 13, color: colors.ink }}>
                  {goalTitle(gr.goal.statement, gr.goal.protocol)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.muted }}>
                    {gr.rows.length} reps{perfect ? ` · ${perfect} perfect` : ''}
                  </Text>
                  <Text style={{ width: 10, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 12, color: colors.muted }}>
                    {open ? '▾' : '▸'}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {open ? gr.rows.map(r => {
              const delay = 80 + rendered * 50;
              rendered++;
              return <Row key={r.step.id} row={r} col={col} delay={delay} />;
            }) : null}
          </View>
        );
      })}

      {/* the only exit, beside the next-up line the closed card was showing */}
      <Pressable
        onPress={onOpenLedger}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border,
        }}
      >
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.medium, fontSize: 12.5, color: colors.muted }}>
          {nextLine ?? ''}
        </Text>
        <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.success }}>Ledger ›</Text>
      </Pressable>
    </View>
  );
}
