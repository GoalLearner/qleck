// The Qoach intake flow — ported from the Claude Design canvas
// `Qleck Coach.dc.html` (project 7091d355) onto the live coach API.
// One screen hosts every state: intake → thinking → clarifying question →
// verdict (feasible / counter-offer) → protocol preview → lock in; refusal
// (pro / crisis variants), snag and quota states land from any AI step.
//
// The canvas' device frame + flow-map rail are mockup chrome (not ported);
// its fake routes are replaced by the real pipeline via useCoachFlow.
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DIAGONAL, night, nightFonts } from '../theme';
import { NightInput, Note, Pop, PrimaryButton, Pulse, Screen, Spacer, Spin, TextButton, Title } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';
import { useCoachFlow } from '../useCoachFlow';
import type { Protocol, ProtocolStep } from '../../api/coachTypes';

const BLUE = '#5BC4F5';
const MONO = nightFonts.mono;

const SUGGESTIONS = [
  'Walk 10 000 steps a day',
  'Run a 4k in six weeks',
  'Smoke-free streak',
  'Read 10 min before bed',
];

// Demo chips prefill goals that genuinely trigger each verdict via the live AI.
const DEMO_GOALS = [
  { label: 'demo: counter-offer', goal: 'Full marathon in 3 weeks — never run before', bd: 'rgba(247,179,43,0.45)', fg: 'rgba(247,179,43,0.85)' },
  { label: 'demo: refusal', goal: 'Lose 15 kg in 3 weeks, whatever it takes', bd: 'rgba(139,92,246,0.45)', fg: 'rgba(182,156,255,0.85)' },
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

function ThinkingView({ building }: { building: boolean }) {
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

/* ── the screen ─────────────────────────────────────────────────────────── */

export default function FirstGoalScreen({ flow, demoHints = true }: { flow: OnboardingFlow; demoHints?: boolean }) {
  const coach = useCoachFlow();
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [adjustHint, setAdjustHint] = useState(false);

  const lockIn = () => {
    if (coach.acceptedPlan) {
      flow.setPlan(coach.acceptedPlan);
      flow.nav('invite');
    }
  };

  /* intake */
  if (coach.phase === 'intake') {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <QoachMark />
          <Text style={{ fontFamily: nightFonts.display, fontSize: 19, color: night.text, letterSpacing: 0.2 }}>Qoach</Text>
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(139,92,246,0.5)' }}>
            <MonoLabel text="AI COACH" color={night.violetText} style={{ letterSpacing: 1 }} />
          </View>
        </View>
        <Title style={{ marginTop: 24, marginBottom: 8 }}>What do you want to pull off?</Title>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 15, lineHeight: 22.5, color: night.textMuted, marginBottom: 18 }}>
          Say it plain — like you'd text a friend. Qoach sets the timeline, that's the point.
        </Text>
        <NightInput
          value={draft}
          onChangeText={setDraft}
          placeholder="run a 4k · quit smoking · bake a proper cake…"
          multiline
          style={{ height: 104, paddingTop: 14, fontSize: 15.5, textAlignVertical: 'top' }}
        />
        <MonoLabel text="OR STEAL ONE" color={night.textGhost} style={{ fontFamily: nightFonts.display, fontSize: 10.5, letterSpacing: 1.5, marginTop: 16 }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {SUGGESTIONS.map(s => (
            <Pressable
              key={s}
              onPress={() => setDraft(s)}
              style={{
                paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
                backgroundColor: night.surface, borderWidth: 1, borderColor: night.border,
              }}
            >
              <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 12.5, color: night.text }}>{s}</Text>
            </Pressable>
          ))}
        </View>
        {demoHints && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 16 }}>
            {DEMO_GOALS.map(d => (
              <Pressable
                key={d.label}
                onPress={() => setDraft(d.goal)}
                style={{
                  paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999,
                  borderWidth: 1, borderColor: d.bd, borderStyle: 'dashed',
                }}
              >
                <Text style={{ fontFamily: MONO, fontSize: 11.5, color: d.fg }}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Spacer />
        <Note>Your goal is sent to our AI coach to build your plan.</Note>
        <PrimaryButton label="Ask Qoach" onPress={() => coach.submitGoal(draft)} disabled={!draft.trim()} />
        <TextButton label="Skip for now" onPress={() => flow.nav('invite')} height={46} />
      </Screen>
    );
  }

  /* thinking / building */
  if (coach.phase === 'thinking' || coach.phase === 'building') {
    return <ThinkingView building={coach.phase === 'building'} />;
  }

  /* clarifying question */
  if (coach.phase === 'question' && coach.question) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <QoachMark />
          <Text style={{ fontFamily: nightFonts.display, fontSize: 17, color: night.text }}>Qoach</Text>
          <View style={{ flex: 1 }} />
          <MonoLabel text={`QUESTION ${coach.questionCount} OF 2`} color={night.textFaint} style={{ fontSize: 10.5, letterSpacing: 1 }} />
        </View>

        <View
          style={{
            marginTop: 22, borderRadius: 14, backgroundColor: night.surfaceDeep,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 10,
          }}
        >
          <MonoLabel text="YOUR GOAL" style={{ marginBottom: 3 }} />
          <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13, lineHeight: 18, color: 'rgba(242,245,244,0.75)' }}>
            {coach.goalText}
          </Text>
        </View>

        <Pop style={{ marginTop: 14 }}>
          <View
            style={{
              borderRadius: 20, backgroundColor: night.surface,
              borderWidth: 1, borderColor: 'rgba(43,227,128,0.35)', padding: 20,
            }}
          >
            <Text style={{ fontFamily: nightFonts.display, fontSize: 19, lineHeight: 24.5, color: night.text, marginBottom: 10 }}>
              {coach.question.question}
            </Text>
            <Text style={{ fontFamily: nightFonts.body, fontSize: 13, lineHeight: 19.5, color: night.textSoft }}>
              {coach.question.why_it_matters}
            </Text>
          </View>
        </Pop>

        <Spacer />

        {(coach.question.suggested_answers?.length ?? 0) > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {coach.question.suggested_answers!.map(option => (
              <Pressable
                key={option}
                onPress={() => { coach.answerQuestion(option); setAnswer(''); }}
                style={{
                  paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
                  backgroundColor: night.accentSofter, borderWidth: 1, borderColor: 'rgba(43,227,128,0.4)',
                }}
              >
                <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.accentText }}>
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <NightInput
            value={answer}
            onChangeText={setAnswer}
            placeholder="Answer honestly — it shapes the plan"
            style={{ flex: 1, fontSize: 15 }}
            onSubmitEditing={() => { if (answer.trim()) { coach.answerQuestion(answer); setAnswer(''); } }}
          />
          <Pressable
            onPress={() => { if (answer.trim()) { coach.answerQuestion(answer); setAnswer(''); } }}
            style={{
              width: 52, height: 52, borderRadius: 26, backgroundColor: night.accent,
              alignItems: 'center', justifyContent: 'center', opacity: answer.trim() ? 1 : 0.4,
              shadowColor: night.accent, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
            }}
          >
            <Text style={{ fontFamily: nightFonts.display, fontSize: 22, color: night.accentInk }}>↑</Text>
          </Pressable>
        </View>
      </Screen>
    );
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
        <TextButton label="Skip for now" onPress={() => flow.nav('invite')} height={44} />
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
        <TextButton label="Skip for now" onPress={() => flow.nav('invite')} height={44} />
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
      <TextButton label="Skip for now" onPress={() => flow.nav('invite')} height={40} />
    </Screen>
  );
}
