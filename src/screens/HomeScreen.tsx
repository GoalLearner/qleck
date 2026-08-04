import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import EventRow from '../components/EventRow';
import FadeInUp from '../components/FadeInUp';
import ProgressRing from '../components/ProgressRing';
import SectionLabel from '../components/SectionLabel';
import { FRIENDS } from '../data/mockData';
import { nextUp, sortedEvents, useRally, weekProgress } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { userName, events, challenges, inviteState, jogState, respondInvite, joinJog, checkIn } = useRally();

  const evs = sortedEvents(events);
  const next = nextUp(events);
  const nextAvs = next ? next.att.slice(0, 3) : [];
  const others = next ? Math.max(next.att.length - 2, 0) : 0;
  const nextNames = next ? next.att.slice(0, 2).map(k => FRIENDS[k].name).join(', ') : '';

  const openEvent = (id: string) => navigation.navigate('Event', { id });

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 2 }}>
          <View>
            <Text style={{ fontFamily: fonts.serif, fontSize: 26, letterSpacing: -0.3, color: colors.ink }}>
              Morning, {userName}.
            </Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 5 }}>
              {evs.length} plans this week · {challenges[0].streak}-day streak. Look at you.
            </Text>
          </View>
          <Pressable
            onPress={() => navigation.navigate('You')}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.openBg, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: colors.accentLink, fontSize: 14, fontFamily: fonts.extrabold }}>{userName[0]}</Text>
          </Pressable>
        </View>

        {/* NEXT UP */}
        {next && (
          <Pressable
            onPress={() => openEvent(next.id)}
            style={{ marginTop: 16, marginHorizontal: 14, backgroundColor: colors.navy, borderRadius: 28, padding: 20 }}
          >
            <Text style={{ fontSize: 10.5, fontFamily: fonts.extrabold, letterSpacing: 1.4, color: 'rgba(245,242,234,0.5)' }}>NEXT UP</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 21, color: colors.creamText }}>{next.title}</Text>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: 'rgba(245,242,234,0.6)', marginTop: 4 }}>
                  {next.time} · {next.place}
                </Text>
              </View>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(245,242,234,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.creamText, fontSize: 18 }}>›</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
              {nextAvs.map(k => (
                <Avatar key={k} friend={FRIENDS[k]} size={28} fontSize={10.5} ringColor={colors.navy} style={{ marginRight: -7 }} />
              ))}
              <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: 'rgba(245,242,234,0.55)', marginLeft: 14 }}>
                {nextNames}{others > 0 ? ` + ${others} are in` : ' are in'}
              </Text>
            </View>
          </Pressable>
        )}

        {/* NEEDS A YES */}
        <SectionLabel>NEEDS A YES</SectionLabel>
        <View style={{ marginHorizontal: 14, backgroundColor: colors.inviteBg, borderWidth: 1, borderColor: colors.inviteBorder, borderRadius: radii.card, padding: 16 }}>
          {inviteState === null && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar friend={FRIENDS.l} size={42} fontSize={14} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.bold, color: colors.inviteAccent }}>Leo invited you</Text>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 17, marginTop: 2, color: colors.ink }}>Dumpling crawl</Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>Sat · 12:30 PM · Golden Palace</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Pressable
                  onPress={() => respondInvite(true)}
                  style={{ flex: 1, height: 42, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13.5, fontFamily: fonts.extrabold }}>I'm in</Text>
                </Pressable>
                <Pressable
                  onPress={() => respondInvite(false)}
                  style={{ flex: 1, height: 42, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.inviteBtnBorder, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.inviteBtnText, fontSize: 13.5, fontFamily: fonts.bold }}>Can't make it</Text>
                </Pressable>
              </View>
            </>
          )}
          {inviteState === 'yes' && (
            <Pressable onPress={() => openEvent('e4')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.successFg, fontSize: 18, fontFamily: fonts.extrabold }}>✓</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14.5, fontFamily: fonts.extrabold, color: colors.ink }}>You're in for Dumpling crawl.</Text>
                <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>
                  On your plans and your calendar — tap to see it.
                </Text>
              </View>
              <Text style={{ fontSize: 16, color: colors.tabIdle }}>›</Text>
            </Pressable>
          )}
          {inviteState === 'no' && (
            <Text style={{ fontSize: 13.5, fontFamily: fonts.semibold, color: colors.muted, textAlign: 'center', paddingVertical: 6 }}>
              Passed. Leo will survive — probably.
            </Text>
          )}
        </View>

        {/* OPEN INVITE */}
        <SectionLabel>OPEN INVITE</SectionLabel>
        <View style={{ marginHorizontal: 14, backgroundColor: colors.openBg, borderWidth: 1, borderColor: colors.openBorder, borderRadius: radii.card, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar friend={FRIENDS.p} size={42} fontSize={14} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.bold, color: colors.accentLink }}>Priya · open to everyone</Text>
              <Text style={{ fontFamily: fonts.serif, fontSize: 17, marginTop: 2, color: colors.ink }}>Morning jog</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>Tomorrow · 7:00 AM · River path</Text>
            </View>
            {jogState === null && (
              <Pressable
                onPress={joinJog}
                style={{ height: 40, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontFamily: fonts.extrabold }}>Join</Text>
              </Pressable>
            )}
          </View>
          {jogState === 'joined' && (
            <Pressable
              onPress={() => openEvent('e5')}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, borderRadius: radii.pill, backgroundColor: colors.successBg, marginTop: 12 }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.successFg }} />
              <Text style={{ fontSize: 12, fontFamily: fonts.extrabold, color: colors.successFg }}>
                You're in — synced to your calendar
              </Text>
            </Pressable>
          )}
        </View>

        {/* This week */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 19, color: colors.ink }}>This week</Text>
          <Pressable onPress={() => navigation.navigate('Plans')}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.extrabold, color: colors.accent }}>See all</Text>
          </Pressable>
        </View>
        <View style={{ gap: 10, paddingHorizontal: 14 }}>
          {evs.map(ev => (
            <EventRow key={ev.id} event={ev} onPress={() => openEvent(ev.id)} showAvatars />
          ))}
        </View>

        {/* Challenges */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 19, color: colors.ink }}>Challenges</Text>
          <Pressable onPress={() => navigation.navigate('Streaks')}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.extrabold, color: colors.accent }}>See all</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 14, paddingBottom: 6 }}>
          {challenges.map(ch => {
            const doneCt = ch.week.reduce((a, b) => a + b, 0);
            return (
              <View
                key={ch.id}
                style={{
                  width: 172, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                  borderRadius: radii.row, padding: 16,
                  shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
                }}
              >
                <ProgressRing size={56} radius={18} strokeWidth={7} progress={weekProgress(ch)}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 17, color: colors.ink }}>{ch.streak}</Text>
                </ProgressRing>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.extrabold, marginTop: 10, lineHeight: 17.5, color: colors.ink }}>{ch.title}</Text>
                <Text style={{ fontSize: 11, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>
                  day streak · {doneCt}/7 this week
                </Text>
                {ch.done ? (
                  <View style={{ height: 34, borderRadius: radii.pill, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
                    <Text style={{ color: colors.successFg, fontSize: 12, fontFamily: fonts.extrabold }}>Done today</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => checkIn(ch.id)}
                    style={{ height: 34, borderRadius: radii.pill, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}
                  >
                    <Text style={{ color: colors.cream, fontSize: 12, fontFamily: fonts.extrabold }}>Check in</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      </ScrollView>
    </FadeInUp>
  );
}
