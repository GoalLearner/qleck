import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { FRIENDS } from '../data/mockData';
import { RallyEvent } from '../data/types';
import { statusPill } from '../state/RallyContext';
import Avatar from './Avatar';
import { CATS, colors, fonts, radii } from '../theme';

interface Props {
  event: RallyEvent;
  onPress: () => void;
  showAvatars?: boolean; // Home shows the attendee stack, Plans doesn't
}

export default function EventRow({ event, onPress, showAvatars = false }: Props) {
  const cat = CATS[event.cat];
  const st = statusPill(event);
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: radii.row, paddingVertical: 13, paddingHorizontal: 14,
        flexDirection: 'row', alignItems: 'center', gap: 13,
        shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
      }}
    >
      <View
        style={{
          width: 48, height: 54, borderRadius: radii.dateTile, backgroundColor: cat.bg,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 10, fontFamily: fonts.extrabold, letterSpacing: 0.5, color: cat.fg }}>{event.day}</Text>
        <Text style={{ fontFamily: fonts.serif, fontSize: 19, lineHeight: 22, color: cat.fg }}>{event.num}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontFamily: fonts.extrabold, color: colors.ink }}>{event.title}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, marginTop: 3 }}>
          {event.time} · {event.place}
        </Text>
        {showAvatars && (
          <View style={{ flexDirection: 'row', marginTop: 7 }}>
            {event.att.map(k => (
              <Avatar key={k} friend={FRIENDS[k]} size={22} fontSize={9} ringColor={colors.card} style={{ marginRight: -6 }} />
            ))}
          </View>
        )}
      </View>
      <View style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: st.bg }}>
        <Text style={{ fontSize: 11, fontFamily: fonts.extrabold, color: st.fg }}>{st.t}</Text>
      </View>
    </Pressable>
  );
}
