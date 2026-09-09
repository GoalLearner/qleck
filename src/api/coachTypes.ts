// Client-side types for the qleck-api coach surface.
//
// Protocol types are imported straight from the backend source — one repo, one
// schema, zero drift (backend/src/protocolSchema.ts is dependency-free, so the
// app can type-import it even though backend/ is excluded from the app's
// tsconfig). Verdict + response envelopes are mirrored here because their
// backend home (coach.ts) pulls in Worker-only types.
export type {
  Protocol, ProtocolMilestone, ProtocolPhase, ProtocolSession, ProtocolStep, RepKind,
} from '../../backend/src/protocolSchema';
import type { Protocol } from '../../backend/src/protocolSchema';

export type PaceKey = 'sprint' | 'steady' | 'relaxed' | 'custom';

/** The attempt floor, mirrored from the server (backend/src/index.ts). Qoach
 *  will not build a plan it prices below this — the original ask on a
 *  counter-offer, or a runway the user named. The server enforces it; the
 *  client only states it, and never fires a build it knows will be refused. */
export const ATTEMPT_FLOOR = 20;

/** One edit to an unlocked plan — mirrors backend/src/protocolEdit.ts. The
 *  server applies it to the STORED protocol; server-owned fields (id,
 *  session_id, derived_from, how_to, source…) are not in the patch on
 *  purpose, and are ignored if sent. */
export type ProtocolEditOp =
  | {
      op: 'update';
      step_id: string;
      patch: {
        title?: string;
        kind?: 'binary' | 'quantity' | 'duration';
        frequency?: { per_week?: number; days?: string[] };
        quantity?: { amount?: number; unit?: string };
        duration_minutes?: number;
        details?: string;
      };
    }
  | {
      op: 'add';
      phase_id: string;
      step: {
        title: string;
        kind: 'binary' | 'quantity' | 'duration';
        frequency: { per_week: number; days?: string[] };
        quantity?: { amount: number; unit: string };
        duration_minutes?: number;
        details?: string;
        /** Only a step that came from the suggest call untouched. */
        source?: 'user' | 'qoach';
      };
    };

export interface PaceOption {
  key: PaceKey;
  duration_weeks: number;
  success_probability: number;
  note: string;
}

export interface Verdict {
  decision: 'feasible' | 'counter_offer' | 'declined';
  goal_statement: string;
  duration_weeks: number;
  assessment: string;
  original_request?: string;
  success_factors: string[];
  /** Coach-judged percent (70-97) that the plan lands IF followed. Absent on
   *  verdicts stored before prompt v16. */
  success_probability?: number;
  /** counter_offer only: the same honest read on the ORIGINAL ask. */
  original_probability?: number;
  /** counter_offer only: the ORIGINAL ask's own timeline in weeks. */
  original_duration_weeks?: number;
  /** Parallel to success_factors: one line each on how the factor moves the
   *  odds. Absent on verdicts stored before prompt v18. */
  success_factor_notes?: string[];
  /** v28: one line under the goal title — the verdict's essence. */
  subtitle?: string;
  /** v28 (design turn 7): the assessment carved into three tap-to-expand
   *  read cards; server-validated, absent on older verdicts. */
  reads?: { kind: 'for' | 'risk' | 'move'; line: string; detail: string; lever?: string; from: string[] }[];
  /** feasible only: 2-3 paces for the same goal; steady mirrors the verdict's
   *  own duration and probability. Absent before prompt v19, and dropped by
   *  the server when malformed. */
  pace_options?: PaceOption[];
}

export interface CoachQuestion {
  question: string;
  why_it_matters: string;
  // 3-4 quick-pick answers from the coach; free text stays available. Older
  // sessions / defensive: may be absent.
  suggested_answers?: string[];
}

export interface CoachRefusal {
  category: string;
  message: string;
}

/** Successful responses from /coach/sessions and .../messages */
export type CoachTurnResponse =
  | { sessionId: string; type: 'question'; question: CoachQuestion }
  | { sessionId: string; type: 'verdict'; verdict: Verdict; domain?: string | null; answers?: Record<string, string>; missing_required?: string[]; quick_picks?: Record<string, string[]> }
  | { sessionId: string; type: 'refused'; refusal: CoachRefusal };

/* ── 2c simulation (mirrors backend/src/scenarios.ts) ─────────────────── */

export interface ScenarioWeek {
  week: number;
  state_value: number;
  adherence: number;
  event?: string;
}

export interface ScenarioRun {
  key: string;
  name: string;
  short: string;
  hit: boolean;
  first_failure_key: string | null;
  first_failure_reason: string | null;
  fail_week?: number;
  mark?: string;
  cg?: boolean;
  state_unit?: string;
  weeks: ScenarioWeek[];
  invalid?: boolean;
}

export interface SimulationState {
  status: 'generating' | 'simulating' | 'done' | 'failed';
  config: { pace: string; variant: string | null };
  granularity?: 'weeks' | 'days';
  steps?: number;
  state_unit?: string;
  lanes: ScenarioRun[];
  planned: { key: string; name: string; short: string }[];
  odds?: { rubric: number; pass_rate: number; blended: number };
  factors?: { key: string; direction: 'up' | 'down'; weight: number }[];
  error?: string;
}

export interface SimulationPoll {
  sessionId: string;
  simulation: SimulationState | null;
  draft_ready: boolean;
  current_odds: number | null;
}

export interface StepAssumption {
  step_id: string;
  title: string;
  assumption: string;
  key: string | null;
}

export interface ProtocolResponse {
  sessionId: string;
  type: 'protocol';
  protocol: Protocol;
  /** Steps whose numbers rest on assumptions the user can correct. */
  assumptions?: StepAssumption[];
  correctable_keys?: string[];
  quick_picks?: Record<string, string[]>;
}

/** Normalized client-side failure. `retryable` drives the Retry affordance. */
export interface CoachError {
  kind: 'quota' | 'unavailable' | 'network' | 'bad_request';
  message: string;
  retryable: boolean;
}

export class CoachApiError extends Error {
  readonly info: CoachError;
  constructor(info: CoachError) {
    super(info.message);
    this.info = info;
  }
}
