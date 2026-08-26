// Help & about — what Qleck is, how plans get made, and what this app is not.
//
// Replaces a dead "Help & feedback" settings row. It also lands two things
// ROADMAP P5 requires on the store-review pass: the AI disclosure and the
// not-medical-advice framing. Behaviours, never outcomes — the same rule the
// coach prompts follow.
import React from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useAppearance } from '../state/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { colors, fonts, radii } from '../theme';

// TODO before store submission: swap for a dedicated support address rather
// than a personal inbox.
const SUPPORT_EMAIL = 'richmondcampano93@gmail.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 26 }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel, marginBottom: 8 }}>
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
          borderRadius: radii.card, paddingVertical: 16, paddingHorizontal: 18,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.inkSoft }}>
      {children}
    </Text>
  );
}

export default function HelpScreen() {
  useAppearance();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const sendFeedback = () => {
    const subject = encodeURIComponent(`Qleck feedback (v${version})`);
    const body = encodeURIComponent('\n\n---\nWhat happened:\n\nWhat you expected:\n');
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {});
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
    >
      <Text style={{ fontFamily: fonts.serif, fontSize: 30, lineHeight: 35, color: colors.ink }}>
        Help &amp; about
      </Text>

      <Section title="WHAT THIS IS">
        <Body>
          Qleck turns a goal you describe in your own words into a week-by-week plan you
          can actually live — a handful of small reps a day, checked off as you go.
          Qoach, the coach inside it, decides whether your timeline is realistic before
          it builds anything, and will counter-offer a version it thinks you can hold.
        </Body>
      </Section>

      <Section title="HOW YOUR PLANS ARE MADE">
        <Body>
          When you describe a goal, that text and your answers to Qoach's questions are
          sent to our AI provider to write your plan. Your check-ins, streaks and the
          rest of your data are not.
        </Body>
        <Body>
          {'\n'}Plans are generated, so treat them as a starting point rather than
          gospel. If one doesn't fit your life, say so — reshaping it is the point.
        </Body>
      </Section>

      <Section title="WHAT THIS ISN'T">
        <Body>
          Qleck is not a medical device and Qoach is not a doctor, therapist,
          dietitian or trainer. Nothing here is medical advice, and no plan can
          promise a health outcome — plans prescribe behaviours (sessions, minutes,
          reps), never results.
        </Body>
        <Body>
          {'\n'}Talk to a professional before starting anything that could affect your
          health, and especially if you're managing a condition, pregnant, or changing
          medication. If you're struggling with your mental health, please reach out to
          someone who can help — in the US you can call or text 988 any time; elsewhere,
          findahelpline.com lists free, confidential options.
        </Body>
      </Section>

      <Section title="SOMETHING WRONG?">
        <Body>
          Tell us what happened and we'll take a look. Bugs, bad plans, wording that
          landed badly — all useful.
        </Body>
        <Pressable
          onPress={sendFeedback}
          style={{
            marginTop: 14, height: 48, borderRadius: radii.pill, backgroundColor: colors.navy,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 14, color: colors.creamText }}>
            Send feedback
          </Text>
        </Pressable>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.sectionLabel, marginTop: 10, textAlign: 'center' }}>
          Opens your mail app — nothing is sent until you send it.
        </Text>
      </Section>

      <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.sectionLabel, textAlign: 'center', marginTop: 26 }}>
        Qleck v{version}
      </Text>

      <Pressable onPress={() => navigation.goBack()} style={{ alignSelf: 'center', marginTop: 18, padding: 8 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 13.5, color: colors.muted }}>Close</Text>
      </Pressable>
    </ScrollView>
  );
}
