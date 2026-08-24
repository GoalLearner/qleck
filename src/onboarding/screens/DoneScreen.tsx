import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { CONFETTI_COLORS, night, nightFonts } from '../theme';
import { Pop, PrimaryButton, Screen, TextButton } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

// qfall: 26 pieces raining from above the screen, staggered and looping.
function ConfettiPiece({ index }: { index: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: (2.6 + (index % 5) * 0.45) * 1000,
        easing: Easing.bezier(0.2, 0.6, 0.6, 1),
        useNativeDriver: true,
      }),
    );
    const id = setTimeout(() => loop.start(), (index % 7) * 280);
    return () => { clearTimeout(id); loop.stop(); };
  }, [index, t]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: -20,
        left: `${3 + ((index * 37) % 94)}%`,
        width: 7 + (index % 3) * 3,
        height: 11 + (index % 4) * 3,
        borderRadius: 2,
        backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
        opacity: t.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-60, 620] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '560deg'] }) },
        ],
      }}
    />
  );
}

const Confetti = () => (
  <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
    {Array.from({ length: 26 }, (_, i) => <ConfettiPiece key={i} index={i} />)}
  </View>
);

export default function DoneScreen({ flow, demoHints }: { flow: OnboardingFlow; demoHints: boolean }) {
  return (
    <Screen scroll={false} style={{ overflow: 'hidden' }}>
      <Confetti />

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <Pop duration={500}>
          <View
            style={{
              width: 110, height: 110, borderRadius: 55, backgroundColor: night.accent,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: night.accent, shadowOpacity: 0.5, shadowRadius: 30,
              shadowOffset: { width: 0, height: 0 }, elevation: 12,
            }}
          >
            <Text style={{ fontFamily: nightFonts.display, fontSize: 46, color: night.accentInk }}>✓</Text>
          </View>
        </Pop>

        <Text
          style={{
            fontFamily: nightFonts.display, fontSize: 34, lineHeight: 37.4,
            color: night.text, textAlign: 'center',
          }}
        >
          You’re in, {flow.firstName}!
        </Text>
        <Text
          style={{
            fontFamily: nightFonts.body, fontSize: 15, lineHeight: 22.5,
            color: night.textMuted, textAlign: 'center',
          }}
        >
          First win: showing up.{'\n'}That already counts.
        </Text>
        <View
          style={{
            paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999,
            backgroundColor: night.accentSoft, borderWidth: 1, borderColor: night.accentBorder,
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 15, color: night.accent }}>+25 points</Text>
        </View>
      </View>

      <PrimaryButton label="See what’s next" onPress={() => flow.nav('home')} />
      {demoHints && <TextButton label="Try the log-in flow" onPress={() => flow.nav('login')} height={46} />}
    </Screen>
  );
}
