import React from 'react';
import { Pressable, Text } from 'react-native';
import { FriendKey } from '../data/types';
import { useRally } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

export default function FollowPill({ friendKey, wide }: { friendKey: FriendKey; wide?: boolean }) {
  const { following, toggleFollow } = useRally();
  const on = !!following[friendKey];
  return (
    <Pressable
      onPress={() => toggleFollow(friendKey)}
      style={{
        height: wide ? 44 : 36, paddingHorizontal: wide ? 26 : 16, borderRadius: radii.pill,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: on ? colors.card : colors.accent,
        borderWidth: on ? 1.5 : 0, borderColor: colors.inputBorder,
      }}
    >
      <Text style={{ fontSize: wide ? 13.5 : 12.5, fontFamily: fonts.extrabold, color: on ? colors.faintText : '#fff' }}>
        {on ? 'Following' : 'Follow'}
      </Text>
    </Pressable>
  );
}
