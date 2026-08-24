import React, { useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import FadeInUp from '../components/FadeInUp';
import SectionLabel from '../components/SectionLabel';
import { DAY_OPTIONS, PICKABLE_FRIENDS, TARGET_OPTIONS, TIME_OPTIONS } from '../data/mockData';
import { Draft, FriendKey } from '../data/types';
import { useRally } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

const INITIAL_DRAFT: Draft = {
  kind: 'plan', title: '', dayIdx: 2, timeIdx: 2, place: '', aud: 'picks',
  challengeKind: 'streak', targetIdx: 1, pollOptions: ['', '', ''],
};

// Mirrors the design's `hdPop` entrance (scale 0.5 → overshoot → 1).
function PopIn({ children }: { children: React.ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.spring(t, { toValue: 1, useNativeDriver: true, friction: 6, tension: 80 }).start();
  }, [t]);
  return (
    <Animated.View style={{ opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }}>
      {children}
    </Animated.View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 40, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1,
        borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center',
        backgroundColor: on ? colors.navy : colors.card,
      }}
    >
      <Text style={{ fontSize: 13, fontFamily: fonts.bold, color: on ? colors.cream : colors.faintText }}>{label}</Text>
    </Pressable>
  );
}

const inputStyle = {
  height: 52, borderRadius: radii.input, borderWidth: 1.5, borderColor: colors.inputBorder,
  backgroundColor: colors.card, paddingHorizontal: 18, fontSize: 14.5,
  fontFamily: fonts.semibold, color: colors.ink,
} as const;

export default function CreateScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { sendRally, people } = useRally();

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [picks, setPicks] = useState<Record<string, boolean>>({});

  const picked = PICKABLE_FRIENDS.filter(k => picks[k]);
  const n = picked.length;
  const isPoll = draft.kind === 'poll';
  const canSend = n > 0 || draft.aud === 'open' || isPoll;

  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const setPollOption = (i: number, v: string) =>
    setDraft(d => ({ ...d, pollOptions: d.pollOptions.map((o, idx) => (idx === i ? v : o)) }));

  const send = () => {
    if (!canSend) return;
    sendRally(draft, picked);
    setStep(3);
  };

  const sentAvs: FriendKey[] = n ? picked : ['m', 's', 'n'];
  const sendLabel = isPoll
    ? 'Post the poll'
    : draft.aud === 'open'
      ? (n ? `Post it + ${n} direct invite${n > 1 ? 's' : ''}` : 'Post open invite')
      : (n ? `Send ${n} invite${n > 1 ? 's' : ''}` : 'Pick at least one');

  const kindCard = (kind: Draft['kind'], title: string, sub: string, icon: React.ReactNode) => {
    const on = draft.kind === kind;
    return (
      <Pressable
        key={kind}
        onPress={() => set({ kind })}
        style={{
          flex: 1, borderRadius: radii.row, padding: 13,
          backgroundColor: on ? colors.card : colors.chipIdleBg,
          borderWidth: 2, borderColor: on ? colors.accent : 'transparent',
        }}
      >
        {icon}
        <Text style={{ fontSize: 13.5, fontFamily: fonts.extrabold, marginTop: 10, color: colors.ink }}>{title}</Text>
        <Text style={{ fontSize: 10.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>{sub}</Text>
      </Pressable>
    );
  };

  return (
    <FadeInUp style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: Math.max(insets.bottom, 20) + 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 24, paddingLeft: 6, color: colors.ink }}>
            {step === 1 ? 'New plan' : step === 2 ? (isPoll ? 'Who can vote?' : "Who's in?") : 'Sent!'}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={{
              width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.inputBorder,
              backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 16, color: colors.accentLink }}>×</Text>
          </Pressable>
        </View>

        {/* progress dots */}
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 4 }}>
          {[1, 2, 3].map(i => (
            <View key={i} style={{ width: 22, height: 6, borderRadius: 3, backgroundColor: step >= i ? colors.navy : '#d9d5c6' }} />
          ))}
        </View>

        {step === 1 && (
          <>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 14 }}>
              {kindCard('plan', 'A plan', 'One-off hangout', (
                <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: '#e4e6f4', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 2.5, borderColor: '#4d5680' }} />
                </View>
              ))}
              {kindCard('challenge', 'A challenge', 'Goal with friends', (
                <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: '#dcecdf', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 13, height: 13, borderWidth: 2.5, borderColor: '#47694f', transform: [{ rotate: '45deg' }] }} />
                </View>
              ))}
              {kindCard('poll', 'A poll', 'Let the group pick', (
                <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: '#f6e5d4', alignItems: 'flex-end', justifyContent: 'center', flexDirection: 'row', gap: 3, paddingBottom: 7 }}>
                  <View style={{ width: 4, height: 8, borderRadius: 2, backgroundColor: '#8a5f38' }} />
                  <View style={{ width: 4, height: 14, borderRadius: 2, backgroundColor: '#8a5f38' }} />
                  <View style={{ width: 4, height: 11, borderRadius: 2, backgroundColor: '#8a5f38' }} />
                </View>
              ))}
            </View>

            <SectionLabel style={{ paddingTop: 20, paddingHorizontal: 22, paddingBottom: 8 }}>
              {isPoll ? 'THE QUESTION' : 'WHAT IS IT?'}
            </SectionLabel>
            <View style={{ paddingHorizontal: 14 }}>
              <TextInput
                value={draft.title}
                onChangeText={title => set({ title })}
                placeholder={isPoll ? 'Where to next? Tacos or sushi?' : 'Saturday picnic, 5k relay, taco tour…'}
                placeholderTextColor={colors.tabIdle}
                style={inputStyle}
              />
            </View>

            {draft.kind === 'challenge' && (
              <>
                <SectionLabel style={{ paddingTop: 18, paddingHorizontal: 22, paddingBottom: 8 }}>WHAT COUNTS?</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14 }}>
                  <Chip label="Daily streak" on={draft.challengeKind === 'streak'} onPress={() => set({ challengeKind: 'streak' })} />
                  <Chip label="Team total" on={draft.challengeKind === 'team'} onPress={() => set({ challengeKind: 'team' })} />
                </View>
                {draft.challengeKind === 'team' && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingTop: 8 }}>
                    {TARGET_OPTIONS.map((t, i) => (
                      <Chip key={t} label={`${t} km`} on={draft.targetIdx === i} onPress={() => set({ targetIdx: i })} />
                    ))}
                  </View>
                )}
              </>
            )}

            {isPoll ? (
              <>
                <SectionLabel style={{ paddingTop: 18, paddingHorizontal: 22, paddingBottom: 8 }}>THE OPTIONS</SectionLabel>
                <View style={{ paddingHorizontal: 14, gap: 8 }}>
                  {draft.pollOptions.map((o, i) => (
                    <TextInput
                      key={i}
                      value={o}
                      onChangeText={v => setPollOption(i, v)}
                      placeholder={['First option', 'Second option', 'Third option (optional)'][i]}
                      placeholderTextColor={colors.tabIdle}
                      style={inputStyle}
                    />
                  ))}
                </View>
              </>
            ) : (
              <>
                <SectionLabel style={{ paddingTop: 18, paddingHorizontal: 22, paddingBottom: 8 }}>WHEN?</SectionLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14 }}>
                  {DAY_OPTIONS.map((l, i) => (
                    <Chip key={l} label={l} on={draft.dayIdx === i} onPress={() => set({ dayIdx: i })} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingTop: 8 }}>
                  {TIME_OPTIONS.map((l, i) => (
                    <Chip key={l} label={l} on={draft.timeIdx === i} onPress={() => set({ timeIdx: i })} />
                  ))}
                </View>
                {draft.kind === 'plan' && (
                  <>
                    <SectionLabel style={{ paddingTop: 18, paddingHorizontal: 22, paddingBottom: 8 }}>WHERE?</SectionLabel>
                    <View style={{ paddingHorizontal: 14 }}>
                      <TextInput
                        value={draft.place}
                        onChangeText={place => set({ place })}
                        placeholder="The park, Sam's place, anywhere…"
                        placeholderTextColor={colors.tabIdle}
                        style={inputStyle}
                      />
                    </View>
                  </>
                )}
              </>
            )}

            <View style={{ paddingHorizontal: 14, paddingTop: 22 }}>
              <Pressable
                onPress={() => setStep(2)}
                style={{ height: 52, borderRadius: radii.pill, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: colors.cream, fontSize: 14.5, fontFamily: fonts.extrabold }}>Pick the people →</Text>
              </Pressable>
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 14 }}>
              {(['picks', 'open'] as const).map(aud => {
                const on = draft.aud === aud;
                return (
                  <Pressable
                    key={aud}
                    onPress={() => set({ aud })}
                    style={{
                      flex: 1, height: 42, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderStrong,
                      alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.navy : colors.card,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: fonts.extrabold, color: on ? colors.cream : colors.faintText }}>
                      {aud === 'picks' ? 'My picks' : 'Anyone on Qleck'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ paddingHorizontal: 22, paddingVertical: 12, fontSize: 13, fontFamily: fonts.semibold, color: colors.muted }}>
              {isPoll
                ? (draft.aud === 'open' ? 'Anyone on Qleck can vote. Tap friends to nudge them directly.' : 'Tap everyone whose vote you want.')
                : draft.aud === 'open'
                  ? 'Anyone on Qleck can see and join this. Tap friends to also invite them directly.'
                  : 'Tap everyone you want in on this.'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 14 }}>
              {PICKABLE_FRIENDS.map(k => {
                const f = people[k];
                const on = !!picks[k];
                return (
                  <Pressable
                    key={k}
                    onPress={() => setPicks(p => ({ ...p, [k]: !on }))}
                    style={{
                      flexBasis: '30%', flexGrow: 1, borderRadius: 22, paddingVertical: 14, paddingHorizontal: 8,
                      alignItems: 'center', backgroundColor: on ? colors.card : '#f0eee4',
                      borderWidth: 2, borderColor: on ? colors.accent : 'transparent',
                    }}
                  >
                    <View style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, opacity: on ? 1 : 0 }} />
                    <Avatar friend={f} size={46} fontSize={15} />
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.extrabold, marginTop: 7, color: colors.ink }}>{f.name}</Text>
                    <Text style={{ fontSize: 9.5, fontFamily: fonts.bold, color: colors.tabIdle, marginTop: 2 }}>{f.tag}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ paddingHorizontal: 14, paddingTop: 22 }}>
              <Pressable
                onPress={send}
                style={{
                  height: 52, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: canSend ? colors.navy : colors.disabledSend,
                }}
              >
                <Text style={{ color: colors.cream, fontSize: 14.5, fontFamily: fonts.extrabold }}>{sendLabel}</Text>
              </Pressable>
              <Pressable onPress={() => setStep(1)} style={{ alignItems: 'center', padding: 14 }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.extrabold, color: colors.muted }}>‹ Back to details</Text>
              </Pressable>
            </View>
          </>
        )}

        {step === 3 && (
          <View style={{ alignItems: 'center', paddingTop: 36, paddingHorizontal: 24 }}>
            <PopIn>
              <View style={{ flexDirection: 'row' }}>
                {sentAvs.map(k => (
                  <Avatar
                    key={k} friend={people[k]} size={52} fontSize={17}
                    ringColor={colors.bg} ringWidth={3} style={{ marginHorizontal: -7 }}
                  />
                ))}
              </View>
            </PopIn>
            <Text style={{ fontFamily: fonts.serif, fontSize: 26, marginTop: 20, color: colors.ink }}>
              {isPoll ? 'Poll is live.' : 'Invites are out.'}
            </Text>
            <Text style={{ fontSize: 13.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 8, lineHeight: 20, textAlign: 'center' }}>
              {isPoll
                ? 'Votes roll in on your home screen — majority rules, no take-backs. (Okay, some take-backs.)'
                : draft.aud === 'open'
                  ? "It's live for everyone on Qleck. Every yes lands straight on their calendar."
                  : "We'll nudge you as the yeses roll in. Every yes lands on their calendar."}
            </Text>
            <View
              style={{
                marginTop: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderStrong,
                borderRadius: radii.pill, paddingVertical: 10, paddingHorizontal: 20,
              }}
            >
              <Text style={{ fontSize: 13, fontFamily: fonts.extrabold, color: colors.accentLink }}>
                {isPoll
                  ? `${draft.title.trim() || 'Your poll'} · ${draft.pollOptions.filter(o => o.trim()).length} options`
                  : `${draft.title.trim() || 'Your plan'} · ${DAY_OPTIONS[draft.dayIdx]} · ${TIME_OPTIONS[draft.timeIdx]}`}
              </Text>
            </View>
            <Pressable
              onPress={() => navigation.navigate('Tabs', { screen: 'Home' })}
              style={{ marginTop: 26, alignSelf: 'stretch', height: 52, borderRadius: radii.pill, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: colors.cream, fontSize: 14.5, fontFamily: fonts.extrabold }}>Back to home</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </FadeInUp>
  );
}
