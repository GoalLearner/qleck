import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { AVATAR_GRADS, night, nightFonts } from '../theme';
import {
  GradientCircle, NightInput, Note, Pop, PrimaryButton, Screen, Spacer, Sub, Title,
} from '../ui';
import type { OnboardingFlow } from '../useOnboardingFlow';

const STATUS_LABEL: Record<string, string> = {
  idle: '', checking: 'checking…', taken: 'taken', free: 'it’s yours', short: 'too short',
};
// Read at call time — a frozen map would keep the dark palette's near-white
// text and vanish on the cream background.
const statusColor = (k: string): string => ({
  idle: night.textGhost, checking: night.textGhost, taken: night.danger,
  free: night.accent, short: night.warn,
}[k] ?? night.textGhost);

// Photo + real name are required — the doc's anti-impersonation rule.
function AvatarPicker({ flow }: { flow: OnboardingFlow }) {
  if (flow.avatar === 0) {
    return (
      <Pressable
        onPress={flow.cycleAvatar}
        style={{
          width: 104, height: 104, borderRadius: 52, backgroundColor: night.surfaceDeep,
          borderWidth: 2, borderColor: night.accentBorder, borderStyle: 'dashed',
          alignItems: 'center', justifyContent: 'center', gap: 4,
        }}
      >
        <Text style={{ fontSize: 26, lineHeight: 28, color: night.accent }}>+</Text>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 13, color: night.accent }}>add photo</Text>
        <Text style={{ fontFamily: nightFonts.body, fontSize: 10, color: night.textFaint }}>required</Text>
      </Pressable>
    );
  }
  return (
    <Pop key={flow.avatar}>
      <Pressable onPress={flow.cycleAvatar}>
        <GradientCircle
          size={104}
          colors={AVATAR_GRADS[flow.avatar]}
          borderWidth={3}
          borderColor={night.accent}
          style={{
            shadowColor: night.accent, shadowOpacity: 0.25,
            shadowRadius: 14, shadowOffset: { width: 0, height: 8 },
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 34, color: night.accentInk }}>
            {flow.initials}
          </Text>
        </GradientCircle>
      </Pressable>
    </Pop>
  );
}

export default function ProfileSetupScreen({ flow }: { flow: OnboardingFlow }) {
  return (
    <Screen>
      <Title style={{ marginBottom: 8 }}>Make it you</Title>
      <Sub style={{ fontSize: 14.5, lineHeight: 21.75, marginBottom: 22 }}>
        Real name + photo keeps imposters out — friends follow the real you.
      </Sub>

      <View style={{ alignItems: 'center', marginBottom: 22 }}>
        <AvatarPicker flow={flow} />
      </View>

      <View style={{ gap: 12 }}>
        <NightInput
          value={flow.name}
          onChangeText={flow.setName}
          placeholder="Full name"
          autoCapitalize="words"
          textContentType="name"
        />

        <View>
          <Text
            style={{
              position: 'absolute', left: 18, top: 0, lineHeight: 52,
              fontFamily: nightFonts.display, fontSize: 16, color: night.textGhost, zIndex: 1,
            }}
          >
            @
          </Text>
          <NightInput
            value={flow.uname}
            onChangeText={flow.changeUname}
            placeholder="username"
            autoCapitalize="none"
            autoCorrect={false}
            borderColor={flow.unameStatus === 'taken' ? night.danger : flow.usernameFree ? night.accent : night.borderMuted}
            style={{ paddingLeft: 40, paddingRight: 92 }}
          />
          <Text
            style={{
              position: 'absolute', right: 16, top: 0, lineHeight: 52,
              fontFamily: nightFonts.display, fontSize: 12, color: statusColor(flow.unameStatus),
            }}
          >
            {STATUS_LABEL[flow.unameStatus]}
          </Text>
        </View>
      </View>

      {flow.unameStatus === 'taken' && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, color: night.textDim }}>Free instead:</Text>
          {flow.usernameSuggestions.map(u => (
            <Pressable
              key={u}
              onPress={() => flow.changeUname(u)}
              style={{
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
                backgroundColor: night.accentSofter, borderWidth: 1, borderColor: 'rgba(43,227,128,0.4)',
              }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 12.5, color: night.accent }}>@{u}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Spacer />

      <Note>
        Your name and photo are visible to people you approve. Everything else stays private by default.
      </Note>
      <PrimaryButton label="Claim my handle" onPress={() => flow.nav('goal')} disabled={!flow.profileReady} />
    </Screen>
  );
}
