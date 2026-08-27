// The Qoach intake flow — ported from the Claude Design canvas
// `Qleck Coach.dc.html` (project 7091d355) onto the live coach API.
// One screen hosts every state: intake → thinking → clarifying question →
// verdict (feasible / counter-offer) → protocol preview → lock in; refusal
// (pro / crisis variants), snag and quota states land from any AI step.
//
// The canvas' device frame + flow-map rail are mockup chrome (not ported);
// its fake routes are replaced by the real pipeline via useCoachFlow.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { DIAGONAL, night, nightFonts } from '../theme';
import { NightInput, Pop, PrimaryButton, Pulse, Screen, Shake, Spacer, Spin, TextButton, Title } from '../ui';
import { useCoachFlow, type AcceptedPlan, type CoachFlow } from '../useCoachFlow';
import { suggestionLook, suggestionsFor } from '../goalSuggestions';
import { useRally } from '../../state/RallyContext';
import type { Protocol, ProtocolMilestone, ProtocolPhase, ProtocolStep } from '../../api/coachTypes';
import Confetti, { type ConfettiHandle } from '../../components/Confetti';
import { celebratePlan } from '../../lib/celebrate';


const MONO = nightFonts.mono;

// Canvas section 3 ("first-page glow-up"): goal chips carry a rep-kind glyph.
// The set is picked at render time (src/onboarding/goalSuggestions.ts) so a
// chip is never offered for something the user already has in flight.

// Cycling ghost prompt inside the empty ask-box.
const GHOSTS = [
  '“run a 4k in six weeks”', '“quit smoking for good”', '“bake a proper sourdough”',
  '“read 10 min before bed”', '“do 20 clean pull-ups”', '“cold shower every morning”',
];

const THINK_LINES = ['Reading your goal…', 'Stress-testing the timeline…', 'Building your protocol…'];

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

// Soft radial ambience behind the intake hero (canvas: two blurred orbs).
function AmbientGlow({ id, color, size, style }: { id: string; color: string; size: number; style: object }) {
  return (
    <Svg width={size} height={size} style={[{ position: 'absolute' }, style]} pointerEvents="none">
      <Defs>
        <RadialGradient id={id}>
          <Stop offset="0" stopColor={color} stopOpacity={0.13} />
          <Stop offset="0.65" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

function GhostPrompt() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setIdx(i => i + 1), 2600);
    return () => clearInterval(iv);
  }, []);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 16, left: 20 }}>
      <Pop key={idx} duration={400}>
        <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 16, color: 'rgba(150,160,170,0.5)' }}>
          {GHOSTS[idx % GHOSTS.length]}
        </Text>
      </Pop>
    </View>
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

function StepRow({ step }: { step: ProtocolStep }) {
  const k = kindStyle(step.kind);
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 11,
        paddingVertical: 10, borderTopWidth: 1, borderTopColor: night.hairline,
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13.5, lineHeight: 18, color: night.text }}>
          {step.title}
        </Text>
        {/* The canvas' rep detail: the "how", one line under the what. */}
        {step.details ? (
          <Text style={{ marginTop: 3, fontFamily: nightFonts.body, fontSize: 12, lineHeight: 17, color: night.textDim }}>
            {step.details}
          </Text>
        ) : null}
      </View>
      {/* Sits beside its rep rather than stranded at the far edge: the column
          is width-capped in ProtocolReveal, which is what pinned these chips
          to the horizon in a desktop browser. */}
      <View style={{ backgroundColor: k.pill, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginTop: 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: k.fg }}>{stepMetric(step)}</Text>
      </View>
    </View>
  );
}

/** One phase: a header that always shows, reps only while open. */
function PhaseCard({
  phase, open, isLast, milestones, onToggle,
}: {
  phase: ProtocolPhase;
  open: boolean;
  isLast: boolean;
  milestones: ProtocolMilestone[];
  onToggle: () => void;
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
          {phase.steps.map(step => <StepRow key={step.id} step={step} />)}
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
  protocol, statement, onLock, onRestart,
}: {
  protocol: Protocol;
  statement: string;
  onLock: () => void;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState(0);
  const [locked, setLocked] = useState(false);
  const [note, setNote] = useState<string | null>(null);
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

  const say = (msg: string) => { setNote(msg); later(() => setNote(null), 2800); };

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
              />
            ))}
          </View>

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
          paddingHorizontal: 28, paddingTop: 12, paddingBottom: 18,
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
              <PrimaryButton label="Lock it in" onPress={lockIn} />
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 26, marginTop: 4 }}>
                <TextButton
                  label="Adjust something"
                  height={40}
                  onPress={() => say('Adjusting mid-plan lands after launch — Start over for a different plan.')}
                />
                <TextButton label="Start over" height={40} onPress={onRestart} />
              </View>
            </>
          )}
        </View>
      </View>

      {note ? (
        <View style={{ position: 'absolute', top: 18, left: 0, right: 0, alignItems: 'center' }} pointerEvents="none">
          <Pop>
            <View
              style={{
                maxWidth: 460, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11,
                backgroundColor: night.surface, borderWidth: 1, borderColor: night.border,
              }}
            >
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 12.5, lineHeight: 18, color: night.text, textAlign: 'center' }}>
                {note}
              </Text>
            </View>
          </Pop>
        </View>
      ) : null}

      <Confetti ref={confettiRef} />
    </View>
  );
}

/* ── thinking ───────────────────────────────────────────────────────────── */

function ThinkingView({ building, onDismiss, dismissLabel }: { building: boolean; onDismiss: () => void; dismissLabel: string }) {
  const [idx, setIdx] = useState(building ? 2 : 0);
  useEffect(() => {
    if (building) return;
    const iv = setInterval(() => setIdx(i => i + 1), 1100);
    return () => clearInterval(iv);
  }, [building]);
  const line = building ? THINK_LINES[2] : THINK_LINES[idx % THINK_LINES.length];
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26 }}>
        <Spin duration={9000}>
          <View
            style={{
              width: 170, height: 170, borderRadius: 85, borderWidth: 2,
              borderColor: 'rgba(43,227,128,0.3)', borderStyle: 'dashed',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Pulse>
              <View
                style={{
                  width: 110, height: 110, borderRadius: 55, backgroundColor: night.accent,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: night.accent, shadowOpacity: 0.5, shadowRadius: 28, shadowOffset: { width: 0, height: 0 },
                }}
              >
                <Text style={{ fontFamily: nightFonts.display, fontSize: 44, color: night.accentInk }}>Q</Text>
              </View>
            </Pulse>
          </View>
        </Spin>
        <View style={{ height: 46, justifyContent: 'center' }}>
          <Pop key={line} duration={450}>
            <Text style={{ fontFamily: nightFonts.display, fontSize: 17, color: night.text, textAlign: 'center' }}>
              {line}
            </Text>
          </Pop>
        </View>
      </View>
      <Text style={{ fontFamily: nightFonts.body, fontSize: 12, lineHeight: 19.2, color: night.textGhost, textAlign: 'center' }}>
        Real coaching takes 3–20 seconds.{'\n'}Qoach is reading, not spinning.
      </Text>
    </Screen>
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
        {/* No denominator: 4 is the server's CAP, not a plan. Qoach asks as
            few as it needs (often one), so "1 OF 4" promised three questions
            that never came. Count what actually happened instead. */}
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <MonoLabel text={`QUESTION ${coach.questionCount}`} color={night.textFaint} style={{ fontSize: 10.5, letterSpacing: 1 }} />
          <View style={{ flexDirection: 'row', gap: 5 }}>
            {Array.from({ length: Math.max(1, coach.questionCount) }, (_, i) => (
              <View key={i} style={{ width: 18, height: 4, borderRadius: 2, backgroundColor: night.accent }} />
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
  onLocked, onDismiss, dismissLabel = 'Skip for now', demoHints = true,
}: {
  onLocked: (plan: AcceptedPlan) => void;
  onDismiss: () => void;
  dismissLabel?: string;
  demoHints?: boolean;
}) {
  const coach = useCoachFlow();
  const { goals } = useRally();
  // Recomputed only when the active goal set changes — locking a goal here
  // retires its whole domain (smoking ⊃ vaping ⊃ cigarettes) next time.
  const suggestions = React.useMemo(
    () => suggestionsFor(goals.map(g => `${g.statement} ${g.protocol.goal_statement ?? ''}`)),
    [goals],
  );
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [boxFocused, setBoxFocused] = useState(false);
  const [shakeCount, setShakeCount] = useState(0);

  const lockIn = () => {
    if (coach.acceptedPlan) onLocked(coach.acceptedPlan);
  };

  /* intake — the stage, not a form (canvas section 3) */
  if (coach.phase === 'intake') {
    const ask = () => {
      if (draft.trim()) coach.submitGoal(draft);
      else setShakeCount(c => c + 1);
    };
    return (
      <Screen scroll={false}>
        <AmbientGlow id="glow-a" color={night.accent} size={420} style={{ top: -160, left: -80 }} />
        <AmbientGlow id="glow-v" color={night.violet} size={480} style={{ bottom: -200, right: -120 }} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <QoachMark />
          <Text style={{ fontFamily: nightFonts.display, fontSize: 19, color: night.text, letterSpacing: 0.2 }}>Qoach</Text>
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: night.border }}>
            <MonoLabel text="AI COACH" color={night.violetText} style={{ letterSpacing: 1 }} />
          </View>
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={{ fontFamily: nightFonts.display, fontSize: 34, lineHeight: 38, color: night.text, textAlign: 'center', marginBottom: 12 }}>
            What do you want to <Text style={{ color: night.accent }}>pull off?</Text>
          </Text>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 15.5, lineHeight: 23, color: night.textMuted, textAlign: 'center', marginBottom: 26 }}>
            Say it plain — like you'd text a friend. Qoach sets the timeline, that's the point.
          </Text>

          <Shake trigger={shakeCount}>
            <View
              style={{
                backgroundColor: night.surface, borderRadius: 22, borderWidth: 1.5,
                borderColor: boxFocused ? night.accent : night.hairline,
                shadowColor: boxFocused ? night.accent : '#000',
                shadowOpacity: boxFocused ? 0.18 : 0.35,
                shadowRadius: boxFocused ? 18 : 24,
                shadowOffset: { width: 0, height: 12 },
              }}
            >
              {!draft && <GhostPrompt />}
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onFocus={() => setBoxFocused(true)}
                onBlur={() => setBoxFocused(false)}
                multiline
                placeholder=""
                style={{
                  height: 88, color: night.text, fontFamily: nightFonts.bodyMedium, fontSize: 16,
                  lineHeight: 23, paddingHorizontal: 20, paddingTop: 16, textAlignVertical: 'top',
                }}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 10, paddingBottom: 10 }}>
                <Pressable
                  onPress={ask}
                  style={({ pressed }) => ({
                    height: 46, paddingHorizontal: 26, borderRadius: 23, backgroundColor: night.accent,
                    alignItems: 'center', justifyContent: 'center',
                    opacity: draft.trim() ? (pressed ? 0.88 : 1) : 0.55,
                    shadowColor: night.accent, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
                  })}
                >
                  <Text style={{ fontFamily: nightFonts.display, fontSize: 15, color: night.accentInk }}>Ask Qoach</Text>
                </Pressable>
              </View>
            </View>
          </Shake>

          <Text style={{ fontFamily: nightFonts.display, fontSize: 10.5, letterSpacing: 1.6, color: night.textGhost, textAlign: 'center', marginTop: 26, marginBottom: 10 }}>
            OR STEAL ONE
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 9 }}>
            {suggestions.map(sg => {
              const look = suggestionLook(sg.kind);
              return (
              <Pressable
                key={sg.label}
                onPress={() => setDraft(sg.label)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 9,
                  paddingVertical: 9, paddingLeft: 9, paddingRight: 15, borderRadius: 999,
                  backgroundColor: pressed ? night.surface : night.surfaceDeep,
                  borderWidth: 1, borderColor: pressed ? night.accentBorderStrong : night.border,
                })}
              >
                <View
                  style={{
                    width: 24, height: 24, borderRadius: 8, backgroundColor: look.bg,
                    borderWidth: 1, borderColor: look.bd, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: look.c }}>{look.g}</Text>
                </View>
                <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.text }}>{sg.label}</Text>
              </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline', gap: 16, marginTop: 22 }}>
            <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, color: night.textGhost }}>
              Your goal is sent to our AI coach to build your plan.
            </Text>
            <Pressable onPress={onDismiss} hitSlop={8}>
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 12.5, color: night.textFaint }}>{dismissLabel}</Text>
            </Pressable>
          </View>
        </View>
      </Screen>
    );
  }

  /* thinking / building — full-screen orb only outside the conversation */
  if (coach.phase === 'building' || (coach.phase === 'thinking' && coach.qa.length === 0)) {
    return <ThinkingView building={coach.phase === 'building'} onDismiss={onDismiss} dismissLabel={dismissLabel} />;
  }

  /* clarify conversation — chat thread (canvas section 2) */
  if ((coach.phase === 'question' || coach.phase === 'thinking') && coach.qa.length > 0) {
    return <ChatThread coach={coach} answer={answer} setAnswer={setAnswer} onDismiss={onDismiss} dismissLabel={dismissLabel} />;
  }

  /* verdict — feasible */
  if (coach.phase === 'verdict' && coach.verdict && coach.verdict.decision === 'feasible') {
    const v = coach.verdict;
    return (
      <Screen>
        <Pop>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <View
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                backgroundColor: night.accentTint, borderWidth: 1, borderColor: night.accentBorderStrong,
              }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 11, letterSpacing: 1.8, color: night.accent }}>✓ FEASIBLE</Text>
            </View>
            <View
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                backgroundColor: night.surface, borderWidth: 1, borderColor: night.borderMuted,
              }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 11, letterSpacing: 1, color: night.text }}>
                {v.duration_weeks} WEEKS
              </Text>
            </View>
          </View>
        </Pop>
        <Title style={{ fontSize: 25, lineHeight: 30, marginTop: 18, marginBottom: 14 }}>{v.goal_statement}</Title>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 14, lineHeight: 22.4, color: night.textMuted, marginBottom: 20 }}>
          {v.assessment}
        </Text>
        <MonoLabel
          text="WHAT WILL DECIDE IT"
          color={night.textFaint}
          style={{ fontFamily: nightFonts.display, fontSize: 10.5, letterSpacing: 1.5, marginBottom: 10 }}
        />
        <View style={{ gap: 9 }}>
          {v.success_factors.map(f => (
            <View key={f} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View
                style={{
                  width: 7, height: 7, borderRadius: 4, backgroundColor: night.accent, marginTop: 6,
                  shadowColor: night.accent, shadowOpacity: 0.6, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
                }}
              />
              <Text style={{ flex: 1, fontFamily: nightFonts.bodyMedium, fontSize: 13.5, lineHeight: 19.5, color: night.text }}>
                {f}
              </Text>
            </View>
          ))}
        </View>
        <Spacer />
        <PrimaryButton label="Build my plan" onPress={coach.buildPlan} />
        <TextButton label="Change my goal" onPress={coach.reset} height={46} />
      </Screen>
    );
  }

  /* verdict — counter-offer */
  if (coach.phase === 'verdict' && coach.verdict) {
    const v = coach.verdict;
    return (
      <Screen>
        <Pop>
          <View
            style={{
              alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
              backgroundColor: 'rgba(247,179,43,0.13)', borderWidth: 1, borderColor: 'rgba(247,179,43,0.6)',
            }}
          >
            <Text style={{ fontFamily: nightFonts.display, fontSize: 11, letterSpacing: 1.8, color: night.warn }}>⇄ COUNTER-OFFER</Text>
          </View>
        </Pop>

        <View
          style={{
            marginTop: 18, borderRadius: 16, backgroundColor: night.surfaceDeep,
            borderWidth: 1, borderColor: night.hairline, paddingHorizontal: 16, paddingVertical: 14,
          }}
        >
          <MonoLabel text="YOUR ASK" style={{ marginBottom: 5 }} />
          <Text
            style={{
              fontFamily: nightFonts.display, fontSize: 15, lineHeight: 20, color: night.textFaint,
              textDecorationLine: 'line-through', textDecorationColor: 'rgba(247,179,43,0.65)',
            }}
          >
            {v.original_request ?? coach.goalText}
          </Text>
        </View>
        <Text style={{ textAlign: 'center', fontFamily: nightFonts.display, fontSize: 16, color: night.textGhost, marginVertical: 8 }}>↓</Text>
        <View
          style={{
            borderRadius: 16, backgroundColor: 'rgba(43,227,128,0.09)',
            borderWidth: 1, borderColor: night.accentBorder, paddingHorizontal: 16, paddingVertical: 14,
          }}
        >
          <MonoLabel text="QOACH'S OFFER" color={night.accent} style={{ marginBottom: 5 }} />
          <Text style={{ fontFamily: nightFonts.display, fontSize: 18, lineHeight: 23.4, color: night.text }}>
            {v.goal_statement}
          </Text>
          <Text style={{ fontFamily: nightFonts.display, fontSize: 12, color: night.accent, marginTop: 4 }}>
            {v.duration_weeks} weeks
          </Text>
        </View>

        <Text style={{ marginTop: 18, fontFamily: nightFonts.body, fontSize: 14, lineHeight: 22.4, color: night.textMuted }}>
          "{v.assessment}"
        </Text>
        <Spacer />
        <PrimaryButton label="Take the deal" onPress={coach.buildPlan} />
        <TextButton label="Change my goal" onPress={coach.reset} height={46} />
      </Screen>
    );
  }

  /* protocol preview */
  if (coach.phase === 'protocol' && coach.protocol && coach.verdict) {
    return (
      <ProtocolReveal
        protocol={coach.protocol}
        statement={coach.verdict.goal_statement}
        onLock={lockIn}
        onRestart={coach.reset}
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
