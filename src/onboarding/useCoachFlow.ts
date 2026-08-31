// Client state machine for the Qoach intake conversation (ROADMAP.md P1).
// Mirrors the server's session states — the server is authoritative (turn
// caps, safety, validation); this hook only tracks what to render.
//
// intake → thinking → question (3-5, server-enforced) → verdict → building →
// protocol; refusal / error can land from any AI step. The designed canvas
// screens will render these states; until then plain screens do.
import { useCallback, useEffect, useRef, useState } from 'react';
import { answerCoachQuestion, generateProtocol, getSimulation, postAnswer, prepareSimulation, priceCustomPace, repriceProtocol, startCoachSession } from '../api/coach';
import type { PaceKey, ProtocolResponse, SimulationState, StepAssumption } from '../api/coachTypes';
import {
  CoachApiError, type CoachError, type CoachQuestion, type CoachRefusal,
  type CoachTurnResponse, type Protocol, type Verdict,
} from '../api/coachTypes';

export type CoachPhase =
  | 'intake'      // typing the goal
  | 'thinking'    // waiting on session-start / answer
  | 'question'    // Qoach asked something
  | 'verdict'     // feasible or counter-offer on screen
  | 'building'    // waiting on protocol generation
  | 'rebuilding'  // regenerating after an assumption was corrected
  | 'protocol'    // plan on screen
  | 'refused'     // safety refusal / decline
  | 'error';      // normalized failure, maybe retryable

export interface AcceptedPlan {
  /** The coach session that built this plan — links the server's
   *  goal_outcomes calibration row to the real goal. */
  coachSessionId?: string;
  goalText: string;        // what the user typed
  statement: string;       // what the coach accepted
  durationWeeks: number;
  /** The chosen pace's success_probability, when the verdict carried one. */
  odds?: number;
  protocol: Protocol;
}

/** One clarify round, for rendering the conversation as a thread. */
export interface QaEntry {
  question: CoachQuestion;
  answer?: string;
}

export function useCoachFlow() {
  const [phase, setPhase] = useState<CoachPhase>('intake');
  const [goalText, setGoalText] = useState('');
  const [question, setQuestion] = useState<CoachQuestion | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [qa, setQa] = useState<QaEntry[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [refusal, setRefusal] = useState<CoachRefusal | null>(null);
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  // The assumption layer (owner spec): which steps rest on assumed values,
  // which manifest keys the user can supply, and the quick-picks for them.
  const [assumptions, setAssumptions] = useState<StepAssumption[]>([]);
  const [quickPicks, setQuickPicks] = useState<Record<string, string[]>>({});
  const [missingRequired, setMissingRequired] = useState<string[]>([]);
  const [verdictAnswers, setVerdictAnswers] = useState<Record<string, string>>({});
  // 2c: the simulation state the verdict page animates from. Polled while
  // the verdict is on screen; a re-run (input edit / pace switch) keeps the
  // previous state for the before/after delta.
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [prevSim, setPrevSim] = useState<SimulationState | null>(null);
  const [editedKey, setEditedKey] = useState<string | null>(null);
  const pollNonce = useRef(0);
  const [pollTick, setPollTick] = useState(0);

  const captureAssumptions = (res: ProtocolResponse) => {
    setAssumptions(res.assumptions ?? []);
    setQuickPicks(res.quick_picks ?? {});
  };
  const [error, setError] = useState<CoachError | null>(null);

  const sessionId = useRef<string | null>(null);
  // What to re-run when the user taps Retry after a retryable error.
  const retryAction = useRef<(() => void) | null>(null);

  const fail = useCallback((err: unknown, retry: () => void) => {
    const info: CoachError = err instanceof CoachApiError
      ? err.info
      : { kind: 'unavailable', retryable: true, message: 'Something went sideways — try again.' };
    retryAction.current = info.retryable ? retry : null;
    setError(info);
    setPhase('error');
  }, []);

  const handleTurn = useCallback((res: CoachTurnResponse) => {
    sessionId.current = res.sessionId;
    if (res.type === 'question') {
      setQuestion(res.question);
      setQuestionCount(n => n + 1);
      setQa(prev => [...prev, { question: res.question }]);
      setPhase('question');
    } else if (res.type === 'verdict') {
      setVerdict(res.verdict);
      setMissingRequired(res.missing_required ?? []);
      setVerdictAnswers(res.answers ?? {});
      if (res.quick_picks) setQuickPicks(res.quick_picks);
      setPhase('verdict');
    } else {
      setRefusal(res.refusal);
      setPhase('refused');
    }
  }, []);

  // Tier-2: whether this session is an own-plan REVIEW (the user brought
  // their plan; Qoach priced it) — flips the verdict/reveal copy.
  const [ownPlanMode, setOwnPlanMode] = useState(false);

  const submitGoal = useCallback((text: string, ownPlan?: string) => {
    const goal = text.trim();
    if (!goal) return;
    const plan = ownPlan?.trim() || undefined;
    setGoalText(goal);
    setOwnPlanMode(!!plan);
    setPhase('thinking');
    startCoachSession(goal, plan).then(handleTurn, err => fail(err, () => submitGoal(goal, plan)));
  }, [fail, handleTurn]);

  const answerQuestion = useCallback((answer: string) => {
    const a = answer.trim();
    const id = sessionId.current;
    if (!a || !id) return;
    setQa(prev => prev.map((entry, i) => (i === prev.length - 1 ? { ...entry, answer: a } : entry)));
    setPhase('thinking');
    answerCoachQuestion(id, a).then(handleTurn, err => fail(err, () => answerQuestion(a)));
  }, [fail, handleTurn]);

  // Which pace the user picked on the verdict screen. Steady is the coach's
  // recommendation and the default; the choice re-times protocol generation
  // and decides which odds the reveal chip carries.
  const [pace, setPace] = useState<PaceKey>('steady');

  // Which side of a counter-offer got built: Qoach's version (default) or
  // the user's ORIGINAL ask (the 20%+ attempt the owner granted them).
  const [variant, setVariant] = useState<'offer' | 'original'>('offer');

  const buildPlan = useCallback(() => {
    const id = sessionId.current;
    if (!id) return;
    setVariant('offer');
    setPickedOdds(null);
    setPhase('building');
    generateProtocol(id, pace).then(
      res => { setProtocol(res.protocol); captureAssumptions(res); setPhase('protocol'); },
      err => fail(err, buildPlan),
    );
  }, [fail, pace]);

  // Tier-1B: the commitment picker's repriced odds — dropping commitments
  // before locking can only lower the number, and this is where the lowered
  // number lives (the lock and the reveal chip both prefer it).
  const [pickedOdds, setPickedOdds] = useState<number | null>(null);
  const repriceWithDrops = useCallback((ids: string[]): Promise<{ refused: { step_id: string; reason: string }[] } | null> => {
    const id = sessionId.current;
    if (!id || !ids.length) return Promise.resolve(null);
    return repriceProtocol(id, ids)
      .then(res => {
        if (res.protocol && typeof res.odds === 'number') {
          setProtocol(res.protocol);
          setPickedOdds(res.odds);
        }
        return { refused: res.refused ?? [] };
      })
      .catch(() => null);
  }, []);

  /** The attempt: build the ORIGINAL ask, eyes open. Server enforces the
   *  20% floor; this only exists on counter-offers that clear it. */
  const buildOriginal = useCallback(() => {
    const id = sessionId.current;
    if (!id) return;
    setVariant('original');
    setPickedOdds(null);
    setPhase('building');
    generateProtocol(id, undefined, 'original').then(
      res => { setProtocol(res.protocol); captureAssumptions(res); setPhase('protocol'); },
      err => fail(err, buildOriginal),
    );
  }, [fail]);

  /** "Assumed ~170 lb — fix": supply the real value, rebuild the protocol.
   *  The server clears the stored plan, so the regeneration derives every
   *  dependent number from the corrected key. */
  const fixAssumption = useCallback((key: string, value: string) => {
    const id = sessionId.current;
    if (!id || !value.trim()) return;
    setPhase('rebuilding');
    setPickedOdds(null);
    postAnswer(id, key, value.trim())
      .then(() => generateProtocol(id))
      .then(
        res => { setProtocol(res.protocol); captureAssumptions(res); setPhase('protocol'); },
        err => fail(err, () => fixAssumption(key, value)),
      );
  }, [fail]);

  // Poll the simulation while a verdict is showing.
  //
  // FIELD LESSON (build 5, the owner's frozen skeletons): the loop must be
  // UNKILLABLE while the verdict is on screen. The old shape bumped the
  // nonce to kill the live loop the instant a pace pill was tapped, and only
  // a SUCCESSFUL prepare restarted it — one backgrounded tap (taking a
  // screenshot, switching apps) lost the POST and left dead polling under
  // eternal skeletons. Now the nonce only discards STALE RESPONSES; the loop
  // itself never stops except on done/failed (and every re-run remounts it
  // via pollTick, bumped in `finally`, success or not).
  const paceRef = useRef(pace);
  paceRef.current = pace;
  const healTries = useRef(0);
  const healing = useRef(false);
  useEffect(() => {
    if (phase !== 'verdict') return;
    const id = sessionId.current;
    if (!id) return;
    const nonce = pollNonce.current;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const res = await getSimulation(id);
        if (!alive) return;
        const s = pollNonce.current === nonce ? res.simulation : null;
        if (s) {
          if (s.config?.pace !== paceRef.current) {
            // A pace switch was lost in flight: the server is simulating a
            // config the pills no longer show. Re-fire the prepare (at most
            // twice, one at a time), then show what exists rather than
            // nothing forever.
            if (healing.current) {
              // a heal is mid-flight — keep ticking, decide on its outcome
            } else if (healTries.current < 2) {
              healTries.current++;
              healing.current = true;
              prepareSimulation(id, paceRef.current)
                .then(() => { pollNonce.current++; setPollTick(t => t + 1); })
                .catch(() => { /* next poll retries via the counter */ })
                .finally(() => { healing.current = false; });
            } else {
              setSim(s);
              if (s.status === 'done' || s.status === 'failed') return;
            }
          } else {
            healTries.current = 0;
            setSim(s);
            if (s.status === 'done' || s.status === 'failed') return;
          }
        }
      } catch { /* poll again */ }
      if (alive) setTimeout(tick, 2200);
    };
    tick();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pollTick]);

  /** The drawer's re-run: correct an input, rebuild + resimulate the same
   *  pace, and replay the lanes with a before/after delta. Polling resumes
   *  whether or not the round-trip succeeds. */
  const editInput = useCallback((key: string, value: string) => {
    const id = sessionId.current;
    if (!id) return;
    setPrevSim(sim);
    setEditedKey(key);
    setSim(null);
    pollNonce.current++; // in-flight responses for the old run are stale
    postAnswer(id, key, value)
      .then(() => prepareSimulation(id, pace))
      .catch(() => { setEditedKey(null); setPrevSim(null); })
      .finally(() => setPollTick(t => t + 1));
  }, [pace, sim]);

  /** v29 "Your pace": price a user-named runway, fold it into the verdict's
   *  pace ladder, select it, and pre-generate its draft. Resolves false when
   *  pricing fails (the pills simply stay as they were). */
  const priceCustom = useCallback((weeks: number): Promise<boolean> => {
    const id = sessionId.current;
    if (!id) return Promise.resolve(false);
    return priceCustomPace(id, weeks)
      .then(res => {
        setVerdict(v => v
          ? { ...v, pace_options: [...(v.pace_options ?? []).filter(o => o.key !== 'custom'), res.pace] }
          : v);
        setPace('custom');
        setPrevSim(null); setEditedKey(null); setSim(null);
        healTries.current = 0;
        pollNonce.current++;
        prepareSimulation(id, 'custom').catch(() => {}).finally(() => setPollTick(t => t + 1));
        return true;
      })
      .catch(() => false);
  }, []);

  /** Pace pill switch: simulate THAT config and replay (owner decision 2).
   *  Polling resumes whether or not the prepare lands — a lost POST is then
   *  repaired by the poll loop's self-heal. */
  const switchPace = useCallback((p: PaceKey) => {
    const id = sessionId.current;
    setPace(p);
    if (!id) return;
    setPrevSim(null);
    setEditedKey(null);
    setSim(null);
    healTries.current = 0;
    pollNonce.current++; // in-flight responses for the old pace are stale
    prepareSimulation(id, p)
      .catch(() => { /* self-heal re-fires it from the poll loop */ })
      .finally(() => setPollTick(t => t + 1));
  }, []);

  /** Back to a blank intake — new goal, new session. */
  const reset = useCallback(() => {
    sessionId.current = null;
    retryAction.current = null;
    setGoalText('');
    setQuestion(null);
    setQuestionCount(0);
    setQa([]);
    setVerdict(null);
    setRefusal(null);
    setPace('steady');
    setVariant('offer');
    setSim(null);
    setPrevSim(null);
    setEditedKey(null);
    pollNonce.current++;
    healTries.current = 0;
    healing.current = false;
    setPickedOdds(null);
    setProtocol(null);
    setError(null);
    setOwnPlanMode(false);
    setPhase('intake');
  }, []);

  const retry = useCallback(() => { retryAction.current?.(); }, []);

  /** The odds of whatever was actually built — the chosen pace, or the
   *  original ask's honest number when the user insisted on the attempt. */
  const chosenOdds =
    variant === 'original'
      ? verdict?.original_probability
      : verdict?.pace_options?.find(o => o.key === pace)?.success_probability ?? verdict?.success_probability;

  /** The statement of whatever was built — mirrors chosenOdds. */
  const chosenStatement =
    variant === 'original' ? (verdict?.original_request ?? goalText) : verdict?.goal_statement;

  const acceptedPlan: AcceptedPlan | null =
    protocol && verdict
      // durationWeeks comes from the PROTOCOL: a sprint or relaxed pace means
      // the verdict's headline weeks and the generated plan's weeks differ.
      ? { goalText, statement: chosenStatement ?? verdict.goal_statement, durationWeeks: protocol.duration_weeks, odds: pickedOdds ?? chosenOdds, protocol, coachSessionId: sessionId.current ?? undefined }
      : null;

  return {
    phase, goalText, question, questionCount, qa, verdict, refusal, protocol, error,
    pace, setPace, chosenOdds, pickedOdds, repriceWithDrops, chosenStatement, buildOriginal,
    assumptions, quickPicks, missingRequired, fixAssumption,
    sim, prevSim, editedKey, editInput, switchPace, priceCustom, verdictAnswers,
    submitGoal, answerQuestion, buildPlan, reset, retry, acceptedPlan, ownPlanMode,
  };
}

export type CoachFlow = ReturnType<typeof useCoachFlow>;
