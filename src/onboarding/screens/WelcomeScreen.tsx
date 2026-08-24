import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AVATAR_GRADS, night, nightFonts } from '../theme';
import { Float, GradientCircle, PrimaryButton, TextButton } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

function Wordmark() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 28 }}>
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

function Slide({ art, title, body, width }: { art: React.ReactNode; title: string; body: string; width: number }) {
  return (
    <View style={{ width, paddingHorizontal: 30, justifyContent: 'center', gap: 22 }}>
      <View style={{ height: 190, alignItems: 'center', justifyContent: 'center' }}>{art}</View>
      <View>
        <Text
          style={{
            fontFamily: nightFonts.display, fontSize: 30, lineHeight: 33.6,
            color: night.text, marginBottom: 10,
          }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 15, lineHeight: 23.25, color: night.textMuted }}>
          {body}
        </Text>
      </View>
    </View>
  );
}

const GoalArt = () => (
  <Float>
    <View
      style={{
        width: 170, height: 170, borderRadius: 85, borderWidth: 2, borderColor: night.accentFaint,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 118, height: 118, borderRadius: 59, borderWidth: 2, borderColor: 'rgba(43,227,128,0.45)',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 64, height: 64, borderRadius: 32, backgroundColor: night.accent,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: night.accent, shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 26, color: night.accentInk }}>✓</Text>
        </View>
      </View>
    </View>
  </Float>
);

const FriendsArt = () => (
  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
    <Float>
      <GradientCircle size={72} colors={AVATAR_GRADS[1]} borderWidth={3} borderColor={night.bg}>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 22, color: night.accentInk }}>M</Text>
      </GradientCircle>
    </Float>
    <Float delay={500} style={{ marginHorizontal: -12, zIndex: 2 }}>
      <GradientCircle size={88} colors={AVATAR_GRADS[2]} borderWidth={3} borderColor={night.bg}>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 28, color: night.accentInk }}>S</Text>
      </GradientCircle>
    </Float>
    <Float delay={1000}>
      <GradientCircle size={72} colors={AVATAR_GRADS[3]} borderWidth={3} borderColor={night.bg}>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 22, color: night.accentInk }}>J</Text>
      </GradientCircle>
    </Float>
  </View>
);

function RewardPill({
  label, delay, solid, dashed,
}: { label: string; delay: number; solid?: boolean; dashed?: boolean }) {
  return (
    <Float delay={delay}>
      <View
        style={{
          paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999,
          backgroundColor: solid ? night.accent : night.surface,
          borderWidth: solid ? 0 : 1,
          borderColor: dashed ? night.accentBorder : night.border,
          borderStyle: dashed ? 'dashed' : 'solid',
        }}
      >
        <Text
          style={{
            fontFamily: solid ? nightFonts.display : nightFonts.bodyMedium,
            fontSize: solid ? 17 : 15,
            color: solid ? night.accentInk : dashed ? night.accentText : night.text,
          }}
        >
          {label}
        </Text>
      </View>
    </Float>
  );
}

const RewardsArt = () => (
  <View style={{ alignItems: 'center', gap: 10 }}>
    <RewardPill label="+25 pts · goal smashed" delay={0} solid />
    <RewardPill label="+10 pts · coached Maya" delay={400} />
    <RewardPill label="−20% voucher unlocked" delay={800} dashed />
  </View>
);

const SLIDES = [
  {
    art: <GoalArt />,
    title: 'Set goals you’ll actually smash',
    body: 'Big dream or tiny habit — put it in writing, give it a deadline, watch it happen.',
  },
  {
    art: <FriendsArt />,
    title: 'Friends make it stick',
    body: 'Invite your crew to coach, cheer and keep you honest. Winning alone is only half the fun.',
  },
  {
    art: <RewardsArt />,
    title: 'Wins turn into rewards',
    body: 'Every smashed goal earns points. Trade them in for real treats from our partners.',
  },
];

export default function WelcomeScreen({ flow }: { flow: OnboardingFlow }) {
  const insets = useSafeAreaInsets();
  // The carousel track is exactly one screen per slide. onLayout would be more
  // precise, but this container is full-bleed so the window width is the width.
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(x, {
      toValue: -flow.slide * width,
      duration: 450,
      // cubic-bezier(.22, 1, .36, 1)
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [flow.slide, width, x]);

  return (
    <View
      style={{
        flex: 1,
        paddingTop: Math.max(insets.top, 24) + 24,
        paddingBottom: Math.max(insets.bottom, 20) + 22,
      }}
    >
      <Wordmark />

      <View
        style={{ flex: 1, marginTop: 10, overflow: 'hidden' }}
        onLayout={e => setWidth(e.nativeEvent.layout.width || windowWidth)}
      >
        <Animated.View style={{ flexDirection: 'row', flex: 1, transform: [{ translateX: x }] }}>
          {SLIDES.map(s => (
            <Slide key={s.title} width={width} art={s.art} title={s.title} body={s.body} />
          ))}
        </Animated.View>
      </View>

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
        <PrimaryButton label="Let’s go" onPress={flow.welcomeNext} />
        <TextButton
          label="I already have an account"
          onPress={() => flow.nav('login')}
          color="rgba(242,245,244,0.65)"
          height={48}
        />
      </View>
    </View>
  );
}
