import React from 'react';
import { Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { NightInput, PrimaryButton, Screen, Shake, Spacer, Sub, Title } from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

const STRENGTH_COLORS = ['rgba(255,255,255,0.25)', night.danger, night.warn, night.accent];
const STRENGTH_LABELS = ['—', 'weak sauce', 'getting there', 'certified strong'];

export default function NewPasswordScreen({ flow }: { flow: OnboardingFlow }) {
  const s = flow.strength;
  return (
    <Screen>
      <Title style={{ marginBottom: 8 }}>Fresh password time</Title>
      <Sub style={{ fontSize: 14.5, lineHeight: 21.75, marginBottom: 24 }}>
        8+ characters. Make it weird — weird is strong.
      </Sub>

      <View style={{ gap: 12 }}>
        <NightInput
          value={flow.resetPw1}
          onChangeText={flow.setResetPw1}
          placeholder="New password"
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
        />
        <NightInput
          value={flow.resetPw2}
          onChangeText={flow.setResetPw2}
          placeholder="Repeat it (no peeking)"
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 6, marginTop: 16, alignItems: 'center' }}>
        {[1, 2, 3].map(i => (
          <View
            key={i}
            style={{
              flex: 1, height: 6, borderRadius: 3,
              backgroundColor: s >= i ? STRENGTH_COLORS[s] : 'rgba(255,255,255,0.1)',
            }}
          />
        ))}
        <Text
          style={{
            fontFamily: nightFonts.display, fontSize: 12, color: STRENGTH_COLORS[s],
            marginLeft: 8, minWidth: 92, textAlign: 'right',
          }}
        >
          {STRENGTH_LABELS[s]}
        </Text>
      </View>

      {!!flow.resetErr && (
        <Shake trigger={flow.resetErr}>
          <Text
            style={{
              fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.danger,
              marginTop: 14, marginHorizontal: 2,
            }}
          >
            {flow.resetErr}
          </Text>
        </Shake>
      )}

      <Spacer />

      <PrimaryButton label="Save & log in" onPress={flow.saveReset} />
    </Screen>
  );
}
