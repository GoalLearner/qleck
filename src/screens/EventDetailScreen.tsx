import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Rect } from 'react-native-svg';
import Avatar from '../components/Avatar';
import FadeInUp from '../components/FadeInUp';
import { RsvpStatus } from '../data/types';
import { useRally } from '../state/RallyContext';
import { CATS, colors, fonts, radii } from '../theme';

// Diagonal-stripe placeholder standing in for the event photo.
function StripedBanner({ bg, fg }: { bg: string; fg: string }) {
  const [width, setWidth] = useState(0);
  const H = 148;
  const step = 20 / Math.cos(Math.PI / 4); // 20px perpendicular period at 45°
  const lines: number[] = [];
  for (let x = -H; x < width + H; x += step) lines.push(x);
  return (
    <View
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={{
        marginHorizontal: 14, height: H, borderRadius: radii.card, overflow: 'hidden',
        borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: '#fbf9f2',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {width > 0 && (
        <Svg width={width} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
          <Rect x={0} y={0} width={width} height={H} fill="#fbf9f2" />
          {lines.map(x => (
            <Line key={x} x1={x} y1={0} x2={x + H} y2={H} stroke={bg} strokeWidth={10} />
          ))}
        </Svg>
      )}
      <View style={{ backgroundColor: 'rgba(255,254,251,0.8)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.pill }}>
        <Text
          style={{
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
            fontSize: 11, letterSpacing: 1, color: fg,
          }}
        >
          event photo
        </Text>
      </View>
    </View>
  );
}

function InfoRow({ marker, label, value, last }: { marker: React.ReactNode; label: string; value: string; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.hairline,
      }}
    >
      {marker}
      <Text style={{ fontSize: 11, fontFamily: fonts.extrabold, color: colors.sectionLabel, width: 52 }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: label === 'NOTE' ? 13 : 13.5, fontFamily: label === 'NOTE' ? fonts.semibold : fonts.bold, color: label === 'NOTE' ? colors.faintText : colors.ink, lineHeight: label === 'NOTE' ? 19 : undefined }}>
        {value}
      </Text>
    </View>
  );
}

export default function EventDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { events, setRsvp, people } = useRally();

  const event = events.find(e => e.id === route.params?.id) ?? events[0];
  const cat = CATS[event.cat];
  const host = people[event.hk];
  const onCal = event.status === 'going' || event.hosting;

  const attFull = [
    { key: event.hk, ...host, name: event.hk === 'd' ? 'You' : host.name, sub: 'Host' },
    ...event.att.filter(k => k !== event.hk).map(k => ({ key: k, ...people[k], sub: 'Going' })),
    ...(event.status === 'going' && !event.hosting ? [{ key: 'd' as const, ...people.d, name: 'You', sub: 'Going' }] : []),
  ];

  const seg = (label: string, value: RsvpStatus) => {
    const on = event.status === value;
    return (
      <Pressable
        key={label}
        onPress={() => setRsvp(event.id, value)}
        style={{
          flex: 1, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center',
          backgroundColor: on ? colors.navy : 'transparent',
        }}
      >
        <Text style={{ fontSize: 13, fontFamily: fonts.extrabold, color: on ? colors.cream : colors.muted }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <FadeInUp style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: Math.max(insets.bottom, 20) + 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 }}>
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

        <StripedBanner bg={cat.bg} fg={cat.fg} />

        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 25, letterSpacing: -0.3, color: colors.ink }}>{event.title}</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 5 }}>
            Hosted by {event.hk === 'd' ? 'you' : host.name}
          </Text>
        </View>

        <View
          style={{
            marginTop: 16, marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
            borderRadius: radii.card, paddingVertical: 6, paddingHorizontal: 16,
            shadowColor: '#232a38', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
          }}
        >
          <InfoRow
            marker={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} />}
            label="WHEN" value={event.time}
          />
          <InfoRow
            marker={<View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: cat.fg }} />}
            label="WHERE" value={event.place}
          />
          <InfoRow
            marker={<View style={{ width: 10, height: 10, backgroundColor: cat.fg, transform: [{ rotate: '45deg' }] }} />}
            label="NOTE" value={event.note} last
          />
        </View>

        <Text style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, fontFamily: fonts.serif, fontSize: 17, color: colors.ink }}>
          Who's in
        </Text>
        <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 20, flexWrap: 'wrap' }}>
          {attFull.map((a, i) => (
            <Pressable
              key={`${a.i}-${i}`}
              disabled={a.name === 'You'}
              onPress={() => navigation.navigate('Friend', { key: a.key })}
              style={{ alignItems: 'center', width: 56 }}
            >
              <Avatar friend={a} size={46} fontSize={15} />
              <Text style={{ fontSize: 11, fontFamily: fonts.bold, marginTop: 5, color: colors.ink }}>{a.name}</Text>
              <Text style={{ fontSize: 9.5, fontFamily: fonts.semibold, color: colors.tabIdle }}>{a.sub}</Text>
            </Pressable>
          ))}
        </View>

        {!event.hosting && (
          <View
            style={{
              marginTop: 22, marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1,
              borderColor: colors.borderStrong, borderRadius: radii.pill, padding: 5, flexDirection: 'row', gap: 4,
              shadowColor: '#232a38', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
            }}
          >
            {seg('Going', 'going')}
            {seg('Maybe', 'maybe')}
            {seg("Can't", 'out')}
          </View>
        )}

        {event.hosting && (
          <View style={{ marginTop: 22, marginHorizontal: 14, flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, height: 50, borderRadius: radii.pill, backgroundColor: '#e4e6f4', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#4d5680', fontSize: 13, fontFamily: fonts.extrabold }}>You're hosting this one</Text>
            </View>
            <Pressable style={{ height: 50, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.cream, fontSize: 13, fontFamily: fonts.extrabold }}>Nudge the maybes</Text>
            </Pressable>
          </View>
        )}

        {onCal && (
          <View
            style={{
              marginTop: 12, marginHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 8, height: 44, borderRadius: radii.pill, backgroundColor: colors.successBg,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.successFg }} />
            <Text style={{ fontSize: 12.5, fontFamily: fonts.extrabold, color: colors.successFg }}>
              Synced to your phone's calendar
            </Text>
          </View>
        )}
      </ScrollView>
    </FadeInUp>
  );
}
