// Confetti salute for the day-done beat, ported from the Qleck Today canvas'
// <canvas> particle system onto RN Animated so it runs on web AND native:
// two corner cannons plus a center pop, gravity/drag physics precomputed into
// interpolation keyframes driven by one progress value per burst.
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

// The canvas' palette: greens, slate blues, terracotta, gold, umber.
const COLORS = ['#47694f', '#6fbf8f', '#4d5680', '#8fa3d9', '#c96f5f', '#e0b64e', '#8a5f38'];

const FRAMES = 200;        // ~3.3s at 60fps, matches the canvas ttl range
const SAMPLE_EVERY = 10;   // 21 keyframes per particle
const DURATION_MS = 3300;

interface Particle {
  color: string;
  w: number;
  h: number;
  round: boolean;
  xs: number[];
  ys: number[];
  rots: string[];
  fadeAt: number; // progress fraction where the particle is fully faded
}

interface Burst {
  id: number;
  particles: Particle[];
  progress: Animated.Value;
}

// Canvas physics verbatim: gravity .3/frame, drag .988, spin, flutter → spin.
function makeParticle(x: number, y: number, a0: number, a1: number, sp: number): Particle {
  const a = a0 + Math.random() * (a1 - a0);
  let vx = Math.cos(a) * sp * (0.55 + Math.random() * 0.75);
  let vy = Math.sin(a) * sp * (0.55 + Math.random() * 0.75);
  let rot = Math.random() * Math.PI;
  const vr = (Math.random() - 0.5) * 0.3;
  const ttl = 140 + Math.random() * 60;
  const xs: number[] = [], ys: number[] = [], rots: string[] = [];
  for (let f = 0; f <= FRAMES; f++) {
    if (f % SAMPLE_EVERY === 0) {
      xs.push(x);
      ys.push(y);
      rots.push(`${rot.toFixed(3)}rad`);
    }
    vy += 0.3;
    vx *= 0.988;
    vy *= 0.988;
    x += vx;
    y += vy;
    rot += vr;
  }
  return {
    color: COLORS[(Math.random() * COLORS.length) | 0],
    w: 5 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    round: Math.random() < 0.25,
    xs, ys, rots,
    fadeAt: Math.min(1, ttl / FRAMES),
  };
}

function makeBurst(width: number, height: number): Particle[] {
  const parts: Particle[] = [];
  const cannon = (x: number, y: number, n: number, a0: number, a1: number, sp: number) => {
    for (let i = 0; i < n; i++) parts.push(makeParticle(x, y, a0, a1, sp));
  };
  cannon(width * 0.08, height + 10, 32, -1.35, -0.75, 21); // left cannon, up-right
  cannon(width * 0.92, height + 10, 32, -2.4, -1.8, 21);   // right cannon, up-left
  cannon(width * 0.5, height * 0.3, 20, 0, Math.PI * 2, 7); // pop near the banner
  return parts;
}

export interface ConfettiHandle {
  fire: () => void;
}

/** Absolute-fill, touch-transparent overlay. Call `.fire()` on the ref. */
const Confetti = forwardRef<ConfettiHandle>(function Confetti(_props, ref) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const size = useRef({ width: 0, height: 0 });
  const nextId = useRef(1);

  useImperativeHandle(ref, () => ({
    fire: () => {
      // onLayout can lag (or not re-fire across hot reloads); the overlay is
      // screen-sized, so the window is always a valid fallback anchor.
      let { width, height } = size.current;
      if (width < 40 || height < 40) ({ width, height } = Dimensions.get('window'));
      if (width < 40 || height < 40) return;
      const burst: Burst = {
        id: nextId.current++,
        particles: makeBurst(width, height),
        progress: new Animated.Value(0),
      };
      setBursts(prev => [...prev, burst]);
      Animated.timing(burst.progress, {
        toValue: 1, duration: DURATION_MS, easing: Easing.linear, useNativeDriver: true,
      }).start(() => setBursts(prev => prev.filter(b => b.id !== burst.id)));
    },
  }), []);

  const inputRange = Array.from({ length: FRAMES / SAMPLE_EVERY + 1 }, (_, i) => i / (FRAMES / SAMPLE_EVERY));

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { zIndex: 50, overflow: 'hidden' }]}
      onLayout={e => { size.current = e.nativeEvent.layout; }}
    >
      {bursts.map(b =>
        b.particles.map((p, i) => (
          <Animated.View
            key={`${b.id}:${i}`}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: p.w, height: p.round ? p.w : p.h,
              borderRadius: p.round ? p.w / 2 : 1,
              backgroundColor: p.color,
              opacity: b.progress.interpolate({
                inputRange: [0, p.fadeAt * 0.65, p.fadeAt],
                outputRange: [1, 1, 0],
                extrapolate: 'clamp',
              }),
              transform: [
                { translateX: b.progress.interpolate({ inputRange, outputRange: p.xs }) },
                { translateY: b.progress.interpolate({ inputRange, outputRange: p.ys }) },
                { rotate: b.progress.interpolate({ inputRange, outputRange: p.rots }) },
              ],
            }}
          />
        )),
      )}
    </View>
  );
});

export default Confetti;
