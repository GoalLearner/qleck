import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../components/Avatar';
import FadeInUp from '../../components/FadeInUp';
import FollowPill from '../components/FollowPill';
import SectionLabel from '../../components/SectionLabel';
import { PICKABLE_FRIENDS, SUGGESTED_PEOPLE } from '../mockData';
import { FriendKey } from '../types';
import { useDemo } from '../DemoContext';
import { colors, fonts, radii } from '../../theme';

function PersonRow({ k, onOpen, last }: { k: FriendKey; onOpen: () => void; last: boolean }) {
  const { people } = useDemo();
  const f = people[k];
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline,
      }}
    >
      <Pressable onPress={onOpen} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
        <Avatar friend={f} size={44} fontSize={14} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14.5, fontFamily: fonts.extrabold, color: colors.ink }}>{f.name}</Text>
          <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 2 }}>
            @{f.name.toLowerCase()}{f.tag ? ` · ${f.tag}` : ''}
          </Text>
        </View>
      </Pressable>
      <FollowPill friendKey={k} />
    </View>
  );
}

export default function FriendsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { following, people } = useDemo();
  const [query, setQuery] = useState('');

  const everyone: FriendKey[] = [...PICKABLE_FRIENDS, ...SUGGESTED_PEOPLE];
  const match = (k: FriendKey) => people[k].name.toLowerCase().includes(query.trim().toLowerCase());
  const followed = everyone.filter(k => following[k] && match(k));
  const suggested = everyone.filter(k => !following[k] && match(k));

  const openFriend = (k: FriendKey) => navigation.navigate('Friend', { key: k });

  const card = (people: FriendKey[]) => (
    <View
      style={{
        marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: radii.card, overflow: 'hidden',
        shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
      }}
    >
      {people.map((k, i) => (
        <PersonRow key={k} k={k} onOpen={() => openFriend(k)} last={i === people.length - 1} />
      ))}
    </View>
  );

  return (
    <FadeInUp style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: Math.max(insets.bottom, 20) + 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
        <View style={{ paddingHorizontal: 20, paddingBottom: 2 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 26, letterSpacing: -0.3, color: colors.ink }}>Friends</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 5 }}>
            Following {everyone.filter(k => following[k]).length} people · real names, real faces
          </Text>
        </View>
        <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search people…"
            placeholderTextColor={colors.tabIdle}
            style={{
              height: 48, borderRadius: radii.input, borderWidth: 1.5, borderColor: colors.inputBorder,
              backgroundColor: colors.card, paddingHorizontal: 18, fontSize: 14,
              fontFamily: fonts.semibold, color: colors.ink,
            }}
          />
        </View>
        {followed.length > 0 && (
          <>
            <SectionLabel>FOLLOWING</SectionLabel>
            {card(followed)}
          </>
        )}
        {suggested.length > 0 && (
          <>
            <SectionLabel>FIND PEOPLE</SectionLabel>
            {card(suggested)}
          </>
        )}
        {followed.length === 0 && suggested.length === 0 && (
          <Text style={{ textAlign: 'center', padding: 24, fontSize: 13, fontFamily: fonts.semibold, color: colors.muted }}>
            Nobody by that name yet.
          </Text>
        )}
      </ScrollView>
    </FadeInUp>
  );
}
