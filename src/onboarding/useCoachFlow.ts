// Client state machine for the Qoach intake conversation (ROADMAP.md P1).
// Mirrors the server's session states — the server is authoritative (turn
// caps, safety, validation); this hook only tracks what to render.
//
// intake → thinking → question (3-5, server-enforced) → verdict → building →
// protocol; refusal / error can land from any AI step. The designed canvas
// screens will render these states; until then plain screens do.
import { useCallback, useEffect, useRef, useState } from 'react';
import { answerCoachQuestion, editProtocol, generateProtocol, getProtocolJob, getSimulation, postAnswer, prepareSimulation, priceCustomPace, repriceTicks as apiRepriceTicks, rewindCoachSession, startCoachSession } from '../api/coach';
import type { BuildingResponse, JobView, PaceKey, ProtocolEditOp, ProtocolJobPoll, ProtocolResponse, SimulationState, StepAssumption } from '../api/coachTypes';
import {
  ATTEMPT_FLOOR, CoachApiError, REWIND_CAP, type CoachError, type CoachQuestion, type CoachRefusal,
  type CoachTurnResponse, type Protocol, type Verdict,
} from '../api/coachTypes';

/** Why Qoach kept an answer the user tried to change. Each of these leaves
 *  the conversation exactly where it was, so it is a line in the chat — not
 *  the snag screen. Anything else (network, quota, a 5xx) is a real failure
 *  and goes through `fail`, where Retry replays the change safely. */
const REWIND_REFUSED: Record<string, string> = {
  rewind_cap: `That's ${REWIND_CAP} changes, the most one conversation takes. Carry on from here.`,
  rewind_unavailable: "This conversation can't go back. Carry on from here.",
  unchanged_answer: 'That’s the answer you already gave.',
  invalid_index: "That answer can't be changed now. Carry on from here.",
  session_not_open: "That answer can't be changed now. Carry on from here.",
};

export type CoachPhase =
  | 'intake'      // typing the goal
  | 'thinking'    // waiting on session-start / answer
  | 'question'    // Qoach asked something
  | 'predict'     // verdict in hand, waiting on the user's own guess
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

export function useCoachFlow(opts?: { askEstimate?: boolean }) {
  const [phase, setPhase] = useState<CoachPhase>('intake');
  // Held in a ref so handleTurn keeps its [] deps: it is the single funnel for
  // every AI turn and must never capture a stale value.
  const askEstimate = useRef(!!opts?.askEstimate);
  askEstimate.current = !!opts?.askEstimate;
  /** What the user said their own odds were, before seeing Qoach's. */
  const [estimate, setEstimate] = useState<number | null>(null);
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
  // Build 33: the durable draft job. `job` is what the wait screen reads
  // while a build is in flight; `draftJob` / `draftReady` are the verdict
  // page's view of the background draft for the pace on screen.
  const [job, setJob] = useState<JobView | null>(null);
  const jobNonce = useRef(0);
  const [draftJob, setDraftJob] = useState<JobView | null>(null);
  const [draftReady, setDraftReady] = useState(false);

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
      // The verdict is already in state either way — 'predict' only withholds
      // the REVEAL, so the guess screen can read it if it ever needs to.
      setPhase(askEstimate.current ? 'predict' : 'verdict');
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

  // Changed answers this conversation (the server caps it at REWIND_CAP),
  // and the line that says why Qoach kept one.
  const [rewinds, setRewinds] = useState(0);
  const [rewindNote, setRewindNote] = useState<string | null>(null);
  // One conversation call at a time: a double tap on send must not become
  // two turns (the server converges them, but the thread would flicker).
  const turnBusy = useRef(false);

  const answerQuestion = useCallback((answer: string) => {
    const a = answer.trim();
    const id = sessionId.current;
    if (!a || !id || turnBusy.current) return;
    // The question being answered, sent along so a retry of an answer that
    // already landed replays its turn rather than answering the next one.
    const index = qa.length - 1;
    const run = () => {
      turnBusy.current = true;
      setRewindNote(null);
      setQa(prev => prev.map((entry, i) => (i === index ? { ...entry, answer: a } : entry)));
      setPhase('thinking');
      answerCoachQuestion(id, a, index)
        .then(handleTurn, err => fail(err, run))
        .finally(() => { turnBusy.current = false; });
    };
    run();
  }, [qa, fail, handleTurn]);

  /**
   * Go back to question `index` and answer it again (15 Sep, the testers'
   * "fix an answer instead of starting over"). The question keeps its text,
   * takes the new answer, and everything after it is dropped — Qoach carries
   * on from there as if that had been the answer all along. When Qoach says
   * no, the thread is put back exactly as it was.
   */
  const rewindTo = useCallback((index: number, answer: string) => {
    const a = answer.trim();
    const id = sessionId.current;
    if (!a || !id || turnBusy.current) return;
    if (!Number.isInteger(index) || index < 0 || index >= qa.length - 1) return;
    if (qa[index].answer === a) return; // nothing changed — nothing to send
    const before = qa;
    const kept = qa.slice(0, index + 1).map((entry, i) => (i === index ? { ...entry, answer: a } : entry));
    const run = () => {
      turnBusy.current = true;
      setRewindNote(null);
      setQa(kept);
      setQuestionCount(kept.length);
      setPhase('thinking');
      rewindCoachSession(id, index, a)
        .then(res => { setRewinds(n => n + 1); handleTurn(res); }, err => {
          const code = err instanceof CoachApiError ? err.info.code : undefined;
          const refused = code ? REWIND_REFUSED[code] : undefined;
          if (!refused) { fail(err, run); return; }
          setQa(before);
          setQuestionCount(before.length);
          if (code === 'rewind_cap' || code === 'rewind_unavailable') setRewinds(REWIND_CAP);
          setRewindNote(refused);
          setPhase('question');
        })
        .finally(() => { turnBusy.current = false; });
    };
    run();
  }, [qa, fail, handleTurn]);

  // Which pace the user picked on the verdict screen. Steady is the coach's
  // recommendation and the default; the choice re-times protocol generation
  // and decides which odds the reveal chip carries.
  const [pace, setPace] = useState<PaceKey>('steady');

  // Which side of a counter-offer got built: Qoach's version (default) or
  // the user's ORIGINAL ask (the 20%+ attempt the owner granted them).
  const [variant, setVariant] = useState<'offer' | 'original'>('offer');
  const paceRef = useRef(pace);
  paceRef.current = pace;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  // Build 33: the build is asynchronous. POST /protocol answers either the
  // plan (the fast path — the background draft was ready) or 202 {building,
  // job}; then GET …/protocol/job is polled until the job lands, and the
  // accept is asked for again, which is then the fast path. Nothing here
  // holds model work inside a request the client could time out — the ~60s
  // iOS default used to turn a slow build into "hit a snag" while the server
  // finished anyway.
  const JOB_POLL_MS = 2200;
  const JOB_CEILING_MS = 6 * 60_000;
  const jobFailure = (j: JobView): CoachError => ({
    kind: 'unavailable', retryable: true,
    message:
      j.reason === 'validators'
        ? 'Qoach wrote three drafts and none passed its own checks. It happens on unusual goals — try once more, or change the goal.'
        : j.reason === 'transport'
          ? 'Qoach couldn’t reach its model. Try again in a moment.'
          : 'The build got lost on the way. Try again.',
  });
  const settle = useCallback((
    res: ProtocolResponse | BuildingResponse,
    again: () => Promise<ProtocolResponse | BuildingResponse>,
    retry: () => void,
  ) => {
    if (res.type === 'protocol') {
      setJob(null);
      setProtocol(res.protocol); captureAssumptions(res); setPhase('protocol');
      return;
    }
    setJob(res.job);
    if (res.job.status === 'failed') { fail(jobFailure(res.job), retry); return; }
    const id = res.sessionId;
    const nonce = ++jobNonce.current;
    const started = Date.now();
    const tick = async () => {
      if (jobNonce.current !== nonce) return;
      await new Promise(r => setTimeout(r, JOB_POLL_MS));
      if (jobNonce.current !== nonce) return;
      let p: ProtocolJobPoll | null = null;
      try { p = await getProtocolJob(id); } catch { /* a blip — poll again */ }
      if (jobNonce.current !== nonce) return;
      if (p) {
        setJob(p.job);
        if (p.status === 'protocol' || p.draft_ready || !p.job || p.job.status === 'done' || p.job.status === 'superseded') {
          // Ask for the accept again: the fast path now — or, with no job on
          // file for this config (or one the server set aside), the server
          // starts a fresh one and we land back here.
          again().then(
            r => { if (jobNonce.current === nonce) settle(r, again, retry); },
            err => { if (jobNonce.current === nonce) fail(err, retry); },
          );
          return;
        }
        if (p.job.status === 'failed') { fail(jobFailure(p.job), retry); return; }
      }
      if (Date.now() - started > JOB_CEILING_MS) {
        fail({ kind: 'unavailable', retryable: true, message: 'The build is taking far longer than it should. Try again.' }, retry);
        return;
      }
      void tick();
    };
    void tick();
  }, [fail]);

  const buildPlan = useCallback((paceOverride?: PaceKey, opts?: { retry?: boolean }) => {
    const id = sessionId.current;
    if (!id) return;
    // A counter-offer's buttons name the pace they build — "Build my plan —
    // 5 weeks" or "Take the deal" — because on that page the pill and the
    // button can disagree, and the button is what the user meant. Validated
    // rather than trusted: PrimaryButton hands its press event to onPress, so
    // a bare `onPress={onBuild}` arrives here with an event where a pace
    // would be.
    const use: PaceKey =
      paceOverride === 'sprint' || paceOverride === 'steady' || paceOverride === 'relaxed' || paceOverride === 'custom'
        ? paceOverride
        : pace;
    setPace(use);
    setVariant('offer');
    setPickedOdds(null);
    setOddsStale(false);
    setPhase('building');
    setJob(null);
    const again = () => generateProtocol(id, use, undefined, estimate);
    generateProtocol(id, use, undefined, estimate, { retry: !!opts?.retry }).then(
      res => settle(res, again, () => buildPlan(use, { retry: true })),
      err => fail(err, () => buildPlan(use)),
    );
  }, [fail, pace, estimate, settle]);

  // Tier-1B: the commitment picker's repriced odds — dropping commitments
  // before locking can only lower the number, and this is where the lowered
  // number lives (the lock and the reveal chip both prefer it).
  const [pickedOdds, setPickedOdds] = useState<number | null>(null);
  // True once an edit has changed the work itself: no number on file
  // describes the plan any more, and the reveal must not show one until it
  // is re-priced or locked. A details-only edit does not set it.
  const [oddsStale, setOddsStale] = useState(false);
  /** The reps that are OFF and the price of the plan without them (build 36).
   *  `plan` is what locks; `odds` is null when Qoach could not price it. */
  const [ticks, setTicks] = useState<{ ids: string[]; plan: Protocol; odds: number | null; cost: string | null } | null>(null);

  /**
   * Price the plan as it stands — the whole set of reps that are off, sent
   * every time, so the number always describes what is on screen. An empty
   * set is the plan as designed, at its own number.
   */
  const repriceTicks = useCallback((ids: string[]): Promise<
    { odds: number | null; cost: string | null } | { error: string } | null
  > => {
    const id = sessionId.current;
    if (!id) return Promise.resolve(null);
    return apiRepriceTicks(id, ids)
      .then(res => {
        if (res.error && !res.protocol) return { error: res.error };
        if (!res.protocol) return null;
        const odds = typeof res.odds === 'number' ? res.odds : null;
        setTicks(ids.length ? { ids, plan: res.protocol, odds, cost: res.cost ?? null } : null);
        setPickedOdds(odds);
        // The price describes the work as it stands now, so nothing on this
        // plan is unpriced any more — unless Qoach could not price it, and
        // then the chip says exactly that.
        setOddsStale(odds === null);
        return res.error ? { error: res.error } : { odds, cost: res.cost ?? null };
      })
      .catch(() => null);
  }, []);


  /** One edit to the accepted plan. The server applies it to the stored
   *  protocol; a refusal comes back with the reason and nothing changes. A
   *  change to the work itself makes the odds stale until the plan is
   *  re-priced or locked. Null = the call itself failed. */
  const applyEdit = useCallback((op: ProtocolEditOp): Promise<{ refused?: { step_id: string; reason: string } } | null> => {
    const id = sessionId.current;
    if (!id) return Promise.resolve(null);
    return editProtocol(id, op)
      .then(res => {
        if (res.refused) return { refused: res.refused };
        if (!res.protocol) return null;
        setProtocol(res.protocol);
        setAssumptions(res.assumptions ?? []);
        setQuickPicks(res.quick_picks ?? {});
        if (res.pricing === 'stale') { setOddsStale(true); setPickedOdds(null); }
        // The priced set described the plan BEFORE this edit. Whatever is
        // ticked off stays ticked off, but it has to be priced again.
        setTicks(null);
        return {};
      })
      .catch(() => null);
  }, []);

  /** The attempt: build the ORIGINAL ask, eyes open. Server enforces the
   *  20% floor; this only exists on counter-offers that clear it. */
  const buildOriginal = useCallback((opts?: { retry?: boolean }) => {
    const id = sessionId.current;
    if (!id) return;
    setVariant('original');
    setPickedOdds(null);
    setOddsStale(false);
    setTicks(null);
    setPhase('building');
    setJob(null);
    // `estimate` is in the deps now: the closure used to be created once
    // with a null guess and sent that null on every attempt build.
    const again = () => generateProtocol(id, undefined, 'original', estimate);
    generateProtocol(id, undefined, 'original', estimate, { retry: !!opts?.retry }).then(
      res => settle(res, again, () => buildOriginal({ retry: true })),
      err => fail(err, () => buildOriginal()),
    );
  }, [fail, estimate, settle]);

  /** "Assumed ~170 lb — fix": supply the real value, rebuild the protocol.
   *  The server clears the stored plan, so the regeneration derives every
   *  dependent number from the corrected key. */
  const fixAssumption = useCallback((key: string, value: string) => {
    const id = sessionId.current;
    if (!id || !value.trim()) return;
    setPhase('rebuilding');
    setPickedOdds(null);
    // The rebuild is a NEW plan at the chosen pace's odds — priced, not
    // stale. Leaving this set meant a corrected assumption produced a plan
    // that showed no number and locked without one.
    setOddsStale(false);
    setTicks(null);
    setJob(null);
    // The rebuild keeps the pace and the side that were built. It used to
    // fall back to steady / the offer, so a corrected number came back on a
    // plan the user had not chosen.
    const v = variantRef.current === 'original' ? 'original' as const : undefined;
    const again = () => generateProtocol(id, paceRef.current, v, estimate);
    postAnswer(id, key, value.trim())
      .then(again)
      .then(
        res => settle(res, again, () => fixAssumption(key, value)),
        err => fail(err, () => fixAssumption(key, value)),
      );
  }, [fail, estimate, settle]);

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
        // Build 33: the draft job for the pace on screen. Its liveness keeps
        // this loop going after a born-failed sim (SIMULATIONS off), and its
        // readiness is the "opens instantly" line under the build button —
        // only for exactly the config the button would build.
        const d = pollNonce.current === nonce ? (res.draft ?? null) : null;
        if (pollNonce.current === nonce) {
          setDraftJob(d);
          setDraftReady(!!res.draft_ready && d?.config?.pace === paceRef.current && (d?.config?.variant ?? null) === null);
        }
        const draftLive = !!d && (d.status === 'queued' || d.status === 'running');
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
              if ((s.status === 'done' || s.status === 'failed') && !draftLive) return;
            }
          } else {
            healTries.current = 0;
            setSim(s);
            if ((s.status === 'done' || s.status === 'failed') && !draftLive) return;
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
    setDraftJob(null); setDraftReady(false);
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
        // Below the floor the number is shown but never built: selecting it
        // would fire a prepare the server refuses, and the poll loop's
        // self-heal would keep re-firing it. The pills stay where they were.
        if (res.pace.success_probability < ATTEMPT_FLOOR) return true;
        setPace('custom');
        setPrevSim(null); setEditedKey(null); setSim(null);
        setDraftJob(null); setDraftReady(false);
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
    setDraftJob(null); setDraftReady(false);
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
    jobNonce.current++;
    setJob(null);
    setDraftJob(null);
    setDraftReady(false);
    healTries.current = 0;
    healing.current = false;
    setPickedOdds(null);
    setEstimate(null);
    setProtocol(null);
    setError(null);
    setOwnPlanMode(false);
    setTicks(null);
    setRewinds(0);
    setRewindNote(null);
    setPhase('intake');
  }, []);

  /** Their call, then the reveal. `null` is the skip — no guess, no comparison. */
  const commitEstimate = useCallback((pct: number | null) => {
    setEstimate(pct);
    setPhase('verdict');
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
      // An edited, not-yet-re-priced plan locks with NO odds rather than the
      // number of the plan it used to be; parseCreateGoal treats absence as a
      // fine state. "Re-price & lock" (step 1c) makes this the rare path.
      // What locks is the plan the ticks describe, at the price of THAT
      // plan — never the full plan with a trimmed plan's number on it.
      ? { goalText, statement: chosenStatement ?? verdict.goal_statement, durationWeeks: (ticks?.plan ?? protocol).duration_weeks, odds: oddsStale ? undefined : (ticks ? ticks.odds ?? undefined : (pickedOdds ?? chosenOdds)), protocol: ticks?.plan ?? protocol, coachSessionId: sessionId.current ?? undefined }
      : null;

  return {
    phase, goalText, question, questionCount, qa, verdict, refusal, protocol, error,
    pace, setPace, chosenOdds, pickedOdds, oddsStale, applyEdit, chosenStatement, buildOriginal,
    ticks, repriceTicks,
    assumptions, quickPicks, missingRequired, fixAssumption,
    sim, prevSim, editedKey, editInput, switchPace, priceCustom, verdictAnswers,
    submitGoal, answerQuestion, buildPlan, reset, retry, acceptedPlan, ownPlanMode,
    rewindTo, rewindsLeft: Math.max(0, REWIND_CAP - rewinds), rewindNote,
    estimate, commitEstimate,
    job, draftJob, draftReady,
  };
}

export type CoachFlow = ReturnType<typeof useCoachFlow>;
