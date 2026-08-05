import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AchievementCard from '../components/AchievementCard';
import Avatar from '../components/Avatar';
import EventRow from '../components/EventRow';
import FadeInUp from '../components/FadeInUp';
import FollowPill from '../components/FollowPill';
import SectionLabel from '../components/SectionLabel';
import { FRIENDS } from '../data/mockData';
import { FriendKey } from '../data/types';
import { teamTotal, useRally } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

export default function FriendProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { events, challenges, achievements, following } = useRally();

  const k: FriendKey = route.params?.key ?? 'm';
  const f = FRIENDS[k];

  const sharedPlans = events
    .filter(e => e.att.includes(k) || e.hk === k)
    .sort((a, b) => a.ord - b.ord);

  const theirChallenges = challenges
    .map(ch => {
      if (ch.kind === 'team') {
        const c = ch.contributions?.find(([key]) => key === k);
        return c ? { ch, line: `${c[1]} ${ch.unit} logged · team at ${teamTotal(ch)}/${ch.target} ${ch.unit}` } : null;
      }
      const b = ch.board.find(([key]) => key === k);
      return b ? { ch, line: `${b[1]} check-ins this month` } : null;
    })
    .filter((x): x is { ch: (typeof challenges)[number]; line: string } => x !== null);

  const theirAchievements = achievements.filter(a => a.who === k);

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

        <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
          <Avatar friend={f} size={84} fontSize={30} />
          <Text style={{ fontFamily: fonts.serif, fontSize: 23, marginTop: 12, color: colors.ink }}>{f.name}</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 4 }}>
            @{f.name.toLowerCase()}{f.tag ? ` · ${f.tag}` : ''}
          </Text>
          <View style={{ marginTop: 14 }}>
            <FollowPill friendKey={k} wide />
          </View>
          {!following[k] && (
            <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: colors.sectionLabel, marginTop: 10, textAlign: 'center' }}>
              Follow {f.name} to see their plans, goals and streaks here.
            </Text>
          )}
        </View>

        {following[k] && (
          <>
            {sharedPlans.length > 0 && (
              <>
                <SectionLabel>PLANS TOGETHER</SectionLabel>
                <View style={{ gap: 10, paddingHorizontal: 14 }}>
                  {sharedPlans.map(ev => (
                    <EventRow key={ev.id} event={ev} onPress={() => navigation.navigate('Event', { id: ev.id })} />
                  ))}
                </View>
              </>
            )}
            {theirChallenges.length > 0 && (
              <>
                <SectionLabel>THEIR CHALLENGES</SectionLabel>
                <View
                  style={{
                    marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                    borderRadius: radii.card, overflow: 'hidden',
                    shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
                  }}
                >
                  {theirChallenges.map(({ ch, line }, i) => (
                    <Pressable
                      key={ch.id}
                      onPress={() => navigation.navigate('Challenge', { id: ch.id })}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16,
                        borderBottomWidth: i < theirChallenges.length - 1 ? 1 : 0, borderBottomColor: colors.hairline,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14.5, fontFamily: fonts.extrabold, color: colors.ink }}>{ch.title}</Text>
                        <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>{line}</Text>
                      </View>
                      <Text style={{ fontSize: 16, color: colors.chevron }}>›</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            {theirAchievements.length > 0 && (
              <>
                <SectionLabel>ACHIEVEMENTS</SectionLabel>
                <View style={{ gap: 10 }}>
                  {theirAchievements.map(a => (
                    <AchievementCard key={a.id} achievement={a} />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </FadeInUp>
  );
}
