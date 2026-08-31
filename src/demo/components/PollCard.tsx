import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Poll } from '../types';
import { useDemo } from '../DemoContext';
import Avatar from './Avatar';
import { colors, fonts, radii } from '../../theme';

export default function PollCard({ poll }: { poll: Poll }) {
  const { vote, people } = useDemo();
  const by = people[poll.by];
  const total = poll.options.reduce((a, o) => a + o.votes.length, 0);
  const voted = poll.myVote !== null;

  return (
    <View
      style={{
        marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: radii.card, padding: 16,
        shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar friend={by} size={42} fontSize={14} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11.5, fontFamily: fonts.bold, color: colors.accentLink }}>
            {poll.by === 'd' ? 'Your poll' : `${by.name} asks`} · {poll.group}
          </Text>
          <Text style={{ fontFamily: fonts.serif, fontSize: 17, marginTop: 2, color: colors.ink }}>{poll.question}</Text>
        </View>
      </View>
      <View style={{ gap: 8, marginTop: 14 }}>
        {poll.options.map((o, i) => {
          const mine = poll.myVote === i;
          const pct = total > 0 ? o.votes.length / total : 0;
          return (
            <Pressable
              key={i}
              onPress={() => vote(poll.id, i)}
              style={{
                height: 42, borderRadius: radii.pill, overflow: 'hidden',
                borderWidth: mine ? 2 : 1, borderColor: mine ? colors.accent : colors.borderStrong,
                justifyContent: 'center',
              }}
            >
              {voted && (
                <View
                  style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${Math.round(pct * 100)}%`, backgroundColor: colors.openBg,
                  }}
                />
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 13, fontFamily: mine ? fonts.extrabold : fonts.bold, color: colors.ink }}>
                  {o.label}{mine ? '  ·  your vote' : ''}
                </Text>
                {voted && (
                  <Text style={{ fontSize: 12, fontFamily: fonts.extrabold, color: colors.muted }}>
                    {Math.round(pct * 100)}%
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ fontSize: 11, fontFamily: fonts.semibold, color: colors.sectionLabel, marginTop: 10 }}>
        {voted
          ? `${total} vote${total === 1 ? '' : 's'} · tap another option to change yours`
          : total > 0 ? `${total} vote${total === 1 ? '' : 's'} so far — tap to vote` : 'Be the first to vote'}
      </Text>
    </View>
  );
}
