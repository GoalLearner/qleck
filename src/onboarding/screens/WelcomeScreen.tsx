// The cold open — the first six seconds.
//
// This used to be a three-slide carousel promising friends who cheer you on
// and points you trade for "real treats from our partners". Neither exists:
// the social surfaces are sealed in src/demo behind DEMO_ENABLED, and there
// are no partners, no points and no vouchers. That copy was shipping into an
// App Store review as an unbacked commercial promise, and it was the only
// manufactured social proof anywhere in the product.
//
// What replaces it is the thing that actually makes Qleck different, moved
// from fourth in line to first: a coach that tells you no. Today a stranger
// meets that behaviour only after an account, a blank box and six questions —
// so the person most likely to be impressed by a refusal is the person least
// likely to reach one. Here it is the first thing they see, on somebody
// else's goal, labelled as an example throughout, with the door out always
// open.
//
// Every word and both numbers come from src/onboarding/coldOpen.json, which
// is a real capture of a real run of the real prompt (backend/harness/
// coldopen.mjs). Nothing on this screen is written by hand, because a demo
// that flatters the coach is exactly the lie the product exists to refuse.
// backend/harness/coldopen.check.mjs fails the harness if the capture and the
// live prompt version drift apart.
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { night, nightFonts } from '../theme';
import { OddsDial } from '../OddsDial';
import { PrimaryButton, TextButton } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';
import cold from '../coldOpen.json';

function Wordmark() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <View
        style={{
          width: 30, height: 30, borderRadius: 10, backgroundColor: night.accent,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: nightFonts.display, fontSize: 17, color: night.accentInk }}>Q</Text>
      </View>
      <Text style={{ fontFamily: nightFonts.display, fontSize: 19, color: night.text, letterSpacing: 0.2 }}>
        Qleck
      </Text>
    </View>
  );
}

function Eyebrow({ text }: { text: string }) {
  return (
    <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 10.5, letterSpacing: 2.2, color: night.textGhost }}>
      {text}
    </Text>
  );
}

/** The three beats. Each one mounts fresh, so its dial sweeps on arrival. */
function Beat({ index }: { index: number }) {
  if (index === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <Eyebrow text="AN EXAMPLE" />
        <Text style={{ fontFamily: nightFonts.display, fontSize: 30, lineHeight: 37, color: night.text }}>
          “{cold.original.request}”
        </Text>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 15, lineHeight: 23, color: night.textMuted }}>
          Somebody asked Qoach for this. Here is what it said back.
        </Text>
      </View>
    );
  }

  const counter = index === 2;
  const odds = counter ? cold.counter.probability : cold.original.probability;
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
      <OddsDial
        value={odds}
        color={counter ? night.accent : night.danger}
        condLabel={counter ? 'WHAT IT WILL BACK' : 'AS ASKED'}
        size={216}
        showTicks={false}
      />
      <Text style={{ fontFamily: nightFonts.display, fontSize: 23, lineHeight: 29, color: night.text }}>
        {counter ? 'So it offered a better one.' : 'Qoach would not sign it.'}
      </Text>
      <Text style={{ fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 22, color: night.textMuted }}>
        {counter ? cold.counter.statement : cold.risk.line}
      </Text>
    </View>
  );
}

const NEXT_LABEL = ['Show me', 'So what would work?', 'Let’s go'];

export default function WelcomeScreen({ flow }: { flow: OnboardingFlow }) {
  const insets = useSafeAreaInsets();
  // Cross-fade rather than a carousel track: the beats have to MOUNT as you
  // reach them or both dials would sweep once, together, at app launch — and
  // the sweep to an ugly number is the whole point of the second beat.
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [flow.slide, fade]);

  return (
    <View
      style={{
        flex: 1,
        paddingTop: Math.max(insets.top, 24) + 24,
        paddingBottom: Math.max(insets.bottom, 20) + 22,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 }}>
        <Wordmark />
        {/* The way past the example is always visible — nobody is held here. */}
        <Pressable onPress={() => flow.nav('auth')} hitSlop={12}>
          <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13.5, color: night.textGhost }}>Skip</Text>
        </Pressable>
      </View>

      <Animated.View key={flow.slide} style={{ flex: 1, opacity: fade, paddingHorizontal: 30, paddingTop: 10 }}>
        <Beat index={flow.slide} />
      </Animated.View>

      <View style={{ flexDirection: 'row', gap: 7, justifyContent: 'center', paddingTop: 18, paddingBottom: 20 }}>
        {[0, 1, 2].map(i => (
          <Pressable
            key={i}
            onPress={() => flow.setSlide(i)}
            hitSlop={8}
            style={{
              width: i === flow.slide ? 22 : 8, height: 8, borderRadius: 4,
              backgroundColor: i === flow.slide ? night.accent : night.borderDashed,
            }}
          />
        ))}
      </View>

      <View style={{ gap: 10, paddingHorizontal: 28 }}>
        <PrimaryButton label={NEXT_LABEL[flow.slide] ?? 'Let’s go'} onPress={flow.welcomeNext} />
        <TextButton
          label="I already have an account"
          onPress={() => flow.nav('login')}
          // Was hardcoded to the dark palette's ink, which turned this into
          // white-on-cream the moment the appearance setting went light.
          color={night.textMuted}
          height={48}
        />
      </View>
    </View>
  );
}
