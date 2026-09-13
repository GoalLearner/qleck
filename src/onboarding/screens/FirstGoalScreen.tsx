// The Qoach intake flow — ported from the Claude Design canvas
// `Qleck Coach.dc.html` (project 7091d355) onto the live coach API.
// One screen hosts every state: intake → thinking → clarifying question →
// verdict (feasible / counter-offer) → protocol preview → lock in; refusal
// (pro / crisis variants), snag and quota states land from any AI step.
//
// The canvas' device frame + flow-map rail are mockup chrome (not ported);
// its fake routes are replaced by the real pipeline via useCoachFlow.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { DIAGONAL, night, nightFonts } from '../theme';
import { NightInput, Pop, PrimaryButton, Pulse, Screen, Segmented, Shake, Spacer, Spin, TextButton, Title } from '../ui';
import { OddsChip, OddsDial } from '../OddsDial';
import { SimVerdict, simPhaseLabel, type SimPhase } from '../SimVerdict';
import type { SimulationState } from '../../api/coachTypes';
import { reportAiResponse } from '../../api/coach';
import { useCoachFlow, type AcceptedPlan, type CoachFlow } from '../useCoachFlow';
import PredictScreen, { bandFor } from './PredictScreen';
import { ATTEMPT_FLOOR } from '../../api/coachTypes';
import type { PaceKey, Protocol, ProtocolEditOp, ProtocolMilestone, ProtocolPhase, ProtocolStep, Verdict } from '../../api/coachTypes';
import Confetti, { type ConfettiHandle } from '../../components/Confetti';
import { celebratePlan } from '../../lib/celebrate';
import {
  GOAL_INPUT_MAX, SPAN_PILLS, addDays, byWhenWeeks, foldTimeline, shortDate, todayYMD, wheelDays, wheelMonths, wheelPreview,
  type ByWhen, type YMD,
} from '../../lib/goalTimeline';


const MONO = nightFonts.mono;

// Mirrors MIN_CLARIFY_TURNS in backend/src/interviewBand.ts: the server guarantees at
// least this many questions, so the progress track can promise them.
const QUESTION_FLOOR = 3;

/* ── shared bits ────────────────────────────────────────────────────────── */

function QoachMark({ size = 30, fontSize = 17 }: { size?: number; fontSize?: number }) {
  return (
    <LinearGradient
      colors={[night.accent, night.violet]}
      start={DIAGONAL.start}
      end={DIAGONAL.end}
      style={{
        width: size, height: size, borderRadius: size / 3,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: night.accent, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
      }}
    >
      <Text style={{ fontFamily: nightFonts.display, fontSize, color: night.accentInk }}>Q</Text>
    </LinearGradient>
  );
}

function MonoLabel({ text, color = night.textGhost, style }: { text: string; color?: string; style?: object }) {
  return (
    <Text style={[{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.2, color, fontWeight: '700' }, style]}>
      {text}
    </Text>
  );
}

/* ── intake: by when? (Ask Intake, turn 3a) ─────────────────────────────── */

/** One pill under BY WHEN?. Selected fills with the accent; the dashed one is
 *  "Qoach decides"; the chevron one opens the wheel. */
function ByWhenPill({ label, on = false, dashed = false, chevron = false, onPress }: {
  label: string; on?: boolean; dashed?: boolean; chevron?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 7,
        paddingVertical: 10, paddingHorizontal: 15, borderRadius: 999,
        backgroundColor: on ? night.accent : 'transparent',
        borderWidth: 1.5, borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: on ? night.accent : pressed ? night.accentBorderStrong : dashed ? night.borderStrong : night.borderMuted,
      })}
    >
      {chevron ? (
        <View
          style={{
            width: 9, height: 9, borderRightWidth: 1.8, borderBottomWidth: 1.8,
            borderColor: on ? night.accentInk : night.textStrong,
            transform: [{ translateY: -2 }, { rotate: '45deg' }],
          }}
        />
      ) : null}
      <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13.5, color: on ? night.accentInk : dashed ? night.textSoft : night.textStrong }}>
        {label}
      </Text>
    </Pressable>
  );
}

const WHEEL_ROW = 42;

/** One scroll column of the date wheel. The parent owns the index; the column
 *  keeps its scroll position in step when the index changes from outside
 *  (a month change clamping the day). Rows are tappable too. */
function WheelColumn({ labels, index, onIndex, flex }: {
  labels: string[]; index: number; onIndex: (i: number) => void; flex: number;
}) {
  const ref = useRef<ScrollView>(null);
  const at = useRef(-1);
  const place = (i: number, animated = false) => {
    at.current = i;
    ref.current?.scrollTo({ y: i * WHEEL_ROW, animated });
  };
  useEffect(() => {
    if (at.current !== index) place(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, labels.length]);
  return (
    <ScrollView
      ref={ref}
      style={{ flex, height: 210 }}
      contentContainerStyle={{ paddingVertical: 84 }}
      showsVerticalScrollIndicator={false}
      snapToInterval={WHEEL_ROW}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onLayout={() => place(index)}
      onScroll={e => {
        const i = Math.max(0, Math.min(labels.length - 1, Math.round(e.nativeEvent.contentOffset.y / WHEEL_ROW)));
        at.current = i;
        if (i !== index) onIndex(i);
      }}
    >
      {labels.map((l, i) => (
        <Pressable
          key={l}
          onPress={() => { place(i, true); onIndex(i); }}
          style={{ height: WHEEL_ROW, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: i === index ? nightFonts.bodyMedium : nightFonts.body, fontSize: 20, color: i === index ? night.text : night.textGhost }}>
            {l}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** "Pick a date": a month and a day, from tomorrow to the 52-week horizon —
 *  the longest runway the fold can state (goalTimeline.ts). Plain scroll
 *  columns, no native picker. */
function DateWheelSheet({ today, initial, onCancel, onSet }: {
  today: YMD; initial: YMD | null; onCancel: () => void; onSet: (day: YMD) => void;
}) {
  const insets = useSafeAreaInsets();
  const months = React.useMemo(() => wheelMonths(today), [today]);
  const [start] = useState(() => {
    if (initial) {
      const mi = months.findIndex(mo => mo.y === initial.y && mo.m === initial.m);
      const di = mi >= 0 ? wheelDays(today, months[mi]).indexOf(initial.d) : -1;
      if (di >= 0) return { mi, di };
    }
    // The design opens on the first of next month.
    return { mi: Math.min(1, months.length - 1), di: 0 };
  });
  const [mi, setMi] = useState(start.mi);
  const [di, setDi] = useState(start.di);
  const days = wheelDays(today, months[mi]);
  const dayIdx = Math.min(di, days.length - 1);
  const picked: YMD = { y: months[mi].y, m: months[mi].m, d: days[dayIdx] };
  return (
    <Pressable
      onPress={onCancel}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: night.scrim, justifyContent: 'flex-end' }}
    >
      <Pop duration={300}>
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: night.surfaceRaised, borderTopLeftRadius: 22, borderTopRightRadius: 22,
            paddingBottom: Math.max(insets.bottom, 18) + 8,
          }}
        >
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: night.hairline,
            }}
          >
            <Pressable onPress={onCancel} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 15, color: night.textSoft }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 12.5, color: night.textFaint }}>{wheelPreview(picked, today)}</Text>
            <Pressable onPress={() => onSet(picked)} hitSlop={8} style={{ padding: 4 }}>
              <Text style={{ fontFamily: nightFonts.display, fontSize: 15, color: night.accent }}>Set</Text>
            </Pressable>
          </View>
          <View style={{ paddingTop: 8, paddingHorizontal: 18 }}>
            <View
              pointerEvents="none"
              style={{ position: 'absolute', left: 18, right: 18, top: 8 + 84, height: WHEEL_ROW, borderRadius: 10, backgroundColor: night.hairline }}
            />
            <View style={{ flexDirection: 'row', gap: 10, height: 210 }}>
              <WheelColumn flex={1.5} labels={months.map(mo => mo.label)} index={mi} onIndex={setMi} />
              <WheelColumn flex={1} labels={days.map(String)} index={dayIdx} onIndex={setDi} />
            </View>
          </View>
        </Pressable>
      </Pop>
    </Pressable>
  );
}

function BigCircle({ glyph, tint }: { glyph: string; tint: 'violet' | 'warn' | 'blue' }) {
  const colors = {
    violet: { bg: night.accentSoft, bd: night.border, fg: night.violetText },
    warn: { bg: 'rgba(247,179,43,0.13)', bd: 'rgba(247,179,43,0.55)', fg: night.warn },
    blue: { bg: night.accentSoft, bd: night.border, fg: night.blue },
  }[tint];
  return (
    <View
      style={{
        width: 84, height: 84, borderRadius: 42, backgroundColor: colors.bg,
        borderWidth: 1.5, borderColor: colors.bd, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: nightFonts.display, fontSize: 30, color: colors.fg }}>{glyph}</Text>
    </View>
  );
}

/* ── protocol rendering ─────────────────────────────────────────────────── */

function kindStyle(kind: ProtocolStep['kind']) {
  if (kind === 'duration') return { glyph: 'D', fg: night.blue, bg: night.accentSoft, bd: night.border, pill: night.accentSofter };
  if (kind === 'quantity') return { glyph: '#', fg: night.violetText, bg: night.accentSoft, bd: night.border, pill: night.accentSofter };
  return { glyph: '✓', fg: night.accent, bg: night.accentSoft, bd: night.accentBorder, pill: night.accentSofter };
}

function stepMetric(step: ProtocolStep): string {
  const freq = `× ${step.frequency.per_week}/wk`;
  if (step.kind === 'duration' && step.duration_minutes) return `${step.duration_minutes} min ${freq}`;
  if (step.kind === 'quantity' && step.quantity) return `${step.quantity.amount} ${step.quantity.unit} ${freq}`;
  return `✓ ${freq}`;
}

/**
 * The footer every AI surface carries (ROADMAP P5).
 *
 * Two obligations in one small block. The disclaimer is a store requirement
 * and, more to the point, true: Qoach writes plans from what you tell it and
 * has no idea what your body is doing. The report control is Play's
 * AI-generated-content policy — a person who just read something wrong needs
 * somewhere to say so that is not a support email.
 */
function CoachFooter({ surface, sessionId }: {
  surface: 'verdict' | 'protocol';
  sessionId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const REASONS: { key: 'wrong' | 'harmful' | 'offensive' | 'nonsense'; label: string }[] = [
    { key: 'wrong', label: "It's wrong" },
    { key: 'harmful', label: 'Could hurt someone' },
    { key: 'offensive', label: 'Offensive' },
    { key: 'nonsense', label: "Doesn't make sense" },
  ];
  return (
    <View style={{ marginTop: 22, gap: 10, alignItems: 'center' }}>
      <Text style={{ fontFamily: nightFonts.body, fontSize: 11, lineHeight: 16.5, color: night.textGhost, textAlign: 'center', maxWidth: 460 }}>
        Qoach is a coach, not a doctor. This is general guidance built from what you
        told it — not medical advice, and no promise about your health. If you're
        managing a condition, are pregnant, or something hurts, talk to a professional first.
      </Text>
      {sent ? (
        <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 11.5, color: night.accent }}>
          Thanks — a human will read that.
        </Text>
      ) : open ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center' }}>
          {REASONS.map(r => (
            <Pressable
              key={r.key}
              onPress={() => {
                void reportAiResponse({ reason: r.key, surface, sessionId });
                setSent(true);
              }}
              style={{
                paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
                borderWidth: 1, borderColor: night.border, backgroundColor: night.surfaceDeep,
              }}
            >
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 11.5, color: night.textMuted }}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} hitSlop={8}>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 11, color: night.textGhost, textDecorationLine: 'underline' }}>
            Report this response
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/* ── the rep editor ─────────────────────────────────────────────────────── */

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_GLYPH: Record<string, string> = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
const KIND_OPTIONS = [
  { key: 'binary', label: 'Do it' },
  { key: 'quantity', label: 'Amount' },
  { key: 'duration', label: 'Minutes' },
];

/** The form's state. Strings for the numbers so a half-typed field is not
 *  coerced under the user's thumb. */
type StepDraft = {
  title: string;
  kind: 'binary' | 'quantity' | 'duration';
  days: string[];
  perWeek: number;
  amount: string;
  unit: string;
  minutes: string;
  details: string;
};

function draftFrom(step: ProtocolStep | null): StepDraft {
  return {
    title: step?.title ?? '',
    kind: (step?.kind as StepDraft['kind']) ?? 'binary',
    days: step?.frequency.days ? [...step.frequency.days] : [],
    perWeek: step?.frequency.per_week ?? 3,
    amount: step?.quantity ? String(step.quantity.amount) : '',
    unit: step?.quantity?.unit ?? '',
    minutes: step?.duration_minutes ? String(step.duration_minutes) : '',
    details: step?.details ?? '',
  };
}

/** The draft as the ONE op the server accepts. A session-attached rep sends
 *  no frequency at all — the server would refuse it, and the form never
 *  showed the days. Server-owned fields are simply not here. */
function opFromDraft(d: StepDraft, step: ProtocolStep | null, phaseId: string, attached: boolean): ProtocolEditOp {
  const frequency = d.days.length ? { per_week: d.days.length, days: d.days } : { per_week: d.perWeek };
  const target =
    d.kind === 'quantity' ? { quantity: { amount: Number(d.amount), unit: d.unit.trim() } }
    : d.kind === 'duration' ? { duration_minutes: Number(d.minutes) }
    : {};
  if (step) {
    return {
      op: 'update', step_id: step.id,
      patch: { title: d.title.trim(), kind: d.kind, ...(attached ? {} : { frequency }), ...target, details: d.details.trim() },
    };
  }
  return { op: 'add', phase_id: phaseId, step: { title: d.title.trim(), kind: d.kind, frequency, ...target, details: d.details.trim() } };
}

/**
 * The inline rep editor — the cousin's underlined item, "do you want Qleck to
 * build your protocol or do you want to build it yourself?", answered as an
 * editable plan rather than a blank canvas. Tap a rep on the reveal and it
 * becomes this form, in place; "+ ADD A REP" opens it empty at the foot of
 * a phase. One rep at a time.
 *
 * Inline rather than a Modal on purpose: the intake is itself presented
 * modally, RepSheet is the wrong palette, and a Modal-over-modal is the iOS
 * race that "Tweak" used to lose. The style is the assumption-fix box's.
 *
 * What it does NOT offer is deliberate. Server-owned fields (id, session,
 * provenance, how_to) are not here. A rep that follows a session shows the
 * session's days and no toggles: the session repair would silently revert
 * any change, which is worse than refusing. The server is the gate — a
 * refusal comes back with Qoach's reason and the form stays open.
 */
function StepEditor({ step, sessionType, saving, error, onSave, onCancel }: {
  /** Null = a new rep. */
  step: ProtocolStep | null;
  /** Set when the rep follows a session: its days are the session's. */
  sessionType?: string;
  saving: boolean;
  error?: string;
  onSave: (d: StepDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<StepDraft>(() => draftFrom(step));
  const set = <K extends keyof StepDraft>(k: K, v: StepDraft[K]) => setD(cur => ({ ...cur, [k]: v }));
  const toggleDay = (day: string) =>
    set('days', d.days.includes(day) ? d.days.filter(x => x !== day) : DAY_KEYS.filter(x => x === day || d.days.includes(x)));
  const perWeek = d.days.length || d.perWeek;
  const amountOk = d.kind !== 'quantity' || (Number.isFinite(Number(d.amount)) && d.amount.trim() !== '' && Number(d.amount) >= 0 && !!d.unit.trim());
  const minutesOk = d.kind !== 'duration' || (Number(d.minutes) >= 1 && Number(d.minutes) <= 600);
  const canSave = !!d.title.trim() && amountOk && minutesOk && !saving;
  const box = { height: 40, fontSize: 13.5, borderRadius: 12, paddingHorizontal: 12 } as const;
  const stepBtn = (label: string, onPress: () => void, disabled: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: night.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}
    >
      <Text style={{ fontFamily: nightFonts.display, fontSize: 13, color: night.text }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={{
        marginVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: night.accentBorder,
        backgroundColor: night.surfaceDeep, padding: 12, gap: 10,
      }}
    >
      <View>
        <MonoLabel text={step ? 'CHANGE THIS REP' : 'NEW REP'} color={night.accent} style={{ marginBottom: 6 }} />
        <NightInput value={d.title} onChangeText={v => set('title', v)} placeholder="What you'll do" maxLength={80} style={box} autoFocus />
      </View>
      <Segmented options={KIND_OPTIONS} value={d.kind} onChange={k => set('kind', k as StepDraft['kind'])} height={32} fontSize={12} />
      {d.kind === 'quantity' ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {/* minWidth 0: a text input has an intrinsic width that otherwise
              beats flex and pushes the unit box past the card's edge. */}
          <NightInput value={d.amount} onChangeText={v => set('amount', v)} placeholder="Amount" keyboardType="decimal-pad" style={[box, { flex: 1, minWidth: 0 }]} />
          <NightInput value={d.unit} onChangeText={v => set('unit', v)} placeholder="Unit — km, pages, reps" maxLength={16} style={[box, { flex: 1.4, minWidth: 0 }]} />
        </View>
      ) : d.kind === 'duration' ? (
        <NightInput value={d.minutes} onChangeText={v => set('minutes', v)} placeholder="Minutes" keyboardType="number-pad" style={box} />
      ) : null}
      {sessionType ? (
        <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, lineHeight: 16, color: night.textGhost }}>
          Follows your {sessionType} days — change the session, not the rep.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {DAY_KEYS.map(day => {
              const on = d.days.includes(day);
              return (
                <Pressable
                  key={day}
                  onPress={() => toggleDay(day)}
                  style={{
                    flex: 1, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: on ? night.accent : night.surface, borderWidth: 1, borderColor: on ? night.accent : night.border,
                  }}
                >
                  <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: on ? night.accentInk : night.textMuted }}>{DAY_GLYPH[day]}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, color: night.textGhost }}>{d.days.length ? 'On those days' : 'Any days'}</Text>
            <View style={{ flex: 1 }} />
            {stepBtn('−', () => set('perWeek', Math.max(1, d.perWeek - 1)), !!d.days.length || d.perWeek <= 1)}
            <Text style={{ fontFamily: nightFonts.display, fontSize: 12.5, color: night.text, minWidth: 74, textAlign: 'center' }}>{perWeek}× a week</Text>
            {stepBtn('+', () => set('perWeek', Math.min(7, d.perWeek + 1)), !!d.days.length || d.perWeek >= 7)}
          </View>
        </View>
      )}
      <NightInput
        value={d.details}
        onChangeText={v => set('details', v)}
        placeholder="How to do it (optional)"
        maxLength={400}
        multiline
        style={[box, { height: 60, paddingTop: 10, textAlignVertical: 'top' }]}
      />
      {error ? (
        <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, lineHeight: 16, color: '#F7B32B' }}>{error}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Pressable
          onPress={() => canSave && onSave(d)}
          disabled={!canSave}
          style={{ flex: 1, height: 40, borderRadius: 12, backgroundColor: canSave ? night.accent : night.hairline, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 13, color: canSave ? night.accentInk : night.textMuted }}>
            {saving ? 'Saving…' : step ? 'Save' : 'Add rep'}
          </Text>
        </Pressable>
        <Pressable onPress={onCancel} style={{ height: 40, paddingHorizontal: 12, justifyContent: 'center' }}>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, color: night.textFaint }}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StepRow({ step, onFixAssumption, dropped = false, refusedReason, onToggleDrop, onEdit }: {
  step: ProtocolStep;
  onFixAssumption?: (key: string) => void;
  /** Tier-1B commitment picker: this step is marked for removal. */
  dropped?: boolean;
  /** Qoach refused the drop — the structural reason, shown in amber. */
  refusedReason?: string;
  onToggleDrop?: () => void;
  /** Tap the rep to change it. Absent once locked, and on a dropped rep. */
  onEdit?: () => void;
}) {
  const k = kindStyle(step.kind);
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 11,
        paddingVertical: 10, borderTopWidth: 1, borderTopColor: night.hairline,
        opacity: dropped ? 0.45 : 1,
      }}
    >
      <View
        style={{
          width: 26, height: 26, borderRadius: 9, backgroundColor: k.bg, marginTop: 1,
          borderWidth: 1, borderColor: k.bd, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: k.fg }}>{k.glyph}</Text>
      </View>
      <Pressable disabled={!onEdit} onPress={onEdit} style={{ flex: 1, minWidth: 0 }}>
        {step.source === 'qoach' ? (
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, color: night.violetText, marginBottom: 2 }}>
            QOACH ADDED
          </Text>
        ) : null}
        <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13.5, lineHeight: 18, color: night.text, textDecorationLine: dropped ? 'line-through' : 'none' }}>
          {step.title}
        </Text>
        {refusedReason ? (
          <Text style={{ marginTop: 3, fontFamily: nightFonts.body, fontSize: 11.5, lineHeight: 16, color: '#F7B32B' }}>
            Qoach kept it — {refusedReason}
          </Text>
        ) : null}
        {/* The canvas' rep detail: the "how", one line under the what. */}
        {step.details ? (
          <Text style={{ marginTop: 3, fontFamily: nightFonts.body, fontSize: 12, lineHeight: 17, color: night.textDim }}>
            {step.details}
          </Text>
        ) : null}
        {step.assumption ? (
          <Pressable
            disabled={!step.assumption_key || !onFixAssumption}
            onPress={() => step.assumption_key && onFixAssumption?.(step.assumption_key)}
            style={{ marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}
          >
            <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, color: '#F7B32B' }}>
              {step.assumption.charAt(0).toUpperCase() + step.assumption.slice(1)}
              {step.assumption_key && onFixAssumption ? ' — ' : ''}
            </Text>
            {step.assumption_key && onFixAssumption ? (
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 11.5, color: '#F7B32B', textDecorationLine: 'underline' }}>
                fix
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </Pressable>
      {/* Sits beside its rep rather than stranded at the far edge: the column
          is width-capped in ProtocolReveal, which is what pinned these chips
          to the horizon in a desktop browser. */}
      <View style={{ backgroundColor: k.pill, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginTop: 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: k.fg }}>{stepMetric(step)}</Text>
      </View>
      {onToggleDrop ? (
        <Pressable
          onPress={onToggleDrop}
          hitSlop={8}
          style={{
            width: 26, height: 26, borderRadius: 13, marginTop: 1,
            borderWidth: 1.5, borderColor: dropped ? night.accentBorder : night.border,
            backgroundColor: dropped ? night.accentSoft : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: dropped ? night.accentText : night.textGhost }}>
            {dropped ? '+' : '×'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One phase: a header that always shows, reps only while open. */
function PhaseCard({
  phase, open, isLast, milestones, onToggle, onFixAssumption, dropped, refused, onToggleDrop,
  editingId, addingHere, renderEditor, onEdit, onAdd,
}: {
  phase: ProtocolPhase;
  open: boolean;
  isLast: boolean;
  milestones: ProtocolMilestone[];
  onToggle: () => void;
  onFixAssumption?: (key: string) => void;
  dropped?: Set<string>;
  refused?: Record<string, string>;
  onToggleDrop?: (id: string) => void;
  /** The rep whose row is the editor right now, if it is in this phase. */
  editingId?: string | null;
  /** A new rep is being written at the foot of THIS phase. */
  addingHere?: boolean;
  /** Renders the editor for a rep (null = a new one). */
  renderEditor?: (step: ProtocolStep | null) => React.ReactNode;
  onEdit?: (id: string) => void;
  onAdd?: () => void;
}) {
  const weeks = phase.start_week === phase.end_week
    ? `WEEK ${phase.start_week}`
    : `WEEKS ${phase.start_week}\u2013${phase.end_week}`;
  const n = phase.steps.length;
  return (
    <View
      style={{
        backgroundColor: night.surface, borderRadius: 22, overflow: 'hidden',
        borderWidth: 1, borderColor: open ? night.accentBorder : night.hairline,
      }}
    >
      <Pressable
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}
      >
        <View
          style={{
            paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
            backgroundColor: open ? night.accentSoft : night.hairline,
            borderWidth: 1, borderColor: open ? night.accentBorder : 'transparent',
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1, color: open ? night.accent : night.textDim }}>
            {weeks}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: nightFonts.display, fontSize: 16, lineHeight: 20, color: open ? night.text : night.textMuted }}>
            {phase.title}
          </Text>
          <Text
            numberOfLines={open ? undefined : 1}
            style={{ marginTop: 2, fontFamily: nightFonts.body, fontSize: 11.5, lineHeight: 16, color: night.textGhost }}
          >
            {phase.focus}
          </Text>
        </View>
        <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 11.5, color: night.textGhost }}>
          {n} {n === 1 ? 'rep' : 'reps'}
        </Text>
        <Text style={{ width: 12, textAlign: 'center', fontFamily: nightFonts.bodyMedium, fontSize: 11, color: night.textGhost }}>
          {open ? '\u25be' : '\u25b8'}
        </Text>
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: 16 }}>
          {phase.steps.map(step => (
            editingId === step.id && renderEditor ? (
              <React.Fragment key={step.id}>{renderEditor(step)}</React.Fragment>
            ) : (
              <StepRow
                key={step.id}
                step={step}
                onFixAssumption={onFixAssumption}
                dropped={dropped?.has(step.id) ?? false}
                refusedReason={refused?.[step.id]}
                onToggleDrop={onToggleDrop ? () => onToggleDrop(step.id) : undefined}
                onEdit={onEdit && !dropped?.has(step.id) ? () => onEdit(step.id) : undefined}
              />
            )
          ))}
          {addingHere && renderEditor ? (
            renderEditor(null)
          ) : onAdd ? (
            <Pressable onPress={onAdd} style={{ paddingVertical: 11, borderTopWidth: 1, borderTopColor: night.hairline, alignItems: 'center' }}>
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: night.textGhost }}>+ ADD A REP</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Milestones show whether or not the phase is open: they are the
          "you did it" markers, not detail to be folded away. */}
      {milestones.map(m => (
        <View
          key={m.id}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
            borderTopWidth: 1, borderTopColor: night.hairline,
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 11, color: isLast ? night.accent : night.warn }}>⚑</Text>
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, color: isLast ? night.accent : night.textDim }}
          >
            {`WEEK ${m.week} \u2014 ${m.title.toUpperCase()}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The week strip: every week of the plan at a glance, milestone weeks flagged,
 * tap one to open the phase it belongs to.
 *
 * Long plans scroll rather than squeezing to ever-thinner cells. A 52-week
 * goal ("read 12 books this year") crammed into a flex row is how the week
 * bars ran off the grid before; fixed-width cells stay legible at any length.
 */
function WeekStrip({
  weeks, milestoneWeeks, activeFrom, activeTo, onPick,
}: {
  weeks: number;
  milestoneWeeks: Set<number>;
  activeFrom: number;
  activeTo: number;
  onPick: (week: number) => void;
}) {
  const scrolls = weeks > 14;
  const cells = Array.from({ length: weeks }, (_, i) => i + 1).map(w => {
    const on = w >= activeFrom && w <= activeTo;
    return (
      <Pressable
        key={w}
        onPress={() => onPick(w)}
        style={{
          flex: scrolls ? undefined : 1, width: scrolls ? 34 : undefined,
          height: 30, borderRadius: 9, borderWidth: 1,
          borderColor: on ? night.accentBorder : night.hairline,
          backgroundColor: on ? night.accentSoft : 'transparent',
          alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 2,
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: on ? night.accent : night.textGhost }}>
          {w}
        </Text>
        {milestoneWeeks.has(w) ? (
          <Text style={{ fontSize: 8, lineHeight: 10, color: on ? night.accent : night.warn }}>⚑</Text>
        ) : null}
      </Pressable>
    );
  });

  return (
    <View style={{ marginTop: 16 }}>
      {scrolls ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {cells}
        </ScrollView>
      ) : (
        <View style={{ flexDirection: 'row', gap: 6 }}>{cells}</View>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 11, color: night.textGhost }}>⚑ milestone weeks</Text>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 11, color: night.textGhost }}>tap a week to open its phase</Text>
      </View>
    </View>
  );
}

/* ── verdict screens (canvas turn 5: the odds dial) ───────────────────── */

const DEFAULT_ODDS_CAPTION = 'A judgment from your answers, not a statistic — it moves with what you do.';

/** Verdict chips row: decision + duration, shared by both verdict screens. */
function VerdictChips({ label, labelColor, weeks }: { label: string; labelColor: string; weeks: string }) {
  return (
    <Pop>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View
          style={{
            paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
            backgroundColor: `${labelColor}17`, borderWidth: 1, borderColor: `${labelColor}59`,
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 11, letterSpacing: 1.8, color: labelColor }}>{label}</Text>
        </View>
        <View
          style={{
            paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
            backgroundColor: night.surface, borderWidth: 1, borderColor: night.borderMuted,
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 11, letterSpacing: 1, color: night.text }}>{weeks}</Text>
        </View>
      </View>
    </Pop>
  );
}

/** The drivers list: tap one and Qoach explains how it moves the number. */
function DriverList({
  factors, notes, active, onPick,
}: {
  factors: string[];
  notes?: string[];
  active: number;
  onPick: (i: number) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {factors.map((t, i) => {
        const on = active === i;
        return (
          <Pressable
            key={t}
            onPress={() => onPick(on ? -1 : i)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: on ? night.accentSofter : night.surface,
              borderWidth: 1, borderColor: on ? night.accentBorder : night.hairline,
              borderRadius: 16, paddingVertical: 13, paddingHorizontal: 16,
            }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: on ? night.accent : night.textGhost }}>
              {`0${i + 1}`}
            </Text>
            <Text style={{ flex: 1, fontFamily: nightFonts.bodyMedium, fontSize: 14, lineHeight: 19.5, color: on ? night.text : night.textMuted }}>
              {t}
            </Text>
            <Text style={{ fontSize: 12, color: on ? night.accent : night.textGhost }}>{on ? '◆' : '◇'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OddsCardHeader({ left, right }: { left: string; right?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6, color: night.textFaint }}>{left}</Text>
      {right ? <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.5, color: night.textGhost }}>{right}</Text> : null}
    </View>
  );
}

const PACE_LABELS: Record<PaceKey, string> = {
  sprint: 'Time crunch',
  steady: 'Steady',
  relaxed: 'No rush',
  custom: 'Yours',
};

/**
 * The user's own call, next to Qoach's.
 *
 * Compared against original_probability — the honest read of the goal AS THEY
 * ASKED FOR IT — never against the live dial value, which moves with the pace
 * pills and is answering a different question. The prompt emits
 * original_probability on every verdict (it equals success_probability when
 * feasible, and can be 3% on a counter-offer), so the comparison is truthful in
 * both directions: a user who overreached gets told, and a user who was harder
 * on themselves than the numbers are gets told that too.
 *
 * Copy rules, which are what keep this from reading as a gimmick: never say the
 * guess was wrong — the app asked for it — and stay FLAT when Qoach is the more
 * optimistic one. Enthusiasm there is a promise the plan has not earned yet.
 */
function GuessGap({ estimate, v }: { estimate?: number | null; v: Verdict }) {
  if (typeof estimate !== 'number') return null;
  const theirs = v.original_probability ?? v.success_probability;
  if (typeof theirs !== 'number') return null;
  const gap = estimate - theirs;
  const line = Math.abs(gap) < 12
    ? 'You had that about right.'
    : gap > 0
      ? "You're more optimistic than I am."
      : "You're harder on yourself than the numbers are.";
  return (
    <View style={{ alignItems: 'center', paddingTop: 10, gap: 5 }}>
      <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.5, color: night.textGhost }}>
        {`YOUR CALL: ${bandFor(estimate).toUpperCase()} · QOACH: ${theirs}%`}
      </Text>
      <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, color: night.textSoft, textAlign: 'center' }}>
        {line}
      </Text>
    </View>
  );
}

/** Canvas 5a/5c — feasible verdict with the odds dial, at 2-3 paces. */
/**
 * v29 "Your pace": the weeks stepper under the pace pills. Once priced, the
 * custom entry joins pace_options and renders as its own pill. Lifted out of
 * FeasibleVerdict so the counter-offer page can render the same control —
 * the page where a user's own timeline has just been overruled, and the one
 * where "I have 5 weeks, price that" had nowhere to go.
 */
function NameItRow({ base, onPrice }: { base: number; onPrice: (weeks: number) => Promise<boolean> }) {
  const [customWeeks, setCustomWeeks] = useState<number | null>(null);
  const [pricing, setPricing] = useState(false);
  const stepWeeks = (d: number) => setCustomWeeks(w => Math.max(1, Math.min(52, (w ?? base) + d)));
  const priceIt = () => {
    if (pricing || customWeeks == null) return;
    setPricing(true);
    onPrice(customWeeks).finally(() => setPricing(false));
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 9 }}>
      <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.8, color: night.textGhost }}>OR NAME IT</Text>
      <Pressable onPress={() => stepWeeks(-1)} hitSlop={6} style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: night.border, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 13, color: night.text }}>−</Text>
      </Pressable>
      <Text style={{ fontFamily: nightFonts.display, fontSize: 12.5, color: night.text, minWidth: 44, textAlign: 'center' }}>
        {customWeeks ?? base} wk
      </Text>
      <Pressable onPress={() => stepWeeks(1)} hitSlop={6} style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: night.border, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 13, color: night.text }}>+</Text>
      </Pressable>
      <Pressable
        onPress={priceIt}
        disabled={pricing || customWeeks == null}
        style={{ paddingHorizontal: 11, height: 28, borderRadius: 14, backgroundColor: customWeeks == null || pricing ? night.hairline : night.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.8, fontWeight: '700', color: customWeeks == null || pricing ? night.textMuted : night.accentInk }}>
          {pricing ? 'PRICING…' : 'PRICE IT'}
        </Text>
      </Pressable>
    </View>
  );
}

function FeasibleVerdict({
  v, pace, onPace, onBuild, onReset, missingRequired,
  sim, prevSim, editedKey, answers, quickPicks, onEditInput, onPriceCustom, ownPlanMode, estimate, draftReady,
}: {
  v: Verdict;
  /** The user's own guess, when they were asked for one. */
  estimate?: number | null;
  pace: PaceKey;
  onPace: (p: PaceKey) => void;
  onBuild: () => void;
  /** Build 33: the background draft for THIS pace is written. */
  draftReady?: boolean;
  onReset: () => void;
  missingRequired?: string[];
  sim?: SimulationState | null;
  prevSim?: SimulationState | null;
  editedKey?: string | null;
  answers?: Record<string, string>;
  quickPicks?: Record<string, string[]>;
  onEditInput?: (key: string, value: string) => void;
  /** v29: price a user-named runway; resolves false when pricing failed. */
  onPriceCustom?: (weeks: number) => Promise<boolean>;
  /** Tier-2: this verdict REVIEWS the user's own plan — the header says so. */
  ownPlanMode?: boolean;
}) {
  // The futures strip renders only once a LIVE simulation for this pace
  // actually exists — never by default. The old null-default flashed the
  // skeleton strip for ~1s on every verdict while SIMULATIONS is off
  // (the first poll then reported the sim disabled and yanked it).
  const simActive = !!onEditInput && !!sim && sim.status !== 'failed' && sim.config.pace === pace;
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [driver, setDriver] = useState(-1);
  // The header's right label derives from the sim's phase — the ONE source
  // (design handoff: header and lanes must never disagree again).
  const [simPhase, setSimPhase] = useState<SimPhase>('boot');
  // The lane replay, handed up by SimVerdict so the dial's tap can fire it.
  const replayRef = useRef<(() => void) | null>(null);

  // v28, design turn 7 ("carved for reading"): when the verdict ships the
  // three read cards, they REPLACE both the assessment wall and the drivers
  // list — nothing is said twice. Old verdicts without reads fall back to
  // the classic assessment + drivers page.
  const carved = !!v.reads && v.reads.length === 3;
  const [readOpen, setReadOpen] = useState(-1);
  const READ_META: Record<'for' | 'risk' | 'move', { g: string; c: string; lab: string }> = {
    for: { g: '✓', c: night.accent, lab: 'GOING FOR YOU' },
    risk: { g: '⚑', c: '#E8B04B', lab: 'THE HONEST RISK' },
    move: { g: '→', c: night.accent, lab: "QOACH'S MOVE" },
  };
  // An answer chip opens the first read card it feeds.
  const readIndexFor = (key: string) => (v.reads ?? []).findIndex(r => r.from.includes(key));
  const chipText = (val: string) => {
    const t = val.toUpperCase().replace(/\s+/g, ' ').trim();
    if (t.length <= 20) return t;
    const cut = t.slice(0, 20);
    return cut.slice(0, cut.lastIndexOf(' ') > 8 ? cut.lastIndexOf(' ') : 20);
  };

  // The paces, when the verdict offers them: the same goal at 2-3 runways,
  // each with its own honestly-priced odds. Steady is the coach's pick and
  // mirrors the verdict's own numbers, so the fallback path is identical.
  const paces = v.pace_options;
  const chosen = paces?.find(o => o.key === pace) ?? paces?.find(o => o.key === 'steady');
  // The simulated pace's number is the blend once its runs land; unsimulated
  // pills stay rubric-provisional (owner decision 2).
  const simBlend = sim?.status === 'done' && sim.config.pace === pace ? sim.odds?.blended : undefined;
  const odds = simBlend ?? chosen?.success_probability ?? v.success_probability;
  const weeks = chosen?.duration_weeks ?? v.duration_weeks;
  const sprinting = !!paces && chosen?.key === 'sprint';
  const caption =
    driver >= 0 && v.success_factor_notes?.[driver]
      ? v.success_factor_notes[driver]
      : chosen?.note || DEFAULT_ODDS_CAPTION;

  const dialCard = odds !== undefined ? (
    <View
      style={{
        width: wide ? 350 : '100%',
        backgroundColor: night.surface, borderWidth: 1, borderColor: night.hairline,
        borderRadius: 24, paddingHorizontal: 22, paddingVertical: 18,
      }}
    >
      {/* "TAP DIAL TO REPLAY" is only true while a sim is live — the dial's
          onPress below is gated on the same simActive. With SIMULATIONS="off"
          (owner call 2026-08-29) that made every verdict advertise a tap that
          does nothing, which is the one part of the sim-lanes bug report that
          is still true of current builds. No sim, no label. */}
      <OddsCardHeader left="QOACH'S CALL" right={simActive ? simPhaseLabel(simPhase) : undefined} />
      {paces ? (
        <View style={{ flexDirection: 'row', gap: 5, backgroundColor: night.hairline, borderRadius: 999, padding: 5, marginTop: 10 }}>
          {paces.map(o => {
            const on = o.key === chosen?.key;
            // A pace whose futures have run shows the earned blend — the
            // pill must never disagree with the dial it just revised.
            const shownOdds = sim?.status === 'done' && sim.config.pace === o.key && sim.odds
              ? sim.odds.blended
              : o.success_probability;
            return (
              <Pressable
                key={o.key}
                onPress={() => onPace(o.key)}
                style={{
                  flex: 1, height: 40, borderRadius: 999,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? night.text : 'transparent',
                }}
              >
                <Text style={{ fontFamily: nightFonts.display, fontSize: 11.5, color: on ? night.bg : night.textMuted }}>
                  {PACE_LABELS[o.key]}
                </Text>
                <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: on ? (o.key === 'sprint' ? '#e8b467' : '#8fd3ab') : night.textGhost }}>
                  {`${o.duration_weeks}wk · ${shownOdds}%`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {paces && onPriceCustom ? <NameItRow base={chosen?.duration_weeks ?? v.duration_weeks} onPrice={onPriceCustom} /> : null}
      <View style={{ marginTop: 8 }}>
        {/* The dial is NEVER gated on the futures (owner call): it lights up
            with Qoach's number the moment the verdict lands. `odds` already
            prefers the blend, so when the runs below finish, useSweep's
            flip-aware target change IS the revision moment — the number
            visibly re-sweeps from the rubric to the earned blend. */}
        <OddsDial
          value={odds}
          color={sprinting ? night.warn : night.accent}
          condLabel={sprinting ? 'IF YOU GO ALL-IN' : 'IF YOU SHOW UP'}
          size={wide ? 296 : Math.max(180, Math.min(width - 104, 296))}
          onPress={simActive && simPhase === 'done' ? () => replayRef.current?.() : undefined}
          mark={estimate}
        />
        <GuessGap estimate={estimate} v={v} />
        {simActive ? (
          <SimVerdict
            sim={sim ?? null}
            prevSim={prevSim ?? null}
            editedKey={editedKey ?? null}
            rubricOdds={odds}
            sprinting={sprinting}
            answers={answers ?? {}}
            quickPicks={quickPicks ?? {}}
            missingRequired={missingRequired ?? []}
            onEditInput={onEditInput!}
            onPhase={setSimPhase}
            bindReplay={fn => { replayRef.current = fn; }}
          />
        ) : null}
      </View>
      <View style={{ minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingTop: 4 }}>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, lineHeight: 18.5, color: night.textSoft, textAlign: 'center' }}>
          {caption}
        </Text>
      </View>
      {missingRequired && missingRequired.length > 0 ? (
        <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, lineHeight: 16, color: '#F7B32B', textAlign: 'center', paddingTop: 2 }}>
          Priced with {missingRequired.length} unknown{missingRequired.length > 1 ? 's' : ''} ({missingRequired.map(k => k.replace(/_/g, ' ')).join(', ')}) — the plan will state its assumptions, and you can fix them.
        </Text>
      ) : null}
      {paces ? (
        <Text style={{ textAlign: 'center', fontFamily: MONO, fontSize: 9, letterSpacing: 0.5, color: night.textGhost, paddingTop: 6 }}>
          STEADY IS QOACH'S PICK · TAP A PILL TO SWITCH
        </Text>
      ) : null}
    </View>
  ) : null;

  // v28: the read cards ARE the factor display — a carved verdict retires
  // the whole classic drivers column (nothing is said twice). It also
  // retires when the sim owns the factors (lanes era, behind the flag).
  const drivers = carved || (simActive && sim?.status === 'done') ? null : (
    <View style={{ flex: wide ? 1 : undefined, gap: 9 }}>
      <OddsCardHeader
        left={odds !== undefined ? 'WHAT MOVES THE NUMBER' : 'WHAT WILL DECIDE IT'}
        right={v.success_factor_notes?.length ? 'TAP ONE — QOACH EXPLAINS' : ''}
      />
      <DriverList factors={v.success_factors} notes={v.success_factor_notes} active={driver} onPick={setDriver} />
      {odds !== undefined ? (
        <Text style={{ paddingHorizontal: 6, fontFamily: nightFonts.body, fontSize: 11.5, lineHeight: 17, color: night.textGhost }}>
          {`${odds} today isn't ${odds} forever — skip weeks and Qoach revises it.`}
        </Text>
      ) : null}
    </View>
  );

  // v28 read cards + answer chips — the carved verdict's whole right column
  // (design turn 7): BUILT FROM YOUR ANSWERS chips that open the read card
  // they feed, then QOACH'S READ with the levers inside, then the footer.
  const readsCol = carved && v.reads ? (
    <View style={{ flex: wide ? 1 : undefined, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 }}>
        <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.6, fontWeight: '700', color: night.textMuted }}>BUILT FROM YOUR ANSWERS</Text>
        <Text style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 0.5, color: night.textGhost }}>TAP ONE</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(answers ?? {}).slice(0, 6).map(([key, val]) => {
          const target = readIndexFor(key);
          const on = target >= 0 && readOpen === target;
          return (
            <Pressable
              key={key}
              onPress={() => { if (target >= 0) setReadOpen(target); }}
              style={{
                paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
                backgroundColor: on ? night.accentSoft : night.surface,
                borderWidth: 1, borderColor: on ? night.accentBorder : night.hairline,
              }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.6, fontWeight: '600', color: on ? night.accentText : night.textSoft }}>
                {chipText(val)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2, marginTop: 10 }}>
        <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.6, fontWeight: '700', color: night.textMuted }}>QOACH'S READ</Text>
        <Text style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 0.5, color: night.textGhost }}>TAP — THE LEVERS ARE INSIDE</Text>
      </View>
      {v.reads.map((r, i) => {
        const m = READ_META[r.kind];
        const on = readOpen === i;
        // The risk card's lever is ALWAYS the derived priced-in line (design
        // turn 7): it explains the number itself, so it must track the live
        // odds — a model-written lever here would go stale on a pace switch.
        const lever = r.kind === 'risk'
          ? (odds !== undefined ? `PRICED IN → WHY IT'S ${odds}, NOT ${Math.min(97, odds + 10)}` : undefined)
          : r.lever;
        return (
          <View key={r.kind} style={{ backgroundColor: night.surface, borderWidth: 1, borderColor: on ? (r.kind === 'risk' ? 'rgba(232,176,75,0.5)' : night.accentBorder) : night.hairline, borderRadius: 18, overflow: 'hidden' }}>
            <Pressable onPress={() => setReadOpen(cur => (cur === i ? -1 : i))} style={{ padding: 13, paddingHorizontal: 15 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: m.c }}>{m.g}</Text>
                <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 1.3, fontWeight: '700', color: m.c }}>{m.lab}</Text>
                <View style={{ flex: 1 }} />
                <Text style={{ fontSize: 10, color: night.textGhost }}>{on ? '◆' : '◇'}</Text>
              </View>
              <Text style={{ marginTop: 7, fontFamily: nightFonts.bodyMedium, fontSize: 13, lineHeight: 19, color: night.text }}>{r.line}</Text>
            </Pressable>
            {on ? (
              <View style={{ paddingHorizontal: 15, paddingBottom: 13 }}>
                <Text style={{ fontFamily: nightFonts.body, fontSize: 12, lineHeight: 18.5, color: night.textSoft }}>{r.detail}</Text>
                {lever ? (
                  <Text style={{ marginTop: 8, fontFamily: MONO, fontSize: 8.5, lineHeight: 14, letterSpacing: 0.7, fontWeight: '700', color: m.c }}>{lever}</Text>
                ) : null}
                <Text style={{ marginTop: 6, fontFamily: MONO, fontSize: 8, letterSpacing: 0.7, fontWeight: '600', color: night.textGhost }}>
                  FROM: {r.from.map(k => (k === 'own_plan' ? 'YOUR PLAN' : k.replace(/_/g, ' ').toUpperCase())).join(' · ')}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
      {odds !== undefined ? (
        <Text style={{ marginTop: 4, textAlign: 'center', fontFamily: nightFonts.body, fontSize: 11, lineHeight: 16.5, color: night.textGhost }}>
          {`${odds} today isn't ${odds} forever — skip weeks and Qoach revises it.`}
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <Screen>
      <View style={{ width: '100%', maxWidth: 920, alignSelf: 'center' }}>
        <VerdictChips label={ownPlanMode ? '✓ YOUR PLAN, PRICED' : '✓ FEASIBLE'} labelColor={night.accent} weeks={`${weeks} WEEKS`} />
        <Title style={{ fontSize: wide ? 31 : 25, lineHeight: wide ? 36 : 30, marginTop: 18, marginBottom: 10 }}>
          {v.goal_statement}
        </Title>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 23, color: night.textMuted, maxWidth: 660 }}>
          {carved && v.subtitle ? v.subtitle : v.assessment}
        </Text>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 20, marginTop: 24 }}>
          {dialCard}
          {drivers}
          {readsCol}
        </View>
        <View style={{ marginTop: 26 }}>
          <PrimaryButton
            label={paces ? `Build my plan — ${weeks} weeks` : 'Build my plan'}
            onPress={onBuild}
            style={wide ? { width: 440, alignSelf: 'center' } : undefined}
          />
          {draftReady ? <ReadyLine /> : null}
          <TextButton label="Change my goal" onPress={onReset} height={46} />
        </View>
        <CoachFooter surface="verdict" />
      </View>
    </Screen>
  );
}

/** Canvas 5b — the counter-offer as a negotiation: one dial, two pills —
 *  three, once the user has named a runway of their own. */
function CounterVerdict({
  v, goalText, pace, onPace, onBuild, onBuildOriginal, onReset, onPriceCustom, ownPlanMode, estimate, draftReady,
}: {
  v: Verdict;
  /** The user's own guess, when they were asked for one. */
  estimate?: number | null;
  goalText: string;
  pace: PaceKey;
  onPace: (p: PaceKey) => void;
  /** Builds the NAMED pace — the deal ('steady') or the user's own runway
   *  ('custom'). Named, because on this page the pill and the button can
   *  disagree, and the button is what the user meant. */
  onBuild: (p: PaceKey) => void;
  onBuildOriginal: () => void;
  onReset: () => void;
  /** Build 33: the background draft for the pace on screen is written. */
  draftReady?: boolean;
  /** v29: price a user-named runway; resolves false when pricing failed. */
  onPriceCustom?: (weeks: number) => Promise<boolean>;
  /** Tier-2: the countered thing is the user's own plan, not just a goal. */
  ownPlanMode?: boolean;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 880;
  const [view, setView] = useState<'asked' | 'offer' | 'custom'>('offer');
  const succ = v.success_probability;
  const orig = v.original_probability;
  const hasPair = succ !== undefined && orig !== undefined;
  // The owner's rule: at 20%+ the user may insist on the original, eyes
  // open; below it the coach will not build the plan and the UI says the
  // floor out loud instead of hiding the option.
  const canAttempt = hasPair && (orig as number) >= ATTEMPT_FLOOR;
  // v29 on a counter-offer: the user's own runway, priced by the coach. This
  // page used to be strictly binary — the coach's weeks, or the coach's read
  // of the original — on exactly the verdict where the user's timeline had
  // just been overruled. The picker is the release valve. The same floor
  // applies: shown at any number, built only at 20% or better.
  const custom = v.pace_options?.find(o => o.key === 'custom');
  const customOk = !!custom && custom.success_probability >= ATTEMPT_FLOOR;
  // A freshly priced runway takes the view, whether or not it clears the
  // floor: below it, the point is to SHOW the number and say why it will not
  // build. `view` is local (the original is a variant, not a pace), so the
  // hook's setPace('custom') alone would leave the page on Qoach's number.
  const customKey = custom ? `${custom.duration_weeks}:${custom.success_probability}` : '';
  useEffect(() => { if (customKey) setView('custom'); }, [customKey]);
  const asked = hasPair && view === 'asked';
  const yours = !!custom && view === 'custom';
  const dialColor = asked || yours ? night.warn : night.accent;
  // A pill that can be built pre-generates its draft, as on the feasible
  // page. The original is a variant, not a pace, and a custom below the
  // floor is shown but never built — neither fires a prepare.
  const pick = (key: 'asked' | 'offer' | 'custom') => {
    setView(key);
    if (key === 'offer') onPace('steady');
    else if (key === 'custom' && customOk) onPace('custom');
  };
  const pills = [
    ...(hasPair ? [{ key: 'asked' as const, label: 'As you asked', pct: `${orig}%`, tint: '#e8b467' }] : []),
    { key: 'offer' as const, label: "Qoach's version", pct: `${succ}%`, tint: '#8fd3ab' },
    ...(custom ? [{ key: 'custom' as const, label: PACE_LABELS.custom, pct: `${custom.duration_weeks}wk · ${custom.success_probability}%`, tint: '#e8b467' }] : []),
  ];
  const pillsOn = pills.length > 1;

  const goalCards = (
    <View style={{ gap: 10 }}>
      {[
        { key: 'asked' as const, label: ownPlanMode ? 'YOUR PLAN AS WRITTEN' : 'AS YOU ASKED', text: v.original_request ?? goalText, ac: night.warn },
        { key: 'offer' as const, label: ownPlanMode ? "QOACH'S AMENDMENTS" : "QOACH'S VERSION", text: v.goal_statement, ac: night.accent },
      ].map(g => {
        // A custom runway prices Qoach's version, so that card stays lit.
        const on = hasPair ? (view === g.key || (view === 'custom' && g.key === 'offer')) : g.key === 'offer';
        return (
          <Pressable
            key={g.key}
            disabled={!hasPair}
            onPress={() => pick(g.key)}
            style={{
              backgroundColor: on ? night.surface : 'transparent',
              borderWidth: 1, borderColor: on ? `${g.ac}80` : night.hairline,
              borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18,
            }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: on ? g.ac : night.textGhost }}>
              {g.label}
            </Text>
            <Text
              style={{
                marginTop: 4, fontFamily: nightFonts.display, fontSize: 17, lineHeight: 22,
                color: on ? night.text : night.textGhost,
                textDecorationLine: !on && g.key === 'asked' ? 'line-through' : 'none',
              }}
            >
              {g.text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const dialCard = succ !== undefined ? (
    <View
      style={{
        width: wide ? 380 : '100%', alignSelf: wide ? 'flex-start' : undefined,
        backgroundColor: night.surface, borderWidth: 1, borderColor: night.hairline,
        borderRadius: 24, paddingHorizontal: 20, paddingVertical: 16,
      }}
    >
      {pillsOn ? (
        <View style={{ flexDirection: 'row', gap: 5, backgroundColor: night.hairline, borderRadius: 999, padding: 5 }}>
          {pills.map(pl => {
            const on = view === pl.key;
            return (
              // Label over number, as on the feasible page. Side by side,
              // three pills at 393pt wrapped "Qoach's version" into its own
              // percentage.
              <Pressable
                key={pl.key}
                onPress={() => pick(pl.key)}
                style={{
                  flex: 1, height: 40, borderRadius: 999,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? night.text : 'transparent',
                }}
              >
                <Text numberOfLines={1} style={{ fontFamily: nightFonts.display, fontSize: 11.5, color: on ? night.bg : night.textMuted }}>
                  {pl.label}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: on ? pl.tint : night.textGhost }}>
                  {pl.pct}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {/* Base: the runway the user actually asked for, when the coach kept
          it; otherwise the counter's. Naming roughly their original lands the
          stepper one tap from "price that". */}
      {onPriceCustom ? <NameItRow base={custom?.duration_weeks ?? v.original_duration_weeks ?? v.duration_weeks} onPrice={onPriceCustom} /> : null}
      <View style={{ marginTop: 12 }}>
        <OddsDial
          value={asked ? (orig as number) : yours && custom ? custom.success_probability : succ}
          color={dialColor}
          condLabel={asked ? 'EVEN ALL-IN' : yours ? 'IF YOU GO ALL-IN' : 'IF YOU SHOW UP'}
          size={wide ? 300 : Math.min(width - 100, 300)}
          mark={estimate}
        />
        <GuessGap estimate={estimate} v={v} />
      </View>
      <View style={{ minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingTop: 4 }}>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, lineHeight: 18.5, color: night.textSoft, textAlign: 'center' }}>
          {asked
            ? canAttempt
              ? `Qoach's honest read on your original — it still recommends the ${succ}% version, but at ${orig}% the choice is yours.`
              : `Qoach only builds plans it can price at ${ATTEMPT_FLOOR}% or better — as asked, this is ${orig}%. The deal below builds its ${succ}% version instead.`
            : yours && custom
              ? customOk
                ? `Your runway, priced straight: ${custom.duration_weeks} weeks at ${custom.success_probability}%. Qoach still recommends ${succ}% at ${v.duration_weeks} weeks — but at ${custom.success_probability}% the choice is yours.`
                : `Qoach only builds plans it can price at ${ATTEMPT_FLOOR}% or better — at ${custom.duration_weeks} weeks this is ${custom.success_probability}%. Name a longer runway, or take the deal at ${succ}%.`
              : yours && custom ? '' : 'Rebuilt so the odds are on your side.'}
        </Text>
      </View>
      {pillsOn ? (
        <Text style={{ textAlign: 'center', fontFamily: MONO, fontSize: 9, letterSpacing: 0.5, color: night.textGhost, paddingTop: 8 }}>
          {yours
            ? customOk ? 'YOUR RUNWAY — THE BUTTON BUILDS IT' : `BELOW ${ATTEMPT_FLOOR}% QOACH ONLY BUILDS ITS VERSION`
            : canAttempt ? 'PICK A SIDE — THE BUTTON BUILDS THE ONE YOU CHOSE' : `PILLS COMPARE THE TWO — BELOW ${ATTEMPT_FLOOR}% QOACH ONLY BUILDS ITS VERSION`}
        </Text>
      ) : null}
    </View>
  ) : null;

  // Built once, used in both layouts — the narrow one used to carry a
  // hand-copied duplicate of this block.
  const actionsInner = yours && custom
    ? customOk
      ? (
        <>
          <PrimaryButton label={`Build my plan — ${custom.duration_weeks} weeks`} onPress={() => onBuild('custom')} />
          <TextButton label={`Take the deal instead — ${succ}%`} onPress={() => onBuild('steady')} height={44} />
        </>
      )
      : <PrimaryButton label={"Take the deal — Qoach’s version"} onPress={() => onBuild('steady')} />
    : canAttempt && view === 'asked'
      ? (
        <>
          <PrimaryButton label={`Attempt my original — ${orig}% odds`} onPress={onBuildOriginal} />
          <TextButton label={`Take the deal instead — ${succ}%`} onPress={() => onBuild('steady')} height={44} />
        </>
      )
      : <PrimaryButton label={"Take the deal — Qoach’s version"} onPress={() => onBuild('steady')} />;
  // The verdict kicked the deal's draft (steady, Qoach's version); a priced
  // custom runway kicks its own. The line names whichever is the one ready.
  const readyLine = draftReady
    ? <ReadyLine text={pace === 'custom' ? 'YOUR PLAN IS WRITTEN — OPENS INSTANTLY' : 'THE DEAL IS WRITTEN — OPENS INSTANTLY'} />
    : null;
  const actions = <>{actionsInner}{readyLine}</>;

  const leftCol = (
    <View style={{ flex: wide ? 1 : undefined, gap: 14 }}>
      <Title style={{ fontSize: wide ? 31 : 25, lineHeight: wide ? 36 : 30 }}>About that goal.</Title>
      {goalCards}
      <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 23, color: night.textMuted }}>
        "{v.assessment}"
      </Text>
      <View style={{ marginTop: 6 }}>
        {actions}
        <TextButton label="Change my goal" onPress={onReset} height={46} />
      </View>
      <CoachFooter surface="verdict" />
    </View>
  );

  return (
    <Screen>
      <View style={{ width: '100%', maxWidth: 960, alignSelf: 'center' }}>
        <VerdictChips
          label={'⇄ COUNTER-OFFER'}
          labelColor={night.warn}
          weeks={yours && custom ? `${custom.duration_weeks} WEEKS — YOURS` : `${v.duration_weeks} WEEKS OFFERED`}
        />
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: wide ? 26 : 18, marginTop: 20 }}>
          {wide ? (
            <>
              {leftCol}
              {dialCard}
            </>
          ) : (
            <>
              <Title style={{ fontSize: 25, lineHeight: 30 }}>About that goal.</Title>
              {goalCards}
              {dialCard}
              <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 23, color: night.textMuted }}>
                "{v.assessment}"
              </Text>
              <View>
                {actions}
                <TextButton label="Change my goal" onPress={onReset} height={46} />
              </View>
            </>
          )}
        </View>
      </View>
    </Screen>
  );
}

/**
 * The protocol reveal (canvas turn "Protocol reveal — the plan lands as a
 * moment, not a wall").
 *
 * The plan used to arrive as one long wall of every rep in every phase, with
 * a legend explaining three glyphs and the frequency chips stranded at the
 * far right of a desktop window. Now phase one sits open with its coaching
 * detail, later phases fold to an honest one-line summary each, the week
 * strip gives the whole span at a glance, and locking in actually pays off.
 */
function ProtocolReveal({
  protocol, statement, odds, onLock, onRestart, quickPicks, onFixAssumption, onReprice, onEdit, oddsStale,
}: {
  protocol: Protocol;
  statement: string;
  odds?: number;
  onLock: () => void;
  onRestart: () => void;
  quickPicks?: Record<string, string[]>;
  onFixAssumption?: (key: string, value: string) => void;
  /** Tier-1B: drop commitments → server refuses structural drops with
   *  reasons and re-prices the rest (the odds prop then updates). */
  onReprice?: (ids: string[]) => Promise<{ refused: { step_id: string; reason: string }[] } | null>;
  /** The editor: one op, applied server-side to the stored plan. A refusal
   *  comes back with Qoach's reason; null means the call itself failed. */
  onEdit?: (op: ProtocolEditOp) => Promise<{ refused?: { step_id: string; reason: string } } | null>;
  /** The work itself has changed since the plan was last priced. No number
   *  on file describes it, so none is shown, and it locks without one. */
  oddsStale?: boolean;
}) {
  const [open, setOpen] = useState(0);
  // The editor: which rep is the form (or which phase has an empty one at
  // its foot), the in-flight save, and Qoach's refusal if any. One at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingPhase, setAddingPhase] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  // Reps the user has changed — the assumption-fix box warns that a rebuild
  // throws these away.
  const [editedIds, setEditedIds] = useState<Set<string>>(new Set());
  const sessionTypeOf = (step: ProtocolStep) => protocol.sessions?.find(s => s.id === step.session_id)?.type;
  const closeEditor = () => { setEditingId(null); setAddingPhase(null); setEditError(undefined); };
  const startEdit = (id: string) => { setAddingPhase(null); setEditError(undefined); setEditingId(id); };
  const startAdd = (phaseId: string) => { setEditingId(null); setEditError(undefined); setAddingPhase(phaseId); };
  const saveDraft = (d: StepDraft, step: ProtocolStep | null, phaseId: string) => {
    if (!onEdit || saving) return;
    setSaving(true);
    setEditError(undefined);
    onEdit(opFromDraft(d, step, phaseId, !!step?.session_id))
      .then(res => {
        if (!res) { setEditError('Couldn\u2019t reach Qoach \u2014 try again.'); return; }
        if (res.refused) { setEditError(`Qoach kept it \u2014 ${res.refused.reason}`); return; }
        if (step) setEditedIds(s => new Set(s).add(step.id));
        closeEditor();
      })
      .finally(() => setSaving(false));
  };
  const renderEditor = (phaseId: string) => (step: ProtocolStep | null) => (
    <StepEditor
      key={step?.id ?? `add-${phaseId}`}
      step={step}
      sessionType={step ? sessionTypeOf(step) : undefined}
      saving={saving}
      error={editError}
      onSave={d => saveDraft(d, step, phaseId)}
      onCancel={closeEditor}
    />
  );
  // Commitment picker state: what the user marked for removal, what Qoach
  // refused (with reasons), and the before→after odds delta.
  const [droppedIds, setDroppedIds] = useState<Set<string>>(new Set());
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [repricing, setRepricing] = useState(false);
  const [delta, setDelta] = useState<{ from: number; to: number } | null>(null);
  const toggleDrop = (id: string) => {
    setRefused(cur => { const { [id]: _gone, ...rest } = cur; return rest; });
    setDroppedIds(cur => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const repriceNow = () => {
    if (!onReprice || repricing || droppedIds.size === 0) return;
    const from = odds;
    setRepricing(true);
    onReprice([...droppedIds])
      .then(res => {
        if (!res) return;
        const refusedMap: Record<string, string> = {};
        for (const r of res.refused) refusedMap[r.step_id] = r.reason;
        setRefused(refusedMap);
        // Refused ids stay in the plan — un-mark them; accepted drops are now
        // GONE from the protocol, so the set resets entirely.
        setDroppedIds(new Set());
        if (from !== undefined) setDelta(d => ({ from: d?.from ?? from, to: from }));
      })
      .finally(() => setRepricing(false));
  };
  // The odds prop updates when the reprice lands — close the delta with it.
  useEffect(() => {
    if (delta && odds !== undefined && odds !== delta.to) setDelta({ from: delta.from, to: odds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [odds]);
  // "Assumed ~170 lb — fix": which manifest key is being edited, and the
  // typed value. Quick-picks submit immediately; typed values via Rebuild.
  const [fixingKey, setFixingKey] = useState<string | null>(null);
  const [fixValue, setFixValue] = useState('');
  const [locked, setLocked] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const confettiRef = useRef<ConfettiHandle>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Every timer this screen starts is cancelled on unmount: the lock-in beat
  // navigates away, and a stray callback firing after that sets state on a
  // gone component.
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  const phases = protocol.phases;
  const milestones = [...protocol.milestones].sort((a, b) => a.week - b.week);
  const milestoneWeeks = new Set(milestones.map(m => m.week));
  const active = phases[open] ?? phases[0];
  const firstRep = phases[0]?.steps[0]?.title ?? '';
  const openingReps = (phases[0]?.steps ?? []).reduce((n, st) => n + st.frequency.per_week, 0);

  const lockIn = () => {
    if (locked) return;
    setLocked(true);
    celebratePlan();                       // haptics + sound, the third sense
    confettiRef.current?.fire();
    later(onLock, 1800);                   // let the moment land before leaving
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen style={{ paddingBottom: 0 }}>
        {/* One capped, centred column. Without it a desktop browser stretches
            each rep row to the full window and throws its chip to the far
            edge, which is exactly how the deployed page looked. */}
        <View style={{ width: '100%', maxWidth: 660, alignSelf: 'center', paddingBottom: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <MonoLabel text="YOUR PROTOCOL" color={night.accent} style={{ fontSize: 10.5, letterSpacing: 1.5 }} />
            <View
              style={{
                paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999,
                backgroundColor: locked ? night.accentSoft : night.hairline,
                borderWidth: 1, borderColor: locked ? night.accentBorder : 'transparent',
              }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: locked ? night.accent : night.textDim }}>
                {locked ? 'LIVE' : 'DRAFT'}
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            {/* 5d: the verdict number rides along, same conditional, smaller badge.
                Once the work has been edited no number on file describes the
                plan, and the chip says so instead of showing one. */}
            {oddsStale ? (
              <View style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: night.surface, borderWidth: 1, borderColor: night.border }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, color: night.textDim }}>— UNPRICED</Text>
              </View>
            ) : odds !== undefined ? <OddsChip value={odds} /> : null}
          </View>

          <Text style={{ fontFamily: nightFonts.display, fontSize: 21, lineHeight: 26.25, color: night.text, marginTop: 8 }}>
            {statement}
          </Text>
          {/* The old glyph legend is gone. It explained the notation instead
              of the plan; the shape of the commitment is the useful summary. */}
          <Text style={{ marginTop: 6, fontFamily: nightFonts.bodyMedium, fontSize: 12.5, color: night.textDim }}>
            {protocol.duration_weeks} weeks · {phases.length} {phases.length === 1 ? 'phase' : 'phases'}
            {openingReps ? ` · starts at ${openingReps} reps a week` : ''}
          </Text>
          {/* The affordances were invisible: a bare × in open phases only, and
              the re-price button hidden until the first mark. One line. */}
          {onEdit && !locked ? (
            <Text style={{ marginTop: 4, fontFamily: nightFonts.body, fontSize: 12, lineHeight: 17, color: night.textGhost }}>
              Tap a rep to change it · × drops it and re-prices.
            </Text>
          ) : null}

          <WeekStrip
            weeks={protocol.duration_weeks}
            milestoneWeeks={milestoneWeeks}
            activeFrom={active?.start_week ?? 1}
            activeTo={active?.end_week ?? 1}
            onPick={w => {
              const i = phases.findIndex(ph => w >= ph.start_week && w <= ph.end_week);
              if (i >= 0) setOpen(i);
            }}
          />

          <View style={{ gap: 10, marginTop: 16 }}>
            {phases.map((phase, i) => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                open={i === open}
                isLast={i === phases.length - 1}
                milestones={milestones.filter(m => m.week >= phase.start_week && m.week <= phase.end_week)}
                onToggle={() => setOpen(cur => (cur === i ? -1 : i))}
                onFixAssumption={onFixAssumption ? (key) => { setFixingKey(key); setFixValue(''); } : undefined}
                dropped={droppedIds}
                refused={refused}
                onToggleDrop={onReprice && !locked ? toggleDrop : undefined}
                editingId={editingId}
                addingHere={addingPhase === phase.id}
                renderEditor={onEdit && !locked ? renderEditor(phase.id) : undefined}
                onEdit={onEdit && !locked ? startEdit : undefined}
                onAdd={onEdit && !locked ? () => startAdd(phase.id) : undefined}
              />
            ))}
          </View>

          {delta && delta.from !== delta.to && !oddsStale ? (
            <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Text style={{ fontFamily: nightFonts.display, fontSize: 14, color: night.textFaint, textDecorationLine: 'line-through' }}>{delta.from}</Text>
              <Text style={{ fontFamily: nightFonts.display, fontSize: 12, color: night.accent }}>→</Text>
              <Text style={{ fontFamily: nightFonts.display, fontSize: 16, color: night.accent }}>{delta.to}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.6, color: night.textMuted }}>YOUR PLAN, YOUR PRICE</Text>
            </View>
          ) : null}

          {droppedIds.size > 0 && !locked ? (
            <Pressable
              onPress={repriceNow}
              disabled={repricing}
              style={{
                marginTop: 12, height: 44, borderRadius: 22,
                backgroundColor: repricing ? night.hairline : night.accent,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.8, fontWeight: '700', color: repricing ? night.textMuted : night.accentInk }}>
                {repricing ? 'RE-PRICING…' : `RE-PRICE WITHOUT ${droppedIds.size} ${droppedIds.size === 1 ? 'COMMITMENT' : 'COMMITMENTS'}`}
              </Text>
            </Pressable>
          ) : null}

          {fixingKey && onFixAssumption ? (
            <View style={{
              marginTop: 10, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(247,179,43,0.55)',
              backgroundColor: 'rgba(247,179,43,0.08)', padding: 14, gap: 10,
            }}>
              <Text style={{ fontFamily: nightFonts.display, fontSize: 13.5, color: night.text }}>
                What's your {fixingKey.replace(/_/g, ' ')}?
              </Text>
              {/* A rebuild regenerates the whole plan from the corrected
                  input. Hand edits do not survive it, and saying so beats
                  replaying them (which would be guessing at intent). */}
              {editedIds.size ? (
                <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, lineHeight: 16, color: '#F7B32B' }}>
                  Rebuilding discards the reps you changed.
                </Text>
              ) : null}
              {(quickPicks?.[fixingKey] ?? []).length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(quickPicks?.[fixingKey] ?? []).map(pick => (
                    <Pressable
                      key={pick}
                      onPress={() => { setFixingKey(null); onFixAssumption(fixingKey, pick); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(247,179,43,0.5)' }}
                    >
                      <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 12.5, color: night.text }}>{pick}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <NightInput
                  value={fixValue}
                  onChangeText={setFixValue}
                  placeholder="Type the real value (e.g. 200 lbs)"
                  style={{ flex: 1, height: 44, fontSize: 13.5 }}
                  onSubmitEditing={() => { if (fixValue.trim()) { setFixingKey(null); onFixAssumption(fixingKey, fixValue); } }}
                />
                <Pressable
                  onPress={() => { if (fixValue.trim()) { setFixingKey(null); onFixAssumption(fixingKey, fixValue); } }}
                  style={{ height: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: night.accent, alignItems: 'center', justifyContent: 'center', opacity: fixValue.trim() ? 1 : 0.5 }}
                >
                  <Text style={{ fontFamily: nightFonts.display, fontSize: 13, color: night.accentInk }}>Rebuild</Text>
                </Pressable>
                <Pressable onPress={() => setFixingKey(null)} style={{ height: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
                  <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, color: night.textFaint }}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <LinearGradient
            colors={[night.accentSofter, 'rgba(14,159,232,0.08)']}
            start={DIAGONAL.start}
            end={DIAGONAL.end}
            style={{
              marginTop: 10, borderRadius: 20, borderWidth: 1, borderColor: night.accentFaint,
              paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', gap: 12,
            }}
          >
            <QoachMark size={34} fontSize={16} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <MonoLabel text="QOACH'S NOTE" color={night.accent} style={{ marginBottom: 5 }} />
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13.5, lineHeight: 20, color: night.text, fontStyle: 'italic' }}>
                {protocol.coach_notes}
              </Text>
            </View>
          </LinearGradient>
        </View>
      </Screen>

      {/* The commitment stays reachable without scrolling back down. */}
      <View
        style={{
          // The home-indicator strip on a notch phone is 34pt; with 18 of
          // padding "Start over" sat inside it, where an upward swipe lands.
          paddingHorizontal: 28, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 18),
          borderTopWidth: 1, borderTopColor: night.hairline, backgroundColor: night.bg,
        }}
      >
        <View style={{ width: '100%', maxWidth: 660, alignSelf: 'center' }}>
          {locked ? (
            <Pop>
              <Pressable
                onPress={onLock}
                style={{
                  borderRadius: 20, paddingHorizontal: 18, paddingVertical: 16, alignItems: 'center',
                  backgroundColor: night.accentSoft, borderWidth: 1, borderColor: night.accentBorder,
                }}
              >
                <Text style={{ fontFamily: nightFonts.display, fontSize: 18, color: night.text, textAlign: 'center' }}>
                  Locked in.
                </Text>
                {firstRep ? (
                  <Text style={{ marginTop: 6, fontFamily: nightFonts.bodyMedium, fontSize: 12.5, lineHeight: 18, color: night.textMuted, textAlign: 'center' }}>
                    Rep one: {firstRep}
                  </Text>
                ) : null}
                <Text style={{ marginTop: 4, fontFamily: nightFonts.body, fontSize: 11.5, color: night.textGhost, textAlign: 'center' }}>
                  Live on your Today page from here.
                </Text>
              </Pressable>
            </Pop>
          ) : (
            <>
              {/* Until edits are priced (their own, gated step), a changed
                  plan locks with no odds rather than the number of the plan
                  it used to be. Said here, where the finger is. */}
              {oddsStale ? (
                <Text style={{ marginBottom: 8, textAlign: 'center', fontFamily: nightFonts.body, fontSize: 11.5, lineHeight: 16, color: night.textGhost }}>
                  Changed reps aren’t priced yet — this locks without odds.
                </Text>
              ) : null}
              <PrimaryButton label="Lock it in" onPress={lockIn} />
              {/* "Adjust something" used to sit here: a stub whose whole
                  behaviour was a toast at the top of the screen saying it was
                  not built. A tester reported it as "nothing happens", which
                  was accurate. Editing lands in this slot when it is real. */}
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 4 }}>
                <TextButton label="Start over" height={40} onPress={() => setLeaveOpen(true)} />
              </View>
            </>
          )}
        </View>
        <CoachFooter surface="protocol" />
      </View>

      {leaveOpen ? (
        <LeaveSheet
          title="Start over?"
          body="This plan and the interview behind it are thrown away. Coming back starts again from the goal, and the questions come again too."
          keepLabel="Keep this plan"
          leaveLabel="Start over"
          onKeep={() => setLeaveOpen(false)}
          onLeave={() => { setLeaveOpen(false); onRestart(); }}
        />
      ) : null}

      <Confetti ref={confettiRef} />
    </View>
  );
}

/* ── the door ───────────────────────────────────────────────────────────── */

/**
 * The one sheet that stands between a person and losing coach state.
 *
 * Nothing about a coach session is written down until a plan is locked —
 * the session id lives in a ref, there is no GET for a session — so every
 * way out before that point throws away the goal, the interview and the
 * verdict at once. Two callers: the wait screen (leaving mid-generation) and
 * the plan reveal ("Start over", which used to be a bare button four points
 * under "Lock it in" with no confirmation — a tester's finger drifted and
 * the plan was gone). One sheet, so the cost is stated the same way in both.
 */
function LeaveSheet({
  eyebrow, title, body, keepLabel, leaveLabel, footnote, onKeep, onLeave,
}: {
  eyebrow?: string; title: string; body: string;
  keepLabel: string; leaveLabel: string; footnote?: string;
  onKeep: () => void; onLeave: () => void;
}) {
  return (
    <Pressable
      onPress={onKeep}
      style={{
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
        backgroundColor: night.scrim, justifyContent: 'flex-end',
      }}
    >
      <Pop duration={300}>
        {/* Stops a tap on the body from reaching the scrim — the body is
            where people read, and reading must not dismiss. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: night.surface, borderTopWidth: 1, borderTopColor: night.border,
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            paddingTop: 20, paddingHorizontal: 24, paddingBottom: 34,
          }}
        >
          {eyebrow ? (
            <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.6, color: night.textGhost }}>
              {eyebrow}
            </Text>
          ) : null}
          <Text style={{ marginTop: eyebrow ? 14 : 0, fontFamily: nightFonts.display, fontSize: 23, lineHeight: 28, color: night.text }}>
            {title}
          </Text>
          <Text style={{ marginTop: 10, fontFamily: nightFonts.body, fontSize: 14, lineHeight: 21, color: night.textMuted }}>
            {body}
          </Text>
          <View style={{ marginTop: 22, gap: 10 }}>
            <Pressable
              onPress={onKeep}
              style={{ height: 52, borderRadius: 26, backgroundColor: night.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 16, color: night.accentInk }}>{keepLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onLeave}
              style={{
                height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: night.borderDashed,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 14.5, color: night.text }}>{leaveLabel}</Text>
            </Pressable>
          </View>
          {footnote ? (
            <Text style={{ marginTop: 16, fontFamily: nightFonts.body, fontSize: 12, lineHeight: 16, color: night.textGhost, textAlign: 'center' }}>
              {footnote}
            </Text>
          ) : null}
        </Pressable>
      </Pop>
    </Pressable>
  );
}

/* ── the wait ───────────────────────────────────────────────────────────── */

/**
 * The wait, ported from the Claude Design canvas `Qleck Qoach Wait`
 * (project 7091d355) — "the wait as a receipt".
 *
 * Generating a plan is ONE model call with no progress signal, so there is
 * nothing here for a percentage to be a percentage OF. Measured across 33
 * production calls: mean 26s, a third past 40s, slowest 75s. The only motion
 * that claims anything is the clock, and the clock is elapsed — true by
 * construction. Everything else on screen was already on file before the wait
 * started: the accepted goal, Qoach's odds beside the odds the user called,
 * the read cards, their own answers.
 *
 * What this replaced: an orb, one line, and a promise of "3–20 seconds" that
 * was wrong on nearly every call.
 */

// Every line is backed by the same 33-call sample. Nothing here says "almost
// done" — that is the one thing the client cannot know.
const WAIT_COPY = {
  thinking: [
    { after: 0, head: 'Reading what you wrote.', sub: 'Your first question is on its way.' },
    { after: 30, head: 'Taking longer than usual.', sub: 'Qoach is thinking, not stuck.' },
    { after: 60, head: 'Past a minute. Still thinking.', sub: 'You can stop, but the goal starts over.' },
  ],
} as const;

/** The building line reads the JOB, not the clock (build 33): every head
 *  maps to a stored fact — in line, writing, how many drafts the checks sent
 *  back. The clock stays as the one thing that claims anything about time.
 *  The old "40 seconds" / "75 seconds" lines are gone: they described the
 *  retired in-request build, calibrated on validator retries; one measured
 *  call is 29s at the median and 60s at p90 (11 Sep). */
function buildingStage(job: CoachFlow['job'], secs: number): { head: string; sub: string } {
  const late = secs >= 90 ? 'You can stop, but the goal starts over.' : null;
  const writing = { head: 'Writing your plan.', sub: late ?? (secs < 45 ? 'Usually about half a minute.' : 'Long plans take a minute. It hasn’t stalled.') };
  if (!job) return writing;
  if (job.status === 'queued') {
    return { head: 'Your plan is in line to be written.', sub: late ?? (secs < 30 ? 'A few seconds, usually.' : 'Slower than usual to be picked up. Still in line.') };
  }
  if (job.status === 'done') return { head: 'Written. Opening it.', sub: 'One moment.' };
  if (job.attempts_logged >= 2) return { head: 'Two drafts didn’t pass Qoach’s checks. One more try.', sub: late ?? 'Every plan is checked before you see it.' };
  if (job.attempts_logged === 1) return { head: 'The first draft didn’t pass Qoach’s checks. Writing another.', sub: late ?? 'Every plan is checked before you see it.' };
  return writing;
}

/** The canvas' default card cadence, exposed there as a tweak. */
const CARD_SECONDS = 7;
/** Below this the door is a quiet link; at it, a bordered button. */
const DOOR_LOUD_AT = 60;

type WaitCard = { tag: string; color: string; line: string; detail: string };

/** Reads night.* at call time — the palette object is mutated in place by the
 *  appearance setting, so a module-level colour would freeze to one mode. */
function waitCards(v: Verdict | null): WaitCard[] {
  if (!v) return [];
  if (v.reads?.length) {
    const TAG = { for: 'FOR', risk: 'RISK', move: 'MOVE' } as const;
    const COLOR = { for: night.accentText, risk: night.warn, move: night.violetText } as const;
    return v.reads.map(r => ({ tag: TAG[r.kind], color: COLOR[r.kind], line: r.line, detail: r.detail }));
  }
  // Verdicts stored before prompt v28 carry no read cards. Their success
  // factors are the same material one level rawer — but sorting them into
  // FOR / RISK / MOVE would be a classification nobody actually made, so
  // they keep a neutral tag.
  return (v.success_factors ?? []).map((line, i) => ({
    tag: 'WHY IT LANDS',
    color: night.accentText,
    line,
    detail: v.success_factor_notes?.[i] ?? '',
  }));
}

/** "Your plan is written — opens instantly": shown only when the draft job
 *  for exactly the config the button would build reports done (build 33).
 *  Never a guess — the server's own fact, polled. */
function ReadyLine({ text = 'YOUR PLAN IS WRITTEN — OPENS INSTANTLY' }: { text?: string }) {
  return (
    <Text style={{ marginTop: 10, textAlign: 'center', fontFamily: MONO, fontSize: 11, letterSpacing: 1.2, color: night.accentText }}>
      {text}
    </Text>
  );
}

function WaitEyebrow({ text, color }: { text: string; color?: string }) {
  return (
    <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: 12, fontWeight: '700', letterSpacing: 1.6, color: color ?? night.textGhost }}>
      {text}
    </Text>
  );
}

/** Fade + 10pt rise as the read cards turn. Keyed on the card index by the
 *  caller, so a new mount is the transition. */
function SoftIn({ children }: { children: React.ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [t]);
  return (
    <Animated.View
      style={{
        opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

function ThinkingView({
  coach, building, onDismiss,
}: { coach: CoachFlow; building: boolean; onDismiss: () => void }) {
  // ELAPSED, not progress. A percentage would be this number over a guess: it
  // would race ahead and then stall near the end, on exactly the slow plans
  // where the reassurance matters most.
  const [secs, setSecs] = useState(0);
  const [sheet, setSheet] = useState(false);
  // Opening the reads freezes the carousel. A card that turned away
  // mid-sentence would be worse than the clamp it was opened to escape.
  const [readsOpen, setReadsOpen] = useState(false);
  useEffect(() => {
    const iv = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const stage = building
    ? buildingStage(coach.job, secs)
    : WAIT_COPY.thinking.reduce((best, s) => (secs >= s.after ? s : best), WAIT_COPY.thinking[0]);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const loud = secs >= DOOR_LOUD_AT;

  const v = coach.verdict ?? null;
  const cards = building ? waitCards(v) : [];
  const frozenIdx = useRef(0);
  if (!readsOpen && cards.length) frozenIdx.current = Math.floor(secs / CARD_SECONDS) % cards.length;
  const cardIdx = cards.length ? frozenIdx.current : 0;
  const card = cards[cardIdx];
  const weeks = v?.pace_options?.find(o => o.key === coach.pace)?.duration_weeks ?? v?.duration_weeks;
  const odds = coach.chosenOdds;
  const answers = coach.qa.filter(e => e.answer);

  return (
    <View style={{ flex: 1 }}>
      <Screen scroll={false} horizontal={24}>
        {/* status — the only row that is the same in both phases */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 52 }}>
          <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
            <Spin duration={9000} style={{ position: 'absolute' }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderStyle: 'dashed', borderColor: night.borderDashed }} />
            </Spin>
            <View
              style={{
                width: 32, height: 32, borderRadius: 16, backgroundColor: night.accent,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 16, color: night.accentInk }}>Q</Text>
            </View>
          </View>
          <View style={{ flex: 1, height: 44, justifyContent: 'center', gap: 2 }}>
            <Text numberOfLines={1} style={{ fontFamily: nightFonts.bodyMedium, fontSize: 15, lineHeight: 20, color: night.text }}>
              {stage.head}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: nightFonts.body, fontSize: 13, lineHeight: 18, color: night.textMuted }}>
              {stage.sub}
            </Text>
          </View>
          {/* MONO so the width does not jump between 0:09 and 0:10. */}
          <Text style={{ fontFamily: MONO, fontSize: 15, lineHeight: 20, color: night.textMuted }}>{clock}</Text>
        </View>

        {building ? (
          <>
            <View style={{ marginTop: 30 }}><WaitEyebrow text="WRITING FROM YOUR VERDICT" /></View>
            <View style={{ marginTop: 10, height: 87, overflow: 'hidden' }}>
              <Text numberOfLines={3} style={{ fontFamily: nightFonts.display, fontSize: 25, lineHeight: 29, color: night.text }}>
                {coach.chosenStatement ?? coach.goalText}
              </Text>
            </View>
            {v?.subtitle ? (
              <Text numberOfLines={2} style={{ marginTop: 6, height: 40, fontFamily: nightFonts.body, fontSize: 14, lineHeight: 20, color: night.textMuted }}>
                {v.subtitle}
              </Text>
            ) : (
              <View style={{ height: 46 }} />
            )}
            {weeks ? (
              <Text style={{ marginTop: 10, fontFamily: MONO, fontSize: 11.5, lineHeight: 14, fontWeight: '500', letterSpacing: 0.8, color: night.textGhost }}>
                {weeks} WEEKS · {coach.pace.toUpperCase()} PACE
              </Text>
            ) : null}

            {/* Their number beside Qoach's. Both were on file before the wait
                started; "YOU CALLED" only appears when they actually called. */}
            {odds != null && !readsOpen ? (
              <View
                style={{
                  marginTop: 18, backgroundColor: night.surface, borderWidth: 1, borderColor: night.border,
                  borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16,
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                }}
              >
                <View>
                  <WaitEyebrow text="QOACH'S ODDS" />
                  <Text style={{ marginTop: 4, fontFamily: MONO, fontSize: 34, lineHeight: 38, fontWeight: '700', color: night.accentText }}>
                    {odds}
                  </Text>
                </View>
                {coach.pickedOdds != null ? (
                  <>
                    <View style={{ width: 1, height: 44, backgroundColor: night.border }} />
                    <View>
                      <WaitEyebrow text="YOU CALLED" />
                      <Text style={{ marginTop: 4, fontFamily: MONO, fontSize: 34, lineHeight: 38, fontWeight: '700', color: night.text }}>
                        {coach.pickedOdds}
                      </Text>
                    </View>
                  </>
                ) : null}
                <Text style={{ flex: 1, fontFamily: nightFonts.body, fontSize: 12, lineHeight: 16, color: night.textMuted }}>
                  Odds it lands if the reps happen as written.
                </Text>
              </View>
            ) : null}

            {/* Closed, a card is a 150pt slot that turns every 7 seconds, so
                both halves are clamped and the longest reads lost their point
                mid-sentence with no way in. Tapping opens all three, in full,
                and stops the rotation — a card that turned away while you were
                reading it would be worse than the clamp. */}
            {card ? (
              readsOpen ? (
                <View style={{ marginTop: 14, flex: 1 }}>
                  <Pressable
                    onPress={() => setReadsOpen(false)}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8 }}
                    hitSlop={8}
                  >
                    <WaitEyebrow text="QOACH'S READ" />
                    <WaitEyebrow text="TAP TO CLOSE" color={night.accentText} />
                  </Pressable>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {cards.map((k, i) => (
                      <View
                        key={i}
                        style={{
                          backgroundColor: night.surfaceDeep, borderWidth: 1, borderColor: night.border,
                          borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16,
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <WaitEyebrow text={k.tag} color={k.color} />
                          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: 12, fontWeight: '500', color: night.textGhost }}>
                            {i + 1} / {cards.length}
                          </Text>
                        </View>
                        <Text style={{ marginTop: 8, fontFamily: nightFonts.display, fontSize: 17, lineHeight: 22, color: night.text }}>
                          {k.line}
                        </Text>
                        {k.detail ? (
                          <Text style={{ marginTop: 6, fontFamily: nightFonts.body, fontSize: 13, lineHeight: 18, color: night.textMuted }}>
                            {k.detail}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : (
                <View style={{ marginTop: 14, height: 150 }}>
                  <SoftIn key={cardIdx}>
                    <Pressable
                      onPress={() => setReadsOpen(true)}
                      style={{
                        height: 150, backgroundColor: night.surfaceDeep, borderWidth: 1, borderColor: night.border,
                        borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <WaitEyebrow text={card.tag} color={card.color} />
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
                          <WaitEyebrow text="TAP TO READ" color={night.accentText} />
                          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: 12, fontWeight: '500', color: night.textGhost }}>
                            {cardIdx + 1} / {cards.length}
                          </Text>
                        </View>
                      </View>
                      <Text numberOfLines={2} style={{ marginTop: 8, height: 44, fontFamily: nightFonts.display, fontSize: 17, lineHeight: 22, color: night.text }}>
                        {card.line}
                      </Text>
                      <Text numberOfLines={3} style={{ marginTop: 6, height: 54, fontFamily: nightFonts.body, fontSize: 13, lineHeight: 18, color: night.textMuted }}>
                        {card.detail}
                      </Text>
                    </Pressable>
                  </SoftIn>
                </View>
              )
            ) : null}

            {answers.length && !readsOpen ? (
              <>
                <View style={{ marginTop: 18 }}><WaitEyebrow text={`YOUR ANSWERS · ${answers.length}`} /></View>
                <View style={{ marginTop: 8, gap: 10 }}>
                  {answers.slice(0, 2).map((e, i) => (
                    <View key={i}>
                      <Text numberOfLines={1} style={{ fontFamily: nightFonts.bodyMedium, fontSize: 12, lineHeight: 16, color: night.textGhost }}>
                        Q{i + 1} · {e.question.question}
                      </Text>
                      <Text numberOfLines={2} style={{ height: 36, fontFamily: nightFonts.body, fontSize: 13.5, lineHeight: 18, color: night.text }}>
                        {e.answer}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : (
          <>
            {/* Pre-verdict there is no plan, no odds and no read cards. What
                there IS: their own words, and whatever they have already
                answered. Nothing is dressed up to fill the space. */}
            <View style={{ marginTop: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <WaitEyebrow text="YOUR GOAL, YOUR WORDS" />
              <WaitEyebrow text={`QUESTION ${Math.max(1, coach.questionCount + 1)} · AT LEAST ${QUESTION_FLOOR}`} color={night.accentText} />
            </View>
            <View style={{ marginTop: 10, height: 108, overflow: 'hidden' }}>
              <Text numberOfLines={4} style={{ fontFamily: nightFonts.display, fontSize: 22, lineHeight: 27, color: night.text }}>
                “{coach.goalText}”
              </Text>
            </View>
            {answers.length ? (
              <>
                <View style={{ marginTop: 22 }}><WaitEyebrow text="SO FAR" /></View>
                <View style={{ marginTop: 8, gap: 10 }}>
                  {answers.map((e, i) => (
                    <View
                      key={i}
                      style={{
                        backgroundColor: night.surface, borderWidth: 1, borderColor: night.border, borderRadius: 18,
                        paddingTop: 12, paddingBottom: 14, paddingHorizontal: 16,
                      }}
                    >
                      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'baseline' }}>
                        <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: 16, fontWeight: '700', color: night.accentText }}>Q{i + 1}</Text>
                        <Text numberOfLines={2} style={{ flex: 1, height: 32, fontFamily: nightFonts.body, fontSize: 12.5, lineHeight: 16, color: night.textMuted }}>
                          {e.question.question}
                        </Text>
                      </View>
                      <Text numberOfLines={3} style={{ marginTop: 6, height: 60, fontFamily: nightFonts.body, fontSize: 14, lineHeight: 20, color: night.text }}>
                        {e.answer}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            <View
              style={{
                marginTop: answers.length ? 10 : 22, height: 72, borderWidth: 1.5, borderStyle: 'dashed',
                borderColor: night.borderDashed, borderRadius: 18,
                flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16,
              }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: 16, fontWeight: '700', color: night.textGhost }}>
                Q{Math.max(1, coach.questionCount + 1)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Dot delay={0} />
                <Dot delay={300} />
                <Dot delay={600} />
              </View>
              <Text style={{ fontFamily: nightFonts.body, fontSize: 13, lineHeight: 18, color: night.textGhost }}>
                Lands here when it’s ready
              </Text>
            </View>
          </>
        )}

        {/* The reads take the slack themselves when open: two flex:1
            siblings would split it and halve the thing being read. */}
        {readsOpen ? null : <Spacer />}

        {/* The door. It was never rendered before this screen: onDismiss has
            been accepted and dropped on the floor since the canvas port, so a
            75-second wait had no exit at all. It is quiet until a minute has
            passed, and it always goes through the sheet — leaving costs the
            whole interview, and one tap should not spend that. */}
        <View style={{ height: 44, justifyContent: 'center' }}>
          {loud ? (
            <Pressable
              onPress={() => setSheet(true)}
              style={{
                height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: night.borderDashed,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 14, color: night.text }}>
                {building ? 'Stop writing this plan' : 'Stop and start over'}
              </Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setSheet(true)} hitSlop={8} style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13.5, color: night.textGhost }}>
                Leave — this goal starts over
              </Text>
            </Pressable>
          )}
        </View>
      </Screen>

      {sheet ? (
        <LeaveSheet
          eyebrow={`${clock} · ${building ? 'STILL WRITING BEHIND THIS' : 'STILL THINKING BEHIND THIS'}`}
          title={building ? 'Stop writing this plan?' : 'Stop and start over?'}
          // The canvas said "your answers are saved". They are not: the coach
          // session id lives in a ref, there is no GET for a session, and
          // nothing is written down until a plan is locked. Saying so is the
          // whole point of this sheet.
          body={answers.length
            ? 'Leaving throws away more than the wait. Your goal, your answers and Qoach’s verdict are only held while this is open — coming back starts again from the goal, and the questions come again too.'
            : 'Leaving throws away more than the wait. Your goal is only held while this is open — coming back means typing it again.'}
          keepLabel="Keep waiting"
          leaveLabel="Leave and start over"
          // True by construction: the plan landing unmounts this whole
          // screen, sheet included.
          footnote="If it finishes while this is open, it opens instead."
          onKeep={() => setSheet(false)}
          onLeave={() => { setSheet(false); onDismiss(); }}
        />
      ) : null}
    </View>
  );
}

/* ── chat thread (clarify conversation) ─────────────────────────────────── */

function Dot({ delay }: { delay: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 330, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 330, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        Animated.delay(440),
      ]),
    );
    const id = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(id); loop.stop(); };
  }, [delay, t]);
  return (
    <Animated.View
      style={{
        width: 7, height: 7, borderRadius: 4, backgroundColor: night.accent,
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
      }}
    />
  );
}

// A function, not a const: a module-level object would capture whichever
// palette was loaded at import time and stay that color forever (this bubble
// was stuck on the dark surface in light mode — dark text on a black card).
const qoachBubble = () => ({
  backgroundColor: night.surface,
  borderWidth: 1, borderColor: night.hairline,
  borderTopLeftRadius: 4, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
});

function TypingRow() {
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <QoachMark size={34} fontSize={18} />
      <View style={[qoachBubble(),{ flexDirection: 'row', gap: 5, paddingHorizontal: 18, paddingVertical: 17, alignItems: 'center' }]}>
        <Dot delay={0} /><Dot delay={150} /><Dot delay={300} />
      </View>
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <View
      style={{
        maxWidth: 520, backgroundColor: night.accentSofter,
        borderWidth: 1, borderColor: night.accentFaint,
        borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 4,
        paddingHorizontal: 18, paddingVertical: 13,
      }}
    >
      <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 15, lineHeight: 22.5, color: night.text }}>{text}</Text>
    </View>
  );
}

function ChatThread({ coach, answer, setAnswer, onDismiss, dismissLabel }: {
  coach: CoachFlow; answer: string; setAnswer: (v: string) => void;
  onDismiss: () => void; dismissLabel: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const thinking = coach.phase === 'thinking';
  const send = (text: string) => {
    if (text.trim() && !thinking) { coach.answerQuestion(text); setAnswer(''); }
  };

  return (
    <Screen scroll={false} horizontal={0}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 9,
          paddingHorizontal: 24, paddingBottom: 14,
          borderBottomWidth: 1, borderBottomColor: night.hairline,
        }}
      >
        <QoachMark />
        <Text style={{ fontFamily: nightFonts.display, fontSize: 18, color: night.text, letterSpacing: 0.2 }}>Qoach</Text>
        <View style={{ flex: 1 }} />
        {/* The denominator is honest again. It was removed when 4 was a CAP
            the coach rarely reached — "1 OF 4" promised questions that never
            came. 3 is now a FLOOR the server guarantees, so it is a real
            promise; the track grows past three on the goals that earn a
            fourth or fifth question. */}
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <MonoLabel
            text={`QUESTION ${coach.questionCount} OF ${Math.max(QUESTION_FLOOR, coach.questionCount)}`}
            color={night.textFaint}
            style={{ fontSize: 10.5, letterSpacing: 1 }}
          />
          <View style={{ flexDirection: 'row', gap: 5 }}>
            {Array.from({ length: Math.max(QUESTION_FLOOR, coach.questionCount) }, (_, i) => (
              <View
                key={i}
                style={{
                  width: 18, height: 4, borderRadius: 2,
                  backgroundColor: i < coach.questionCount ? night.accent : night.hairline,
                }}
              />
            ))}
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          maxWidth: 720, width: '100%', alignSelf: 'center',
          paddingHorizontal: 24, paddingTop: 24, paddingBottom: 18, gap: 18,
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <MonoLabel text="YOUR GOAL" style={{ paddingRight: 4 }} />
          <UserBubble text={coach.goalText} />
        </View>

        {coach.qa.map((entry, i) => {
          const isActive = i === coach.qa.length - 1 && coach.phase === 'question';
          return (
            <React.Fragment key={i}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <QoachMark size={34} fontSize={18} />
                <View style={{ gap: 10, flex: 1, maxWidth: 560, alignItems: 'flex-start' }}>
                  <Pop style={{ alignSelf: 'stretch' }}>
                    <View style={[qoachBubble(),{ paddingHorizontal: 20, paddingVertical: 16 }]}>
                      <Text style={{ fontFamily: nightFonts.display, fontSize: 19, lineHeight: 24.7, color: night.text, marginBottom: 7 }}>
                        {entry.question.question}
                      </Text>
                      <Text style={{ fontFamily: nightFonts.body, fontSize: 13.5, lineHeight: 20.9, color: night.textSoft }}>
                        {entry.question.why_it_matters}
                      </Text>
                    </View>
                  </Pop>
                  {isActive && (entry.question.suggested_answers?.length ?? 0) > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {entry.question.suggested_answers!.map(option => (
                        <Pressable
                          key={option}
                          onPress={() => send(option)}
                          style={({ pressed }) => ({
                            paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
                            backgroundColor: pressed ? night.accentSoft : night.surfaceDeep,
                            borderWidth: 1, borderColor: pressed ? night.accent : 'rgba(43,227,128,0.4)',
                          })}
                        >
                          <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13.5, color: night.text }}>{option}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </View>
              {entry.answer !== undefined && (
                <View style={{ alignItems: 'flex-end' }}>
                  <UserBubble text={entry.answer} />
                </View>
              )}
            </React.Fragment>
          );
        })}

        {thinking && <TypingRow />}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
        <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center', paddingHorizontal: 24, paddingTop: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <NightInput
              value={answer}
              onChangeText={setAnswer}
              placeholder="Answer honestly — it shapes the plan"
              style={{ flex: 1, height: 54, fontSize: 15 }}
              editable={!thinking}
              onSubmitEditing={() => send(answer)}
            />
            <Pressable
              onPress={() => send(answer)}
              style={{
                width: 54, height: 54, borderRadius: 27, backgroundColor: night.accent,
                alignItems: 'center', justifyContent: 'center',
                opacity: answer.trim() && !thinking ? 1 : 0.4,
                shadowColor: night.accent, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
              }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 22, color: night.accentInk }}>{'\u2191'}</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, color: night.textGhost }}>
              Tap a suggestion to send it {'\u2014'} or type your own
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 10.5, color: night.textGhost }}>
              your answers shape the plan
            </Text>
          </View>
        </View>
      </View>
    </Screen>
  );
}

/* ── the screen ─────────────────────────────────────────────────────────── */

// Hosted in two places: the onboarding funnel (dismiss = skip ahead) and the
// in-app "+" modal (dismiss = cancel). The Qoach surfaces keep Electric Night
// in both — the coach is its own sub-brand.
export default function FirstGoalScreen({
  onLocked, onDismiss, dismissLabel = 'Skip for now', demoHints = true, initialGoal, onUnsaved,
}: {
  onLocked: (plan: AcceptedPlan) => void;
  onDismiss: () => void;
  dismissLabel?: string;
  demoHints?: boolean;
  /** Prefill for the intake box — the regenerate-old-goal path. */
  initialGoal?: string;
  /** True while there is coach state that is not written down anywhere —
   *  a call in flight, a question on screen, a verdict, an unlocked plan.
   *  The host uses it to take away the swipe-to-dismiss gesture: the coach
   *  session lives in memory, so a stray swipe throws away the goal, the
   *  interview and the verdict silently. It used to cover only calls in
   *  flight, which left the plan itself — the most expensive state of all —
   *  one swipe from gone. */
  onUnsaved?: (unsaved: boolean) => void;
}) {
  // Ask on EVERY plan, not just the first (owner call, 2026-09-02). The gap
  // is novel once, but CALIBRATION is not: with the guess stored beside
  // Qoach's number and the eventual outcome, a few plans in you can honestly
  // tell someone they run optimistic — their own history, which is the only
  // kind of evidence this product is allowed to show. One guess per user
  // would have been a curiosity; one per plan is a dataset.
  const coach = useCoachFlow({ askEstimate: true });
  // Nothing about a coach session is written down until a plan is locked,
  // so every phase past intake is state a stray swipe would throw away. The
  // host takes the gesture away while that is true — deliberate exits (the
  // door on the wait screen, Start over, Cancel) still work. Error and
  // refusal are excluded: their screens are the way out.
  const unsaved = coach.phase !== 'intake' && coach.phase !== 'error' && coach.phase !== 'refused';
  useEffect(() => { onUnsaved?.(unsaved); }, [unsaved, onUnsaved]);
  useEffect(() => () => { onUnsaved?.(false); }, [onUnsaved]);
  const [draft, setDraft] = useState(initialGoal ?? '');
  const [answer, setAnswer] = useState('');
  const [boxFocused, setBoxFocused] = useState(false);
  const [shakeCount, setShakeCount] = useState(0);
  // Ask Intake, turn 3a (13 Sep): two doors on one screen. 'plan' is turn 2's
  // plan mode — the user brings their own plan and Qoach reviews it instead
  // of authoring one. The goal sentence stays: a plan is priced FOR something.
  const [mode, setMode] = useState<'goal' | 'plan'>('goal');
  const [planDraft, setPlanDraft] = useState('');
  const [planFocused, setPlanFocused] = useState(false);
  // "By when?" — a span pill, an exact day off the wheel, or Qoach decides
  // (null). Folded into the goal text at submit as whole weeks, floored, so
  // the coach reads a stated fact and the plan never runs past the date.
  const today = React.useMemo(() => todayYMD(), []);
  const [byWhen, setByWhen] = useState<ByWhen>(null);
  const [wheelOpen, setWheelOpen] = useState(false);

  const lockIn = () => {
    if (coach.acceptedPlan) onLocked(coach.acceptedPlan);
  };

  /* intake — Ask Intake, turn 3a: the date lives on the screen */
  if (coach.phase === 'intake') {
    const planMode = mode === 'plan';
    const ready = draft.trim().length > 2 && (!planMode || planDraft.trim().length > 2);
    const ask = () => {
      if (!ready) { setShakeCount(c => c + 1); return; }
      coach.submitGoal(foldTimeline(draft, byWhenWeeks(byWhen, today)), planMode ? planDraft : undefined);
    };
    const exact = byWhen?.kind === 'exact' ? byWhen.date : null;
    const field = (focused: boolean, height: number) => ({
      height, borderRadius: 16, backgroundColor: night.surface,
      borderWidth: 1.5, borderColor: focused ? night.accent : night.border,
      color: night.text, fontFamily: nightFonts.bodyMedium, fontSize: 16, lineHeight: 24,
      paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, textAlignVertical: 'top' as const,
    });
    return (
      <View style={{ flex: 1 }}>
        <Screen horizontal={26}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <QoachMark size={28} fontSize={16} />
            <Text style={{ flex: 1, fontFamily: nightFonts.display, fontSize: 18, color: night.text }}>Qoach</Text>
            {/* Not in the design, still needed: onboarding's "Skip for now"
                and the new-goal modal's "Cancel" both leave from here. */}
            <Pressable onPress={onDismiss} hitSlop={10}>
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 14, color: night.textSoft }}>{dismissLabel}</Text>
            </Pressable>
          </View>

          <Text style={{ marginTop: 34, marginBottom: 8, fontFamily: nightFonts.display, fontSize: 34, lineHeight: 37, color: night.text }}>
            {planMode ? 'Bring the plan ' : 'What do you want to '}
            <Text style={{ color: night.accent }}>{planMode ? "you've got." : 'pull off?'}</Text>
          </Text>
          <Text style={{ marginBottom: 22, fontFamily: nightFonts.body, fontSize: 15, lineHeight: 22.5, color: night.textMuted }}>
            {planMode ? "Qoach won't rewrite it — it keeps you honest to it." : "Say it plain — like you'd text a friend."}
          </Text>

          <Shake trigger={shakeCount}>
            <View style={{ gap: 10 }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onFocus={() => setBoxFocused(true)}
                onBlur={() => setBoxFocused(false)}
                multiline
                maxLength={GOAL_INPUT_MAX}
                placeholder={planMode ? 'What it’s for — “run a half marathon”' : '“cold shower every morning”'}
                placeholderTextColor={night.textGhost}
                style={field(boxFocused, planMode ? 64 : 112)}
              />
              {planMode ? (
                <TextInput
                  value={planDraft}
                  onChangeText={setPlanDraft}
                  onFocus={() => setPlanFocused(true)}
                  onBlur={() => setPlanFocused(false)}
                  multiline
                  maxLength={1000}
                  placeholder="Mon: 3 mi easy · Wed: intervals · Sat: long run…"
                  placeholderTextColor={night.textGhost}
                  style={field(planFocused, 112)}
                />
              ) : null}
            </View>
          </Shake>

          <View style={{ marginTop: 24, gap: 11 }}>
            <Text style={{ fontFamily: nightFonts.display, fontSize: 10.5, letterSpacing: 1.5, color: night.textGhost }}>BY WHEN?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SPAN_PILLS.map(pill => {
                const on = byWhen?.kind === 'span' && byWhen.label === pill.label;
                return (
                  <ByWhenPill
                    key={pill.label}
                    on={on}
                    label={on ? `${pill.label} · ${shortDate(addDays(today, pill.days), today)}` : pill.label}
                    onPress={() => setByWhen({ kind: 'span', label: pill.label, days: pill.days })}
                  />
                );
              })}
              <ByWhenPill
                chevron
                on={!!exact}
                label={exact ? shortDate(exact, today) : 'Pick a date'}
                onPress={() => { Keyboard.dismiss(); setWheelOpen(true); }}
              />
              <ByWhenPill dashed label="Qoach decides" onPress={() => setByWhen(null)} />
            </View>
          </View>

          <View style={{ flex: 1, minHeight: 24 }} />

          <Pressable
            onPress={ask}
            style={({ pressed }) => ({
              height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center',
              backgroundColor: ready ? night.accent : night.accentFaint,
              opacity: ready && pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ fontFamily: nightFonts.display, fontSize: 16, color: ready ? night.accentInk : night.textGhost }}>Ask Qoach</Text>
          </Pressable>
          <Pressable onPress={() => setMode(planMode ? 'goal' : 'plan')} hitSlop={6} style={{ marginTop: 14, alignSelf: 'center', padding: 6 }}>
            <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 14, color: night.textSoft }}>
              {planMode ? '← Start from a goal instead' : 'I already have a plan →'}
            </Text>
          </Pressable>
        </Screen>

        {wheelOpen ? (
          <DateWheelSheet
            today={today}
            initial={exact}
            onCancel={() => setWheelOpen(false)}
            onSet={day => { setByWhen({ kind: 'exact', date: day }); setWheelOpen(false); }}
          />
        ) : null}
      </View>
    );
  }

  /* thinking / building — full-screen orb only outside the conversation */
  if (coach.phase === 'building' || coach.phase === 'rebuilding' || (coach.phase === 'thinking' && coach.qa.length === 0)) {
    return <ThinkingView coach={coach} building={coach.phase !== 'thinking'} onDismiss={onDismiss} />;
  }

  /* clarify conversation — chat thread (canvas section 2) */
  if ((coach.phase === 'question' || coach.phase === 'thinking') && coach.qa.length > 0) {
    return <ChatThread coach={coach} answer={answer} setAnswer={setAnswer} onDismiss={onDismiss} dismissLabel={dismissLabel} />;
  }

  /* their call, before ours */
  if (coach.phase === 'predict') {
    return <PredictScreen onPick={coach.commitEstimate} />;
  }

  /* verdict — feasible (canvas 5a desktop / 5c phone) */
  if (coach.phase === 'verdict' && coach.verdict && coach.verdict.decision === 'feasible') {
    return (
      <FeasibleVerdict
        v={coach.verdict}
        missingRequired={coach.missingRequired}
        pace={coach.pace}
        onPace={coach.switchPace}
        onBuild={coach.buildPlan}
        onReset={coach.reset}
        sim={coach.sim}
        prevSim={coach.prevSim}
        editedKey={coach.editedKey}
        answers={coach.verdictAnswers}
        quickPicks={coach.quickPicks}
        onEditInput={coach.editInput}
        onPriceCustom={coach.priceCustom}
        ownPlanMode={coach.ownPlanMode}
        estimate={coach.estimate}
        draftReady={coach.draftReady}
      />
    );
  }

  /* verdict — counter-offer (canvas 5b: the negotiation, one dial flips) */
  if (coach.phase === 'verdict' && coach.verdict) {
    return (
      <CounterVerdict
        v={coach.verdict}
        goalText={coach.goalText}
        pace={coach.pace}
        onPace={coach.switchPace}
        onBuild={coach.buildPlan}
        onBuildOriginal={coach.buildOriginal}
        onReset={coach.reset}
        onPriceCustom={coach.priceCustom}
        ownPlanMode={coach.ownPlanMode}
        estimate={coach.estimate}
        draftReady={coach.draftReady}
      />
    );
  }

  /* protocol preview */
  if (coach.phase === 'protocol' && coach.protocol && coach.verdict) {
    return (
      <ProtocolReveal
        protocol={coach.protocol}
        statement={coach.chosenStatement ?? coach.verdict.goal_statement}
        odds={coach.pickedOdds ?? coach.chosenOdds}
        quickPicks={coach.quickPicks}
        onFixAssumption={coach.fixAssumption}
        onLock={lockIn}
        onRestart={coach.reset}
        onReprice={coach.repriceWithDrops}
        onEdit={coach.applyEdit}
        oddsStale={coach.oddsStale}
      />
    );
  }

  /* refusal — crisis variant */
  if (coach.phase === 'refused' && coach.refusal?.category === 'unsafe_selfharm') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <BigCircle glyph="♥" tint="violet" />
          <Title style={{ fontSize: 26, lineHeight: 30, textAlign: 'center' }}>You matter more than any goal</Title>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 14, lineHeight: 22.4, color: night.textMuted, textAlign: 'center', maxWidth: 290 }}>
            This is beyond what a coaching app should touch — and you deserve real support from real people. Reaching out is the strongest move there is.
          </Text>
          <View
            style={{
              width: '100%', borderRadius: 18, backgroundColor: night.surface,
              borderWidth: 1, borderColor: night.hairline, paddingHorizontal: 18, paddingVertical: 4,
            }}
          >
            <View style={{ paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: night.hairline }}>
              <Text style={{ fontFamily: nightFonts.display, fontSize: 15, color: night.text }}>988 — Suicide & Crisis Lifeline</Text>
              <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, color: night.textDim }}>Call or text, free, 24/7 (US)</Text>
            </View>
            <View style={{ paddingVertical: 13 }}>
              <Text style={{ fontFamily: nightFonts.display, fontSize: 15, color: night.accent }}>findahelpline.com</Text>
              <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, color: night.textDim }}>Free support lines, worldwide</Text>
            </View>
          </View>
        </View>
        <PrimaryButton label="Try a different goal" onPress={() => { setDraft(''); coach.reset(); }} />
      </Screen>
    );
  }

  /* refusal — needs-a-pro variant */
  if (coach.phase === 'refused' && coach.refusal) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <BigCircle glyph="+" tint="violet" />
          <Title style={{ fontSize: 27, lineHeight: 31, textAlign: 'center' }}>This one needs a pro in your corner</Title>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 23.2, color: night.textMuted, textAlign: 'center', maxWidth: 290 }}>
            {coach.refusal.message}
          </Text>
        </View>
        <PrimaryButton label="Try a different goal" onPress={() => { setDraft(''); coach.reset(); }} />
        <TextButton label={dismissLabel} onPress={onDismiss} height={44} />
      </Screen>
    );
  }

  /* quota */
  if (coach.phase === 'error' && coach.error?.kind === 'quota') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <BigCircle glyph="☾" tint="blue" />
          <Title style={{ fontSize: 26, lineHeight: 30, textAlign: 'center' }}>Daily coach limit reached</Title>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 23.2, color: night.textMuted, textAlign: 'center', maxWidth: 270 }}>
            Qoach is off the clock — back tomorrow. Your draft goal stays saved right where you left it.
          </Text>
          <View style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}>
            <Text style={{ fontFamily: MONO, fontSize: 11.5, color: night.textDim }}>resets at midnight</Text>
          </View>
        </View>
        <PrimaryButton label="Back to my goal" onPress={coach.reset} />
        <TextButton label={dismissLabel} onPress={onDismiss} height={44} />
      </Screen>
    );
  }

  /* error — snag */
  // Every failure kind used to render the same "hit a snag" line, so a client
  // that could not REACH the coach looked identical to a coach that broke.
  // That cost two rounds of diagnosis in one day: once for a tester whose
  // requests never left the browser, once for a dev worker that was simply
  // not running. The specific message is already on the error; show it.
  const snagNetwork = coach.error?.kind === 'network';
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <BigCircle glyph="!" tint="warn" />
        <Title style={{ fontSize: 26, lineHeight: 30, textAlign: 'center' }}>
          {snagNetwork ? "Can't reach the coach" : 'The coach hit a snag'}
        </Title>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 23.2, color: night.textMuted, textAlign: 'center', maxWidth: 280 }}>
          {coach.error?.message ?? 'Not you — us. Try again in a moment; your goal is still right here.'}
        </Text>
        {coach.error ? (
          <Text style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: night.textGhost, textAlign: 'center' }}>
            {coach.error.kind.toUpperCase()}
          </Text>
        ) : null}
        {!snagNetwork ? (
          <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, lineHeight: 19, color: night.textGhost, textAlign: 'center', maxWidth: 280 }}>
            Your goal is still right here.
          </Text>
        ) : null}
      </View>
      {coach.error?.retryable && <PrimaryButton label="Retry" onPress={coach.retry} />}
      <TextButton label="Back to my goal" onPress={coach.reset} height={46} />
      <TextButton label={dismissLabel} onPress={onDismiss} height={40} />
    </Screen>
  );
}
