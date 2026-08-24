import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { BackButton, Note, PrimaryButton, Screen, Spacer, Sub, Title } from '../ui';
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

export default function ForgotPasswordScreen({ flow }: { flow: OnboardingFlow }) {
  const pick = (c: ResetChannel) => () => flow.setResetChannel(c);
  return (
    <Screen>
      <BackButton onPress={() => flow.nav('login')} />
      <Title style={{ marginTop: 26, marginBottom: 8 }}>No stress — resets happen</Title>
      <Sub style={{ marginBottom: 24 }}>Where should the reset link go?</Sub>

      <View style={{ gap: 12 }}>
        <ChannelOption
          label="Email link"
          detail="s•••a@qleck.com"
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

      <Spacer />

      <Note>The link works once and dies after 15 minutes — nobody sneaks in.</Note>
      <PrimaryButton label="Send reset link" onPress={() => flow.nav('sent')} />
    </Screen>
  );
}
