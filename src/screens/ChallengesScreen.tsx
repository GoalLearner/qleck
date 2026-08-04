import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import ProgressRing from '../components/ProgressRing';
import WeekDots from '../components/WeekDots';
import { useRally, weekProgress } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

export default function ChallengesScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { challenges, checkIn } = useRally();

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 2 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 26, letterSpacing: -0.3, color: colors.ink }}>Challenges</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 5 }}>Keep the streaks alive.</Text>
        </View>
        <View style={{ gap: 12, paddingHorizontal: 14, paddingTop: 16 }}>
          {challenges.map(ch => (
            <View
              key={ch.id}
              style={{
                backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                borderRadius: radii.card, padding: 18,
                shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
              }}
            >
              <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                <ProgressRing size={64} radius={24} strokeWidth={8} progress={weekProgress(ch)}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 20, color: colors.ink }}>{ch.streak}</Text>
                </ProgressRing>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 17, color: colors.ink }}>{ch.title}</Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, marginTop: 3 }}>{ch.sub}</Text>
                  <Pressable onPress={() => navigation.navigate('Challenge', { id: ch.id })}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.extrabold, color: colors.accent, marginTop: 6 }}>Details ›</Text>
                  </Pressable>
                </View>
              </View>
              <View style={{ marginTop: 14 }}>
                <WeekDots challenge={ch} />
              </View>
              {ch.done ? (
                <View style={{ height: 44, borderRadius: radii.pill, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}>
                  <Text style={{ color: colors.successFg, fontSize: 13.5, fontFamily: fonts.extrabold }}>
                    Done today — see you tomorrow
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => checkIn(ch.id)}
                  style={{ height: 44, borderRadius: radii.pill, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: 14 }}
                >
                  <Text style={{ color: colors.cream, fontSize: 13.5, fontFamily: fonts.extrabold }}>Check in for today</Text>
                </Pressable>
              )}
            </View>
          ))}
          <Pressable
            onPress={() => navigation.getParent()?.navigate('Create')}
            style={{
              height: 58, borderRadius: radii.row, borderWidth: 2, borderStyle: 'dashed',
              borderColor: colors.dashed, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.muted, fontSize: 13.5, fontFamily: fonts.extrabold }}>+ Start a challenge</Text>
          </Pressable>
        </View>
      </ScrollView>
    </FadeInUp>
  );
}
