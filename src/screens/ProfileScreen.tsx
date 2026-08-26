// You tab — identity, current goal, settings. Trimmed to the coach-first
// shape (owner call, 2026-08-24): the mock badges/friends/crews/stat rows came
// off; real community (friends, cheers, doing goals together) returns via
// ROADMAP P6 on a real backend.
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import SectionLabel from '../components/SectionLabel';
import YouAvatar from '../components/YouAvatar';
import { goalTitle } from '../components/protocolViews';
import { useRally } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

const SETTINGS = ['Notifications', 'Help & feedback'];

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: radii.card, overflow: 'hidden',
        shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
      }}
    >
      {children}
    </View>
  );
}

export default function ProfileScreen({ onLogout }: { onLogout: () => void }) {
  const insets = useSafeAreaInsets();
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
          {SETTINGS.map((label, i) => (
            <View
              key={label}
              style={{
                flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 16,
                borderBottomWidth: i < SETTINGS.length - 1 ? 1 : 0, borderBottomColor: colors.hairline,
              }}
            >
              <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: colors.ink }}>{label}</Text>
              <Text style={{ fontSize: 16, color: colors.chevron }}>›</Text>
            </View>
          ))}
        </Card>

        <Pressable
          onPress={onLogout}
          style={{
            marginTop: 22, marginHorizontal: 14, height: 52, borderRadius: radii.pill,
            borderWidth: 1.5, borderColor: 'rgba(160,90,90,0.35)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: colors.danger }}>Log out</Text>
        </Pressable>
      </ScrollView>
    </FadeInUp>
  );
}
