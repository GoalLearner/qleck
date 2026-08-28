// Client state machine for the Qoach intake conversation (ROADMAP.md P1).
// Mirrors the server's session states — the server is authoritative (turn
// caps, safety, validation); this hook only tracks what to render.
//
// intake → thinking → question (3-5, server-enforced) → verdict → building →
// protocol; refusal / error can land from any AI step. The designed canvas
// screens will render these states; until then plain screens do.
import { useCallback, useRef, useState } from 'react';
import { answerCoachQuestion, generateProtocol, startCoachSession } from '../api/coach';
import type { PaceKey } from '../api/coachTypes';
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
  | 'protocol'    // plan on screen
  | 'refused'     // safety refusal / decline
  | 'error';      // normalized failure, maybe retryable

export interface AcceptedPlan {
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

  const buildPlan = useCallback(() => {
    const id = sessionId.current;
    if (!id) return;
    setPhase('building');
    generateProtocol(id, pace).then(
      res => { setProtocol(res.protocol); setPhase('protocol'); },
      err => fail(err, buildPlan),
    );
  }, [fail, pace]);

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
    setProtocol(null);
    setError(null);
    setPhase('intake');
  }, []);

  const retry = useCallback(() => { retryAction.current?.(); }, []);

  /** The odds of whatever pace was chosen — what the reveal chip shows and
   *  what the goal record keeps. */
  const chosenOdds =
    verdict?.pace_options?.find(o => o.key === pace)?.success_probability ?? verdict?.success_probability;

  const acceptedPlan: AcceptedPlan | null =
    protocol && verdict
      // durationWeeks comes from the PROTOCOL: a sprint or relaxed pace means
      // the verdict's headline weeks and the generated plan's weeks differ.
      ? { goalText, statement: verdict.goal_statement, durationWeeks: protocol.duration_weeks, odds: chosenOdds, protocol }
      : null;

  return {
    phase, goalText, question, questionCount, qa, verdict, refusal, protocol, error,
    pace, setPace, chosenOdds,
    submitGoal, answerQuestion, buildPlan, reset, retry, acceptedPlan,
  };
}

export type CoachFlow = ReturnType<typeof useCoachFlow>;
