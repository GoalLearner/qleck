// You tab — identity, current goal, settings. Trimmed to the coach-first
// shape (owner call, 2026-08-24): the mock badges/friends/crews/stat rows came
// off; real community (friends, cheers, doing goals together) returns via
// ROADMAP P6 on a real backend.
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import SectionLabel from '../components/SectionLabel';
import YouAvatar from '../components/YouAvatar';
import { goalTitle } from '../components/protocolViews';
import { useRally } from '../state/RallyContext';
import { useTheme, type ThemePref } from '../state/ThemeContext';
import { colors, fonts, radii } from '../theme';

// "Notifications" used to live here as a chevron that did nothing. It comes
// back with the feature (ROADMAP P4: local nudges, quiet hours, per-goal mute)
// — a control over something that doesn't exist is worse than no control.

const APPEARANCE: { key: ThemePref; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

// One switch for the whole product: the tabs and the Qoach surfaces always
// share a mode, so moving between them never changes the lighting.
function AppearanceRow() {
  const { pref, setPref } = useTheme();
  return (
    <View style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
      <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.ink, marginBottom: 10 }}>
        Appearance
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {APPEARANCE.map(opt => {
          const on = pref === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setPref(opt.key)}
              style={{
                flex: 1, height: 40, borderRadius: radii.pill,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? colors.ink : 'transparent',
                borderWidth: 1.5, borderColor: on ? colors.ink : colors.inputBorder,
              }}
            >
              <Text
                style={{
                  fontSize: 13, fontFamily: fonts.bold,
                  color: on ? colors.bg : colors.muted,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: radii.card, overflow: 'hidden',
        shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
      }}
    >
      {children}
    </View>
  );
}

export default function ProfileScreen({ onLogout }: { onLogout: () => void }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { profile, goals } = useRally();

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', paddingTop: 18, paddingHorizontal: 20 }}>
          <YouAvatar size={84} fontSize={30} serif />
          <Text style={{ fontFamily: fonts.serif, fontSize: 23, marginTop: 12, color: colors.ink }}>
            {profile.fullName}
          </Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 4 }}>
            @{profile.handle}
          </Text>
        </View>

        <SectionLabel style={{ marginTop: 22 }}>{goals.length > 1 ? 'CURRENT GOALS' : 'CURRENT GOAL'}</SectionLabel>
        <Card>
          {goals.length === 0 ? (
            <View style={{ paddingVertical: 15, paddingHorizontal: 16 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.semibold, color: colors.muted }}>
                No goal yet — tap + to talk to Qoach.
              </Text>
            </View>
          ) : (
            goals.map((goal, i) => (
              <View
                key={goal.id}
                style={{
                  paddingVertical: 15, paddingHorizontal: 16,
                  borderBottomWidth: i < goals.length - 1 ? 1 : 0, borderBottomColor: colors.hairline,
                }}
              >
                <Text style={{ fontSize: 14.5, fontFamily: fonts.extrabold, color: colors.ink }}>
                  {goalTitle(goal.statement, goal.protocol)}
                </Text>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 3 }}>
                  {goal.durationWeeks} weeks · coached by Qoach
                </Text>
              </View>
            ))
          )}
        </Card>

        <SectionLabel>SETTINGS</SectionLabel>
        <Card>
          <AppearanceRow />
          <View style={{ height: 1, backgroundColor: colors.hairline }} />
          <Pressable
            onPress={() => navigation.navigate('Help')}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 16,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: colors.ink }}>
              Help &amp; about
            </Text>
            <Text style={{ fontSize: 16, color: colors.chevron }}>›</Text>
          </Pressable>
        </Card>

        <Pressable
          onPress={onLogout}
          style={{
            marginTop: 22, marginHorizontal: 14, height: 52, borderRadius: radii.pill,
            borderWidth: 1.5, borderColor: colors.dangerBorder,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: colors.danger }}>Log out</Text>
        </Pressable>
      </ScrollView>
    </FadeInUp>
  );
}
