import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing } from '../theme';

interface Props {
  title: string;
  onSearch?: () => void;
}

/** Centered title with a circular search button on the right, matching the app. */
export default function AppHeader({ title, onSearch }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.side} />
      <Text style={styles.title}>{title}</Text>
      <View style={[styles.side, styles.right]}>
        <Pressable style={styles.searchBtn} onPress={onSearch} hitSlop={8}>
          <Ionicons name="search" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  side: { width: 44 },
  right: { alignItems: 'flex-end' },
  title: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.title,
    fontWeight: '700',
  },
  searchBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
