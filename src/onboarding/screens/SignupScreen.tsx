import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { night, nightFonts } from '../theme';
import {
  BackButton, DemoChip, NightInput, Note, Pop, PrimaryButton, Screen, Segmented, Shake, Spacer,
  Sub, Title,
} from '../ui';
import { DEMO_EXISTING_EMAIL, type OnboardingFlow } from '../useOnboardingFlow';

// "This email already has a Qleck account" — the doc's impersonation guard.
function AccountExistsSheet({ flow }: { flow: OnboardingFlow }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={flow.existsOpen} transparent animationType="fade" onRequestClose={() => flow.setExistsOpen(false)}>
      <Pressable
        style={{ flex: 1, backgroundColor: night.scrim, justifyContent: 'flex-end' }}
        onPress={() => flow.setExistsOpen(false)}
      >
        <Pop duration={300}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: night.surface,
              borderTopLeftRadius: 28, borderTopRightRadius: 28,
              borderTopWidth: 1, borderColor: night.border,
              paddingHorizontal: 28, paddingTop: 28,
              paddingBottom: 46 + insets.bottom,
            }}
          >
            <View
              style={{
                width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(247,179,43,0.15)',
                borderWidth: 1.5, borderColor: 'rgba(247,179,43,0.6)',
                alignItems: 'center', justifyContent: 'center', marginBottom: 14,
              }}
            >
              <Text style={{ fontFamily: nightFonts.display, fontSize: 20, color: night.warn }}>!</Text>
            </View>
            <Text
              style={{
                fontFamily: nightFonts.display, fontSize: 22, lineHeight: 26.4,
                color: night.text, marginBottom: 8,
              }}
            >
              This email already has a Qleck account
            </Text>
            <Text
              style={{
                fontFamily: nightFonts.body, fontSize: 14, lineHeight: 21,
                color: night.textMuted, marginBottom: 20,
              }}
            >
              Forgetful — or is someone borrowing your identity? Either way, we’ve got you. One account per human.
            </Text>
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={flow.existsLogin}
                style={({ pressed }) => ({
                  height: 50, borderRadius: 25, backgroundColor: night.accent,
                  alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.88 : 1,
                })}
              >
                <Text style={{ fontFamily: nightFonts.display, fontSize: 15, color: night.accentInk }}>
                  Log in instead
                </Text>
              </Pressable>
              <Pressable
                onPress={flow.existsReset}
                style={{
                  height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: night.borderStrong,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: nightFonts.display, fontSize: 15, color: night.text }}>
                  Reset my password
                </Text>
              </Pressable>
              <Pressable
                onPress={() => flow.setExistsOpen(false)}
                style={{ height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 14, color: night.textSoft }}>
                  Use a different email
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pop>
      </Pressable>
    </Modal>
  );
}

export default function SignupScreen({ flow, demoHints }: { flow: OnboardingFlow; demoHints: boolean }) {
  const { isEmail } = flow;
  return (
    <>
      <Screen>
        <BackButton onPress={() => flow.nav('auth')} />
        <Title style={{ marginTop: 26, marginBottom: 8 }}>
          {isEmail ? 'What’s your email?' : 'What’s your number?'}
        </Title>
        <Sub style={{ marginBottom: 22 }}>We’ll send a 6-digit code to make sure it’s really you.</Sub>

        <Segmented
          options={[{ key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }]}
          value={flow.method}
          onChange={k => flow.pickMethod(k as 'email' | 'phone')}
          style={{ marginBottom: 16 }}
        />

        <NightInput
          value={flow.contact}
          onChangeText={flow.setContact}
          placeholder={isEmail ? 'you@somewhere.com' : '+47 400 00 000'}
          keyboardType={isEmail ? 'email-address' : 'phone-pad'}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType={isEmail ? 'emailAddress' : 'telephoneNumber'}
          style={{ height: 54 }}
        />

        {!!flow.contactErr && (
          <Shake trigger={flow.contactErr}>
            <Text
              style={{
                fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.danger,
                marginTop: 10, marginHorizontal: 2,
              }}
            >
              {flow.contactErr}
            </Text>
          </Shake>
        )}

        {demoHints && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <DemoChip label="demo: new@qleck.app" onPress={() => flow.setContact('new@qleck.app')} />
            <DemoChip
              label={`existing: ${DEMO_EXISTING_EMAIL}`}
              tone="danger"
              onPress={() => flow.setContact(DEMO_EXISTING_EMAIL)}
            />
          </View>
        )}

        <Spacer />

        <Note>
          Used only to secure your account and for password resets. GDPR-safe — never shared, never leaked.
        </Note>
        <PrimaryButton label="Send my code" onPress={flow.submitContact} />
      </Screen>

      <AccountExistsSheet flow={flow} />
    </>
  );
}
