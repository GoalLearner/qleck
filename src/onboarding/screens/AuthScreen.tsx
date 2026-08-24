import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { BackButton, Note, OutlineButton, Screen, Spacer, Sub, TextButton, Title } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

function SolidButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 54, borderRadius: 27, backgroundColor: night.text,
        alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text style={{ fontFamily: nightFonts.display, fontSize: 15.5, color: night.bg }}>{label}</Text>
    </Pressable>
  );
}

export default function AuthScreen({ flow }: { flow: OnboardingFlow }) {
  return (
    <Screen>
      <BackButton onPress={() => flow.nav('welcome')} />
      <Title style={{ marginTop: 26, marginBottom: 8 }}>Join Qleck</Title>
      <Sub style={{ marginBottom: 28 }}>Pick a door — takes under a minute, promise.</Sub>

      <View style={{ gap: 11 }}>
        <SolidButton label="Continue with Apple" onPress={flow.socialJoin} />
        <OutlineButton label="Continue with Google" onPress={flow.socialJoin} light />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 6 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: night.hairline }} />
          <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 12, color: night.textGhost }}>or</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: night.hairline }} />
        </View>

        <Pressable
          onPress={() => flow.pickMethod('email')}
          style={({ pressed }) => ({
            height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? 'rgba(43,227,128,0.2)' : night.accentSoft,
            borderWidth: 1.5, borderColor: 'rgba(43,227,128,0.55)',
          })}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 15.5, color: night.accent }}>
            Sign up with email
          </Text>
        </Pressable>

        <OutlineButton label="Sign up with phone" onPress={() => flow.pickMethod('phone')} />
      </View>

      <Spacer />

      <Note center>Your details stay yours — GDPR-safe, never sold, never leaked.</Note>
      <TextButton label="Already on Qleck? Log in" onPress={() => flow.nav('login')} color={night.accent} bold />
    </Screen>
  );
}
