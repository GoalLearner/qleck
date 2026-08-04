import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import FadeInUp from '../components/FadeInUp';
import ProgressRing from '../components/ProgressRing';
import WeekDots from '../components/WeekDots';
import { FRIENDS } from '../data/mockData';
import { useRally, weekProgress } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

export default function ChallengeDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { challenges, checkIn } = useRally();

  const ch = challenges.find(c => c.id === route.params?.id) ?? challenges[0];

  return (
    <FadeInUp style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: Math.max(insets.bottom, 20) + 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 }}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={{
              width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.inputBorder,
              backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 17, color: colors.accentLink }}>‹</Text>
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', paddingTop: 4, paddingHorizontal: 20 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 24, letterSpacing: -0.3, color: colors.ink }}>{ch.title}</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 4 }}>{ch.sub}</Text>
        </View>

        <View style={{ alignItems: 'center', marginTop: 18 }}>
          <ProgressRing size={150} radius={60} strokeWidth={12} progress={weekProgress(ch)}>
            <Text style={{ fontFamily: fonts.serif, fontSize: 44, lineHeight: 48, color: colors.ink }}>{ch.streak}</Text>
            <Text style={{ fontSize: 11, fontFamily: fonts.bold, color: colors.muted, marginTop: 2 }}>day streak</Text>
          </ProgressRing>
        </View>

        <View style={{ alignItems: 'center', marginTop: 16 }}>
          <WeekDots challenge={ch} size={32} gap={8} />
        </View>

        <View style={{ marginTop: 18, marginHorizontal: 14 }}>
          {ch.done ? (
            <View style={{ height: 50, borderRadius: radii.pill, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.successFg, fontSize: 14, fontFamily: fonts.extrabold }}>
                Done today — see you tomorrow
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={() => checkIn(ch.id)}
              style={{ height: 50, borderRadius: radii.pill, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: colors.cream, fontSize: 14, fontFamily: fonts.extrabold }}>Check in for today</Text>
            </Pressable>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 10 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 17, color: colors.ink }}>Leaderboard</Text>
          <Text style={{ fontSize: 10.5, fontFamily: fonts.bold, color: colors.sectionLabel }}>check-ins this month</Text>
        </View>
        <View
          style={{
            marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
            borderRadius: radii.card, overflow: 'hidden',
            shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
          }}
        >
          {ch.board.map(([k, pts], idx) => {
            const f = FRIENDS[k];
            const isYou = k === 'd';
            return (
              <View
                key={`${k}-${idx}`}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16,
                  backgroundColor: isYou ? colors.youRowBg : 'transparent',
                }}
              >
                <Text style={{ fontFamily: fonts.serif, fontSize: 15, width: 20, color: colors.sectionLabel }}>{idx + 1}</Text>
                <Avatar friend={f} size={34} fontSize={12} />
                <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.extrabold, color: colors.ink }}>
                  {isYou ? 'You' : f.name}
                </Text>
                <Text style={{ fontFamily: fonts.serif, fontSize: 16, color: colors.ink }}>{pts}</Text>
              </View>
            );
          })}
        </View>

        <Text
          style={{
            paddingVertical: 16, paddingHorizontal: 24, fontSize: 12.5, fontFamily: fonts.semibold,
            color: colors.sectionLabel, lineHeight: 19.5, textAlign: 'center',
          }}
        >
          One check-in a day keeps the streak alive. Miss a day and it's back to zero. Honor system — we trust you. Mostly.
        </Text>
      </ScrollView>
    </FadeInUp>
  );
}
