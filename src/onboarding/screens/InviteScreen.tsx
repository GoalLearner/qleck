import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AVATAR_GRADS, night, nightFonts } from '../theme';
import { GradientCircle, PrimaryButton, Screen, Spacer, Sub, Title } from '../ui';
import { SUGGESTED_FRIENDS, type OnboardingFlow } from '../useOnboardingFlow';

const INVITE_LINK = 'qleck.app/join/sara-x7';

export default function InviteScreen({ flow }: { flow: OnboardingFlow }) {
  const copy = () => {
    Clipboard.setStringAsync(INVITE_LINK).catch(() => {});
    flow.copyLink();
  };

  return (
    <Screen>
      <Title style={{ marginBottom: 8 }}>Build your cheer squad</Title>
      <Sub style={{ fontSize: 14.5, lineHeight: 21.75, marginBottom: 20 }}>
        Goals stick twice as well with friends watching. Invite a few.
      </Sub>

      <View style={{ gap: 6 }}>
        {SUGGESTED_FRIENDS.map((f, i) => {
          const on = !!flow.invited[i];
          return (
            <View key={f.handle} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 4 }}>
              <GradientCircle size={44} colors={AVATAR_GRADS[f.grad]}>
                <Text style={{ fontFamily: nightFonts.display, fontSize: 16, color: night.accentInk }}>
                  {f.initial}
                </Text>
              </GradientCircle>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: nightFonts.display, fontSize: 14.5, color: night.text }}>{f.name}</Text>
                <Text style={{ fontFamily: nightFonts.body, fontSize: 12.5, color: night.textFaint }}>{f.handle}</Text>
              </View>
              <Pressable
                onPress={() => flow.toggleInvite(i)}
                style={{
                  height: 36, paddingHorizontal: 16, borderRadius: 18,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? night.accentTint : 'transparent',
                  borderWidth: 1.5, borderColor: on ? night.accentBorderStrong : night.borderMuted,
                }}
              >
                <Text
                  style={{
                    fontFamily: nightFonts.display, fontSize: 12.5,
                    color: on ? night.accent : night.text,
                  }}
                >
                  {on ? 'Invited ✓' : 'Invite'}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <View
        style={{
          marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: night.surface, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
          borderStyle: 'dashed', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12,
        }}
      >
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontFamily: nightFonts.mono, fontSize: 13, color: night.textMuted }}
        >
          {INVITE_LINK}
        </Text>
        <Pressable
          onPress={copy}
          style={{
            height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: night.accent,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: nightFonts.display, fontSize: 12.5, color: night.accentInk }}>
            {flow.copied ? 'Copied!' : 'Copy'}
          </Text>
        </Pressable>
      </View>

      <Spacer />

      <PrimaryButton label="Continue" onPress={() => flow.nav('perms')} />
    </Screen>
  );
}
