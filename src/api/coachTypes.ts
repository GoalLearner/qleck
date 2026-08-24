// Client-side types for the qleck-api coach surface.
//
// Protocol types are imported straight from the backend source — one repo, one
// schema, zero drift (backend/src/protocolSchema.ts is dependency-free, so the
// app can type-import it even though backend/ is excluded from the app's
// tsconfig). Verdict + response envelopes are mirrored here because their
// backend home (coach.ts) pulls in Worker-only types.
export type {
  Protocol, ProtocolMilestone, ProtocolPhase, ProtocolStep, RepKind,
} from '../../backend/src/protocolSchema';
import type { Protocol } from '../../backend/src/protocolSchema';

export interface Verdict {
  decision: 'feasible' | 'counter_offer' | 'declined';
  goal_statement: string;
  duration_weeks: number;
  assessment: string;
  original_request?: string;
  success_factors: string[];
}

export interface CoachQuestion {
  question: string;
  why_it_matters: string;
}

export interface CoachRefusal {
  category: string;
  message: string;
}

/** Successful responses from /coach/sessions and .../messages */
export type CoachTurnResponse =
  | { sessionId: string; type: 'question'; question: CoachQuestion }
  | { sessionId: string; type: 'verdict'; verdict: Verdict }
  | { sessionId: string; type: 'refused'; refusal: CoachRefusal };

export interface ProtocolResponse {
  sessionId: string;
  type: 'protocol';
  protocol: Protocol;
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
