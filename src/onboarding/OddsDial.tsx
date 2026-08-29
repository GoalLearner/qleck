// The odds dial — canvas turn 5 ("Success odds — Qoach's call, on a dial"),
// ported from Qleck Coach.dc.html onto react-native-svg.
//
// A 240° arc sweeps to the verdict's success_probability while the number
// counts up; the adherence conditional is welded under the digit; tapping
// replays the sweep. The same animation drives three sizes: the big verdict
// dial, the phone variant, and the small echo chip on the protocol header.
//
// The canvas normalised the arc with pathLength=100 and CSS transitions;
// react-native-svg has neither, so the real arc length is computed (r=84,
// 240° → 351.86 units) and a JS ticker drives both the dash offset and the
// counting number — one clock, so they can never drift apart.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { night, nightFonts } from './theme';

const ARC_D = 'M 27.25 144 A 84 84 0 1 1 172.75 144';
const ARC_LEN = 351.86; // 240° of an r=84 circle
const MONO = nightFonts.mono;

/** One clock for arc and digit: eased 0→target, replayable, flip-aware. */
function useSweep(target: number) {
  const [shown, setShown] = useState(0);
  const cur = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const animate = useCallback((to: number, dur: number) => {
    if (timer.current) clearInterval(timer.current);
    const from = cur.current;
    const t0 = Date.now();
    timer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      const v = from + (to - from) * e;
      cur.current = v;
      setShown(v);
      if (p >= 1 && timer.current) clearInterval(timer.current);
    }, 28);
  }, []);

  // Initial mount sweeps from zero; a changed target (the counter-offer pill
  // flip) sweeps from wherever the dial currently sits, slightly quicker.
  useEffect(() => {
    animate(target, cur.current === 0 ? 1500 : 1200);
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const replay = useCallback(() => {
    cur.current = 0;
    setShown(0);
    animate(target, 1500);
  }, [animate, target]);

  return { shown, replay };
}

export function OddsDial({
  value, color, condLabel, size = 300, showTicks = true, onPress,
}: {
  value: number;
  color: string;
  condLabel: string;
  size?: number;
  showTicks?: boolean;
  /** Override the tap. The simulated verdict passes its full lane replay —
   *  without this the dial's own sweep-replay swallows the press and the
   *  spec's "tap dial to replay" never reaches the lanes. */
  onPress?: () => void;
}) {
  const { shown, replay } = useSweep(value);
  const h = size * 0.81; // viewBox 200×162
  return (
    <Pressable onPress={onPress ?? replay} style={{ alignSelf: 'center' }}>
      <Svg width={size} height={h} viewBox="0 0 200 162">
        <Path d={ARC_D} fill="none" stroke={night.hairline} strokeWidth={12} strokeLinecap="round" />
        <Path
          d={ARC_D}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LEN}`}
          strokeDashoffset={ARC_LEN * (1 - shown / 100)}
        />
        {showTicks ? (
          <>
            <SvgText x="27.25" y="160" textAnchor="middle" fontSize="8.5" fontFamily={MONO} fill={night.textGhost}>0</SvgText>
            <SvgText x="172.75" y="160" textAnchor="middle" fontSize="8.5" fontFamily={MONO} fill={night.textGhost}>100</SvgText>
          </>
        ) : null}
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: h,
          alignItems: 'center', justifyContent: 'center', paddingTop: size * 0.21,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
          <Text style={{ fontFamily: nightFonts.display, fontSize: size * 0.175, lineHeight: size * 0.18, color: night.text, letterSpacing: -1 }}>
            {Math.round(shown)}
          </Text>
          <Text style={{ fontFamily: nightFonts.display, fontSize: size * 0.076, color: night.textGhost }}>%</Text>
        </View>
        <View style={{ marginTop: 7, paddingTop: 7, borderTopWidth: 1.5, borderTopColor: `${color}59` }}>
          <Text style={{ fontFamily: MONO, fontSize: size * 0.033, fontWeight: '700', letterSpacing: 2.2, color }}>
            {condLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** 5d — the echo chip: the verdict number rides along to the protocol header. */
export function OddsChip({ value }: { value: number }) {
  const { shown, replay } = useSweep(value);
  return (
    <Pressable
      onPress={replay}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 7,
        paddingVertical: 5, paddingLeft: 8, paddingRight: 12, borderRadius: 999,
        backgroundColor: night.surface, borderWidth: 1, borderColor: night.accentBorder,
      }}
    >
      <Svg width={21} height={17} viewBox="0 0 200 162">
        <Path d={ARC_D} fill="none" stroke={night.hairline} strokeWidth={22} strokeLinecap="round" />
        <Path
          d={ARC_D}
          fill="none"
          stroke={night.accent}
          strokeWidth={22}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LEN}`}
          strokeDashoffset={ARC_LEN * (1 - shown / 100)}
        />
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 14, color: night.text }}>{Math.round(shown)}</Text>
        <Text style={{ fontFamily: nightFonts.display, fontSize: 10, color: night.textGhost }}>%</Text>
      </View>
      <View style={{ width: 1, height: 12, backgroundColor: night.borderMuted }} />
      <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.3, color: night.accent }}>
        IF YOU SHOW UP
      </Text>
    </Pressable>
  );
}
