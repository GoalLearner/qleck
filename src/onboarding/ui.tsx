// Shared primitives for the Electric Night onboarding funnel.
// Every screen in the canvas repeats the same shell, buttons, inputs and
// keyframe animations — they live here once.
import React, { useEffect, useRef } from 'react';
import {
  Animated, Easing, Platform, Pressable, ScrollView, StyleProp, Text, TextInput,
  TextStyle, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { DIAGONAL, night, nightFonts } from './theme';

/* ── shell ──────────────────────────────────────────────────────────────── */

// The canvas frames every screen with `padding:78px 28px 42px` inside an 874pt
// device. The 78 covers the status bar, so on a real device it's inset + 24.
export function Screen({
  children, style, scroll = true, horizontal = 28,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
  horizontal?: number;
}) {
  const insets = useSafeAreaInsets();
  const pad = {
    paddingTop: Math.max(insets.top, 24) + 24,
    paddingBottom: Math.max(insets.bottom, 20) + 22,
    paddingHorizontal: horizontal,
  };
  if (!scroll) return <View style={[{ flex: 1 }, pad, style]}>{children}</View>;
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ flexGrow: 1 }, pad, style]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export const Spacer = () => <View style={{ flex: 1, minHeight: 20 }} />;

/* ── type ───────────────────────────────────────────────────────────────── */

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[{ fontFamily: nightFonts.display, fontSize: 32, lineHeight: 35, color: night.text }, style]}>
      {children}
    </Text>
  );
}

export function Sub({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[{ fontFamily: nightFonts.body, fontSize: 15, lineHeight: 22.5, color: night.textMuted }, style]}>
      {children}
    </Text>
  );
}

// The small GDPR / reassurance line every data-asking screen ends with.
export function Note({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: nightFonts.body, fontSize: 12, lineHeight: 19.2,
        color: night.textGhost, marginBottom: 14, textAlign: center ? 'center' : 'left',
      }}
    >
      {children}
    </Text>
  );
}

/* ── buttons ────────────────────────────────────────────────────────────── */

// Built per call so the glow follows the active palette.
const glow = (): ViewStyle => (Platform.OS === 'web'
  ? { boxShadow: `0 8px 24px ${night.accentGlow}` } as ViewStyle
  : {
      shadowColor: night.accent, shadowOpacity: 0.3,
      shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8,
    } as ViewStyle);

export function PrimaryButton({
  label, onPress, disabled, style,
}: { label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          height: 54, borderRadius: 27, backgroundColor: night.accent,
          alignItems: 'center', justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.88 : 1,
        },
        glow(),
        style,
      ]}
    >
      <Text style={{ fontFamily: nightFonts.display, fontSize: 16, color: night.accentInk }}>{label}</Text>
    </Pressable>
  );
}

export function OutlineButton({
  label, onPress, style, light,
}: { label: string; onPress: () => void; style?: StyleProp<ViewStyle>; light?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center',
          backgroundColor: light ? night.surface : 'transparent',
          borderWidth: 1.5, borderColor: pressed ? night.borderDashed : night.borderMuted,
        },
        style,
      ]}
    >
      <Text style={{ fontFamily: nightFonts.display, fontSize: 15.5, color: night.text }}>{label}</Text>
    </Pressable>
  );
}

export function TextButton({
  label, onPress, color = night.textSoft, bold, height = 44, style,
}: {
  label: string; onPress: () => void; color?: string; bold?: boolean;
  height?: number; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} style={[{ height, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text
        style={{
          fontFamily: bold ? nightFonts.display : nightFonts.bodyMedium,
          fontSize: bold ? 14.5 : 14, color,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={{
        width: 40, height: 40, borderRadius: 20, backgroundColor: night.surface,
        borderWidth: 1, borderColor: night.hairline, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: night.text, fontSize: 22, lineHeight: 24, marginTop: -3 }}>‹</Text>
    </Pressable>
  );
}

/* ── inputs ─────────────────────────────────────────────────────────────── */

type NightInputProps = React.ComponentProps<typeof TextInput> & { borderColor?: string };

export const NightInput = React.forwardRef<TextInput, NightInputProps>(
  function NightInput({ borderColor, style, onFocus, onBlur, ...props }, ref) {
    const [focused, setFocused] = React.useState(false);
    return (
      <TextInput
        ref={ref}
        placeholderTextColor="rgba(150,160,170,0.55)"
        {...props}
        onFocus={e => { setFocused(true); onFocus?.(e); }}
        onBlur={e => { setFocused(false); onBlur?.(e); }}
        style={[
          {
            height: 52, borderRadius: 16, backgroundColor: night.surface,
            borderWidth: 1.5, borderColor: focused ? night.accent : (borderColor ?? night.border),
            color: night.text, fontFamily: nightFonts.bodyMedium, fontSize: 16,
            paddingHorizontal: 18,
          },
          style,
        ]}
      />
    );
  },
);

// The pill switch used for Email/Phone and for the goal period.
export function Segmented({
  options, value, onChange, height = 38, fontSize = 13.5, style,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  height?: number;
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', gap: 6, backgroundColor: night.surface, borderRadius: 14, padding: 4 },
        style,
      ]}
    >
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={{
              flex: 1, height, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? night.accent : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: nightFonts.display, fontSize,
                color: on ? night.accentInk : night.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Dashed demo affordance ("psst — the code is 424242").
export function DemoChip({
  label, onPress, tone = 'neutral',
}: { label: string; onPress?: () => void; tone?: 'neutral' | 'danger' }) {
  const border = tone === 'danger' ? 'rgba(255,107,107,0.45)' : night.borderDashed;
  const color = tone === 'danger' ? 'rgba(255,107,107,0.8)' : night.textSoft;
  const inner = (
    <View
      style={{
        paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
        borderWidth: 1, borderColor: border, borderStyle: 'dashed', alignSelf: 'flex-start',
      }}
    >
      <Text style={{ fontFamily: nightFonts.mono, fontSize: 12, color }}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{inner}</Pressable> : inner;
}

/* ── avatars ────────────────────────────────────────────────────────────── */

export function GradientCircle({
  size, colors, children, style, borderWidth = 0, borderColor,
}: {
  size: number;
  colors: [string, string];
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  borderWidth?: number;
  borderColor?: string;
}) {
  return (
    <LinearGradient
      colors={colors}
      start={DIAGONAL.start}
      end={DIAGONAL.end}
      style={[
        {
          width: size, height: size, borderRadius: size / 2,
          alignItems: 'center', justifyContent: 'center', borderWidth, borderColor,
        },
        style,
      ]}
    >
      {children}
    </LinearGradient>
  );
}

/* ── animation wrappers (the canvas' @keyframes) ────────────────────────── */

// qpop: scale .4 → 1.08 → 1 with a fade in.
export function Pop({
  children, style, duration = 300,
}: { children: React.ReactNode; style?: StyleProp<ViewStyle>; duration?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1, duration, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true,
    }).start();
  }, [duration, t]);
  return (
    <Animated.View
      style={[
        { opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// qshake: fires whenever `trigger` flips to a new truthy value.
export function Shake({
  trigger, children, style,
}: { trigger: unknown; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const x = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!trigger) return;
    x.setValue(0);
    Animated.sequence(
      [-7, 7, -5, 5, 0].map(to =>
        Animated.timing(x, { toValue: to, duration: 100, easing: Easing.linear, useNativeDriver: true })),
    ).start();
  }, [trigger, x]);
  return <Animated.View style={[{ transform: [{ translateX: x }] }, style]}>{children}</Animated.View>;
}

// qfloat: gentle 7pt bob over 4s, with an optional stagger delay.
export function Float({
  children, delay = 0, style,
}: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const id = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(id); loop.stop(); };
  }, [delay, t]);
  return (
    <Animated.View
      style={[{ transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }] }, style]}
    >
      {children}
    </Animated.View>
  );
}

// qpulse: gentle scale throb for the thinking orb.
export function Pulse({
  children, style,
}: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <Animated.View
      style={[{ transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) }] }, style]}
    >
      {children}
    </Animated.View>
  );
}

// qspin: continuous rotation, optionally reversed.
export function Spin({
  children, duration = 2400, reverse, style,
}: { children: React.ReactNode; duration?: number; reverse?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [duration, t]);
  const rotate = t.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? ['360deg', '0deg'] : ['0deg', '360deg'],
  });
  return <Animated.View style={[{ transform: [{ rotate }] }, style]}>{children}</Animated.View>;
}
