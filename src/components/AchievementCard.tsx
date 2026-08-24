import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Achievement } from '../data/types';
import { useRally } from '../state/RallyContext';
import Avatar from './Avatar';
import { colors, fonts, radii } from '../theme';

export default function AchievementCard({ achievement }: { achievement: Achievement }) {
  const { cheer, people } = useRally();
  const who = people[achievement.who];
  const others = achievement.cheers.filter(k => k !== 'd');
  const cheerLine = others.length
    ? `${others.slice(0, 2).map(k => people[k].name).join(', ')}${others.length > 2 ? ` + ${others.length - 2}` : ''}${achievement.cheeredByMe ? ' and you' : ''} cheered`
    : achievement.cheeredByMe ? 'You cheered' : 'No cheers yet — be first';

  return (
    <View
      style={{
        marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: radii.card, padding: 16,
        shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar friend={who} size={42} fontSize={14} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.ink, lineHeight: 20 }}>
            <Text style={{ fontFamily: fonts.extrabold }}>{who.name}</Text> {achievement.text}
          </Text>
          <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 3 }}>{cheerLine}</Text>
        </View>
      </View>
      {achievement.cheeredByMe ? (
        <View style={{ height: 40, borderRadius: radii.pill, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
          <Text style={{ color: colors.successFg, fontSize: 12.5, fontFamily: fonts.extrabold }}>You cheered 🎉</Text>
        </View>
      ) : (
        <Pressable
          onPress={() => cheer(achievement.id)}
          style={{ height: 40, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}
        >
          <Text style={{ color: '#fff', fontSize: 12.5, fontFamily: fonts.extrabold }}>Congratulate 🎉</Text>
        </Pressable>
      )}
    </View>
  );
}
