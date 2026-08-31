import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { BackButton, NightInput, Note, PrimaryButton, Screen, Shake, Spacer, Sub, Title } from '../ui';
import type { OnboardingFlow, ResetChannel } from '../useOnboardingFlow';

// Reset via email *or* SMS — both channels, per the doc.
function ChannelOption({
  label, detail, selected, onPress,
}: { label: string; detail: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: selected ? night.accentSofter : night.surface,
        borderWidth: 1.5, borderColor: selected ? night.accent : night.hairline,
      }}
    >
      <View
        style={{
          width: 22, height: 22, borderRadius: 11, borderWidth: 2,
          borderColor: selected ? night.accent : night.borderDashed,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 10, height: 10, borderRadius: 5,
            backgroundColor: selected ? night.accent : 'transparent',
          }}
        />
      </View>
      <View>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 15.5, color: night.text, marginBottom: 2 }}>
          {label}
        </Text>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 13, color: night.textDim }}>{detail}</Text>
      </View>
    </Pressable>
  );
}

export default function ForgotPasswordScreen({ flow, demoHints = false }: { flow: OnboardingFlow; demoHints?: boolean }) {
  const pick = (c: ResetChannel) => () => flow.setResetChannel(c);
  return (
    <Screen>
      <BackButton onPress={() => flow.nav('login')} />
      <Title style={{ marginTop: 26, marginBottom: 8 }}>No stress — resets happen</Title>
      <Sub style={{ marginBottom: 24 }}>Tell us the account’s email and we’ll send a 6-digit code.</Sub>

      <NightInput
        value={flow.resetEmail}
        onChangeText={flow.setResetEmail}
        placeholder="you@somewhere.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        style={{ height: 54 }}
      />

      {!!flow.forgotErr && (
        <Shake trigger={flow.forgotErr}>
          <Text
            style={{
              fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.danger,
              marginTop: 10, marginHorizontal: 2,
            }}
          >
            {flow.forgotErr}
          </Text>
        </Shake>
      )}

      {/* P3: the SMS channel is hidden until phone auth ships — the mock
          picker survives under demo hints only. */}
      {demoHints && (
        <View style={{ gap: 12, marginTop: 16 }}>
          <ChannelOption
            label="Email code"
            detail="the account’s inbox"
            selected={flow.resetChannel === 'email'}
            onPress={pick('email')}
          />
          <ChannelOption
            label="SMS link"
            detail="+47 ••• •• 842"
            selected={flow.resetChannel === 'sms'}
            onPress={pick('sms')}
          />
        </View>
      )}

      <Spacer />

      <Note>The code works once and dies after 10 minutes — nobody sneaks in.</Note>
      <PrimaryButton label={flow.forgotBusy ? 'Sending…' : 'Send reset code'} onPress={flow.sendReset} />
    </Screen>
  );
}
