import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Rect } from 'react-native-svg';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, fonts, radii } from '../theme';

function HomeIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22}>
      <Circle cx={11} cy={11} r={8} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={11} cy={11} r={3} fill={color} />
    </Svg>
  );
}

function PlansIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22}>
      <Rect x={3} y={4} width={16} height={15} rx={5} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={8.5} cy={12} r={1.6} fill={color} />
      <Circle cx={13.5} cy={12} r={1.6} fill={color} />
    </Svg>
  );
}

function StreaksIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22}>
      <Rect
        x={5.2} y={5.2} width={11.6} height={11.6} rx={2.5} fill="none" stroke={color} strokeWidth={2}
        transform="rotate(45 11 11)"
      />
    </Svg>
  );
}

function YouIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22}>
      <Circle cx={11} cy={7.5} r={3.6} fill="none" stroke={color} strokeWidth={2} />
      <Rect x={4} y={13.5} width={14} height={7} rx={3.5} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

const ICONS: Record<string, (p: { color: string }) => React.ReactElement> = {
  Today: PlansIcon,   // calendar-ish: the day's reps
  Goals: HomeIcon,    // target: the goal
  You: YouIcon,
  // Quarantined Rally-era surfaces keep their glyphs for the demo build:
  Home: HomeIcon,
  Plans: PlansIcon,
  Streaks: StreaksIcon,
};

// Floating pill tab bar with a center "+" that starts a new goal with Qoach.
export default function RallyTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const tab = (route: (typeof state.routes)[number], index: number) => {
    const focused = state.index === index;
    const color = focused ? colors.accent : colors.tabIdle;
    const Icon = ICONS[route.name] ?? HomeIcon;
    return (
      <Pressable
        key={route.key}
        onPress={() => {
          const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
        }}
        style={{ alignItems: 'center', gap: 3, width: 56 }}
      >
        <Icon color={color} />
        <Text style={{ fontSize: 9.5, fontFamily: fonts.extrabold, color }}>{route.name}</Text>
      </Pressable>
    );
  };

  return (
    <View
      style={{
        position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 16),
        height: 66, borderRadius: radii.pill,
        backgroundColor: 'rgba(255,254,251,0.94)',
        borderWidth: 1, borderColor: colors.borderStrong,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
        paddingHorizontal: 10,
        shadowColor: '#232a38', shadowOpacity: 0.14, shadowRadius: 32, shadowOffset: { width: 0, height: 12 },
        ...(Platform.OS === 'android' ? { elevation: 12 } : null),
      }}
    >
      {/* balanced flex halves keep the "+" dead-center regardless of tab count */}
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-evenly' }}>
        {state.routes.slice(0, 2).map((r, i) => tab(r, i))}
      </View>
      <Pressable
        onPress={() => navigation.getParent()?.navigate('NewGoal' as never)}
        style={{
          width: 52, height: 52, borderRadius: 26, backgroundColor: colors.navy,
          alignItems: 'center', justifyContent: 'center', marginTop: -2,
          shadowColor: '#212836', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
          ...(Platform.OS === 'android' ? { elevation: 10 } : null),
        }}
      >
        <Text style={{ color: colors.cream, fontSize: 22, fontFamily: fonts.semibold, marginTop: -2 }}>+</Text>
      </Pressable>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-evenly' }}>
        {state.routes.slice(2).map((r, i) => tab(r, i + 2))}
      </View>
    </View>
  );
}
