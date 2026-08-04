import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

// Mirrors the design's `hdUp` entrance (fade + 14px rise).
export default function FadeInUp({ children, style, distance = 14, duration = 320 }: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  distance?: number;
  duration?: number;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration, useNativeDriver: true }).start();
  }, [t, duration]);
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
