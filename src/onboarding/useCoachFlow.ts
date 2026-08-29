// Client state machine for the Qoach intake conversation (ROADMAP.md P1).
// Mirrors the server's session states — the server is authoritative (turn
// caps, safety, validation); this hook only tracks what to render.
//
// intake → thinking → question (3-5, server-enforced) → verdict → building →
// protocol; refusal / error can land from any AI step. The designed canvas
// screens will render these states; until then plain screens do.
import { useCallback, useEffect, useRef, useState } from 'react';
import { answerCoachQuestion, generateProtocol, getSimulation, postAnswer, prepareSimulation, startCoachSession } from '../api/coach';
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

  const submitGoal = useCallback((text: string) => {
    const goal = text.trim();
    if (!goal) return;
    setGoalText(goal);
    setPhase('thinking');
    startCoachSession(goal).then(handleTurn, err => fail(err, () => submitGoal(goal)));
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
    setPhase('building');
    generateProtocol(id, pace).then(
      res => { setProtocol(res.protocol); captureAssumptions(res); setPhase('protocol'); },
      err => fail(err, buildPlan),
    );
  }, [fail, pace]);

  /** The attempt: build the ORIGINAL ask, eyes open. Server enforces the
   *  20% floor; this only exists on counter-offers that clear it. */
  const buildOriginal = useCallback(() => {
    const id = sessionId.current;
    if (!id) return;
    setVariant('original');
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
    postAnswer(id, key, value.trim())
      .then(() => generateProtocol(id))
      .then(
        res => { setProtocol(res.protocol); captureAssumptions(res); setPhase('protocol'); },
        err => fail(err, () => fixAssumption(key, value)),
      );
  }, [fail]);

  // Poll the simulation while a verdict is showing. Stops on done/failed;
  // restarts when a re-run bumps the nonce.
  useEffect(() => {
    if (phase !== 'verdict') return;
    const id = sessionId.current;
    if (!id) return;
    const nonce = pollNonce.current;
    let alive = true;
    const tick = async () => {
      if (!alive || pollNonce.current !== nonce) return;
      try {
        const res = await getSimulation(id);
        if (!alive || pollNonce.current !== nonce) return;
        if (res.simulation) setSim(res.simulation);
        if (res.simulation && (res.simulation.status === 'done' || res.simulation.status === 'failed')) return;
      } catch { /* poll again */ }
      setTimeout(tick, 2200);
    };
    tick();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pollTick]);

  /** The drawer's re-run: correct an input, rebuild + resimulate the same
   *  pace, and replay the lanes with a before/after delta. */
  const editInput = useCallback((key: string, value: string) => {
    const id = sessionId.current;
    if (!id) return;
    setPrevSim(sim);
    setEditedKey(key);
    setSim(null);
    pollNonce.current++;
    postAnswer(id, key, value)
      .then(() => prepareSimulation(id, pace))
      .then(() => { pollNonce.current++; setSim(null); setPollTick(t => t + 1); })
      .catch(() => { /* the poll simply keeps whatever state exists */ });
  }, [pace, sim]);

  /** Pace pill switch: simulate THAT config and replay (owner decision 2). */
  const switchPace = useCallback((p: PaceKey) => {
    const id = sessionId.current;
    setPace(p);
    if (!id) return;
    setPrevSim(null);
    setEditedKey(null);
    setSim(null);
    pollNonce.current++;
    prepareSimulation(id, p).then(() => setPollTick(t => t + 1)).catch(() => {});
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
    setProtocol(null);
    setError(null);
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
      ? { goalText, statement: chosenStatement ?? verdict.goal_statement, durationWeeks: protocol.duration_weeks, odds: chosenOdds, protocol, coachSessionId: sessionId.current ?? undefined }
      : null;

  return {
    phase, goalText, question, questionCount, qa, verdict, refusal, protocol, error,
    pace, setPace, chosenOdds, chosenStatement, buildOriginal,
    assumptions, quickPicks, missingRequired, fixAssumption,
    sim, prevSim, editedKey, editInput, switchPace, verdictAnswers,
    submitGoal, answerQuestion, buildPlan, reset, retry, acceptedPlan,
  };
}

export type CoachFlow = ReturnType<typeof useCoachFlow>;
