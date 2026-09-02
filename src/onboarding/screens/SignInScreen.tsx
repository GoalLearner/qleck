import React from 'react';
import { Platform, Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import {
  NightInput, OutlineButton, PrimaryButton, Screen, Shake, Spacer, TextButton, Title,
} from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

export default function SignInScreen({ flow, demoHints }: { flow: OnboardingFlow; demoHints: boolean }) {
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View
          style={{
            width: 30, height: 30, borderRadius: 10, backgroundColor: night.accent,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 17, color: night.accentInk }}>Q</Text>
        </View>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 19, color: night.text }}>Qleck</Text>
      </View>

      <Title style={{ marginTop: 28, marginBottom: 22 }}>Welcome back</Title>

      <View style={{ gap: 12 }}>
        <NightInput
          value={flow.loginEmail}
          onChangeText={flow.setLoginEmail}
          placeholder="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
        />
        <NightInput
          value={flow.loginPw}
          onChangeText={flow.setLoginPw}
          placeholder="Password"
          secureTextEntry
          autoCapitalize="none"
          textContentType="password"
          borderColor={flow.loginErr ? night.danger : night.borderMuted}
        />
      </View>

      {flow.loginErr && (
        <Shake trigger={flow.loginErr}>
          <Text
            style={{
              fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.danger,
              marginTop: 12, marginHorizontal: 2,
            }}
          >
            That password isn’t it. Try again — or reset it, zero judgment.
          </Text>
        </Shake>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <TextButton
          label="Forgot password?"
          onPress={() => { if (flow.loginEmail.trim()) flow.setResetEmail(flow.loginEmail.trim()); flow.nav('forgot'); }}
          color={night.accent}
          bold
          height={40}
        />
      </View>
      <Text style={{ fontFamily: nightFonts.body, fontSize: 12, lineHeight: 17, color: night.textGhost, marginTop: 2, marginHorizontal: 2 }}>
        Signed up with a code and never set a password? “Forgot password” sets your first one.
      </Text>

      <Spacer />

      <PrimaryButton label={flow.loginBusy ? 'Logging in…' : 'Log in'} onPress={flow.submitLogin} />
      {demoHints && (
        <OutlineButton
          label="Unlock with Face ID"
          onPress={() => flow.nav('faceid')}
          style={{ height: 50, borderRadius: 25, marginTop: 10 }}
        />
      )}
      {/* This screen only knows email and password, but on iOS most accounts
          are Sign in with Apple, which has neither — and Apple lives on the
          door ('auth'). Labelled "New here? Create an account" it read as
          signup only, so an Apple user who landed here could not find the way
          back in. The door signs in and signs up both; the label now says so. */}
      <TextButton
        label={Platform.OS === 'ios' ? 'Sign in with Apple, or create an account' : 'New here? Create an account'}
        onPress={() => flow.nav('auth')}
      />
    </Screen>
  );
}
