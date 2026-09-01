import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { Note, PrimaryButton, Screen, Spacer, Sub, Title } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

function PermCard({
  glyph, glyphColor, glyphBg, glyphBorder, title, body, on, onToggle,
}: {
  glyph: string; glyphColor: string; glyphBg: string; glyphBorder: string;
  title: string; body: string; on: boolean; onToggle: () => void;
}) {
  return (
    <View
      style={{
        borderRadius: 20, backgroundColor: night.surface,
        borderWidth: 1, borderColor: night.hairline, padding: 18,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <View
          style={{
            width: 40, height: 40, borderRadius: 12, backgroundColor: glyphBg,
            borderWidth: 1, borderColor: glyphBorder, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 18, color: glyphColor }}>{glyph}</Text>
        </View>
        <Text style={{ flex: 1, fontFamily: nightFonts.display, fontSize: 16, color: night.text }}>{title}</Text>
        <Pressable
          onPress={onToggle}
          style={{
            height: 36, paddingHorizontal: 16, borderRadius: 18,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: on ? night.accentTint : 'transparent',
            borderWidth: 1.5, borderColor: on ? night.accentBorderStrong : night.borderMuted,
          }}
        >
          <Text
            style={{ fontFamily: nightFonts.display, fontSize: 12.5, color: on ? night.accent : night.text }}
          >
            {on ? 'On ✓' : 'Allow'}
          </Text>
        </Pressable>
      </View>
      <Text style={{ fontFamily: nightFonts.body, fontSize: 13, lineHeight: 19.5, color: night.textSoft }}>
        {body}
      </Text>
    </View>
  );
}

export default function PermissionsScreen({ flow }: { flow: OnboardingFlow }) {
  return (
    <Screen>
      <Title style={{ marginBottom: 8 }}>One quick yes</Title>
      <Sub style={{ fontSize: 14.5, lineHeight: 21.75, marginBottom: 22 }}>
        Optional, and you can change it any time.
      </Sub>

      {/* Two cards used to live here, and both described things that do not
          happen (2026-09-01):

          "Cheer alerts when friends hype your wins" is Rally-era copy for the
          social surfaces, which have been dormant since 2026-08-24 —
          DEMO_ENABLED is false and the routes are gone. The nudge half is
          real, so the body now says only what the nudges actually do.

          "Motion & Fitness — auto-count steps" was worse: there is NO step
          reading anywhere in the app. No Pedometer, no expo-sensors, no
          HealthKit — step import is a Phase 3 item that has not been built.
          Asking for a permission the app cannot use misleads the user and is
          a plausible App Review rejection on its own. The card is removed
          rather than reworded; flow.permSteps still exists, so it comes back
          the day the import lands. */}
      <View style={{ gap: 12 }}>
        <PermCard
          glyph="!"
          glyphColor={night.violetText}
          glyphBg="rgba(139,92,246,0.18)"
          glyphBorder="rgba(139,92,246,0.5)"
          title="Notifications"
          body="A morning note with the day's reps, and an evening one only if your streak is about to break."
          on={flow.permNotif}
          onToggle={flow.togglePermNotif}
        />
      </View>

      <Spacer />

      <Note center>Change these anytime in Settings. iPhone will ask once more — for real — after this.</Note>
      <PrimaryButton label="Finish setup" onPress={() => flow.nav('done')} />
    </Screen>
  );
}
