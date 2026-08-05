import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EventRow from '../components/EventRow';
import FadeInUp from '../components/FadeInUp';
import { sortedEvents, useRally } from '../state/RallyContext';
import { colors, fonts, radii } from '../theme';

export default function PlansScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { events } = useRally();
  const evs = sortedEvents(events);
  const hosted = evs.filter(e => e.hosting).length;

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 2 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 26, letterSpacing: -0.3, color: colors.ink }}>Your plans</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 5 }}>
            {evs.length} coming up · {hosted} hosted by you
          </Text>
        </View>
        <View style={{ gap: 10, paddingHorizontal: 14, paddingTop: 16 }}>
          {evs.map(ev => (
            <EventRow key={ev.id} event={ev} onPress={() => navigation.navigate('Event', { id: ev.id })} />
          ))}
          <Pressable
            onPress={() => navigation.getParent()?.navigate('Create')}
            style={{
              height: 58, borderRadius: radii.row, borderWidth: 2, borderStyle: 'dashed',
              borderColor: colors.dashed, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.muted, fontSize: 13.5, fontFamily: fonts.extrabold }}>+ New plan</Text>
          </Pressable>
        </View>
      </ScrollView>
    </FadeInUp>
  );
}
