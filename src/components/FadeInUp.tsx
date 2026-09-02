import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

// Mirrors the design's `hdUp` entrance (fade + 14px rise).
export default function FadeInUp({ children, style, distance = 14, duration = 320, delay = 0 }: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  distance?: number;
  duration?: number;
  /** Stagger a list: row i starts at `delay` ms. */
  delay?: number;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration, delay, useNativeDriver: true }).start();
  }, [t, duration, delay]);
  return (
    <Animated.View
      style={[style, {
        opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
}
