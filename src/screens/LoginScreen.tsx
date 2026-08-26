import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import { colors, fonts, radii } from '../theme';


function AuthButton({ label, solid, onPress }: { label: string; solid?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 54, borderRadius: radii.pill, marginBottom: solid ? 10 : 18,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: solid ? colors.cream : 'transparent',
        borderWidth: solid ? 0 : 1.5, borderColor: 'rgba(245,242,234,0.28)',
      }}
    >
      <Text style={{ fontSize: 15, fontFamily: solid ? fonts.extrabold : fonts.bold, color: solid ? colors.loginNavy : colors.cream }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.loginNavy }}>
      <FadeInUp
        style={{
          flex: 1,
          paddingTop: Math.max(insets.top, 58) + 52,
          paddingHorizontal: 26,
          paddingBottom: Math.max(insets.bottom, 20) + 22,
        }}
      >
        {/* overlapping avatar trio */}
        <View style={{ position: 'relative', height: 56, marginBottom: 22 }}>
          <View style={{ position: 'absolute', left: 0, top: 0, width: 44, height: 44, borderRadius: 22, backgroundColor: '#e4e6f4', borderWidth: 3, borderColor: colors.loginNavy }} />
          <View style={{ position: 'absolute', left: 28, top: 6, width: 44, height: 44, borderRadius: 22, backgroundColor: '#dcecdf', borderWidth: 3, borderColor: colors.loginNavy }} />
          <View style={{ position: 'absolute', left: 56, top: 0, width: 44, height: 44, borderRadius: 22, backgroundColor: '#f6e5d4', borderWidth: 3, borderColor: colors.loginNavy }} />
        </View>
        <Text style={{ fontFamily: fonts.serif, fontSize: 48, color: colors.cream, letterSpacing: -1, lineHeight: 50 }}>qleck</Text>
        <Text style={{ fontFamily: fonts.serif, fontSize: 17, color: 'rgba(245,242,234,0.72)', marginTop: 12 }}>
          Plans that actually happen.
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 13, lineHeight: 21, color: 'rgba(245,242,234,0.5)', fontFamily: fonts.regular, marginBottom: 20 }}>
          Rally your people. Pick a day. Say yes —{'\n'}every plan lands on everyone's calendar.
        </Text>
        <AuthButton label="Continue with Apple" solid onPress={onLogin} />
        <AuthButton label="Continue with Google" onPress={onLogin} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(245,242,234,0.14)' }} />
          <Text style={{ fontSize: 11, fontFamily: fonts.bold, color: 'rgba(245,242,234,0.4)', letterSpacing: 1 }}>OR</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(245,242,234,0.14)' }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput
            placeholder="you@email.com"
            placeholderTextColor="rgba(245,242,234,0.45)"
            keyboardType="email-address"
            autoCapitalize="none"
            style={{
              flex: 1, height: 54, borderRadius: radii.pill, borderWidth: 1.5,
              borderColor: 'rgba(245,242,234,0.16)', backgroundColor: 'rgba(245,242,234,0.07)',
              color: colors.cream, paddingHorizontal: 20, fontSize: 14.5, fontFamily: fonts.medium,
            }}
          />
          <Pressable
            onPress={onLogin}
            style={{
              width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accent,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 20, fontFamily: fonts.bold }}>→</Text>
          </Pressable>
        </View>
        <Text style={{ fontSize: 11, color: 'rgba(245,242,234,0.35)', textAlign: 'center', marginTop: 18, fontFamily: fonts.regular }}>
          By continuing you agree to be a good sport.
        </Text>
      </FadeInUp>
    </View>
  );
}
