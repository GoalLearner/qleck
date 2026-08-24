import React from 'react';
import { Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { Float, PrimaryButton, Screen, TextButton, Title } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

export default function LinkSentScreen({ flow }: { flow: OnboardingFlow }) {
  const desc = flow.resetChannel === 'email'
    ? 'Check s•••a@qleck.com — tap the link inside to set a new password.'
    : 'Check your texts at +47 ••• •• 842 — tap the link to set a new password.';

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <Float>
          <View
            style={{
              width: 96, height: 96, borderRadius: 48, backgroundColor: night.accentSoft,
              borderWidth: 1.5, borderColor: night.accentBorder,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: nightFonts.display, fontSize: 38, color: night.accent }}>→</Text>
          </View>
        </Float>

        <Title style={{ textAlign: 'center' }}>Link sent</Title>
        <Text
          style={{
            fontFamily: nightFonts.body, fontSize: 14.5, lineHeight: 22.5,
            color: night.textMuted, textAlign: 'center', maxWidth: 270,
          }}
        >
          {desc}
        </Text>

        {/* A mock of the message that just landed. */}
        <View
          style={{
            borderRadius: 18, backgroundColor: night.surface, borderWidth: 1, borderColor: night.hairline,
            paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
            maxWidth: 300,
          }}
        >
          <View
            style={{
              width: 36, height: 36, borderRadius: 10, backgroundColor: night.accent,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: nightFonts.display, fontSize: 18, color: night.accentInk }}>Q</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: nightFonts.display, fontSize: 13, color: night.text }}>
              Reset your Qleck password
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: nightFonts.body, fontSize: 12, color: night.textDim }}>
              Tap the link — it expires in 15 min ⏱
            </Text>
          </View>
        </View>
      </View>

      <PrimaryButton label="Open the link (demo)" onPress={() => flow.nav('reset')} />

      {flow.resendIn > 0 ? (
        <Text
          style={{
            fontFamily: nightFonts.bodyMedium, fontSize: 13.5, color: night.textFaint,
            textAlign: 'center', height: 44, lineHeight: 44,
          }}
        >
          Didn’t get it? Resend in {flow.resendIn}s
        </Text>
      ) : (
        <TextButton label="Resend link" onPress={flow.startResend} color={night.accent} bold />
      )}
    </Screen>
  );
}
