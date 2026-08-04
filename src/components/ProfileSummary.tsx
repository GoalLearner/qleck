import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Profile } from '../data/types';
import { colors, font, spacing } from '../theme';

/** Avatar flanked by follower / following counts, with the full name below. */
export default function ProfileSummary({ profile }: { profile: Profile }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Stat value={profile.followers} label="followers" />
        <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
        <Stat value={profile.following} label="following" />
      </View>
      <Text style={styles.name}>{profile.fullName}</Text>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '85%',
  },
  stat: { alignItems: 'center', width: 90 },
  statValue: { color: colors.text, fontSize: font.title, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: font.label, marginTop: 2 },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  name: {
    color: colors.text,
    fontSize: font.body,
    fontWeight: '600',
    marginTop: spacing.md,
  },
});
