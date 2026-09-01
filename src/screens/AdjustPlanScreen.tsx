// "Adjust my plan" — the coach that can change its mind.
//
// A generated protocol used to be a one-shot artifact: if week 2 turned out to
// be too much, the plan just sat there being wrong. Now the user says what's
// off, Qoach rewrites the weeks ahead, and — the part that matters — they SEE
// what changed before it applies. Declining costs nothing, because the
// proposal is never written until Accept.
//
// Past weeks are untouchable: the server splices them back from storage, so
// nothing here can rewrite a day already lived.
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goalTitle } from '../components/protocolViews';
import { GoalApiError, applyRevision, mintGoalId, proposeRevision } from '../api/goals';
import { localDate } from '../api/device';
import type { Protocol } from '../api/coachTypes';
import { diffProtocols, type ProtocolDiff, type StepChange } from '../lib/protocolDiff';
import { weekOf } from '../lib/protocolTime';
import { useRally } from '../state/RallyContext';
import { useAppearance } from '../state/ThemeContext';
import { colors, fonts, radii } from '../theme';

// Named the way someone struggling would say it. The lightening reasons say
// REDUCE explicitly: asked only to "make it lighter", the model will happily
// add a gentle step on top of the hard one and call the result easier.
const LIGHTEN = ' Reduce or remove what is already there rather than adding anything new — the total amount of work must go DOWN.';

const REASONS = [
  { key: 'too_hard', label: 'Too much', feedback: 'This is too much for me right now — please make the weeks ahead lighter.' + LIGHTEN },
  { key: 'too_easy', label: 'Too easy', feedback: 'This is easier than I expected — I can handle more, so raise the targets on what is already there.' },
  { key: 'busy', label: 'Life got busy', feedback: 'Life got busy and I cannot give this as much time as planned — please fit it into less time.' + LIGHTEN },
  { key: 'injury', label: 'Injured or ill', feedback: 'I am injured or ill and need the next stretch to be much gentler on my body.' + LIGHTEN },
  { key: 'wrong', label: 'Wrong shape', feedback: 'The plan does not fit how my life actually works — please reshape it to suit my real week.' },
];

const TONE: Record<StepChange['kind'], { label: string; color: () => string }> = {
  eased: { label: 'EASIER', color: () => colors.success },
  dropped: { label: 'DROPPED', color: () => colors.muted },
  added: { label: 'NEW', color: () => colors.accentLink },
  harder: { label: 'MORE', color: () => colors.inviteAccent },
  reworded: { label: 'REWORDED', color: () => colors.muted },
};

function ChangeRow({ change }: { change: StepChange }) {
  const tone = TONE[change.kind];
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.hairline,
      }}
    >
      <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.chipBg, marginTop: 2 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 9.5, letterSpacing: 0.8, color: tone.color() }}>
          {tone.label}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, color: colors.ink,
            textDecorationLine: change.kind === 'dropped' ? 'line-through' : 'none',
          }}
        >
          {change.step.title}
        </Text>
        {!!change.detail && (
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.muted, marginTop: 2 }}>
            {change.detail}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function AdjustPlanScreen() {
  useAppearance();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { goals, refreshGoals } = useRally();

  const goalId: string = route.params?.goalId;
  const goal = goals.find(g => g.id === goalId);

  // P4 never-miss-twice: the comeback banner opens this screen with a reason
  // preselected ("Make today easier" = too_hard) so the easier week is two
  // taps away, not a form.
  const initialReason: string | null =
    typeof route.params?.reason === 'string' && REASONS.some(r => r.key === route.params.reason)
      ? route.params.reason
      : null;
  const [reason, setReason] = useState<string | null>(initialReason);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'proposing' | 'applying' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ protocol: Protocol; diff: ProtocolDiff; week: number } | null>(null);
  // Minted once per proposal so a retry after a dropped response replays
  // instead of appending a second version.
  const [protocolId, setProtocolId] = useState<string | null>(null);

  if (!goal) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontFamily: fonts.serif, fontSize: 20, color: colors.ink }}>That goal is no longer here.</Text>
        <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 18 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.accentLink }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const week = weekOf(goal.startedOn, localDate(), goal.protocol.duration_weeks, goal.pauses);

  const explain = (e: unknown): string => {
    const code = e instanceof GoalApiError ? e.code : '';
    if (code === 'already_adjusted_today') {
      return 'You already adjusted this plan today. Give it a day — changing the plan every day is its own way of not doing it.';
    }
    if (code === 'quota_exceeded') return 'Qoach is off the clock — back tomorrow.';
    if (code === 'ai_disabled' || code === 'ai_unconfigured') return 'Qoach is unavailable right now. Your plan is unchanged.';
    return 'Qoach could not rework the plan just now. Nothing changed — try again in a moment.';
  };

  const feedbackText = () => {
    const chosen = REASONS.find(r => r.key === reason);
    return [chosen?.feedback, note.trim()].filter(Boolean).join(' ');
  };

  const submit = async () => {
    const feedback = feedbackText();
    if (!feedback) return;
    setBusy('proposing');
    setError(null);
    try {
      const res = await proposeRevision(goal.id, feedback, week);
      setProposal({
        protocol: res.protocol,
        diff: diffProtocols(goal.protocol, res.protocol, res.currentWeek),
        week: res.currentWeek,
      });
      setProtocolId(mintGoalId());
    } catch (e) {
      setError(explain(e));
    }
    setBusy(null);
  };

  const accept = async () => {
    if (!proposal || !protocolId) return;
    setBusy('applying');
    setError(null);
    try {
      await applyRevision(goal.id, protocolId, proposal.protocol, proposal.week, feedbackText());
      await refreshGoals();
      navigation.goBack();
    } catch (e) {
      setError(explain(e));
      setBusy(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 26) + 10,
        paddingBottom: Math.max(insets.bottom, 24) + 28,
        paddingHorizontal: 22,
        width: '100%', maxWidth: 620, alignSelf: 'center',
      }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.5, color: colors.sectionLabel }}>
        ADJUST · WEEK {week} OF {goal.protocol.duration_weeks}
      </Text>
      <Text style={{ fontFamily: fonts.serif, fontSize: 28, lineHeight: 34, color: colors.ink, marginTop: 8 }}>
        {goalTitle(goal.statement, goal.protocol)}
      </Text>

      {!proposal ? (
        <>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21, color: colors.muted, marginTop: 10 }}>
            What is off? Qoach reworks the weeks ahead — everything you have already banked stays exactly as it is.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
            {REASONS.map(r => {
              const on = reason === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setReason(r.key)}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 11, borderRadius: radii.pill,
                    backgroundColor: on ? colors.ink : 'transparent',
                    borderWidth: 1.5, borderColor: on ? colors.ink : colors.inputBorder,
                  }}
                >
                  <Text style={{ fontFamily: fonts.bold, fontSize: 13.5, color: on ? colors.bg : colors.ink }}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={400}
            placeholder="Anything else Qoach should know? (optional)"
            placeholderTextColor={colors.sectionLabel}
            style={{
              marginTop: 16, minHeight: 92, borderRadius: radii.card, padding: 16,
              backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
              fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink,
              textAlignVertical: 'top',
            }}
          />

          <Pressable
            onPress={submit}
            disabled={!reason || busy !== null}
            style={{
              marginTop: 18, height: 52, borderRadius: radii.pill, backgroundColor: colors.navy,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10,
              opacity: !reason || busy ? 0.5 : 1,
            }}
          >
            {busy === 'proposing' && <ActivityIndicator color={colors.creamText} />}
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 14.5, color: colors.creamText }}>
              {busy === 'proposing' ? 'Qoach is reworking it…' : 'Ask Qoach to rework it'}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21, color: colors.muted, marginTop: 10 }}>
            {proposal.diff.unchanged
              ? 'Qoach thinks the plan is already right for you — nothing changed.'
              : `Here is what changes from week ${proposal.week} onward. Nothing is saved until you accept.`}
          </Text>

          <View
            style={{
              marginTop: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
              borderRadius: radii.card, paddingHorizontal: 18, paddingVertical: 4,
            }}
          >
            {proposal.diff.changes.map((c, i) => <ChangeRow key={`${c.step.id}:${i}`} change={c} />)}
            {proposal.diff.weeksDelta !== 0 && (
              <View style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.hairline }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 13.5, color: colors.ink }}>
                  {proposal.diff.weeksDelta > 0
                    ? `The plan gets ${proposal.diff.weeksDelta} week${proposal.diff.weeksDelta === 1 ? '' : 's'} longer`
                    : `The plan gets ${-proposal.diff.weeksDelta} week${proposal.diff.weeksDelta === -1 ? '' : 's'} shorter`}
                </Text>
              </View>
            )}
            {proposal.diff.changes.length === 0 && proposal.diff.weeksDelta === 0 && (
              <View style={{ paddingVertical: 14 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: colors.muted }}>
                  No changes to the weeks ahead.
                </Text>
              </View>
            )}
          </View>

          {!!proposal.protocol.coach_notes && (
            <Text style={{ fontFamily: fonts.regular, fontStyle: 'italic', fontSize: 13.5, lineHeight: 20, color: colors.faintText, marginTop: 16 }}>
              {proposal.protocol.coach_notes}
            </Text>
          )}

          <Pressable
            onPress={accept}
            disabled={busy !== null}
            style={{
              marginTop: 20, height: 52, borderRadius: radii.pill, backgroundColor: colors.navy,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy === 'applying' && <ActivityIndicator color={colors.creamText} />}
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 14.5, color: colors.creamText }}>
              Use this plan
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setProposal(null); setProtocolId(null); }}
            disabled={busy !== null}
            style={{ alignSelf: 'center', marginTop: 14, padding: 8 }}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 13.5, color: colors.muted }}>
              Keep my current plan
            </Text>
          </Pressable>
        </>
      )}

      {error && (
        <Text style={{ fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 20, color: colors.danger, marginTop: 16 }}>
          {error}
        </Text>
      )}

      <Pressable onPress={() => navigation.goBack()} disabled={busy !== null} style={{ alignSelf: 'center', marginTop: 20, padding: 8 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.sectionLabel }}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}
