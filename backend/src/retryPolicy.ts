/**
 * What the NEXT generation attempt should look like.
 *
 * Pulled out of the generation loops so it can be checked without a model
 * call — `npm run check:retry`. The loops themselves need the provider.
 *
 * The loop's job is to spend at most three model calls turning a rejected
 * plan into a valid one. Production on 7 Sep spent all three and got nowhere:
 * a plan whose phase weeks overlapped, then two correction attempts that each
 * returned the identical protocol, byte for byte. Attempts 1 and 2 even sent
 * the identical correction prompt — necessarily, since the thing being
 * corrected had not changed. Roughly forty seconds and two paid calls bought
 * exactly nothing, and the user got "The coach hit a snag".
 *
 * Two rules, and both say the same thing: a request that has already been
 * answered should not be sent again unchanged.
 *
 *   1. Nothing to correct -> retry CLEAN. Already true for a NULL emission
 *      ("asking a model to minimally correct `null` spends the attempt it was
 *      given to recover"). A repeat is the same situation wearing different
 *      clothes: the model has read the errors and declined to move, so the
 *      correction has demonstrably failed and re-sending it is the waste.
 *   2. A stuck sampler needs a different sample. The temperature goes up for
 *      that one attempt — not as a general loosening, only where the evidence
 *      says the default has settled into a groove it will not leave.
 */

/** What the generator normally samples at. */
export const GEN_TEMPERATURE = 0.4;
/** Only after the model has re-emitted the same protocol it was asked to fix. */
export const STUCK_TEMPERATURE = 0.9;

export interface AttemptPlan {
  /** Send the previous emission plus its errors, and ask for a fix. */
  correcting: boolean;
  temperature: number;
  /** Why this attempt differs, for the log line. Null on an ordinary attempt. */
  reason: 'no_previous_emission' | 'model_repeated_itself' | null;
}

export function planNextAttempt(input: {
  attempt: number;
  /** The previous attempt's parsed tool input, or null/undefined if it emitted nothing. */
  lastOutput: unknown;
  /** True when the previous emission was identical to the one before it. */
  repeated: boolean;
}): AttemptPlan {
  const { attempt, lastOutput, repeated } = input;
  if (attempt === 0) return { correcting: false, temperature: GEN_TEMPERATURE, reason: null };
  if (lastOutput === null || lastOutput === undefined) {
    return { correcting: false, temperature: GEN_TEMPERATURE, reason: 'no_previous_emission' };
  }
  if (repeated) {
    return { correcting: false, temperature: STUCK_TEMPERATURE, reason: 'model_repeated_itself' };
  }
  return { correcting: true, temperature: GEN_TEMPERATURE, reason: null };
}

/** Stable identity of an emission, for spotting a model that has not moved.
 *  Key order is whatever the model emitted, which is the point: this is
 *  comparing two answers to the same question, not two arbitrary objects. */
export function emissionFingerprint(toolInput: unknown): string | null {
  if (toolInput === null || toolInput === undefined) return null;
  try {
    return JSON.stringify(toolInput);
  } catch {
    return null;                                   // circular: treat as unknown
  }
}
