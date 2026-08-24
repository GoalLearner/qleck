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
import type { Protocol, ProtocolStep } from '../../api/coachTypes';

const BLUE = '#5BC4F5';
const MONO = nightFonts.mono;

// Canvas section 3 ("first-page glow-up"): goal chips carry a rep-kind glyph.
const SUGGESTIONS = [
  { g: 'D', c: BLUE, bg: 'rgba(14,159,232,0.14)', bd: 'rgba(14,159,232,0.5)', label: 'Run a 5k' },
  { g: '#', c: '#B69CFF', bg: 'rgba(139,92,246,0.14)', bd: 'rgba(139,92,246,0.5)', label: 'Lose 10 lbs' },
  { g: '✓', c: '#2BE380', bg: 'rgba(43,227,128,0.12)', bd: 'rgba(43,227,128,0.5)', label: 'Quit smoking' },
  { g: '#', c: '#B69CFF', bg: 'rgba(139,92,246,0.14)', bd: 'rgba(139,92,246,0.5)', label: 'Save $5,000' },
  { g: 'D', c: BLUE, bg: 'rgba(14,159,232,0.14)', bd: 'rgba(14,159,232,0.5)', label: 'Read 12 books this year' },
  { g: '✓', c: '#2BE380', bg: 'rgba(43,227,128,0.12)', bd: 'rgba(43,227,128,0.5)', label: 'Gym 3 mornings a week' },
];

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
    violet: { bg: 'rgba(139,92,246,0.12)', bd: 'rgba(139,92,246,0.45)', fg: night.violetText },
    warn: { bg: 'rgba(247,179,43,0.13)', bd: 'rgba(247,179,43,0.55)', fg: night.warn },
    blue: { bg: 'rgba(14,159,232,0.12)', bd: 'rgba(14,159,232,0.5)', fg: BLUE },
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
  if (kind === 'duration') return { glyph: 'D', fg: BLUE, bg: 'rgba(14,159,232,0.14)', bd: 'rgba(14,159,232,0.5)', pill: 'rgba(14,159,232,0.1)' };
  if (kind === 'quantity') return { glyph: '#', fg: night.violetText, bg: 'rgba(139,92,246,0.14)', bd: 'rgba(139,92,246,0.5)', pill: 'rgba(139,92,246,0.1)' };
  return { glyph: '✓', fg: night.accent, bg: 'rgba(43,227,128,0.12)', bd: night.accentBorder, pill: 'rgba(43,227,128,0.1)' };
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View
        style={{
          width: 26, height: 26, borderRadius: 8, backgroundColor: k.bg,
          borderWidth: 1, borderColor: k.bd, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: k.fg }}>{k.glyph}</Text>
      </View>
      <Text style={{ flex: 1, fontFamily: nightFonts.bodyMedium, fontSize: 13, lineHeight: 17.5, color: night.text }}>
        {step.title}
      </Text>
      <View style={{ backgroundColor: k.pill, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: k.fg }}>{stepMetric(step)}</Text>
      </View>
    </View>
  );
}

function MilestoneRow({ week, title }: { week: number; title: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 }}>
      <Text style={{ fontFamily: nightFonts.display, fontSize: 12, color: night.accent }}>⚑</Text>
      <MonoLabel text={`WEEK ${week} — ${title.toUpperCase()}`} color={night.textDim} style={{ fontSize: 10.5 }} />
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
    </View>
  );
}

function ProtocolBody({ protocol }: { protocol: Protocol }) {
  const milestones = [...protocol.milestones].sort((a, b) => a.week - b.week);
  return (
    <View style={{ gap: 10 }}>
      {protocol.phases.map(phase => (
        <React.Fragment key={phase.id}>
          <View
            style={{
              borderRadius: 20, backgroundColor: night.surface,
              borderWidth: 1, borderColor: night.hairline, padding: 16,
            }}
          >
            <View
              style={{
                alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
                backgroundColor: night.accentSoft, borderWidth: 1, borderColor: 'rgba(43,227,128,0.45)',
              }}
            >
              <MonoLabel text={`WEEKS ${phase.start_week}–${phase.end_week}`} color={night.accent} />
            </View>
            <Text style={{ fontFamily: nightFonts.display, fontSize: 16, color: night.text, marginVertical: 10 }}>
              {phase.title}
            </Text>
            <View style={{ gap: 8 }}>
              {phase.steps.map(step => <StepRow key={step.id} step={step} />)}
            </View>
          </View>
          {milestones
            .filter(m => m.week >= phase.start_week && m.week <= phase.end_week)
            .map(m => <MilestoneRow key={m.id} week={m.week} title={m.title} />)}
        </React.Fragment>
      ))}

      <LinearGradient
        colors={['rgba(43,227,128,0.1)', 'rgba(14,159,232,0.08)']}
        start={DIAGONAL.start}
        end={DIAGONAL.end}
        style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(43,227,128,0.35)', paddingHorizontal: 16, paddingVertical: 14 }}
      >
        <MonoLabel text="QOACH'S NOTE" color={night.accent} style={{ marginBottom: 5 }} />
        <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13.5, lineHeight: 20, color: night.text, fontStyle: 'italic' }}>
          {protocol.coach_notes}
        </Text>
      </LinearGradient>
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

const QOACH_BUBBLE = {
  backgroundColor: night.surface,
  borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  borderTopLeftRadius: 4, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
} as const;

function TypingRow() {
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <QoachMark size={34} fontSize={18} />
      <View style={[QOACH_BUBBLE, { flexDirection: 'row', gap: 5, paddingHorizontal: 18, paddingVertical: 17, alignItems: 'center' }]}>
        <Dot delay={0} /><Dot delay={150} /><Dot delay={300} />
      </View>
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <View
      style={{
        maxWidth: 520, backgroundColor: 'rgba(43,227,128,0.1)',
        borderWidth: 1, borderColor: 'rgba(43,227,128,0.35)',
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
          borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
        }}
      >
        <QoachMark />
        <Text style={{ fontFamily: nightFonts.display, fontSize: 18, color: night.text, letterSpacing: 0.2 }}>Qoach</Text>
        <View style={{ flex: 1 }} />
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <MonoLabel text={`QUESTION ${coach.questionCount} OF 4`} color={night.textFaint} style={{ fontSize: 10.5, letterSpacing: 1 }} />
          <View style={{ flexDirection: 'row', gap: 5 }}>
            {[1, 2, 3, 4].map(n => (
              <View
                key={n}
                style={{
                  width: 18, height: 4, borderRadius: 2,
                  backgroundColor: coach.questionCount >= n ? night.accent : 'rgba(255,255,255,0.15)',
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
                    <View style={[QOACH_BUBBLE, { paddingHorizontal: 20, paddingVertical: 16 }]}>
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
                            backgroundColor: pressed ? 'rgba(43,227,128,0.12)' : night.surfaceDeep,
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
            <Text style={{ fontFamily: MONO, fontSize: 10.5, color: 'rgba(242,245,244,0.35)' }}>
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
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [adjustHint, setAdjustHint] = useState(false);
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
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(139,92,246,0.5)' }}>
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
            {SUGGESTIONS.map(sg => (
              <Pressable
                key={sg.label}
                onPress={() => setDraft(sg.label)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 9,
                  paddingVertical: 9, paddingLeft: 9, paddingRight: 15, borderRadius: 999,
                  backgroundColor: pressed ? night.surface : night.surfaceDeep,
                  borderWidth: 1, borderColor: pressed ? 'rgba(43,227,128,0.65)' : night.border,
                })}
              >
                <View
                  style={{
                    width: 24, height: 24, borderRadius: 8, backgroundColor: sg.bg,
                    borderWidth: 1, borderColor: sg.bd, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: sg.c }}>{sg.g}</Text>
                </View>
                <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.text }}>{sg.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline', gap: 16, marginTop: 22 }}>
            <Text style={{ fontFamily: nightFonts.body, fontSize: 11.5, color: 'rgba(242,245,244,0.35)' }}>
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
        <Text style={{ fontFamily: nightFonts.body, fontSize: 14, lineHeight: 22.4, color: 'rgba(242,245,244,0.65)', marginBottom: 20 }}>
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
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16, paddingVertical: 14,
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
        <Text style={{ textAlign: 'center', fontFamily: nightFonts.display, fontSize: 16, color: 'rgba(242,245,244,0.35)', marginVertical: 8 }}>↓</Text>
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

        <Text style={{ marginTop: 18, fontFamily: nightFonts.body, fontSize: 14, lineHeight: 22.4, color: 'rgba(242,245,244,0.65)' }}>
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
      <Screen>
        <MonoLabel text="YOUR PROTOCOL" color={night.accent} style={{ fontSize: 10.5, letterSpacing: 1.5 }} />
        <Text style={{ fontFamily: nightFonts.display, fontSize: 21, lineHeight: 26.25, color: night.text, marginTop: 8, marginBottom: 4 }}>
          {coach.verdict.goal_statement}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 12.5, color: night.textDim }}>
            {coach.protocol.duration_weeks} weeks · {coach.protocol.phases.length} phases  ·
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: BLUE }}>D</Text>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 12, color: night.textGhost }}>duration</Text>
          <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: night.violetText }}>#</Text>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 12, color: night.textGhost }}>quantity</Text>
          <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: night.accent }}>✓</Text>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 12, color: night.textGhost }}>done / not</Text>
        </View>

        <ProtocolBody protocol={coach.protocol} />

        <View style={{ height: 16 }} />
        <PrimaryButton label="Lock it in" onPress={lockIn} />
        {adjustHint ? (
          <Text style={{ height: 44, textAlign: 'center', paddingTop: 13, fontFamily: nightFonts.body, fontSize: 12.5, color: night.textFaint }}>
            Adjusting mid-plan lands after launch — Start over for a different plan.
          </Text>
        ) : (
          <TextButton label="Adjust something" onPress={() => setAdjustHint(true)} />
        )}
        <TextButton label="Start over" onPress={() => { setAdjustHint(false); coach.reset(); }} height={40} />
      </Screen>
    );
  }

  /* refusal — crisis variant */
  if (coach.phase === 'refused' && coach.refusal?.category === 'unsafe_selfharm') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <BigCircle glyph="♥" tint="violet" />
          <Title style={{ fontSize: 26, lineHeight: 30, textAlign: 'center' }}>You matter more than any goal</Title>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 14, lineHeight: 22.4, color: 'rgba(242,245,244,0.65)', textAlign: 'center', maxWidth: 290 }}>
            This is beyond what a coaching app should touch — and you deserve real support from real people. Reaching out is the strongest move there is.
          </Text>
          <View
            style={{
              width: '100%', borderRadius: 18, backgroundColor: night.surface,
              borderWidth: 1, borderColor: night.hairline, paddingHorizontal: 18, paddingVertical: 4,
            }}
          >
            <View style={{ paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
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
          <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 23.2, color: 'rgba(242,245,244,0.65)', textAlign: 'center', maxWidth: 290 }}>
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
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <BigCircle glyph="!" tint="warn" />
        <Title style={{ fontSize: 26, lineHeight: 30, textAlign: 'center' }}>The coach hit a snag</Title>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 23.2, color: night.textMuted, textAlign: 'center', maxWidth: 270 }}>
          Not you — us. Try again in a moment; your goal is still right here.
        </Text>
      </View>
      {coach.error?.retryable && <PrimaryButton label="Retry" onPress={coach.retry} />}
      <TextButton label="Back to my goal" onPress={coach.reset} height={46} />
      <TextButton label={dismissLabel} onPress={onDismiss} height={40} />
    </Screen>
  );
}
