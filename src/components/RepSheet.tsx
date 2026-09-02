// The rep how-to sheet, shared by Goals and Today.
//
// It started life inside GoalsScreen, which put it on the wrong screen: Today
// is where a person actually DOES the rep, so "what am I meant to do?" gets
// asked there, in front of an unchecked circle at 7am. Goals is where you go
// to read the plan. Both need it, so it lives here.
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { kindLook } from './protocolViews';
import type { ProtocolStep } from '../api/coachTypes';
import { fetchGoalProvenance } from '../api/goals';
import { colors, fonts } from '../theme';

export function freqChip(step: ProtocolStep): string {
  const parts: string[] = [];
  if (step.kind === 'duration' && step.duration_minutes) parts.push(`${step.duration_minutes} min`);
  if (step.kind === 'quantity' && step.quantity) parts.push(`${step.quantity.amount} ${step.quantity.unit}`);
  const pw = step.frequency.per_week;
  parts.push(pw >= 7 ? 'daily' : pw === 1 ? 'weekly' : `${pw}/wk`);
  return parts.join(' · ');
}

const ANSWER_LABEL: Record<string, string> = {
  bodyweight: 'your weight',
  current_best: 'your current best',
  current_baseline: 'your starting point',
  current_amount: 'what you have saved',
  current_followers: 'your follower count',
  current_avg_views: 'your typical views',
  current_pace_or_distance: 'your current pace',
  current_level: 'your current level',
  current_output: 'what you produce now',
  current_frequency: 'how often you do it now',
  current_standing: 'where you are now',
  current_state: 'where you are now',
  training_days_per_week: 'days you can train',
  days_per_week: 'days you can train',
  hours_per_week: 'hours you have',
  training_age: 'how long you have trained',
  training_history: 'your training history',
  injuries_limits: 'your injuries and limits',
  equipment: 'your equipment',
  eating_pattern: 'how you eat now',
  past_attempts: 'what you have tried before',
  prior_attempts: 'what you have tried before',
  prior_growth_attempts: 'what you have tried before',
  activity_level: 'how active you are',
  income_or_contribution_capacity: 'what you can put aside',
  pay_cadence: 'when you get paid',
  pay_day: 'your payday',
  fixed_obligations: 'your fixed costs',
  target_date: 'your target date',
  deadline: 'your deadline',
  race_date: 'your race date',
  exam_or_deadline_date: 'your exam date',
  posting_cadence: 'how often you post',
  platform: 'your platform',
  niche: 'your niche',
  context: 'when and where it happens',
  support_context: 'who is around it',
  capacity: 'what you can take on',
  schedule_windows: 'when you are free',
  preferred_settings: 'what feels doable',
  existing_circle: 'the people you have',
  project_scope: 'the size of the project',
  practice_context: 'how you practise',
  weak_areas: 'your weak areas',
  materials: 'what you have to hand',
  accountability: 'who sees your work',
  manager_alignment: 'where your manager stands',
  promotion_criteria: 'what the next level needs',
  current_role_level: 'your current level',
  timeline_expectation: 'your review cycle',
  visible_gaps: 'the gaps you know about',
  best_performing_content: 'what has worked',
  own_plan: 'your own plan',
};

const KIND_LABEL: Record<ProtocolStep['kind'], string> = {
  binary: 'HABIT',
  quantity: 'TARGET',
  duration: 'SESSION',
};

/** Is there more to say than the row already shows? A step whose whole
 *  instruction fits on two lines does not get a "How to do it" that opens on
 *  the same sentence it was already showing.
 *
 *  Provenance counts as more to say. A short step can still carry a receipt —
 *  "8,000 steps, assumed because you never told us how active you are" — and
 *  the first build of this made those rows untappable, which hid the receipt
 *  behind a link that never appeared. */
export function hasHowTo(step: ProtocolStep): boolean {
  return !!step.how_to
    || (step.details?.length ?? 0) > 88
    || (step.derived_from?.length ?? 0) > 0
    || !!step.assumption;
}

/**
 * WHERE THIS CAME FROM — the receipt behind a prescribed number.
 *
 * Every numeric target already carries `derived_from`: the manifest keys it was
 * computed from, enforced server-side by provenanceErrors since P2a and shown
 * to the user precisely never. This surfaces it, and it is the honest answer to
 * "is this plan actually mine, or a template with my name on it".
 *
 * The three sources are kept visually distinct because conflating them is the
 * dishonest version. A domain default presented as personalization is exactly
 * the trust failure this feature exists to prevent, so standard_practice says
 * so out loud. Citations are neutral-coloured: amber already means "assumed,
 * unverified" elsewhere in the app, and a citation is the opposite claim.
 */
function StepProvenance({ step, answers }: {
  step: ProtocolStep; answers: Record<string, string> | null;
}) {
  const from = step.derived_from ?? [];
  // A key we cannot show a value for says nothing useful, so it is dropped
  // rather than rendered as an empty promise.
  const cited = from.filter(k => k !== 'goal_text' && k !== 'standard_practice' && answers?.[k]);
  const fromGoal = from.includes('goal_text');
  const standard = from.includes('standard_practice');
  if (!cited.length && !fromGoal && !standard && !step.assumption) return null;

  const Line = ({ children, dim }: { children: React.ReactNode; dim?: boolean }) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 5 }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 13, lineHeight: 19, color: colors.dotUpcoming }}>·</Text>
      <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: dim ? colors.muted : colors.inkSoft }}>
        {children}
      </Text>
    </View>
  );

  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1, color: colors.sectionLabel }}>
        WHERE THIS CAME FROM
      </Text>
      {cited.map(k => (
        <Line key={k}>
          <Text style={{ fontFamily: fonts.semibold }}>{ANSWER_LABEL[k] ?? k.replace(/_/g, ' ')}</Text>
          {' — you told us '}
          <Text style={{ fontFamily: fonts.semibold, color: colors.ink }}>{answers![k]}</Text>
        </Line>
      ))}
      {fromGoal ? <Line>from your goal, as you wrote it</Line> : null}
      {/* Said plainly on purpose: this number is NOT from their answers. */}
      {standard ? <Line dim>standard practice for this kind of goal — not from your answers</Line> : null}
      {step.assumption ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 7 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, lineHeight: 18, color: colors.inviteAccent }}>!</Text>
          <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: colors.inviteAccent }}>
            Assumed: {step.assumption}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The how-to sheet: one rep at a time, with room to actually say it.
 *
 * Renders the structured `how_to` when the plan carries one, and falls back to
 * the plain `details` paragraph when it does not — which is every goal built
 * before this shipped. That fallback is the point: this had to improve the
 * plans people already have, not only the ones written after it.
 */
export function RepSheet({ step, phaseLabel, goalId, onClose, onTweak }: {
  step: ProtocolStep; phaseLabel: string; goalId: string; onClose: () => void; onTweak: () => void;
}) {
  const look = kindLook(step.kind);
  const how = step.how_to;
  // Fetched here, held here, and gone when the sheet closes — see
  // fetchGoalProvenance for why it never rides the goal list.
  const [answers, setAnswers] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchGoalProvenance(goalId).then(a => { if (alive) setAnswers(a); });
    return () => { alive = false; };
  }, [goalId]);
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }}
        />
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 36, maxHeight: '86%' }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.outline, alignSelf: 'center', marginBottom: 18 }} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: look.bg }}>
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, color: look.fg }}>{look.glyph}</Text>
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1, color: look.fg }}>{KIND_LABEL[step.kind]}</Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.chipBg }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.muted }}>{freqChip(step)}</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.bold, fontSize: 11.5, color: colors.muted }}>{phaseLabel}</Text>
            </View>

            <Text style={{ fontFamily: fonts.serif, fontSize: 24, lineHeight: 28, color: colors.ink, marginTop: 12 }}>{step.title}</Text>

            {how ? (
              <>
                <Text style={{ fontFamily: fonts.medium, fontSize: 15, lineHeight: 22.5, color: colors.muted, marginTop: 10 }}>{how.why}</Text>
                {how.sections.map((sec, i) => (
                  <View key={sec.heading + i} style={{ marginTop: 18 }}>
                    <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1, color: colors.success }}>{sec.heading.toUpperCase()}</Text>
                    {sec.body ? (
                      <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: colors.inkSoft, marginTop: 5 }}>{sec.body}</Text>
                    ) : null}
                    {sec.items && sec.items.length > 0 ? (
                      <View style={{ marginTop: 6, gap: 6 }}>
                        {sec.items.map((it, j) => (
                          <View key={j} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                            <Text style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.dotUpcoming }}>{'\u2022'}</Text>
                            <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20.3, color: colors.inkSoft }}>{it}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))}
                <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 12 }}>
                  <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: colors.success, paddingTop: 2 }}>{'\u2713'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1, color: colors.success }}>COUNTS AS DONE</Text>
                    <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 19.6, color: colors.ink, marginTop: 4 }}>{how.counts_as_done}</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={{ fontFamily: fonts.medium, fontSize: 15, lineHeight: 23, color: colors.inkSoft, marginTop: 12 }}>{step.details}</Text>
            )}

            {step.week_progression ? (
              <View style={{ marginTop: 18 }}>
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1, color: colors.success }}>HOW IT RAMPS</Text>
                <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: colors.inkSoft, marginTop: 5 }}>{step.week_progression}</Text>
              </View>
            ) : null}

            <StepProvenance step={step} answers={answers} />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 }}>
              <Pressable
                onPress={onClose}
                style={{ flex: 1, paddingVertical: 15, borderRadius: 999, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, color: colors.bg }}>Got it</Text>
              </Pressable>
              <Pressable
                onPress={onTweak}
                style={{ paddingVertical: 15, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.muted }}>Tweak</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
