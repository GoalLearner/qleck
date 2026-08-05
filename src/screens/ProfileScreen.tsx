import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import { FRIENDS, PICKABLE_FRIENDS } from '../data/mockData';
import FadeInUp from '../components/FadeInUp';
import SectionLabel from '../components/SectionLabel';
import { useRally } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

const BADGES = [
  { label: 'Early bird', bg: '#dcecdf', fg: '#47694f' },
  { label: 'Streak keeper', bg: '#e4e6f4', fg: '#4d5680' },
  { label: 'Snack provider', bg: '#f6e5d4', fg: '#8a5f38' },
];

const CREWS = [
  { i: 'R', bg: '#dcecdf', fg: '#47694f', name: 'Runday crew', sub: '6 friends · 2 plans this week' },
  { i: 'B', bg: '#e4e6f4', fg: '#4d5680', name: 'Book nook', sub: '5 friends · quiet lately' },
];

const SETTINGS = ['Notifications', 'Calendar sync', 'Help & feedback'];

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
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { userName, challenges, following } = useRally();
  const bestStreak = Math.max(...challenges.map(c => c.streak));
  const followedCount = Object.values(following).filter(Boolean).length;

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', paddingTop: 18, paddingHorizontal: 20 }}>
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.openBg, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.accentLink, fontFamily: fonts.serif, fontSize: 30 }}>{userName[0]}</Text>
          </View>
          <Text style={{ fontFamily: fonts.serif, fontSize: 23, marginTop: 12, color: colors.ink }}>{userName} Whitfield</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 4 }}>
            @{userName.toLowerCase()} · joined June '26
          </Text>
        </View>

        {/* Stats */}
        <View
          style={{
            flexDirection: 'row', marginTop: 18, marginHorizontal: 14, backgroundColor: colors.card,
            borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingVertical: 16,
            shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
          }}
        >
          {[
            ['14', 'plans joined'],
            [String(bestStreak), 'best streak'],
            ['96%', 'show-up rate'],
          ].map(([big, small], i) => (
            <React.Fragment key={small}>
              {i > 0 && <View style={{ width: 1, backgroundColor: colors.borderStrong }} />}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 22, color: colors.ink }}>{big}</Text>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.bold, color: colors.muted, marginTop: 3 }}>{small}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Badges */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingTop: 14, paddingHorizontal: 24 }}>
          {BADGES.map(b => (
            <View key={b.label} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: radii.pill, backgroundColor: b.bg }}>
              <Text style={{ color: b.fg, fontSize: 11.5, fontFamily: fonts.extrabold }}>{b.label}</Text>
            </View>
          ))}
        </View>

        <SectionLabel>FRIENDS</SectionLabel>
        <Card>
          <Pressable
            onPress={() => navigation.navigate('Friends')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 16 }}
          >
            <View style={{ flexDirection: 'row' }}>
              {PICKABLE_FRIENDS.slice(0, 4).map(k => (
                <Avatar key={k} friend={FRIENDS[k]} size={30} fontSize={11} ringColor={colors.card} style={{ marginRight: -8 }} />
              ))}
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontSize: 14.5, fontFamily: fonts.extrabold, color: colors.ink }}>
                Following {followedCount} people
              </Text>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>
                Find friends, see their plans and streaks
              </Text>
            </View>
            <Text style={{ fontSize: 16, color: colors.chevron }}>›</Text>
          </Pressable>
        </Card>

        <SectionLabel>YOUR CREWS</SectionLabel>
        <Card>
          {CREWS.map((crew, i) => (
            <View
              key={crew.name}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 16,
                borderBottomWidth: i < CREWS.length - 1 ? 1 : 0, borderBottomColor: colors.hairline,
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: crew.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: crew.fg, fontSize: 14, fontFamily: fonts.extrabold }}>{crew.i}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14.5, fontFamily: fonts.extrabold, color: colors.ink }}>{crew.name}</Text>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>{crew.sub}</Text>
              </View>
              <Text style={{ fontSize: 16, color: colors.chevron }}>›</Text>
            </View>
          ))}
        </Card>

        <SectionLabel>SETTINGS</SectionLabel>
        <Card>
          {SETTINGS.map((label, i) => (
            <View
              key={label}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 15, paddingHorizontal: 16,
                borderBottomWidth: i < SETTINGS.length - 1 ? 1 : 0, borderBottomColor: colors.hairline,
              }}
            >
              <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: colors.ink }}>{label}</Text>
              <Text style={{ fontSize: 16, color: colors.chevron }}>›</Text>
            </View>
          ))}
        </Card>

        <Pressable onPress={onLogout} style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.extrabold, color: colors.danger }}>Log out</Text>
        </Pressable>
      </ScrollView>
    </FadeInUp>
  );
}
