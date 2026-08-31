import React, { useRef } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { BackButton, Screen, Shake, Spacer, Sub, TextButton, Title } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

export default function VerifyScreen({ flow }: { flow: OnboardingFlow; demoHints?: boolean }) {
  const refs = useRef<(TextInput | null)[]>([]);
  const focus = (i: number) => refs.current[i]?.focus();

  return (
    <Screen>
      {/* The same boxes serve signup (back to the email form) and the reset
          flow (back to the code-sent screen). */}
      <BackButton onPress={() => flow.nav(flow.otpPurpose === 'reset' ? 'sent' : 'signup')} />
      <Title style={{ marginTop: 26, marginBottom: 8 }}>Prove it’s you</Title>
      <Sub style={{ marginBottom: 26 }}>
        We sent a 6-digit code to <Text style={{ color: night.text }}>{flow.contactMasked}</Text>.
      </Sub>

      <Shake trigger={flow.otpErr}>
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between' }}>
          {flow.otp.map((digit, i) => (
            <TextInput
              key={i}
              ref={el => { refs.current[i] = el; }}
              value={digit}
              onChangeText={v => flow.setOtpDigit(i, v, focus)}
              onKeyPress={e => {
                // Not in the canvas, but a real keyboard needs it: backspace on
                // an empty box steps back to the previous one.
                if (e.nativeEvent.key === 'Backspace' && !digit && i > 0) focus(i - 1);
              }}
              maxLength={1}
              keyboardType="number-pad"
              inputMode="numeric"
              selectTextOnFocus
              autoFocus={i === 0}
              style={{
                width: 48, height: 58, borderRadius: 14, backgroundColor: night.surface,
                borderWidth: 1.5,
                borderColor: flow.otpErr ? night.danger : digit ? night.accent : night.borderMuted,
                color: night.accent, fontFamily: nightFonts.display, fontSize: 24, textAlign: 'center',
              }}
            />
          ))}
        </View>
      </Shake>

      {flow.otpErr && (
        <Text
          style={{
            fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.danger,
            marginTop: 14, marginHorizontal: 2,
          }}
        >
          {flow.otpErrMsg || 'Not quite. Fresh boxes — try again.'}
        </Text>
      )}

      {flow.verifying && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <ActivityIndicator size="small" color={night.accent} />
          <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.textMuted }}>
            Checking…
          </Text>
        </View>
      )}

      <Spacer />

      {flow.resendIn > 0 ? (
        <Text
          style={{
            fontFamily: nightFonts.bodyMedium, fontSize: 14, color: night.textFaint,
            textAlign: 'center', height: 44, lineHeight: 44,
          }}
        >
          Resend in {flow.resendIn}s
        </Text>
      ) : (
        <TextButton label="Resend code" onPress={flow.resendCode} color={night.accent} bold />
      )}
    </Screen>
  );
}
