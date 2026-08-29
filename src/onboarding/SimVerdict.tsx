// The simulated verdict (canvas turn 6, "Verdict, earned"): the dial waits
// for the scenario lanes. Runs race a dashed finish as the backend resolves
// them; fails stop cold with a marker; the lanes HOLD until the user taps —
// the probability never arrives uninvited — then settle into a receipt strip
// and the dial fills with the BLENDED number. Tap a receipt bar for that
// run's step-by-step; factors carry kill/carry tags and trace to answers;
// the drawer edits an input and replays everything with a before/after
// delta. Ported to Electric Night tokens (the canvas draws the cream theme
// of the same page).
//
// ONE `phase` ENUM DRIVES EVERYTHING (design handoff sim_verdict_fix):
//   boot → lanes → hold → settle → done, replay loops back to lanes.
// Header label, caption, lane visibility and dial visibility all derive from
// it, so no two parts of the card can ever disagree about what is happening
// — the TestFlight bug was a header saying "done" over lanes stuck at idle.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from 'react-native';
import { night, nightFonts } from './theme';
import { NightInput } from './ui';
import { OddsDial } from './OddsDial';
import type { ScenarioRun, SimulationState } from '../api/coachTypes';

const MONO = 'ui-monospace, Menlo, monospace';
const FAIL = '#E07A6A';           // the canvas' #c96f5f, lifted for night
const AMBER = '#F7B32B';
// The spec's draw curve, verbatim: cubic-bezier(.3,.6,.4,1).
const DRAW_EASING = Easing.bezier(0.3, 0.6, 0.4, 1);

export type SimPhase = 'boot' | 'lanes' | 'hold' | 'settle' | 'done';

/** The header label for a phase — exported so the card header can never
 *  free-hand its own version of the state. */
export function simPhaseLabel(phase: SimPhase): string {
  switch (phase) {
    case 'boot':
    case 'lanes': return 'SIMULATING — TAP TO SKIP';
    case 'hold': return "TAP FOR QOACH'S CALL";
    case 'settle': return '';
    case 'done': return 'TAP DIAL TO REPLAY';
  }
}

/* ── one lane ──────────────────────────────────────────────────────────── */

function Lane({ run, railW, delayMs, snap, onResolved }: {
  run: ScenarioRun;
  railW: number;
  /** Stagger for lanes present at run start (380 + i×250); 0 for lanes that
   *  stream in later — their arrival is their stagger. */
  delayMs: number;
  /** Skip-tap / reduced motion: paint the final state immediately. */
  snap: boolean;
  onResolved: (key: string) => void;
}) {
  // idle → running (undecided ink; hit 1500ms to 100%, fail
  // max(700, 1600×endFrac) to its fraction) → resolved (color earned at
  // resolve: green ✓ pop or red dot + mono marker). Spec 6c timings.
  const anim = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState(false);
  const steps = run.weeks.length || 1;
  const endFrac = run.hit ? 1 : Math.max(0.08, Math.min(0.96, (run.fail_week ?? steps) / steps));
  useEffect(() => {
    if (snap) {
      anim.setValue(endFrac);
      setDone(true);
      onResolved(run.key);
      return;
    }
    const duration = run.hit ? 1500 : Math.max(700, Math.round(1600 * endFrac));
    const t = Animated.timing(anim, {
      toValue: endFrac, duration, delay: delayMs,
      easing: DRAW_EASING, useNativeDriver: false,
    });
    t.start(({ finished }) => {
      // A snap/replay can interrupt the timing — only an actually finished
      // draw resolves here (the snap path resolves itself above).
      if (finished) { setDone(true); onResolved(run.key); }
    });
    return () => t.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);
  const fillColor = done ? (run.hit ? night.accent : FAIL) : night.textFaint;
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(1, railW)] });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, height: 26 }}>
      <Text style={{ width: 70, textAlign: 'right', fontFamily: MONO, fontSize: 8, letterSpacing: 0.6, color: done ? night.textSoft : night.textFaint }}>
        {run.short}
      </Text>
      <View style={{ flex: 1, height: 26, marginRight: 16, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: night.hairline }} />
        <View style={{ position: 'absolute', right: 0, top: 4, bottom: 4, borderLeftWidth: 2, borderStyle: 'dashed', borderLeftColor: night.border }} />
        <Animated.View style={{ position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: fillColor, width }} />
        {done && run.hit ? (
          <Text style={{ position: 'absolute', right: -15, fontFamily: MONO, fontSize: 10, fontWeight: '700', color: night.accent }}>✓</Text>
        ) : null}
        {done && !run.hit ? (
          <>
            <View style={{ position: 'absolute', left: `${endFrac * 100}%`, marginLeft: -3, width: 7, height: 7, borderRadius: 4, backgroundColor: FAIL }} />
            {run.mark ? (
              <Text numberOfLines={1} style={{ position: 'absolute', left: `${Math.min(endFrac, 0.5) * 100}%`, top: -6, maxWidth: '55%', fontFamily: MONO, fontSize: 7.5, letterSpacing: 0.4, color: FAIL }}>
                {run.fail_week ? `${run.weeks.length > 7 ? 'w' : 'd'}${run.fail_week} · ${run.mark}` : run.mark}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

/* ── the block ─────────────────────────────────────────────────────────── */

export function SimVerdict({
  sim, prevSim, editedKey, rubricOdds, sprinting,
  answers, quickPicks, missingRequired,
  onEditInput, onPhase,
}: {
  sim: SimulationState | null;
  prevSim: SimulationState | null;
  editedKey: string | null;
  rubricOdds?: number;
  sprinting?: boolean;
  answers: Record<string, string>;
  quickPicks: Record<string, string[]>;
  missingRequired: string[];
  onEditInput: (key: string, value: string) => void;
  /** The card header derives its right-side label from this — one source. */
  onPhase?: (phase: SimPhase) => void;
}) {
  const [railW, setRailW] = useState(0);
  const [phase, setPhase] = useState<SimPhase>('boot');
  const [runId, setRunId] = useState(0);       // bumps remount lanes for replay
  const [snapAll, setSnapAll] = useState(false); // skip-tap / reduced motion
  const [resolved, setResolved] = useState<Record<string, true>>({});
  const [detail, setDetail] = useState<number>(-1);
  const [factorOpen, setFactorOpen] = useState<number>(-1);
  const [drawer, setDrawer] = useState(false);
  const [drawerSel, setDrawerSel] = useState<Record<string, string>>({});
  const [compare, setCompare] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Stagger applies to lanes already present when a run starts (replay, or a
  // sim that arrives complete via verdict memory); streamed arrivals start
  // at 0 — their arrival is their stagger.
  const staggerKeys = useRef<string[]>([]);
  // Phase-advance timer — in a ref, re-armed only when the driving facts
  // change, cleared on unmount or explicit transition. Never from a plain
  // re-render (design README cause #2: timers killed by lifecycle).
  const phaseT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (alive) setReduceMotion(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => setReduceMotion(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  const lanes = sim?.lanes ?? [];
  const planned = sim?.planned ?? [];
  const running = sim ? sim.status === 'generating' || sim.status === 'simulating' : true;
  const doneStatus = sim?.status === 'done';
  const stepUnit = sim?.granularity === 'days' ? 'D' : 'W';
  const allResolved = lanes.length > 0 && lanes.every(l => resolved[l.key]);
  const snap = snapAll || reduceMotion;

  const onLaneResolved = useCallback((key: string) => {
    setResolved(cur => (cur[key] ? cur : { ...cur, [key]: true }));
  }, []);

  const clearPhaseT = () => { if (phaseT.current) { clearTimeout(phaseT.current); phaseT.current = null; } };

  // ── the machine ──
  // boot → lanes: first lane data has arrived and the rail is measured
  // (README cause #4 — never animate toward an unmeasured width).
  useEffect(() => {
    if (phase === 'boot' && lanes.length > 0 && railW > 0) {
      staggerKeys.current = lanes.map(l => l.key);
      setPhase('lanes');
    }
  }, [phase, lanes.length, railW, lanes]);
  // lanes → hold: 500ms after the last lane resolves (420ms after a skip);
  // reduced motion goes immediately.
  useEffect(() => {
    if (phase === 'lanes' && doneStatus && allResolved) {
      clearPhaseT();
      if (reduceMotion) { setPhase('hold'); return; }
      phaseT.current = setTimeout(() => setPhase('hold'), snapAll ? 420 : 500);
    }
    return undefined;
  }, [phase, doneStatus, allResolved, snapAll, reduceMotion]);
  // settle → done: lanes fade 450ms, dial 470ms later.
  useEffect(() => {
    if (phase === 'settle') {
      clearPhaseT();
      if (reduceMotion) { fade.setValue(0); setPhase('done'); return; }
      Animated.timing(fade, { toValue: 0, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
      phaseT.current = setTimeout(() => setPhase('done'), 470);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduceMotion]);
  // A re-run (pace switch / drawer edit) cleared the sim: reset the theater.
  useEffect(() => {
    if (running && phase !== 'boot') {
      clearPhaseT();
      fade.setValue(1);
      setPhase('boot'); setRunId(r => r + 1); setSnapAll(false); setResolved({}); setDetail(-1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  useEffect(() => () => clearPhaseT(), []); // unmount only
  useEffect(() => { onPhase?.(phase); }, [phase, onPhase]);

  /** The stage tap — the spec's whole interaction model. */
  const onStageTap = () => {
    if (phase === 'lanes') { setSnapAll(true); return; }              // skip
    if (phase === 'hold') { setDetail(-1); setPhase('settle'); return; } // Qoach's call
    if (phase === 'done') {                                            // replay
      clearPhaseT();
      fade.setValue(1);
      staggerKeys.current = lanes.map(l => l.key);
      setSnapAll(false); setResolved({}); setDetail(-1); setRunId(r => r + 1);
      setPhase('lanes');
    }
  };

  const hits = lanes.filter(l => l.hit && !l.invalid).length;
  const valid = lanes.filter(l => !l.invalid).length;
  const blended = sim?.odds?.blended;
  const rubric = sim?.odds?.rubric ?? rubricOdds;
  const hasContingency = lanes.some(l => l.cg);

  const judge = useMemo(() => {
    if (phase === 'boot' || phase === 'lanes' || running) {
      return `Running ${planned.length || 6} honest futures of your plan — the dial waits for them.`;
    }
    if (phase === 'hold' || phase === 'settle') {
      return `${hits} of ${valid} land. Take your time with the lanes — tap when you're ready for Qoach's call.`;
    }
    const worst = lanes.find(l => !l.hit && !l.invalid);
    let why = worst?.first_failure_reason ? worst.first_failure_reason.split('—')[0].trim() : '';
    if (why.length > 110) why = why.slice(0, why.lastIndexOf(' ', 110)) + '…';
    return `${hits} of ${valid} land. Judged ${blended}, not ${rubric}${why ? ` — ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ''}${why.endsWith('…') ? '' : '.'}`;
  }, [phase, running, hits, valid, blended, rubric, lanes, planned.length]);

  // Factors from the sim, decorated with kill/carry tags + trace + linkage.
  const factors = useMemo(() => {
    const fs = sim?.factors ?? [];
    return fs.map(f => {
      const killed = lanes.filter(l => !l.hit && !l.invalid && l.first_failure_key === f.key);
      const tag = f.direction === 'down'
        ? `failed ${killed.length} of ${valid}`
        : `carried ${hits} of ${valid}`;
      const linked = killed.map(l => l.short).join(', ');
      return { ...f, tag, linked };
    });
  }, [sim?.factors, lanes, valid, hits]);

  const fmtVal = (v: number) => {
    const u = sim?.state_unit ?? '';
    const n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : Math.round(v * 10) / 10;
    return u.startsWith('$') || u.includes('$') ? `$${n}` : `${n}`;
  };

  useEffect(() => { if (detail >= lanes.length) setDetail(-1); }, [detail, lanes.length]);
  const det = detail >= 0 && detail < lanes.length ? lanes[detail] : null;
  const detPts = useMemo(() => {
    if (!det) return [];
    const w = det.weeks;
    if (w.length <= 4) return w;
    // The canvas shows notable points: first, eventful, fail, last.
    const idx = new Set<number>([0, w.length - 1]);
    if (det.fail_week) idx.add(Math.min(w.length - 1, det.fail_week - 1));
    w.forEach((p, i) => { if (p.event) idx.add(i); });
    return [...idx].sort((a, b) => a - b).slice(0, 4).map(i => w[i]);
  }, [det]);

  return (
    <View>
      {/* the race / the dial — one tappable stage, phase-driven */}
      <Pressable
        onPress={onStageTap}
        style={{ height: 238, justifyContent: 'center' }}
        onLayout={e => setRailW(Math.max(0, e.nativeEvent.layout.width - 95 - 16))}
      >
        {phase !== 'done' ? (
          <Animated.View style={{ gap: 6, opacity: fade }}>
            {(planned.length ? planned : Array.from({ length: 6 }, (_, i) => ({ key: String(i), name: '', short: '·' }))).map(p => {
              const run = lanes.find(l => l.key === p.key);
              const si = staggerKeys.current.indexOf(p.key);
              return run && phase !== 'boot' && railW > 0 ? (
                <Lane
                  key={`${runId}-${p.key}`}
                  run={run}
                  railW={railW}
                  delayMs={si >= 0 ? 380 + si * 250 : 0}
                  snap={snap}
                  onResolved={onLaneResolved}
                />
              ) : (
                <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, height: 26 }}>
                  <Text style={{ width: 70, textAlign: 'right', fontFamily: MONO, fontSize: 8, letterSpacing: 0.6, color: night.textGhost }}>{p.short}</Text>
                  <View style={{ flex: 1, height: 26, marginRight: 16, justifyContent: 'center' }}>
                    <View style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: night.hairline }} />
                    <View style={{ position: 'absolute', right: 0, top: 4, bottom: 4, borderLeftWidth: 2, borderStyle: 'dashed', borderLeftColor: night.border }} />
                  </View>
                </View>
              );
            })}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 79, paddingRight: 16 }}>
              <Text style={{ fontFamily: MONO, fontSize: 7.5, color: night.textGhost }}>{stepUnit}1</Text>
              <Text style={{ fontFamily: MONO, fontSize: 7.5, color: night.textGhost }}>{stepUnit}{sim?.steps ?? ''} · TARGET</Text>
            </View>
          </Animated.View>
        ) : (
          <View style={{ alignItems: 'center' }}>
            <OddsDial
              value={blended ?? rubric ?? 75}
              color={sprinting ? night.warn : night.accent}
              condLabel={sprinting ? 'IF YOU GO ALL-IN' : 'IF YOU SHOW UP'}
              size={236}
              onPress={onStageTap}
            />
          </View>
        )}
      </Pressable>

      {/* receipt strip */}
      {phase === 'done' ? (
        <View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            {lanes.map((l, i) => (
              <Pressable
                key={l.key}
                onPress={() => setDetail(cur => (cur === i ? -1 : i))}
                style={{
                  width: 22, height: 8, borderRadius: 4,
                  backgroundColor: l.invalid ? night.hairline : l.hit ? night.accent : FAIL,
                  borderWidth: 2, borderColor: detail === i ? night.text : 'transparent',
                }}
              />
            ))}
          </View>
          <Text style={{ marginTop: 7, textAlign: 'center', fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.6, color: det ? (det.hit ? night.accentText : FAIL) : night.textFaint }}>
            {det
              ? `${det.short} — ${det.hit ? 'LANDS' : (det.mark ?? 'FAILS').toUpperCase()}`
              : `${hits} OF ${valid} LAND · TAP A RUN FOR ITS ${sim?.granularity === 'days' ? 'DAYS' : 'WEEKS'}`}
          </Text>
        </View>
      ) : null}

      {/* re-run delta + compare */}
      {phase === 'done' && prevSim?.odds && sim?.odds && editedKey ? (
        <View style={{ marginTop: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
            <Text style={{ fontFamily: nightFonts.display, fontSize: 15, color: night.textFaint, textDecorationLine: 'line-through' }}>{prevSim.odds.blended}</Text>
            <Text style={{ fontFamily: nightFonts.display, fontSize: 13, color: night.accent }}>→</Text>
            <Text style={{ fontFamily: nightFonts.display, fontSize: 17, color: night.accent }}>{sim.odds.blended}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.6, color: night.textMuted }}>CHANGED: {editedKey.toUpperCase()}</Text>
            <Pressable onPress={() => setCompare(c => !c)} style={{ borderWidth: 1, borderColor: night.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.6, color: night.textSoft }}>{compare ? 'HIDE' : 'COMPARE'}</Text>
            </Pressable>
          </View>
          {compare ? (
            <View style={{ marginTop: 9, padding: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: night.hairline, borderRadius: 12, gap: 7 }}>
              {[{ lab: 'BEFORE', s: prevSim, op: 0.45 }, { lab: 'AFTER', s: sim, op: 1 }].map(row => (
                <View key={row.lab} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <Text style={{ width: 76, fontFamily: MONO, fontSize: 8, letterSpacing: 0.6, color: night.textMuted }}>{row.lab} · {row.s.odds?.blended}</Text>
                  <View style={{ flexDirection: 'row', gap: 5, opacity: row.op }}>
                    {row.s.lanes.map(l => (
                      <View key={l.key} style={{ width: 16, height: 6, borderRadius: 3, backgroundColor: l.hit ? night.accent : FAIL }} />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* judge line */}
      <View style={{ minHeight: 40, justifyContent: 'center', paddingTop: 6 }}>
        <Text style={{ textAlign: 'center', fontFamily: nightFonts.body, fontSize: 12.5, lineHeight: 18, color: night.textSoft }}>{judge}</Text>
      </View>

      {/* run detail */}
      {phase === 'done' && det ? (
        <View style={{ marginTop: 10, backgroundColor: night.surface, borderWidth: 1, borderColor: det.hit ? night.accentFaint : 'rgba(224,122,106,0.4)', borderRadius: 16, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 0.8, color: night.text, fontWeight: '700' }}>{det.short}</Text>
            <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: det.hit ? night.accentSoft : 'rgba(224,122,106,0.15)' }}>
              <Text style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 0.8, fontWeight: '700', color: det.hit ? night.accentText : FAIL }}>{det.hit ? 'LANDS' : 'FAILS'}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setDetail(-1)} hitSlop={8}><Text style={{ color: night.textFaint, fontSize: 14 }}>×</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
            {detPts.map(pt => (
              <View key={pt.week} style={{ flexGrow: 1, flexBasis: '22%', minWidth: 74, borderWidth: 1, borderColor: pt.event ? 'rgba(247,179,43,0.35)' : night.hairline, borderRadius: 11, padding: 8 }}>
                <Text style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 0.6, color: night.textMuted, fontWeight: '700' }}>{stepUnit}{pt.week}</Text>
                <Text style={{ marginTop: 3, fontFamily: nightFonts.display, fontSize: 13, color: night.text }}>{fmtVal(pt.state_value)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }}>
                  <View style={{ width: 26, height: 3, borderRadius: 2, backgroundColor: night.hairline }}>
                    <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: pt.adherence >= 0.7 ? night.accent : AMBER, width: `${Math.round(pt.adherence * 100)}%` }} />
                  </View>
                  <Text style={{ fontFamily: MONO, fontSize: 7.5, color: night.textFaint, flexShrink: 1 }}>{Math.round(pt.adherence * 100)}%</Text>
                </View>
                {pt.event ? (
                  <Text numberOfLines={2} style={{ marginTop: 5, fontFamily: MONO, fontSize: 8.5, lineHeight: 12, color: det.hit ? night.textSoft : FAIL }}>{pt.event}</Text>
                ) : null}
              </View>
            ))}
          </View>
          {det.first_failure_reason ? (
            <Text style={{ marginTop: 10, fontFamily: nightFonts.body, fontSize: 12, lineHeight: 17, color: night.textSoft }}>{det.first_failure_reason}</Text>
          ) : null}
          {det.cg ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: night.hairline }}>
              <Text style={{ color: AMBER, fontSize: 10 }}>⚑</Text>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.6, color: night.textSoft }}>ANSWERED IN THE PLAN · FIRST-SLIP PROTOCOL</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* factors */}
      {phase === 'done' && factors.length > 0 ? (
        <View style={{ marginTop: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 4 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.6, color: night.textMuted, fontWeight: '700' }}>WHAT MOVES THE NUMBER</Text>
            <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.5, color: night.textGhost }}>FROM THE RUNS</Text>
          </View>
          {factors.map((f, i) => (
            <View key={f.key} style={{ backgroundColor: night.surface, borderWidth: 1, borderColor: factorOpen === i ? night.border : night.hairline, borderRadius: 14, overflow: 'hidden' }}>
              <Pressable onPress={() => setFactorOpen(cur => (cur === i ? -1 : i))} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 }}>
                <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: f.direction === 'down' ? FAIL : night.accentText }}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={{ flex: 1, fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.text }}>{f.key.replace(/_/g, ' ')}</Text>
                <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.5, color: f.direction === 'down' ? FAIL : night.accentText }}>{f.tag}</Text>
              </Pressable>
              {factorOpen === i ? (
                <View style={{ paddingHorizontal: 13, paddingBottom: 12, paddingLeft: 38 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.7, color: night.textMuted }}>FROM: {f.key.toUpperCase()}{f.linked ? ` · KILLS ${f.linked}` : ''}</Text>
                </View>
              ) : null}
            </View>
          ))}
          {hasContingency ? (
            <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(247,179,43,0.4)', borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ color: AMBER, fontSize: 11 }}>⚑</Text>
              <Text style={{ flex: 1, fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.text }}>First-slip protocol — built from the failed runs</Text>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.5, color: AMBER }}>IN THE PLAN</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* drawer trigger */}
      {phase === 'done' && Object.keys(answers).length > 0 ? (
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          <Pressable onPress={() => setDrawer(true)} style={{ borderWidth: 1, borderColor: night.border, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.8, color: night.textSoft }}>CHANGE AN INPUT →</Text>
          </Pressable>
        </View>
      ) : null}

      {/* the inputs drawer */}
      {drawer ? (
        <View style={{ marginTop: 12, backgroundColor: night.surfaceDeep, borderWidth: 1, borderColor: night.hairline, borderRadius: 18, padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.6, color: night.textMuted, fontWeight: '700' }}>YOUR INPUTS</Text>
            <Pressable onPress={() => setDrawer(false)} hitSlop={8}><Text style={{ color: night.textFaint, fontSize: 15 }}>×</Text></Pressable>
          </View>
          <Text style={{ marginTop: 6, fontFamily: nightFonts.body, fontSize: 12, lineHeight: 17, color: night.textSoft }}>
            The verdict is built from these. Edit one and Qoach re-runs the futures — about half a minute.
          </Text>
          <View style={{ marginTop: 12, gap: 10 }}>
            {Object.entries(answers).map(([key, val]) => {
              const sel = drawerSel[key];
              const assumed = missingRequired.includes(key);
              return (
                <View key={key} style={{ borderWidth: 1, borderColor: sel ? night.accentBorder : night.hairline, borderRadius: 14, padding: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.8, color: night.textMuted }}>{key.replace(/_/g, ' ').toUpperCase()}</Text>
                    {assumed ? (
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(247,179,43,0.4)' }}>
                        <Text style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: 0.7, color: AMBER, fontWeight: '700' }}>ASSUMED</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ marginTop: 4, fontFamily: nightFonts.display, fontSize: 13, color: night.text }}>{sel ?? val}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                    {(quickPicks[key] ?? []).map(pick => (
                      <Pressable key={pick} onPress={() => setDrawerSel(cur => ({ ...cur, [key]: pick }))} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: sel === pick ? night.accentBorder : night.hairline, backgroundColor: sel === pick ? night.accentSoft : 'transparent' }}>
                        <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 11, color: night.text }}>{pick}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <NightInput
                    value={sel && !(quickPicks[key] ?? []).includes(sel) ? sel : ''}
                    onChangeText={t => setDrawerSel(cur => ({ ...cur, [key]: t }))}
                    placeholder="Or type the real value"
                    style={{ marginTop: 8, height: 38, fontSize: 12 }}
                  />
                  {sel && sel.trim() && sel !== val ? (
                    <Pressable
                      onPress={() => { setDrawer(false); setDrawerSel({}); onEditInput(key, sel.trim()); }}
                      style={{ marginTop: 9, height: 38, borderRadius: 11, backgroundColor: night.accent, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.8, color: night.accentInk, fontWeight: '700' }}>↻ RE-RUN · {key.replace(/_/g, ' ').toUpperCase()}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
          <Text style={{ marginTop: 12, fontFamily: MONO, fontSize: 8.5, lineHeight: 13, letterSpacing: 0.5, color: night.textGhost }}>
            RE-RUNS REDRAW THE LANES — THE DIAL WAITS FOR THEM. NOTHING HERE IS A POPULATION STAT.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
